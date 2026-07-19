/**
 * projects.json → inventory import (quick-kayinleong-039).
 *
 * DRY-RUN BY DEFAULT (project convention T-03-31 — mutations require --apply).
 *
 *   Dry-run:  LLM-extracts the strict ProjectDoc fields (price, bedrooms, tenure,
 *             vp, bumi/foreign, location) from each Skool write-up, validates the
 *             mapping, and writes a reviewable preview (projects.inventory.json).
 *             NO Firestore writes, NO embeddings.
 *   --apply:  reads the preview and calls the REAL inventory pipeline:
 *             createProject() (embeds + writes) + attachCollateral() (each Drive
 *             folder link as CollateralDoc.externalUrl — D-09/C2, no Drive API).
 *
 * Model is resolved via modelFor('finder') → Firestore appConfig/modelConfig
 * (model-agnostic, C5). Credentials load from .env.local (never read/committed).
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/scrape-skool/to-inventory.ts            # dry-run
 *   tsx --env-file=.env.local scripts/scrape-skool/to-inventory.ts --apply    # write
 *   ... --limit 5        (cap for a trial)
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";
import { generateObject } from "ai";
import type { AuthenticatedUser } from "@/src/firebase/auth";

const APPLY = process.argv.includes("--apply");
const METER = process.argv.includes("--meter");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();
const PROJECTS_JSON = process.env.PROJECTS_JSON || path.resolve(process.cwd(), "projects.json");
const PREVIEW = process.env.INVENTORY_PREVIEW || path.resolve(process.cwd(), "projects.inventory.json");
const TOKENS_JSON = process.env.TOKENS_JSON || path.resolve(process.cwd(), "projects.tokens.json");
const TODAY = "2026-07-19";
const MAX_APPLY = 200;
const ADMIN: AuthenticatedUser = { uid: "skool-import-039", role: "admin", tenantId: "d2" };

// ─── extraction schema ──────────────────────────────────────────────────────
const Extracted = z.object({
  priceValueRM: z
    .number()
    .describe("Asking/from price in Malaysian Ringgit as a plain integer (e.g. 1200000). Lowest price if a range is given. 0 if no price is stated."),
  bedrooms: z.number().int().describe("Representative bedroom count — the SMALLEST layout offered. 0 if not stated."),
  tenure: z.string().describe("'Freehold' or 'Leasehold' (append expiry year if given, e.g. 'Leasehold 2119'). '' if unknown."),
  completed: z.boolean().describe(`true if Vacant Possession / completion has ALREADY occurred as of ${TODAY}; false if upcoming/under construction.`),
  completionYear: z.number().int().nullable().describe("Stated VP/completion year (e.g. 2028), else null."),
  bumiQuota: z.boolean().describe("true if the write-up mentions bumiputera units/quota/lots."),
  foreignEligible: z.boolean().describe("true if it mentions foreign-buyer eligibility / MM2H / foreign purchase; false if not mentioned."),
  locationText: z.string().describe("Concise location: neighbourhood/area, city, nearby transit/landmarks mentioned."),
});
type Extracted = z.infer<typeof Extracted>;

interface ProjectInput {
  name: string;
  status: "active";
  priceValue: number;
  tenure: string;
  vpStatus: boolean;
  vpDate: string | null; // ISO in preview; converted to Date on apply
  bumiQuota: boolean;
  foreignEligible: boolean;
  description: string;
  locationText: string;
  bedrooms: number;
}
interface Collateral {
  type: string;
  lang: "en";
  externalUrl: string;
}

const REQUIRED = ["name", "status", "priceValue", "tenure", "vpStatus", "bumiQuota", "foreignEligible", "description", "locationText", "bedrooms"] as const;

function toInput(p: any, ex: Extracted): ProjectInput {
  const vpDate = ex.completed && ex.completionYear ? new Date(Date.UTC(ex.completionYear, 0, 1)).toISOString() : null;
  return {
    name: p.titleClean,
    status: "active",
    priceValue: Number.isFinite(ex.priceValueRM) ? ex.priceValueRM : 0,
    tenure: ex.tenure?.trim() || "Unknown",
    vpStatus: !!ex.completed,
    vpDate,
    bumiQuota: !!ex.bumiQuota,
    foreignEligible: !!ex.foreignEligible,
    description: p.body.text,
    locationText: ex.locationText?.trim() || p.section.replace(/^Project List:\s*/, ""),
    bedrooms: Number.isInteger(ex.bedrooms) ? ex.bedrooms : 0,
  };
}

