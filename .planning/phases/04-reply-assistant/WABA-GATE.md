# WABA Graduation Gate (REPLY-12 / D-23)

**Status:** PROPOSED — Derek finalizes. Documented gate only; **zero integration code.**
**Owner:** Derek (project lead + KB owner) — product + legal sign-off.
**Authored:** 2026-06-05 (Phase 4, Plan 04-10).

> This is a planning artifact, not a feature. It defines the bar that must be met
> *before* anyone proposes building past the paste-and-draft Reply Assistant. It does
> NOT authorize, scaffold, or design any WhatsApp Business API (WABA) work. Nothing in
> the v1 codebase touches a WhatsApp Business API, an auto-send path, or a WhatsApp
> webhook — and nothing here changes that.

---

## 1. Purpose

The v1 Reply Assistant is **paste-and-draft, copy-out only**: an agent pastes an
incoming WhatsApp message, the model drafts a D2-grounded reply, the agent edits it,
copies it to the clipboard, and sends it from **their own phone**. The app never sends
anything.

"Graduating" past this model would mean integrating the **WhatsApp Business API (WABA)**
so drafts could be delivered (or edit-captured) through an official channel rather than
copy-paste. That is a large step up in reputational, PDPA, and operational risk — a
wrong-client reply sent automatically is the worst failure mode the platform has.

This gate exists so that step is **earned by evidence**, not taken on optimism. It is
explicitly **out of scope for v1** (REQUIREMENTS Out-of-Scope WABA-01; CLAUDE.md hard
constraint "No WhatsApp Business API in v1"). The criteria below are the proposed
evidence Derek would review before reopening the question.

**No WhatsApp Business API integration, library, webhook, or scaffold exists in v1, and this document creates none.**

---

## 2. Proposed Gate Metrics

Each metric is **PROPOSED — Derek finalizes**. Thresholds are starting points from
research (04-RESEARCH §Q9), not commitments. All must hold simultaneously over the same
pilot window before graduation is even discussed.

| # | Criterion | Proposed threshold (Derek finalizes) | Why it gates |
|---|-----------|----------------------------------------|--------------|
| G-1 | **Draft quality — edit rate** | Median `editRatio` **< 25%** sustained over **≥ 4 weeks** of pilot data | If agents still heavily rewrite drafts, the model is not yet trustworthy enough to move closer to send. |
| G-2 | **Zero wrong-client incidents** | **0** confirmed wrong-lead / wrong-client replies attributable to the assistant over the pilot window | The single worst failure mode. Any non-zero count blocks graduation outright. |
| G-3 | **Tone / voice quality** | Judge **tone PASS rate ≥ 90%** on the EN Reply gold sets (Opus judge from Remote Config) | Drafts must reliably sound like a D2 senior agent, not generic AI, before reducing the human-edit step. |
| G-4 | **PDPA cleanliness** | Audit log **clean of any `pdpa_redacted:false`** and zero PDPA coverage-test failures over the window | The Reply path carries the most PII. The redaction boundary must be provably airtight before any channel integration. |
| G-5 | **Signal volume floor** | **≥ N drafts / agent / week** (N is Derek's call, e.g. ≥ 5) | Without enough drafts the other metrics are noise, not signal. Graduation needs a statistically meaningful base. |

> **Thresholds (25%, 4 weeks, 90%, N) are PROPOSED placeholders. Derek sets the final
> numbers.** Promotion above paste-and-draft requires Derek's explicit product + legal
> sign-off (§4) — meeting the metrics is necessary, not sufficient.

---

## 3. Data Sources

Each criterion reads from existing v1 telemetry — no new instrumentation is required to
*evaluate* the gate (and none that touches WABA).

| Criterion | Source | Where it comes from |
|-----------|--------|---------------------|
| G-1 edit rate | `replyEdits` collection — `editRatio` per row | Read-time `count()` aggregation surfaced on the senior-coach / admin **Reply Quality** dashboard panel (REPLY-11 / ADMIN-06, Plan 04-10). Row-on-every-copy denominator (Pitfall E). |
| G-2 wrong-client incidents | Manual incident log + escalations | Reported by coaches / Derek; cross-checked against `escalations`. Not auto-derivable — a human judgement call (count must be 0). |
| G-3 tone PASS rate | `evals/` Reply gold-set scores | Promptfoo Reply gold-set runs scored by the Opus judge (model from Remote Config); the `eval-nightly` lazy-cron job records judge-rubric metrics. EN gold sets are canonical for this gate. |
| G-4 PDPA cleanliness | `auditLogs` + PDPA coverage test suite | Audit rows store hashes only; the gate checks for any `pdpa_redacted:false` and any coverage-test failure (`src/audit/pdpa.test.ts`). |
| G-5 draft volume | `replyEdits` count per agent per week | Same Reply Quality aggregation (drafts-per-agent KPI), windowed weekly. |

---

## 4. Sign-off

Graduation past paste-and-draft is **Derek's decision** (product + legal), not an
automatic consequence of hitting the numbers above.

- [ ] All proposed thresholds reviewed and **finalized by Derek** (the values in §2 are placeholders until then).
- [ ] G-1 … G-5 all met simultaneously over the agreed pilot window.
- [ ] PDPA / data-residency implications of any proposed channel re-reviewed (TIA on file; Anthropic residency posture re-checked).
- [ ] Explicit written sign-off from Derek recorded before any WABA scoping work is opened.

Until every box is checked, the platform stays paste-and-draft, copy-out only.

---

## 5. Out of Scope (forever-excluded in v1)

The following remain hard-excluded in v1 per CLAUDE.md / PROJECT.md / ROADMAP.md, and are
**not** unlocked by this document — they may only be *revisited* after this gate is met
and Derek signs off:

- **WhatsApp Business API (WABA) integration** of any kind (WABA-01/02 — deferred to v2).
- **Auto-send / auto-post.** Copy-to-clipboard is the only path from draft to human; the
  agent always sends from their own phone (HR-1 / HR-2, 04-UI-SPEC).
- **Webhook-driven edit capture from WhatsApp** (depends on WABA — the v1 edit signal is
  the in-card `originalDraft` vs `editedFinal` diff on Copy, D-18).
- Any code touching a WhatsApp Business API, SDK, or webhook in Phase 4.

This artifact contains no code, no SDK reference, and no integration scaffold by design.
