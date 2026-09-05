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
 *
 * Env (quick-kayinleong-088):
 *   EXTRACT_PROVIDER   'anthropic' (default) | 'google'. Selects the extraction provider;
 *                      see buildExtractModel(). Google reads GOOGLE_GENERATIVE_AI_API_KEY
 *                      and uses the Gemini Developer API (never Vertex).
 *   EXTRACT_MODEL      Model id for the chosen provider, e.g. 'gemini-3.5-flash'.
 *                      Unset → falls back to modelFor('finder') on the dry-run path.
 *   EXTRACT_BASE_URL   Anthropic endpoint override (the /v1 pin). Anthropic path only.
 *   EXTRACT_MAX_CHARS  Write-up characters sent to the model (default 24000).
 *
 * Embeddings are always Gemini gemini-embedding-001 @1024-d regardless of the
 * extraction provider — that is a separate, fixed decision (see .planning/TSD.md).
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

// ─── psf sanity range (quick-kayinleong-088) ────────────────────────────────
/**
 * Plausible **asking** price-per-sqft range for Malaysian residential stock, in RM.
 *
 * The trap this guards: nearly every write-up states a maintenance / sinking-fund rate
 * one or two lines away from the asking rate, and it is also written "RM… psf" —
 * "Est. RM0.38 psf (inclusive of sinking fund)", "Maintenance Fee: RM0.715 psf",
 * "Maintenance Fee: RM0.80 psf". Those are RM0.20–2.00 psf. Letting one through as an
 * asking rate produces a field that is wrong by three orders of magnitude.
 *
 * Enforced twice on purpose: stated in the schema `.describe()` (so the model sees it)
 * AND clamped in `sanePsf()` below (so a model that ignores it cannot corrupt the
 * field). The clamp zeroes rather than throwing — a zod `.min()/.max()` bound would
 * turn one bad number into a lost record, and `0` already means "not stated" here.
 */
const PSF_MIN = 200;
const PSF_MAX = 5000;

/** Keep a psf rate only if it is inside the plausible ASKING band; else 0 ("not stated"). */
function sanePsf(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < PSF_MIN || n > PSF_MAX) return 0;
  return Math.round(n);
}

