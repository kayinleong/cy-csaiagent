# Phase 7: Console IA v2 — Net-new Surfaces - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 07-console-ia-v2-net-new-surfaces
**Mode:** `--auto` — every gray area auto-selected; recommended (least-privilege / minimal-surface / registry-consistent) option chosen without interactive prompts.
**Areas discussed:** Cohort data model · Agent profile pages · Coach-assignment · Conversation flagged queue · Audit-log viewer · Model-config UI · PDPA-settings display · days-to-first-close · Cross-cutting (collections/rules/gating/sequencing)

---

## Cohort data model + cardinality + ownership

| Option | Description | Selected |
|--------|-------------|----------|
| New `cohorts` collection + `cohortId` field on agentProfiles | Registry-pattern collection; membership via denormalized pointer | ✓ |
| UID array on the cohort doc | Members listed inline on the cohort document | |
| Join collection `cohortMembers` | Many-to-many membership table | |

**Choice:** New `cohorts/{cohortId}` collection (makeConverter, deny-by-default, rules-tested) + denormalized `cohortId?` on `AgentProfileDoc`; **one cohort per agent**; admin-write, admin/coach read, read-only DENIED. (D-01/D-02/D-03)
**Notes:** Array avoids the 1 MB doc trap; join collection is YAGNI for intake-batch semantics. Equality filter `where('cohortId','==',cid)` matches existing patterns.

---

## Agent profile pages — composition + access scope

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only drill-in from existing aggregations | agentProfiles + usageRollups + escalations/knowledgeGaps counts | ✓ |
| Editable profile (journey stage, leads) | Profile page can mutate journey state | |

**Choice:** Read-only composed view; admin sees any, senior-coach sees own-downline only with `auditDrilldown` on read; read-only role DENIED. (D-04/D-05)
**Notes:** Editing journey state risks the journey state machine — kept out. PII-bearing → read-only denied.

---

## Coach-assignment UI — backing field + who

| Option | Description | Selected |
|--------|-------------|----------|
| Write existing seniorCoachId + uplineCoachId, admin-only, audited | No schema change; mirrors role-assignment UI | ✓ |
| New assignment collection | Separate coach↔agent mapping table | |

**Choice:** Reassign by atomically writing the EXISTING `agentProfiles.seniorCoachId` + `users.uplineCoachId`; admin-only; audited; historical denorm rows left as-is. (D-06/D-07/D-08)
**Notes:** Both fields already exist — no schema change. Backfilling historical `seniorCoachId` on reassignment is deferred.

---

## Conversation flagged queue — mechanism + PII + access

| Option | Description | Selected |
|--------|-------------|----------|
| New `conversationFlags` collection, manual flag, ref-only | Mirrors escalations; conversationId reference, no content | ✓ |
| Flag field inline on conversation doc | Status flag stored on the conversation | |
| AI auto-flagging | Model detects risky conversations | |

**Choice:** New `conversationFlags/{flagId}` collection (status open/reviewed/dismissed, denormalized seniorCoachId), Admin-SDK writes, conversationId ref only (no content); manual coach/admin flag; admin sees all, coach sees own-downline; read-only DENIED. (D-09/D-10/D-11)
**Notes:** No-PII posture mirrors auditLogs/usageEvents; AI auto-flagging deferred.

---

## Audit-log viewer — what's shown + pagination + self-audit

| Option | Description | Selected |
|--------|-------------|----------|
| Admin read surface: actor/action/target/ts, bounded+filtered | Hashes not decoded; compliance traceability | ✓ |
| Attempt to decode/resolve hashes | Reverse-map hashes to PII | |

**Choice:** Admin-only read over `auditLogs`; show actor/action/targetRef/ts; hashes NOT decoded (one-way by design); bounded `orderBy ts desc limit 50` + cursor + filters; viewer does NOT self-audit (no PII touched). (D-12/D-13/D-14)
**Notes:** sha256 is one-way — decoding is impossible and out of scope. read-only DENIED (admin-read collection).

---