function validate(input: ProjectInput): string[] {
  const errs: string[] = [];
  for (const f of REQUIRED) {
    const v = (input as any)[f];
    if (v === undefined || v === null || v === "") errs.push(`missing ${f}`);
  }
  if (typeof input.priceValue !== "number") errs.push("priceValue not a number");
  if (typeof input.bedrooms !== "number") errs.push("bedrooms not a number");
  return errs;
}

function collateralType(text: string): string {
  const t = (text || "").toLowerCase();
  if (/project info|info|developer|internal/.test(t)) return "project-info";
  if (/fb ads|ads/.test(t)) return "fb-ads";
  if (/reel/.test(t)) return "reels";
  if (/drone|fpv/.test(t)) return "drone-footage";
  if (/showroom|walkthrough|video/.test(t)) return "showroom-video";
  if (/demand gen/.test(t)) return "demand-gen";
  if (/teaser/.test(t)) return "teaser";
  if (/docs\.google/.test(t)) return "google-doc";
  return "drive";
}
function collateralFor(p: any): Collateral[] {
  const seen = new Set<string>();
  const out: Collateral[] = [];
  for (const l of p.body.links || []) {
    if (/drive\.google\.com|docs\.google\.com/.test(l.href) && !seen.has(l.href)) {
      seen.add(l.href);
      out.push({ type: collateralType(l.text || l.href), lang: "en", externalUrl: l.href });
    }
  }
  return out;
}

// Shared extraction prompt (used for the LLM call AND for token estimation on apply).
const EXTRACT_SYSTEM = `You extract structured Malaysian real-estate fields from a D2 project write-up. Today is ${TODAY}. Be conservative — only assert a boolean when the text supports it. Prices are in RM.`;
function extractPrompt(p: any): string {
  return `Project: ${p.title}\nRegion: ${p.section}\n\nWrite-up:\n${String(p.body.text).slice(0, 6000)}`;
}