// ─── extraction schema ──────────────────────────────────────────────────────
const Extracted = z.object({
  priceValueRM: z
    .number()
    .describe(
      "TOTAL asking price in Malaysian Ringgit as a plain integer (e.g. 1200000), copied from a total that is WRITTEN VERBATIM in the text. Lowest figure if a total range is given. " +
        "Otherwise 0. NEVER calculate it: do not multiply a per-square-foot rate by any size, do not use a size you inferred or that appears elsewhere, do not derive it from a monthly instalment, a loan margin, a booking fee or a discount, and do not copy a price quoted for a DIFFERENT (comparable/competitor) project. " +
        "If the text states only a psf rate, priceValueRM is 0 and the rate goes in pricePsfMin/pricePsfMax.",
    ),
  priceEvidence: z
    .string()
    .describe(
      "The exact substring from the write-up that states the total price, copied character-for-character (e.g. 'All from RM1.72mil'). Empty string when priceValueRM is 0. This is checked against the source text — a quote that is not present verbatim causes the price to be discarded.",
    ),
  pricePsfMin: z
    .number()
    .describe(
      `Lowest stated ASKING price per square foot in RM (e.g. 720 from "Gross Price: RM720 psf"; 900 from "RM900-1000psf"). 0 if no asking psf rate is stated. ` +
        `A valid asking rate is between ${PSF_MIN} and ${PSF_MAX} RM psf. ` +
        `Do NOT use the maintenance fee / service charge / sinking-fund psf — that is RM0.20–2.00 psf (e.g. "Maintenance Fee: RM0.715 psf", "Est. RM0.38 psf (inclusive of sinking fund)") and must be ignored entirely. ` +
        `Do NOT use a psf rate quoted for a comparable or competitor project. Do NOT use a loan-margin cap (e.g. "BOC: 90% (up to RM1,200 psf)").`,
    ),
  pricePsfMax: z
    .number()
    .describe(
      `Highest stated ASKING price per square foot in RM (1000 from "RM900-1000psf"). Same value as pricePsfMin when a single rate is quoted. 0 if none stated. Same exclusions as pricePsfMin — never the maintenance/sinking-fund psf, never a comparable project's rate.`,
    ),
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
  /** Stated asking psf rate, RM (quick-kayinleong-088). null = none stated. */
  pricePsfMin: number | null;
  pricePsfMax: number | null;
  /** Where priceValue came from — see ProjectDoc.priceProvenance. */
  priceProvenance: "stated" | "psf_only" | "unknown";
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

/** Collapse whitespace + normalise the dash/currency variants writers mix, for quote matching. */
function normalizeForQuote(s: string): string {
  return String(s || "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Verify a model-reported total price against the source text (quick-kayinleong-088).
 *
 * The defect this closes: the extractor was inventing totals by multiplying a stated psf
 * rate by a square footage it made up — Luminar Residence Subang ("Gross Price: RM720
 * psf", no total anywhere) was stored as RM360,000; The Lantern Bangsar ("RM1,400 psf")
 * as RM798,800. 21 of 51 stored prices had no total in their source. A prompt alone
 * cannot be trusted to stop that, so the price only survives if the model's `priceEvidence`
 * quote is actually present in the write-up.
 *
 * Rejection zeroes the price (`priceBandFor(0)` → 'price_unknown', the existing sentinel)
 * rather than dropping the record — an unknown price is honest, a fabricated one is not.
 */
function priceFrom(p: any, ex: Extracted): { priceValue: number; rejected: string | null } {
  const claimed = Number.isFinite(ex.priceValueRM) ? Math.round(ex.priceValueRM) : 0;
  if (claimed <= 0) return { priceValue: 0, rejected: null };
  const quote = normalizeForQuote(ex.priceEvidence);
  if (!quote) return { priceValue: 0, rejected: "no priceEvidence quote supplied" };
  // Match against the FULL write-up, not the truncated prompt slice — a quote from the
  // visible portion is what matters, and the full text is a superset of it.
  if (!normalizeForQuote(p?.body?.text).includes(quote)) {
    return { priceValue: 0, rejected: `priceEvidence not found verbatim in source: "${ex.priceEvidence.slice(0, 80)}"` };
  }
  return { priceValue: claimed, rejected: null };
}

function toInput(p: any, ex: Extracted): { input: ProjectInput; priceRejected: string | null } {
  const vpDate = ex.completed && ex.completionYear ? new Date(Date.UTC(ex.completionYear, 0, 1)).toISOString() : null;
  const { priceValue, rejected } = priceFrom(p, ex);
  const psfLo = sanePsf(ex.pricePsfMin);
  const psfHi = sanePsf(ex.pricePsfMax);
  // A lone bound is a valid single rate; order them so min <= max whichever way they came back.
  const bounds = [psfLo, psfHi].filter((n) => n > 0).sort((a, b) => a - b);
  const pricePsfMin = bounds.length ? bounds[0] : null;
  const pricePsfMax = bounds.length ? bounds[bounds.length - 1] : null;
  return {
    input: {
      name: p.titleClean,
      status: "active",
      priceValue,
      pricePsfMin,
      pricePsfMax,
      priceProvenance: priceValue > 0 ? "stated" : pricePsfMin !== null ? "psf_only" : "unknown",
      tenure: ex.tenure?.trim() || "Unknown",
      vpStatus: !!ex.completed,
      vpDate,
      bumiQuota: !!ex.bumiQuota,
      foreignEligible: !!ex.foreignEligible,
      description: p.body.text,
      locationText: ex.locationText?.trim() || p.section.replace(/^Project List:\s*/, ""),
      bedrooms: Number.isInteger(ex.bedrooms) ? ex.bedrooms : 0,
    },
    priceRejected: rejected,
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
const EXTRACT_SYSTEM = `You extract structured Malaysian real-estate fields from a D2 project write-up. Today is ${TODAY}. Prices are in RM.

You are a TRANSCRIBER, not an analyst. Every number you emit must be readable in the text. Only assert a boolean when the text supports it.

PRICE RULES — these are the rules this extractor exists to enforce; breaking them corrupts the property database:
1. priceValueRM is a TOTAL price and ONLY ever a total price that is written verbatim in the write-up. Copy it; never compute it.
2. NO ARITHMETIC OF ANY KIND. Do not multiply a per-square-foot rate by a square footage — not by a size stated in the text, not by a typical size, not by a size you infer from the layout, not by anything. Multiplying "RM720 psf" by a made-up 500 sqft to report 360000 is the single worst error you can make here; the correct answer in that case is priceValueRM = 0.
3. If the write-up quotes only a psf rate (e.g. "Gross Price: RM720 psf", "Price: RM1,400 psf (Gross)", "RM900-1000psf"), then priceValueRM = 0 and the rate goes in pricePsfMin/pricePsfMax.
4. A ceiling or a marketing claim is not a total. "Prices below RM800K!!" is not a price — it is an upper bound; priceValueRM = 0.
5. Ignore prices quoted for OTHER projects. Write-ups list competitors for comparison ("Nadi Bangsar RM1300psf", "KL Eco City RM1300psf"). Those belong to neither field.
6. Booking fees, deposits, cancellation/admin charges, legal fees, monthly instalments, rental yields, loan margins and discounts are NOT prices.
7. The maintenance fee / service charge / sinking fund is quoted in the same "RM… psf" form as the asking rate and is usually one line away from it. It is RM0.20–2.00 psf. It is NEVER an asking psf rate. An asking rate is RM${PSF_MIN}–${PSF_MAX} psf. Anything below RM${PSF_MIN} psf is not an asking rate — leave the psf fields 0.
8. priceEvidence must be the exact characters you copied the total from, or an empty string. It is verified against the source text; an unverifiable quote discards the price.

When in doubt, emit 0. A missing price is correct and expected; an invented one is a defect.`;

/**
 * Characters of write-up handed to the model.
 *
 * Was 6000, which silently truncated the 3 longest write-ups mid-document and cost real
 * data: Royal Lexis KL states "All from RM1.72mil" at character 6,323 — past the cut —
 * so the extractor saw a write-up with no price at all. The longest write-up in
 * projects.json is 6,855 chars, so 24,000 covers the whole corpus with ~3.5x headroom.
 *
 * Token trade-off: 24,000 chars ≈ 6,000–7,000 input tokens worst case vs ≈1,500 before.
 * At 82 projects that is a few hundred thousand extra input tokens per full run — cheap
 * on a flash-tier model, and trivially within both Claude's and Gemini's context. The
 * cap stays in place (rather than being removed) so one pathological source document
 * cannot blow up a run; lower it via EXTRACT_MAX_CHARS if cost ever matters more than
 * completeness.
 */
const MAX_PROMPT_CHARS = Number(process.env.EXTRACT_MAX_CHARS || 24000);

function extractPrompt(p: any): string {
  return `Project: ${p.title}\nRegion: ${p.section}\n\nWrite-up:\n${String(p.body.text).slice(0, MAX_PROMPT_CHARS)}`;
}

// ─── extraction provider (quick-kayinleong-088) ─────────────────────────────
type ExtractProvider = "anthropic" | "google";

/**
 * Anthropic endpoint pin. A stray ANTHROPIC_BASE_URL in the environment (e.g. one
 * missing the `/v1` path) causes every call to 404, so the real endpoint is set
 * explicitly. Overridable via EXTRACT_BASE_URL. Anthropic path only — the Gemini
 * SDK default endpoint is correct and must not be pinned.
 */
const anthropicBaseUrl = () => process.env.EXTRACT_BASE_URL || "https://api.anthropic.com/v1";

/** Per-provider default, used only where the caller has no EXTRACT_MODEL (--meter). */
const DEFAULT_EXTRACT_MODEL: Record<ExtractProvider, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  google: "gemini-3.5-flash",
};

function extractProvider(): ExtractProvider {
  const raw = (process.env.EXTRACT_PROVIDER || "anthropic").trim().toLowerCase();
  if (raw !== "anthropic" && raw !== "google") {
    throw new Error(`EXTRACT_PROVIDER must be 'anthropic' or 'google' (got: ${raw})`);
  }
  return raw;
}

/** Provenance label for the token report: "<provider>:<model>", or null when unset. */
function extractModelLabel(): string | null {
  const id = process.env.EXTRACT_MODEL?.trim();
  return id ? `${extractProvider()}:${id}` : null;
}

/**
 * THE one place a provider is constructed — dryRun() and meter() both come through here
 * so the switch cannot drift between them.
 *
 * EXTRACT_PROVIDER=google      → Gemini via the Developer API (@ai-sdk/google,
 *                                GOOGLE_GENERATIVE_AI_API_KEY). NOT Vertex — Vertex is
 *                                outside the allowed Firebase/GCP surface.
 *                                Known-good extraction model: gemini-3.5-flash.
 * unset | 'anthropic'          → Anthropic, unchanged from before this switch existed,
 *                                base-URL pin included.
 *
 * Model id always comes from EXTRACT_MODEL; `useDefault` lets --meter fall back to the
 * per-provider default the way it always has. Keys are read from the environment only
 * (loaded from .env.local by --env-file) and never logged.
 */
async function buildExtractModel(useDefault = false): Promise<{ model: any; label: string }> {
  const provider = extractProvider();
  const modelId = process.env.EXTRACT_MODEL?.trim() || (useDefault ? DEFAULT_EXTRACT_MODEL[provider] : "");
  if (!modelId) throw new Error("no extraction model — set EXTRACT_MODEL");

  if (provider === "google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    return { model: google(modelId), label: `google:${modelId}` };
  }

  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const anthropic = createAnthropic({ baseURL: anthropicBaseUrl(), apiKey: process.env.ANTHROPIC_API_KEY });
  return { model: anthropic(modelId), label: `anthropic:${modelId} @ ${anthropicBaseUrl()}` };
}

async function dryRun() {
  // ETL tooling: model is configurable via EXTRACT_MODEL (a valid current model id),
  // else falls back to the app's model-agnostic modelFor('finder'). Not hard-coded.
  let model: any;
  if (process.env.EXTRACT_MODEL) {
    const built = await buildExtractModel();
    model = built.model;
    console.log(`[dry-run] model: ${built.label}`);
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
    collTotal = 0,
    priceRejects = 0,
    psfCaptured = 0;
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
    const { input, priceRejected } = toInput(p, ex);
    const errs = validate(input);
    const collateral = collateralFor(p);
    collTotal += collateral.length;
    if (input.priceValue === 0) priceUnknown++;
    if (input.bedrooms === 0) bedUnknown++;
    if (priceRejected) priceRejects++;
    if (input.pricePsfMin !== null) psfCaptured++;
    records.push({ sourceId: p.id, sourceUrl: p.url, input, collateral, extraction: ex, validationErrors: errs, priceRejected });
    const priceCol =
      input.priceValue > 0
        ? `RM${input.priceValue.toLocaleString()}`
        : input.pricePsfMin !== null
          ? `RM${input.pricePsfMin}${input.pricePsfMax !== input.pricePsfMin ? `-${input.pricePsfMax}` : ""} psf`
          : "price unknown";
    console.log(
      `  ✓ ${input.name} — ${priceCol} · ${input.bedrooms}BR · ${input.tenure} · vp=${input.vpStatus} bumi=${input.bumiQuota} foreign=${input.foreignEligible} · ${collateral.length} collateral${errs.length ? "  ⚠ " + errs.join(",") : ""}`,
    );
    // Surface every discarded price — a run with many of these means the model is still
    // trying to compute totals, and the prompt needs another turn of the screw.
    if (priceRejected) console.log(`      ⚠ price discarded — ${priceRejected}`);
  }

  const withErrors = records.filter((r) => r.validationErrors?.length).length;
  const out = {
    generatedAt: new Date().toISOString(),
    source: PROJECTS_JSON,
    target: "inventory (projects + collateral)",
    count: records.length,
    extractionModel: extractModelLabel() ?? "modelFor(finder)",
    stats: {
      extractErrors,
      withValidationErrors: withErrors,
      priceUnknown,
      bedroomsUnknown: bedUnknown,
      collateralTotal: collTotal,
      pricesDiscarded: priceRejects,
      psfCaptured,
    },
    records,
  };
  writeFileSync(PREVIEW, JSON.stringify(out, null, 2));
  console.log(`\n[dry-run] DONE — ${records.length} mapped, ${withErrors} with validation errors, ${extractErrors} extraction failures`);
  console.log(`[dry-run] priceValue=0 (unknown): ${priceUnknown} · bedrooms=0 (unknown): ${bedUnknown} · collateral links: ${collTotal}`);
  console.log(`[dry-run] psf rates captured: ${psfCaptured} · unverifiable prices discarded: ${priceRejects}`);
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
    extractionModel: extractModelLabel() ?? "modelFor(finder)",
    tokenizer: "gpt-tokenizer (ESTIMATE — approximates Claude/Gemini token counts, not exact billing)",
    note: "Per-project token estimates for the extraction prompt+output and the Gemini embedding text.",
    totals: { extractionInputTokens: T.i, extractionOutputTokens: T.o, embeddingTokens: T.e, totalTokens: total, avgTokensPerProject: Math.round(total / (rows.length || 1)) },
    perProject: rows,
  };
}

// ─── meter: EXACT per-project token usage ───────────────────────────────────
// Extraction: real `usage` from re-running generateObject on the configured provider.
// Embedding: Gemini countTokens on the embedding text (exact; no generation quota).
async function meter() {
  const { model, label: modelLabel } = await buildExtractModel(true);
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
  console.log(`[meter] exact token usage for ${recs.length} projects (extraction=${modelLabel} usage, embedding=Gemini countTokens)…`);

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
    extractionModel: modelLabel,
    extractionSource: rows.every((r) => r.extractionExact) ? "exact (provider usage)" : "mostly exact (some estimated on error)",
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
