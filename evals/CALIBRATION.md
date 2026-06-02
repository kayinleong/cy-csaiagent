# D2 Coach Eval — Human Calibration Protocol

**Version:** 2.0 (Phase 2 / QUAL-06 — updated 02-07)
**Status:** PENDING — human calibration sign-off required (see §4 + §9)
**Owner:** Derek (project lead + KB owner)
**Target agreement:** >85% judge-human agreement on all six rubric domains

---

## 1. Purpose

The Opus judge (resolved from Firebase Remote Config key `model.grader.default`)
automates quality scoring for the D2 Onboarding Coach at scale — nightly via the
on-visit lazy-cron Server Action. Before trusting automated scores in production,
judge scores must be validated against human expert opinion.

This document is the calibration protocol (QUAL-06, D-15, D-08).

Calibration answers: *"Does the judge score responses the same way a senior D2 coach
would?"* If yes (>85% agreement across all six domains), automated nightly evals are
reliable. If not, the rubric is revised and re-calibrated.

---

## 2. Participants

| Role | Person | Responsibility |
|------|--------|----------------|
| Project lead + KB owner | Derek | EN and BM calibration set; final sign-off |
| Senior D2 coach | TBD (recruited by Derek) | Practical D2 domain validation |
| Native Mandarin speaker | TBD (recruited by Derek) | ZH calibration set review (D-08) |
| Native Bahasa Malaysia speaker | TBD (recruited by Derek) | BM calibration set review (D-08) |

**Why a native speaker for MS/ZH?** Machine translation produces fluent but culturally
flat text. A native reviewer confirms that BM/ZH responses read as a D2 agent would
actually communicate — not as a translated EN response. This is requirement D-08.

---

## 3. Rubric Domains (Six Domains — All Must Pass)

The Opus judge scores each Coach response on six domains (defined in `src/eval/judge.ts`):

| Domain | What it checks | Failure example |
|--------|----------------|-----------------|
| **GROUNDING** | Response cites a real D2 KB chunk ID (`[KB:chunk-id]`) | Generic answer with no chunk citation |
| **SCOPE** | Stays within D2-specific content; refuses generic real-estate advice | Giving general MYS housing market advice not from D2 KB |
| **LANGUAGE** | Response language matches prompt language (EN→EN, MS→MS, ZH→ZH) | Replying in English to a Mandarin prompt |
| **VOICE** | Sounds like a knowledgeable D2 senior agent (no AI-tell filler) | Starting with "Certainly! Great question!" |
| **HALLUCINATION** | Does NOT assert facts absent from cited KB chunks | Inventing a RM 500 minimum budget without KB citation |
| **TONE-DRIFT** | No AI-persona "bleed" — no em-dash overuse, no "I'd be happy to help" | Response reads like a corporate chatbot, not a D2 agent |

Overall verdict: PASS only if **all six domains** pass.

**Phase 2 additions (02-07):** HALLUCINATION and TONE-DRIFT domains were added to the
four-domain Phase-1 rubric. Tone-drift is a focused sub-check that complements VOICE
by targeting specific AI-persona bleed patterns that the broader VOICE check may miss.

---

## 4. Calibration Set

### 4.1 Size and composition

| Language | Scenarios | Source |
|----------|-----------|--------|
| English (EN) | 10 | Mix of: grounded answers, KB-miss redirects, out-of-scope refusals, comprehension gates, playbook walkthroughs |
| Bahasa Malaysia (MS) | 5 | Same scenario types — BM prompt + expected BM response |
| Mandarin Chinese (ZH) | 5 | Same scenario types — ZH prompt + expected ZH response |
| **Total** | **20** | |

Phase 2 calibration set draws from all four gold files:
- `evals/coach-trilingual.gold.yaml` (Phase 1 seed — onboarding week-1 question)
- `evals/gold/coach-training.yaml` (training Q&A + out-of-scope refusal)
- `evals/gold/coach-journey.yaml` (day-one pairing + comprehension gate)
- `evals/gold/coach-playbooks.yaml` (Meta Ads playbook + first-Meta-ad walkthrough)

Derek selects 20 representative Coach responses (mix of good, borderline, and bad)
by running the eval against the live Coach after SPIKE-DEPLOY closes the Phase-1 gate.

### 4.2 Annotation format