async function dryRun() {
  // ETL tooling: model is configurable via EXTRACT_MODEL (a valid current model id),
  // else falls back to the app's model-agnostic modelFor('finder'). Not hard-coded.
  let model: any;
  if (process.env.EXTRACT_MODEL) {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    // A stray ANTHROPIC_BASE_URL (e.g. missing the /v1 path) causes 404s — pin the
    // real endpoint explicitly. API key comes from .env.local.
    const anthropic = createAnthropic({
      baseURL: process.env.EXTRACT_BASE_URL || "https://api.anthropic.com/v1",
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    model = anthropic(process.env.EXTRACT_MODEL);
    console.log(`[dry-run] model: ${process.env.EXTRACT_MODEL} @ ${process.env.EXTRACT_BASE_URL || "https://api.anthropic.com/v1"}`);
  } else {
    const { modelFor } = await import("@/src/llm/provider");
    model = await modelFor("finder");
    console.log("[dry-run] model: modelFor('finder')");
  }
  const data = JSON.parse(readFileSync(PROJECTS_JSON, "utf8"));
  const projects = data.projects.slice(0, LIMIT);
  console.log(`[dry-run] extracting fields for ${projects.length} projects…`);

  const records: any[] = [];
  let priceUnknown = 0,
    bedUnknown = 0,
    extractErrors = 0,
    collTotal = 0;
  for (const p of projects) {
    let ex: Extracted;
    try {
      const r = await generateObject({ model, schema: Extracted, system: EXTRACT_SYSTEM, prompt: extractPrompt(p) });
      ex = r.object;
    } catch (e) {
      extractErrors++;
      records.push({ sourceId: p.id, sourceUrl: p.url, error: (e as Error).message });
      console.log(`  ✗ ${p.titleClean} — extraction failed: ${(e as Error).message}`);
      continue;
    }
    const input = toInput(p, ex);
    const errs = validate(input);
    const collateral = collateralFor(p);
    collTotal += collateral.length;
    if (input.priceValue === 0) priceUnknown++;
    if (input.bedrooms === 0) bedUnknown++;
    records.push({ sourceId: p.id, sourceUrl: p.url, input, collateral, extraction: ex, validationErrors: errs });
    console.log(
      `  ✓ ${input.name} — RM${input.priceValue.toLocaleString()} · ${input.bedrooms}BR · ${input.tenure} · vp=${input.vpStatus} bumi=${input.bumiQuota} foreign=${input.foreignEligible} · ${collateral.length} collateral${errs.length ? "  ⚠ " + errs.join(",") : ""}`,
    );
  }

  const withErrors = records.filter((r) => r.validationErrors?.length).length;
  const out = {
    generatedAt: new Date().toISOString(),
    source: PROJECTS_JSON,
    target: "inventory (projects + collateral)",
    count: records.length,
    stats: { extractErrors, withValidationErrors: withErrors, priceUnknown, bedroomsUnknown: bedUnknown, collateralTotal: collTotal },
    records,
  };
  writeFileSync(PREVIEW, JSON.stringify(out, null, 2));
  console.log(`\n[dry-run] DONE — ${records.length} mapped, ${withErrors} with validation errors, ${extractErrors} extraction failures`);
  console.log(`[dry-run] priceValue=0 (unknown): ${priceUnknown} · bedrooms=0 (unknown): ${bedUnknown} · collateral links: ${collTotal}`);
  console.log(`[dry-run] preview → ${PREVIEW}`);
  console.log(`[dry-run] review it, then re-run with --apply to write to Firestore.`);
}

async function apply() {
  if (!existsSync(PREVIEW)) throw new Error(`no preview at ${PREVIEW} — run the dry-run first`);
  const preview = JSON.parse(readFileSync(PREVIEW, "utf8"));
  const valid = preview.records.filter((r: any) => r.input && !(r.validationErrors?.length)).slice(0, LIMIT);
  if (valid.length > MAX_APPLY) throw new Error(`safety cap: ${valid.length} > ${MAX_APPLY}`);

  const pid = process.env.FIREBASE_PROJECT_ID || "";
  const pidMasked = pid ? `${pid.slice(0, 4)}…${pid.slice(-4)}` : "(from .env.local)";
  console.log("─".repeat(64));
  console.log(`APPLY MODE — writing ${valid.length} projects + collateral to Firestore.`);
  console.log(`Target project: ${pidMasked}`);
  console.log("─".repeat(64));

  const { createProject, attachCollateral } = await import("@/src/inventory/crud");
  const { composeProjectEmbeddingText } = await import("@/src/inventory/embedText");
  const { priceBandFor } = await import("@/src/firebase/collections");
  const { encode } = await import("gpt-tokenizer");
  const tok = (s: string) => {
    try {
      return encode(s || "").length;
    } catch {
      return Math.ceil((s || "").length / 4);
    }
  };
  // Join back to source write-ups so we can estimate the extraction-prompt tokens.
  const src = JSON.parse(readFileSync(PROJECTS_JSON, "utf8"));
  const byId = new Map<string, any>(src.projects.map((p: any) => [p.id, p]));

  // Resume support: skip projects already written in a prior run (by name),
  // so re-running only imports the remaining/failed ones (no duplicates).
  const priorRows: any[] = existsSync(TOKENS_JSON)
    ? (() => {
        try {
          return JSON.parse(readFileSync(TOKENS_JSON, "utf8")).perProject || [];
        } catch {
          return [];
        }
      })()
    : [];
  const done = new Set<string>(priorRows.map((r: any) => r.name));
  const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

  let created = 0,
    coll = 0,
    skipped = 0;
  const errors: any[] = [];
  const allRows: any[] = [...priorRows];

  for (const r of valid) {
    if (done.has(r.input.name)) {
      skipped++;
      continue;
    }
    // Per-project token estimate: extraction prompt + extracted JSON + embedding text.
    const p = byId.get(r.sourceId);
    const extIn = p ? tok(EXTRACT_SYSTEM + "\n" + extractPrompt(p)) : 0;
    const extOut = tok(JSON.stringify(r.extraction || {}));
    const embDoc = { ...r.input, vpDate: null, tenantId: "d2", priceBand: priceBandFor(r.input.priceValue), embedding: [] };
    const embTok = tok(composeProjectEmbeddingText(embDoc as any));
    const total = extIn + extOut + embTok;

    try {
      const input = { ...r.input, vpDate: r.input.vpDate ? new Date(r.input.vpDate) : null };
      const { projectId } = await createProject(ADMIN, input as any);
      created++;
      for (const c of r.collateral || []) {
        await attachCollateral(ADMIN, projectId, { type: c.type, lang: c.lang, externalUrl: c.externalUrl });
        coll++;
      }
      allRows.push({ name: r.input.name, projectId, extractionInputTokens: extIn, extractionOutputTokens: extOut, embeddingTokens: embTok, totalTokens: total });
      done.add(r.input.name);
      console.log(`  [${created}] ${r.input.name} → ${projectId} (+${(r.collateral || []).length} coll) · tokens ext ${extIn}+${extOut} emb ${embTok} = ${total}`);
      writeFileSync(TOKENS_JSON, JSON.stringify(buildReport(allRows), null, 2)); // checkpoint each success (resumable)
    } catch (e) {
      errors.push({ name: r.input.name, error: (e as Error).message });
      console.log(`  ✗ ${r.input.name}: ${(e as Error).message}`);
    }
    await sleep(Number(process.env.EMBED_DELAY_MS || 1200)); // pace to respect Gemini embedding RPM
  }

  const report = buildReport(allRows);
  writeFileSync(TOKENS_JSON, JSON.stringify(report, null, 2));

  console.log(`\nAPPLIED — ${created} new projects, ${coll} collateral docs, ${skipped} skipped (already done), ${errors.length} errors`);
  console.log(
    `TOKENS (est, cumulative over ${allRows.length}) — extraction ${report.totals.extractionInputTokens}+${report.totals.extractionOutputTokens}, embedding ${report.totals.embeddingTokens}, TOTAL ${report.totals.totalTokens} (avg ${report.totals.avgTokensPerProject}/project)`,
  );
  console.log(`Token report → ${TOKENS_JSON}`);
  if (errors.length) console.log("Failed (retry later): " + errors.map((e) => e.name).join(", "));
}

function buildReport(rows: any[]) {
  const T = rows.reduce(
    (a, r) => ({ i: a.i + (r.extractionInputTokens || 0), o: a.o + (r.extractionOutputTokens || 0), e: a.e + (r.embeddingTokens || 0) }),
    { i: 0, o: 0, e: 0 },
  );
  const total = T.i + T.o + T.e;
  return {
    meteredAt: new Date().toISOString(),
    extractionModel: process.env.EXTRACT_MODEL || "modelFor(finder)",
    tokenizer: "gpt-tokenizer (ESTIMATE — approximates Claude/Gemini token counts, not exact billing)",
    note: "Per-project token estimates for the extraction prompt+output and the Gemini embedding text.",
    totals: { extractionInputTokens: T.i, extractionOutputTokens: T.o, embeddingTokens: T.e, totalTokens: total, avgTokensPerProject: Math.round(total / (rows.length || 1)) },
    perProject: rows,
  };
}

// ─── meter: EXACT per-project token usage ───────────────────────────────────
// Extraction: real `usage` from re-running generateObject (Anthropic).
// Embedding: Gemini countTokens on the embedding text (exact; no generation quota).
async function meter() {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const anthropic = createAnthropic({
    baseURL: process.env.EXTRACT_BASE_URL || "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
  const model = anthropic(process.env.EXTRACT_MODEL || "claude-haiku-4-5-20251001");
  const { priceBandFor } = await import("@/src/firebase/collections");
  const { composeProjectEmbeddingText } = await import("@/src/inventory/embedText");
  const { encode } = await import("gpt-tokenizer");
  const est = (s: string) => {
    try {
      return encode(s || "").length;
    } catch {
      return Math.ceil((s || "").length / 4);
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const gKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "";

  async function embedTokens(text: string): Promise<{ tokens: number; exact: boolean }> {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:countTokens?key=${gKey}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text }] }] }) },
      );
      if (res.ok) {
        const j: any = await res.json();
        if (typeof j.totalTokens === "number") return { tokens: j.totalTokens, exact: true };
      }
    } catch {
      /* fall through to estimate */
    }
    return { tokens: est(text), exact: false };
  }

  const src = JSON.parse(readFileSync(PROJECTS_JSON, "utf8"));
  const byId = new Map<string, any>(src.projects.map((p: any) => [p.id, p]));
  const preview = JSON.parse(readFileSync(PREVIEW, "utf8"));
  const recs = preview.records.filter((r: any) => r.input).slice(0, LIMIT);
  console.log(`[meter] exact token usage for ${recs.length} projects (extraction=Anthropic usage, embedding=Gemini countTokens)…`);

  const rows: any[] = [];
  for (const r of recs) {
    const p = byId.get(r.sourceId);
    let extIn = 0,
      extOut = 0,
      extExact = false;
    try {
      const g = await generateObject({ model, schema: Extracted, system: EXTRACT_SYSTEM, prompt: extractPrompt(p) });
      const u: any = g.usage || {};
      extIn = u.inputTokens ?? u.promptTokens ?? 0;
      extOut = u.outputTokens ?? u.completionTokens ?? 0;
      extExact = extIn > 0;
    } catch (e) {
      extIn = est(EXTRACT_SYSTEM + "\n" + extractPrompt(p));
      extOut = est(JSON.stringify(r.extraction || {}));
      console.log(`  ⚠ ext estimated (${(e as Error).message}) for ${r.input.name}`);
    }
    const doc = { ...r.input, vpDate: null, tenantId: "d2", priceBand: priceBandFor(r.input.priceValue), embedding: [] };
    const emb = await embedTokens(composeProjectEmbeddingText(doc as any));
    const total = extIn + extOut + emb.tokens;
    rows.push({
      name: r.input.name,
      extractionInputTokens: extIn,
      extractionOutputTokens: extOut,
      extractionExact: extExact,
      embeddingTokens: emb.tokens,
      embeddingExact: emb.exact,
      totalTokens: total,
    });
    console.log(`  ${r.input.name} — ext ${extIn}+${extOut}${extExact ? "" : "(est)"} · emb ${emb.tokens}${emb.exact ? "" : "(est)"} = ${total}`);
    await sleep(Number(process.env.METER_DELAY_MS || 350));
  }

  const T = rows.reduce((a, r) => ({ i: a.i + r.extractionInputTokens, o: a.o + r.extractionOutputTokens, e: a.e + r.embeddingTokens }), { i: 0, o: 0, e: 0 });
  const total = T.i + T.o + T.e;
  const report = {
    meteredAt: new Date().toISOString(),
    method: "exact API usage",
    extractionModel: process.env.EXTRACT_MODEL || "claude-haiku-4-5-20251001",
    extractionSource: rows.every((r) => r.extractionExact) ? "exact (Anthropic usage)" : "mostly exact (some estimated on error)",
    embeddingModel: "gemini-embedding-001",
    embeddingSource: rows.every((r) => r.embeddingExact) ? "exact (Gemini countTokens)" : "mixed (some estimated)",
    totals: { extractionInputTokens: T.i, extractionOutputTokens: T.o, embeddingTokens: T.e, totalTokens: total, avgTokensPerProject: Math.round(total / (rows.length || 1)) },
    perProject: rows,
  };
  writeFileSync(TOKENS_JSON, JSON.stringify(report, null, 2));
  console.log(`\n[meter] EXACT — extraction ${T.i}+${T.o}, embedding ${T.e}, TOTAL ${total} (avg ${report.totals.avgTokensPerProject}/project over ${rows.length})`);
  console.log(`[meter] report → ${TOKENS_JSON}`);
}

(METER ? meter() : APPLY ? apply() : dryRun()).catch((e) => {
  console.error("[to-inventory] fatal:", e);
  process.exit(1);
});