## Model-config admin UI — read/write scope + keys + safety

| Option | Description | Selected |
|--------|-------------|----------|
| Read+write `model.{pillar}.default` for 5 pillars via Admin SDK publishTemplate | Etag concurrency, admin-only, audited | ✓ |
| Read-only display of current model IDs | No write path | |
| Expose arbitrary Remote Config keys | Full template editor | |

**Choice:** Read AND write the 5 `model.{pillar}.default` keys (coach/finder/reply/router/grader) via `getServerTemplate → set → publishTemplate` with ETag optimistic concurrency; free-form model IDs (model-agnostic); confirm dialog + audit on publish; admin-only. (D-15/D-16/D-17)
**Notes:** Roadmap requires read/write. Only the 5 known keys editable (avoid breaking unrelated config). Reversible → confirm dialog, not type-to-confirm.

---

## PDPA-settings display — data source + access scope

| Option | Description | Selected |
|--------|-------------|----------|
| Admin-only static policy display from constants + erasure link | Policy-fixed; read-only widening deferred to Derek | ✓ |
| Widen to read-only role now | Stakeholder can view PDPA posture | |
| Editable PDPA knobs | Configurable retention/redaction/residency | |

**Choice:** Static read-only display (no knobs — locked in Phase 6) from a policy-constants module + link to existing erasure; admin-only for Phase 7; read-only widening recorded as an open Derek decision. (D-18/D-19)
**Notes:** Phase 6 locked read-only least-privilege; widening "requires an explicit user/Derek decision." No new knobs (redaction/residency are policy-bound).

---

## days-to-first-close — close signal capture + who + where

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal `firstCloseAt` field + audited coach/admin record action | One field; metric derived read-time | ✓ |
| Full `deals` collection | Deal value, project, multi-close history | |
| Derive from existing data | No new signal | |

**Choice:** Add `firstCloseAt?` to `AgentProfileDoc`, set by an idempotent audited "record first close" action (coach own-downline / admin); metric = firstCloseAt − onboarding start, computed read-time, shown in Analytics & Performance (aggregate) + agent profile (per-agent). (D-20/D-21/D-22)
**Notes:** No CRM/WABA pipeline exists to auto-derive a close; a full deals ledger is deferred. Wires the existing CDASH-05 funnel "first close" stage.

---

## Cross-cutting — collections / rules / gating / sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| 2 new collections + field adds; requireRole on all; read-only denied everywhere; Phase-6 wave order | Registry+rules-in-same-plan; server-side gate; least-privilege | ✓ |

**Choice:** `cohorts` + `conversationFlags` new collections (rules + rules-test in same plan); `cohortId`/`firstCloseAt` are field adds; every surface gated via `requireRole()`; read-only DENIED on all Phase-7 surfaces; surfaces placed into the 4 Phase-6 sections (hrefs unchanged); trilingual w/ i18n-parity CI; Wave-0 RED scaffold then data-model-before-surfaces. (D-23 → D-27)
**Notes:** Preserves the Phase-6 IA shell + least-privilege allow-list. No forbidden GCP — Remote Config write stays in the Firebase Admin SDK.

---

## Claude's Discretion
- Exact shadcn UI composition of each surface within Phase-6 section conventions.
- Whether cohort-management + coach-assignment share one page or split routes (keep deep links stable).
- Audit-log viewer pagination cursor mechanics (startAfter vs offset).
- Model-config conflict UX (retry vs reload) — never blind-overwrite.
- Per-agent vs cohort-level days-to-first-close presentation math (both required).

## Deferred Ideas
- Full `deals`/CRM ledger → future phase.
- AI auto-flagging of conversations → future phase.
- Historical `seniorCoachId` denorm backfill on reassignment → future / on-demand.
- Widening read-only role to PDPA-settings display → open Derek decision.
- Many-to-many / nested cohort membership → future phase.
- Editable agent journey state from the profile → out of scope (Coach pillar concern).
- WhatsApp Business API / any auto-send → Phase 8 (graduation-gated).
