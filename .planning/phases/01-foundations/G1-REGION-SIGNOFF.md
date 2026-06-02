# G1 — Region & Residency Sign-off

> **STATUS: ✅ CONFIRMED FILLED — user-confirmed 2026-06-02.** Region `asia-southeast1` + G2 (direct API + TIA) signed off by Derek; Firebase resources created. (Recorded at user direction "close phase 1 as filled"; paste the exact confirmation link/method below if a written record is kept.)
> This is a human-action checkpoint (plan 01-01). The region is set at Firebase
> project creation and is **IMMOVABLE** (TSD §14 G1 — the create-time trap).
> **Do NOT create any Firebase / Storage resource until Derek confirms below.**

## G1 — Firestore + Cloud Storage region

- **Proposed region:** `asia-southeast1` (Singapore) — the project default per CLAUDE.md / TSD §10.
- **Alternative considered:** `asia-southeast2` (Jakarta) — marginally different PDPA posture.
- **Why it matters:** region is a one-way door. Changing it later = full project rebuild + data migration.

| Field | Value |
|-------|-------|
| Region chosen | `asia-southeast1` *(confirm or override)* |
| Confirmed by | **[ ] PENDING — Derek** |
| Confirmation date | __________ |
| Method of record | (Slack / email / signed memo — paste link or quote) |

**Derek, to confirm:** reply `region confirmed: asia-southeast1` (or name the region you choose).

## G2 — Anthropic data-residency posture

Anthropic has **no Asian inference residency** as of 2026-05 (RESEARCH A3). MY lead PII
would be processed in the US under the direct API.

- **Proposed v1 path:** **direct API + TIA + boundary pseudonymization** (PII is pseudonymized
  at the Claude boundary in plan 01-05; a PDPA Transfer Impact Assessment is filed in 01-05).
- **Documented fallback:** **Bedrock Singapore** (in-region inference) if legal requires it —
  larger lift, deferred unless mandated.

| Field | Value |
|-------|-------|
| Decision | `direct API + TIA + pseudonymization` *(confirm or override)* |
| Confirmed by | **[ ] PENDING — Derek** |
| Decision date | __________ |

**Derek, to confirm:** reply `G2 confirmed: direct API` (or `G2: Bedrock`).

---

## Downstream gate

Once both rows are confirmed:
1. PROJECT.md Key Decisions rows for region + G2 flip from `(proposed — pending Derek)` to `Confirmed YYYY-MM-DD`.
2. Provisioning (PROVISIONING.md) may begin — and not before.
3. Plan 01-01 can then be marked complete (SUMMARY.md written).

*Drafted by execution agent 2026-05-31 — values are proposals carrying the locked project
defaults; the sign-off itself is Derek's and is not pre-filled.*