Each annotator scores each response on all six domains independently (before
seeing the judge's score), using this form:

```
Scenario ID: [e.g. EN-01]
Prompt: [the user message]
Response: [the Coach response]

Annotator: [name]
GROUNDING:     PASS / FAIL — [brief rationale]
SCOPE:         PASS / FAIL — [brief rationale]
LANGUAGE:      PASS / FAIL — [brief rationale]
VOICE:         PASS / FAIL — [brief rationale]
HALLUCINATION: PASS / FAIL — [brief rationale]
TONE-DRIFT:    PASS / FAIL — [brief rationale]
OVERALL:       PASS / FAIL
```

Scores are submitted to Derek before the calibration session meeting.

---

## 5. Agreement Metric

**Agreement = (# scenarios where judge verdict == human consensus) / (total scenarios)**

Human consensus = majority vote of the two human annotators (Derek + senior coach).
For MS/ZH: native speaker review overrides automated checks on the LANGUAGE domain.

**Target:** >85% agreement (17/20 scenarios agree between judge and human consensus).

If agreement < 85%:
1. Review all disagreements — identify patterns (judge too strict / too lenient on which domain).
2. Revise the rubric in `src/eval/judge.ts` for the failing domain.
3. Re-run calibration on the same 20 scenarios.
4. Repeat until ≥85% agreement.

**Sign-off requirement:** Derek signs off in writing (email or Slack) that calibration
is complete. This document is updated with the final agreement percentage and date.

**Out-of-scope for the LLM judge:** Tone-drift subtleties in BM/ZH (cultural register
gaps) are a known limitation — the native speaker review in LANGUAGE domain partially
covers this, but human review of BM/ZH tone remains the gold standard (D-08).

---

## 6. Cadence

| Event | Timing | Trigger |
|-------|---------|---------|
| Initial calibration | After Phase-1 gates close + SPIKE-DEPLOY | First live Coach deployment |
| Quarterly re-calibration | Every 90 days | Drift check — model updates, KB growth |
| Rubric revision calibration | After any rubric change | Re-validate new rubric |
| Native MS/ZH review | Per calibration cycle | Native speakers score all MS/ZH scenarios |

---

## 7. Nightly Eval Pipeline

After calibration sign-off, the nightly eval runs automatically via the on-visit
lazy-cron Server Action:

1. Authenticated user visits the app → `app/_actions/jobs.ts` calls `runDueJobs()`.
2. `runDueJobs()` checks if `eval-nightly` is due (last-run-per-window, 24h default).
3. If due: calls `runNightlyEval()` in `src/eval/runNightly.ts`.
4. `runNightlyEval()`:
   a. Checks `JUDGE_MODEL` env var (set from Remote Config `model.grader.default`).
   b. If unset: logs a warning and skips — never crashes the cron.
   c. If set: shells out to `npx promptfoo eval -c evals/promptfooconfig.yaml --output evals/results/{runId}.json`.
   d. Parses JSON results; writes one `EvalDoc` per (suite, lang) to the `evals/` Firestore collection.
5. Senior coach dashboard surfaces eval pass rates + any regressions.

**D-09 timing note:** The lazy-cron fires on authorized user visits, not on a wall
clock. A truly idle overnight period defers the nightly eval. For the pilot, on-visit
timing is accepted. If the pilot shows eval cadence gaps, the documented escape hatch
(a GitHub Actions scheduled workflow) requires an explicit user decision — do NOT add
a scheduled-cron workflow unilaterally. (02-CONTEXT.md D-09 resolution: 2026-06-02.)

**Run command (manual — requires live credentials):**
```bash
# Requires: live Anthropic key, JUDGE_MODEL set from Remote Config
JUDGE_MODEL=$(firebase remoteconfig:get --key model.grader.default) \
  npx promptfoo eval -c evals/promptfooconfig.yaml
```

**Offline fixture validation only (no live calls):**
```bash
# Validates YAML fixture syntax; provider calls will fail without live credentials
npx promptfoo eval -c evals/promptfooconfig.yaml --no-run --no-cache || true
```

---

## 8. Changed-Prompt CI Suite

Any PR that touches `src/agents/coach/**` or `evals/**` triggers an offline fixture
validation in CI (`.github/workflows/ci.yml` — "Eval fixtures — offline YAML syntax
validation" step). This step:

- Validates that `evals/promptfooconfig.yaml` references all three Phase-2 gold files.
- Runs `npx promptfoo eval --no-run --no-cache` to validate YAML syntax.
- Does NOT require ANTHROPIC_API_KEY or JUDGE_MODEL (offline only).

The live eval (npm run eval) is gated on JUDGE_MODEL being set and runs only
post-gate. DO NOT add a scheduled-cron GitHub Actions workflow for the nightly eval
— it must run via the lazy-cron Server Action (D-09 decision).

---

## 9. Trilingual Native Review Process (D-08)

Machine translation (MT) is prohibited for BM and ZH KB content and eval fixtures.
All BM and ZH content must be reviewed by a native speaker before being marked final.

**Process:**
1. Draft BM/ZH coach responses in gold YAML files — initially written in EN.
2. Native speaker (recruited by Derek) translates and reviews each BM/ZH response.
3. Reviewer annotates the calibration form (§4.2) with a LANGUAGE domain note:
   `"Native review: [PASS/FAIL] — [brief comment on naturalness/accuracy]"`
4. Native-reviewed responses are marked `native_review_status: APPROVED` in the fixture.
5. Non-approved responses remain `native_review_status: PENDING` and are excluded from
   production eval scoring until approved.

**Current status:**
- EN: No native review required (EN is the proof-slice language).
- MS: `native_review_status: PENDING` across all four gold files — awaiting Derek to recruit a native BM reviewer.
- ZH: `native_review_status: PENDING` across all four gold files — awaiting Derek to recruit a native ZH reviewer.

---

## 10. Sign-Off Record

| Event | Date | Agreement % | Signed by |
|-------|------|-----------|---------  |
| Initial calibration (six-domain rubric) | PENDING | PENDING | Derek |
| MS native review | PENDING | — | TBD |
| ZH native review | PENDING | — | TBD |

*This table is updated after each calibration session. "PENDING" means not yet completed.*

**Deferred gate:** The live calibration run (Derek + a coach, >85% agreement) is
approved by the project lead but executes after the Phase-1 live stack is provisioned
(SPIKE-DEPLOY gate). The gold sets, rubric, config, and runner wiring are validated
offline now; the live calibration run and sign-off follow after the gate closes.
(02-07 SUMMARY note: live calibration is deferred-behind-the-gate, user-approved.)
