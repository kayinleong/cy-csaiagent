# D2 Coach Eval — Human Calibration Plan

**Version:** 1.0  
**Status:** PENDING — human calibration sign-off required (see §4)  
**Owner:** Derek (project lead + KB owner)  
**Target agreement:** >85% judge-human agreement on all four rubric domains  

---

## 1. Purpose

The Opus-4.7 judge (resolved from Firebase Remote Config key `model.grader.default`)
automates quality scoring for the D2 Onboarding Coach at scale — nightly via QStash.
Before trusting automated scores in production, judge scores must be validated against
human expert opinion. This document is the calibration protocol (FND-07, D-08).

Calibration answers: *"Does the judge score responses the same way a senior D2 coach
would?"* If the answer is yes (>85% agreement), automated nightly evals are reliable.
If not, the rubric is revised and re-calibrated.

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

## 3. Rubric Domains (Four Domains — All Must Pass)

The Opus judge scores each Coach response on four domains (defined in `src/eval/judge.ts`):

| Domain | What it checks | Failure example |
|--------|----------------|-----------------|
| **GROUNDING** | Response cites a real D2 KB chunk ID (`[KB:chunk-id]`) | Generic answer with no chunk citation |
| **SCOPE** | Stays within D2-specific content; refuses generic real-estate advice | Giving general MYS housing market advice not from D2 KB |
| **LANGUAGE** | Response language matches prompt language (EN→EN, MS→MS, ZH→ZH) | Replying in English to a Mandarin prompt |
| **VOICE** | Sounds like a knowledgeable D2 senior agent (no AI-tell filler) | Starting with "Certainly! Great question!" |

Overall verdict: PASS only if all four domains pass.

---

## 4. Calibration Set

### 4.1 Size and composition

| Language | Scenarios | Source |
|----------|-----------|--------|
| English (EN) | 10 | Mix of: grounded answers, KB-miss redirects, out-of-scope refusals |
| Bahasa Malaysia (MS) | 5 | Same scenario types — BM prompt + expected BM response |
| Mandarin Chinese (ZH) | 5 | Same scenario types — ZH prompt + expected ZH response |
| **Total** | **20** | |

Phase 1 calibration set uses the `evals/coach-trilingual.gold.yaml` fixture as the
seed. Derek selects 20 representative Coach responses (mix of good, borderline, and
bad) by running the eval against the live Coach after SPIKE-DEPLOY.

### 4.2 Annotation format

Each annotator scores each response on all four domains independently (before
seeing the judge's score), using this form:

```
Scenario ID: [e.g. EN-01]
Prompt: [the user message]
Response: [the Coach response]

Annotator: [name]
GROUNDING:  PASS / FAIL — [brief rationale]
SCOPE:      PASS / FAIL — [brief rationale]
LANGUAGE:   PASS / FAIL — [brief rationale]
VOICE:      PASS / FAIL — [brief rationale]
OVERALL:    PASS / FAIL
```

Scores are submitted to Derek before the calibration session meeting.

---

## 5. Agreement Metric

**Agreement = (# scenarios where judge verdict == human consensus) / (total scenarios)**

Human consensus = majority vote of the two human annotators (Derek + senior coach).
For MS/ZH: native speaker review overrides automated checks on the LANGUAGE domain.

**Target:** >85% agreement (17/20 scenarios agree between judge and human consensus).

If agreement < 85%:
1. Review all disagreements — identify patterns (judge too strict / too lenient on one domain).
2. Revise the rubric in `src/eval/judge.ts` for the failing domain.
3. Re-run calibration on the same 20 scenarios.
4. Repeat until ≥85% agreement.

**Sign-off requirement:** Derek signs off in writing (email or Slack) that calibration
is complete. This document is updated with the final agreement percentage and date.

---

## 6. Cadence

| Event | Timing | Trigger |
|-------|---------|---------|
| Initial calibration | Week 4 (SPIKE-DEPLOY + go/no-go gate) | First live Coach deployment |
| Quarterly re-calibration | Every 90 days | Drift check — model updates, KB growth |
| Rubric revision calibration | After any rubric change | Re-validate new rubric |
| Native MS/ZH review | Per calibration cycle | Native speakers score all MS/ZH scenarios |

---

## 7. Nightly Eval Pipeline

After calibration sign-off, the nightly eval runs automatically:

1. QStash cron → `POST /api/jobs/eval-nightly` (HMAC-signed)
2. The job runner:
   a. Fetches `JUDGE_MODEL` from Firebase Remote Config (`model.grader.default`)
   b. Sets `JUDGE_MODEL` env var
   c. Runs `npx promptfoo eval -c evals/promptfooconfig.yaml --no-cache`
   d. Writes results to `evals/{runId}` Firestore collection (TSD §4)
3. Senior coach dashboard surfaces eval pass rates + any regressions

**Run command (manual):**
```bash
# Requires: live Anthropic key, JUDGE_MODEL set from Remote Config
JUDGE_MODEL=$(firebase remoteconfig:get --key model.grader.default) \
  npx promptfoo eval -c evals/promptfooconfig.yaml
```

**Offline fixture validation only (no live calls):**
```bash
npx promptfoo eval -c evals/promptfooconfig.yaml --no-cache || true
# Validates YAML fixture syntax; provider calls will fail without live credentials
```

---

## 8. Trilingual Native Review Process (D-08)

Machine translation (MT) is prohibited for BM and ZH KB content and eval fixtures.
All BM and ZH content must be reviewed by a native speaker before being marked final.

**Process:**
1. Draft BM/ZH coach responses in `evals/coach-trilingual.gold.yaml` — initially in EN.
2. Native speaker (recruited by Derek) translates and reviews each BM/ZH response.
3. Reviewer annotates the calibration form (§4.2) with a LANGUAGE domain note:
   `"Native review: [PASS/FAIL] — [brief comment on naturalness/accuracy]"`
4. Native-reviewed responses are marked `native_review_status: APPROVED` in the fixture.
5. Non-approved responses remain `native_review_status: PENDING` and are excluded from
   production eval scoring until approved.

**Current status:**
- EN: No native review required (EN is the proof-slice language).
- MS: `native_review_status: PENDING` — awaiting Derek to recruit a native BM reviewer.
- ZH: `native_review_status: PENDING` — awaiting Derek to recruit a native ZH reviewer.

---

## 9. Sign-Off Record

| Event | Date | Agreement % | Signed by |
|-------|------|-------------|-----------|
| Initial calibration | PENDING | PENDING | Derek |
| MS native review | PENDING | — | TBD |
| ZH native review | PENDING | — | TBD |

*This table is updated after each calibration session. "PENDING" means not yet completed.*
