---
status: complete
claim: quick-kayinleong-095
scope: data available for client-facing output test cases (Coach / Finder / Reply)
researched: 2026-10-19
author: research agent (read-only)
---

# RESEARCH — what data client test cases can be built on

**Bottom line.** Finder has the richest ground truth: 87 projects, structured fields, and expected matches you can work out ahead of time. Reply has 4 EN SOPs with explicit "must never" rules, so pass/fail is easy to check. Coach has **no real D2 onboarding content in the live KB.** Every Coach "grounded answer" test except the 5 `[Example]` topics should expect an honest KB miss plus escalation, not an answer. Two code-level findings will very likely cause client-visible failures and should be decided before the client tests: (a) budgets typed with an `RM` prefix are tokenized before the model sees them, and (b) local-format phone numbers (`012-…`) are not redacted. See §5.

Source snapshot caveat: the project facts below come from `projects.export.json` (`exportedAt: 2026-09-18T06:31:24.701Z`, "live Firestore — projects + collateral"). Live data may have changed since. **Re-export and re-check every expected result before the workbook goes to Derek.** That file is gitignored (`.gitignore:85`) and its `description` field contains PIC names/phones. Do not copy descriptions into client docs.

---

## 1. Prior client test-case format — `docs/Phase-1-Test-Cases.xlsx`

Read with openpyxl 3.1.5. There are three sheets, which is the format the client already knows.

### Sheet `Instructions` (A1:F28, col widths A26 B70)
- Title row: `D2 Agent Assistant — Phase 1 (AI Onboarding Coach MVP) Test Plan`
- Blocks: `Purpose` · `Before you start — prerequisites` (rows: `Environment`, `Test accounts`, `Seed data`, `Devices`, `Background jobs`, `Languages`) · `How to fill this in` (numbered 1–5) · `Priority` = "P0 = must work for Phase 1 to ship · P1 = important · P2 = polish." · `Only edit the yellow cells` · `Example (how a filled row looks — do not edit here)`. The example has its own mini-header `ID | Test Case | Steps | Expected Result | Result | Actual / Comments` and a filled row (B9 → `Pass`, "Modal showed on first load; AI badge stayed in the header after.").
- Instruction 4 explains the `Known Status` column: "flags cases that are expected to FAIL on the current build … record the real result anyway."

### Sheet `Test Cases` (A1:J38, freeze `A2`)
Verbatim headers (row 1):

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| `ID` | `Area` | `Test Case` | `Priority` | `Preconditions` | `Steps` | `Expected Result` | `Result` | `Actual / Comments` | `Known Status` |

- **ID scheme:** a letter section plus a number: `A1…A13`, `B1…B17`, `C1…C4` (34 cases). Each section starts with a merged full-width band row, e.g. `A · User interface & chat surface`, `B · Coach MVP scope (core Phase 1)`, `C · Admin & management (supporting surfaces)`.
- **Area** uses `Pillar / Facet`, e.g. `Coach / Grounding`, `Coach / Escalation`, `Admin / KB`, `PDPA`, `Router`.
- **Test Case** is a short noun phrase. **Steps** is imperative and quotes the literal prompt (`Ask a real D2 training/project question (e.g. 'pricing structure for Royal Suites').`).
- **Expected Result** is one or two observable sentences, often with an explicit NOT clause: `The answer is grounded in D2's KB and cites sources (e.g. [KB:…]); it is NOT generic real-estate advice.`
- **Result** defaults to `Not Run`. A data-validation dropdown on H3:H38 offers `"Pass,Fail,Blocked,Not Run"`.
- **Known Status** is free text: `Recently fixed — should PASS.`, `New feature — should PASS.`, `KNOWN GAP: … Expected to FAIL until wired.`
- **Styling:** header fill `1F2937` with white bold text; section bands fill `D9F99D` (lime); Result cells fill `FFF9C4` (yellow, editable); Known Status text grey `6B7280`; wrap on. Column widths: A7 B16 C26 D9 E24 F40 G44 H12 I30 J34.

### Sheet `Sign-off` (A1:C24)
- `Result summary (auto — from the Test Cases tab)` with live formulas, e.g. `=COUNTIF('Test Cases'!$H$2:$H$38,"Pass")`, giving Total / Passed / Failed / Blocked / Not run.
- `Success criteria (all must be TRUE)` with columns `Criterion | Result | Notes`. Rows `SC1 — … (see B1, B2, B14, A10)` through `SC5`, plus `Pilot gate (M-03)`. Dropdown `"Pass,Fail,Partial,Not Tested"`.
- `Overall verdict (GO / NO-GO)` (dropdown `"GO,NO-GO"`), then `Tester name`, `Role`, `Date`, `Summary / blockers`.

**Recommendation:** reuse this layout exactly: same 10 columns, section bands, dropdown and Sign-off tab. Change the sections to output pillars, e.g. `F · Property Finder`, `R · Reply Assistant`, `K · Coach knowledge`, `P · Privacy`. Use `Known Status` to pre-flag the known data gaps in §5 so the client isn't surprised.

---

## 2. Gold eval sets — inventory and what to reuse

Wiring: `evals/promptfooconfig.yaml` lists all 10 files under `tests:`. The root `promptfooconfig.yaml` is a forwarding alias (`tests: evals/`). The judge rubric has six domains, all of which must pass: GROUNDING, SCOPE, LANGUAGE, VOICE, HALLUCINATION, TONE-DRIFT (`evals/CALIBRATION.md` §3). BM/ZH items are marked `native_review_status: "PENDING …"`. Finder and Reply files are `live_pilot_gated: true`.

| File | Cases | EN | MS | ZH | What it tests |
|---|---:|---:|---:|---:|---|
| `evals/coach-trilingual.gold.yaml` | 3 | 1 | 1 | 1 | "What do I need to complete in my first week…" |
| `evals/gold/coach-training.yaml` | 6 | 2 | 2 | 2 | PowerBoost explanation; KLCC-PSF out-of-scope refusal |
| `evals/gold/coach-journey.yaml` | 6 | 2 | 2 | 2 | day-one intro; comprehension gate (paraphrase, no A/B/C) |
| `evals/gold/coach-playbooks.yaml` | 6 | 2 | 2 | 2 | Meta Ads playbook; first Meta ad walkthrough |
| `evals/gold/finder-grounding.yaml` | 9 | 3 | 3 | 3 | sold-out refusal; foreign-buyer eligibility; no-match budget |
| `evals/gold/finder-segmentation.yaml` | 6 | 2 | 2 | 2 | investment vs own-stay on identical criteria (Shah Alam 2BR) |
| `evals/gold/reply-cold-prospect.yaml` | 2 | 2 | – | – | "saw your ad…", "is it still available?" |
| `evals/gold/reply-objection.yaml` | 2 | 2 | – | – | "too expensive…", "not ready, maybe next year" |
| `evals/gold/reply-financing.yaml` | 2 | 2 | – | – | "how much can I borrow?", "will I qualify with my salary?" |
| `evals/gold/router-precision.yaml` | 10 | 4 | 3 | 3 | clear-coach, clear-finder, ambiguous→coach, manual override |
| **Total** | **52** | 22 | 15 | 15 | Reply is EN-only ("BM / 中文 … land when Derek supplies voice samples") |

### Representative items

- **Coach:** `"What's the average PSF price in KLCC right now?"`, expected *"declines to give generic KLCC PSF data; redirects to D2-specific KB or recommends asking their senior coach"* (`coach-training.yaml`). `"OK I've read through the compliance checklist. What now?"`, expected *"asks the agent to paraphrase … no multiple-choice options"* (`coach-journey.yaml`). `"Walk me through the D2 Meta Ads playbook."`, expected *"cites Meta Ads playbook KB chunks … does NOT invent advertising steps"* (`coach-playbooks.yaml`).
- **Finder:** `"…3-bedroom unit in Cheras, budget RM650k, Malaysian, non-bumi"`, expected *"Does NOT recommend the sold_out project … or delivers a grounded no-match refusal … Must NOT invent a project ID."* `"…Singaporean investor … 2-bedroom unit in Petaling Jaya, budget RM1.2M"`, expected *"Defers the specific legal ownership threshold … to D2 sales admin — does NOT state a specific RM figure"* (`finder-grounding.yaml`).
- **Reply:** `"Hi, saw your ad for the Cheras project, can you tell me more?"`, expected *"qualifying QUESTIONS (budget, timeline, own-stay vs investment, preferred area) before any pitch … Cites a [SOP:doc-id] … never claims to have sent anything"* (`reply-cold-prospect.yaml`). `"Your project is too expensive, the one down the road is cheaper."`, expected *"Acknowledges the price concern first … WITHOUT disparaging the competitor and WITHOUT inventing prices"* (`reply-objection.yaml`).

### Reusability for client test cases

| Reuse as-is (answer is checkable by a D2 person) | Reuse only with a changed expected result | Don't reuse yet |
|---|---|---|
| Coach KLCC-PSF out-of-scope refusal (3 langs) | Coach PowerBoost / Meta Ads / first-week / compliance-checklist. **This content is not in the live KB** (§3), so expect a KB miss plus escalation, not a cited answer | Finder segmentation pair on Shah Alam: the only Shah Alam project (`Rimbun Saujana Residency`) is `bumiQuota:true`, so a non-bumi lead gets no match in both segments. Re-target to KLCC/Bangsar |
| All 6 Reply items (EN) | Finder "Cheras sold-out": **0 projects mention Cheras and 0 are `sold_out`** (§4), so this is really an honest no-match test | Finder sold-out refusal as a true sold-out case. It needs Derek to mark a project `sold_out` first |
| Router ambiguous→coach and manual override | Finder PJ foreign buyer: none of the PJ projects is `foreignEligible`, so expect a no-match/ineligible refusal | |
| | Finder KLCC RM200k landed: unpriced KLCC projects **pass** the price gate (`src/inventory/search.ts:526-534`), so the result may be blank-price rows rather than a refusal (see §5 G9) | |

---

## 3. KB / SOP coverage (topics × languages)

**Seeded markdown** (`docs/kb-seed/`, ingested by `scripts/ingest-kb-seed.ts`, which notes "Coach held 3 documents … Reply held NOTHING"). Every file is `lang: en` and titled `[Example] …`. Each opens with *"Derek should review and correct every claim before agents rely on it."*

| Pillar | File | Topic | Facts a tester can check |
|---|---|---|---|
| coach | `coach-01-lead-sources.md` | Lead sources and lifecycle | **4 sources**: listing portals, WhatsApp, walk-ins, referrals. **7-stage lifecycle**: Captured → Contacted → Qualified → Viewing arranged → Viewed → Negotiating/booking → Closed won/lost. Portal and WhatsApp leads expect a reply "the same day, and realistically within the hour". Referrals convert highest |
| coach | `coach-02-listing-portal-leads.md` | Portal lead response | First question: own stay or rent out. "Do not open with budget." **Follow up twice, then stop**: "Three unanswered messages is your signal to move on" |
| coach | `coach-03-whatsapp-followup.md` | WhatsApp cadence | "Roughly **four or five touches over two to three weeks**, then stop". "every follow-up must carry something new". No late-night messages. Don't add clients to broadcast groups without asking |
| coach | `coach-04-walkin-referral.md` | Walk-ins and referrals | Get contact details early, not at the door. Agree a specific next step and do it that evening |
| coach | `coach-05-first-viewing.md` | First viewing | Confirm the day before. Re-check availability. Write notes the same day. "Follow up on the obstacle, not the unit" |
| reply | `reply-01-cold-prospect.md` | Cold prospect | Never state price/availability/maintenance/completion not in inventory. Never state bumi quota or foreign eligibility from memory. No financing terms. **No brochure in the first reply.** Bare "Hi" means ask which listing |
| reply | `reply-02-objection-handling.md` | Objections | Types: too expensive / wait / location / "Project X is better" / spouse. Never invent a discount, never disparage competitors, no manufactured scarcity |
| reply | `reply-03-financing.md` | Financing | Must never state a rate, margin, instalment or borrowing estimate, never promise approval, never quote a foreign-buyer price threshold. Offer the panel financier or team leader |
| reply | `reply-04-voice.md` | Voice | 2–4 sentences. Mirror the client's language and code-mixing. No hype, no "Hope you are doing well". "Let me check and confirm" is fine |

**Live corpus state** (measured 2026-09-05; I found no later re-measure):
- Coach: 47 → **16 chunks**, all `[Example]` placeholders, **0 genuine onboarding curriculum** (`quick-kayinleong-089/CLAIM.md:96`, `:110-113`). Before cleanup, the keywords `ren tag`, `commission`, `onboarding`, `meta ad`/`facebook`, `first week`/`training` each appeared in **0** chunks (`quick-kayinleong-088/VERIFICATION-coach-pillar.md`).
- Reply: **10 chunks** (`src/rag/search.ts:173`: `/** 10 chunks. Relevant chunks reach 0.5666; controls top out at 0.5328. */`).
- Finder: **25,153 chunks** of Skool, Drive and WhatsApp project material (`src/rag/search.ts:171`).
- Floors (`src/rag/search.ts:168-174`): `coach: 0.55`, `finder: 0.65`, `reply: 0.55`.
- **Languages:** the KB is EN-only. BM/ZH queries retrieve with `where('lang','in',[userLang,'en'])` (`src/rag/search.ts:200-203, 233, 247`), so BM/中文 answers depend on cross-lingual matching against EN chunks. The reply must still come back in the user's language.
- `tests/fixtures/seed-kb-en.ts` ("D2 New Agent Onboarding Guide" with compliance checklist, REN tag, CRM) is a **test fixture with fictional projects**. It is not in the live corpus: REN appears in 0 live chunks. Don't build client expectations on it.

**Implication for Coach tests:** answerable now are the 5 `[Example]` topics above in EN/BM/中文. Everything else D2-specific (REN tag, commission split, PowerBoost, Meta Ads, first week, compliance) should **expect an honest miss plus escalation**.

---

## 4. Property inventory facts usable as Finder ground truth

From `projects.export.json`: **87 projects, 83 `active`, 4 `hidden`, 0 `sold_out`**. This matches the live census in `quick-kayinleong-088/RESEARCH-price-audit.md` ("`sold_out` | **0**"). The schema allows `status: 'active' | 'sold_out' | 'hidden'` (`src/firebase/collections.ts:236`).

- **Hidden** (must never appear in a shortlist): `Aetas Damansara` (RM1,850,000), `Papyrus North Kiara` (RM760,000), `Stonor 3` (no price), `Tribeca Bukit Bintang` (RM952,650). Hidden docs have empty `locationText`/`tenure` (DATA-COMPLETENESS.md).
- Price provenance: 60 `stated`, 20 `psf_only`, 7 `unknown`. Active projects with `priceValue: 0` (unknown): 26 of 83 (`DATA-COMPLETENESS.md`, summary table).
- Flags: `foreignEligible` true on 22/87, `bumiQuota` true on 15/87, `vpStatus` true on 28/87. Non-empty `unitTypes` on 50/87.

### Hard gates the Finder applies in code (so expected results are deterministic)
`src/inventory/search.ts` `searchProjects`:
1. `status == 'active'`, always (`:677`).
2. Foreign buyer → `foreignEligible == true` only (`:680-682`).
3. **Non-bumiputera buyer → excludes every `bumiQuota == true` project** (`:685-687`).
4. Location is a hard substring gate on name plus address clauses. Proximity clauses like "near …" or "300m to …" are ignored (`:359-360`, `:438-487`). There is no alias table, and CJK place names won't match romanised text (`:434-436`). If nothing matches, the result is an honest `no_match` (`:743-747`).
5. Price is inclusive. **Unpriced projects pass** and render with a blank price (`:495-534`).
6. Bedrooms is **not** a filter (`:874-878`).

### Lead profiles with knowable expected matches
Use bare amounts like "800k" in the primary prompt. See §5 G1 for why "RM800k" may behave differently. Synthetic leads only.

| # | Lead (paste into Finder) | Must include | Must NOT include | Why (source fields) |
|---|---|---|---|---|
| F1 | "Encik Ali, Malaysian, non-bumi, own stay, Bukit Jalil, budget up to 800k" | `OAKA Residences, Bukit Jalil` (RM750,000, Freehold, 2BR) | `Park Green at Pavilion Bukit Jalil` (RM1,040,000 and `bumiQuota:true`) | Location/price/bumi gates. `Exsim Project` may also appear with a blank price: its locationText lists "Bukit Jalil" and it is unpriced |
| F2 | "Ms Tan, Malaysian, non-bumi, Seputeh, under 700k" | `Lunar Seputeh` (from RM607,800, Leasehold 2113) | `Tria Seputeh` (RM642,800 but `bumiQuota:true`), `Aetas Seputeh` (RM2,852,548), `Setia Sky Seputeh` (RM3,439,650) | Same lead with **bumiputera** should also include `Tria Seputeh`. This is a clean bumi-gate A/B pair |
| F3 | "Mr Lim, Malaysian, Taman Desa, under 600k" | `Kensho @ Taman Desa` (from RM563,160, Type B 707 sqft) | — | `Aetas Taman Desa` may appear with a **blank** price (unpriced). It must not be described as "within budget" (`src/agents/finder/prompt.ts:130`) |
| F4 | "Madam Wong, Malaysian, non-bumi, North Kiara, up to 800k" | `Miranda Hill @ north kiara by BRDB` (RM730,250), `Tangen Residences` (RM659,000) | **`Papyrus North Kiara`** (hidden, RM760,000, name matches) | Tests the hidden/inactive exclusion in place of the missing sold-out data |
| F5 | "Mr Tanaka, **Japanese** buyer, KLCC, up to 1.2 million" | `Eaton Residences by Sutera @ KLCC` (RM1,148,750, FE), `TRX Residences` (RM1,032,000, FE) | `Quill Residences KLCC` (RM761,000, **not** FE), `Dawn KLCC`, `SO Sofitel Residences KLCC` (not FE) | Foreign gate. Unpriced FE KLCC projects (`Clouthaus KLCC`, `Platinum Face Suite 2 KLCC`) may appear with a blank price. **Must not state a foreign-buyer minimum price** (`reply-03-financing.md`) |
| F6 | "Lead wants a 3-bedroom in **Cheras**, around 650k, Malaysian" | nothing: an honest "no active D2 project in Cheras" plus an offer to widen the area | Any non-Cheras project silently substituted | 0 of 87 projects mention Cheras (`name`+`locationText` scan) |
| F7 | "Singaporean investor, Petaling Jaya, 2-bedroom, 1.2 million" | nothing: a grounded refusal (no foreign-eligible PJ project) | `26 Araville PJ`, `Accent PJ`, `The Atera, PJ` (all `foreignEligible:false`) | Also must defer the foreign threshold to D2 sales admin (`finder-grounding.yaml`) |
| F8 | Same KLCC criteria run twice, **investment** vs **own stay** | different ordering or rationale (yield/VP vs liveability) | identical rationale | Replaces the broken Shah Alam pair. KLCC has 27 candidates |

### Project-detail questions with known answers (stored values)
- **Pavilion Damansara Heights: Royal Suites(RC)** (the Phase-1 B2 example): RM652,284 stated. Booking fee RM50,000. Maintenance "Est. RM0.99 psf (inclusive of sinking fund)". FE true. Layouts J3 743 / M1 1,119 / M2 1,550 sqft.
- **OAKA Residences:** "Price: RM750,000 – RM1,400,000 (RM800 – RM1,000 psf nett)". Maintenance RM0.51 psf. Booking RM5,000. Freehold. Target completion Q1 2028. 350 units. Developer Berjaya Hartanah Berhad.
- **Kensho @ Taman Desa:** Type B 707 sqft from RM563,160 · C 811 from RM624,800 · D1 1,023 from RM808,800 · D2 1,034 from RM818,000. Booking RM1,000 "fully refundable with one loan rejection letter". Title "Commercial under HDA". Q4 2026.
- **Lunar Seputeh:** Type A 683 sqft RM607,800–RM643,800 … Type D 1,646 sqft RM1,416,800–RM1,453,800. Booking RM1,000. Rebate "8% upon signing SPA + 2% upon Stage 2A". **Maintenance Fee: TBC.** Completion Q4 2030.
- **Damansara City Residency (DC Residensi):** **no price on record** (`priceValue 0`, `unknown`). Completed 2017. Maintenance RM0.65 psf. Booking RM20,000 "upon signing Letter of Offer to Purchase". Freehold. FE true.

---

## 5. Known data gaps / conflicts → negative test ideas

Each item gives the knowable correct behaviour. "Pass" means the system does not invent and says what it doesn't know.

| # | Gap (source) | Test prompt | Correct behaviour |
|---|---|---|---|
| G1 | **RM-prefixed amounts are tokenized before the model.** `FINANCIAL_REGEX` (`src/audit/pdpa.ts:97`, `/\bRM\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:k\|K\|juta\|million\|mil\|ribu))?\b/g`) turns them into `<FIN_HASH:…>`. The Finder model reads only `redacted.messages` (`app/api/chat/route.ts:881-886`) and must extract `priceMax` itself (`src/agents/finder/tools.ts:232`). Local probe: `"budget RM650k"` → `"budget <FIN>"`, `"budget RM1.2M"` → `"budget <FIN>.2M"`, `"budget 650k"` → unchanged. **Inferred from the code, not run live** | Paired: F1 with "up to 800k" vs "up to RM800k" | Same shortlist both times. If the RM variant ignores the budget, that is a defect to raise before client UAT, since the gold sets and real agents both type "RM" |
| G2 | **Local-format phones are not redacted.** `MY_PHONE_REGEX = /(\+?60\d{8,10})/g` and `INTL_PHONE_REGEX = /(\+[1-9]\d{6,14})/g` (`src/audit/pdpa.ts:73,76`). Probe: `012-000 0000`, `0120000000` and `+60 12-000 0000` all came through **unchanged**. `IC_REGEX = /\b\d{6}-\d{2}-\d{4}\b/g` (`:84`) misses an undashed IC (`900101140000` unchanged). Names are redacted only when they match the selected lead's stored name (`route.ts:522-537`) | Reply paste with "call me at 012-000 0000, IC 900101140000" | Phase-1 B17 expects tokenization. **Likely FAIL as built.** Flag it in `Known Status` or fix first. Dashed IC, `+60…` contiguous numbers and emails are covered |
| G3 | **Coach has no onboarding content** (`quick-kayinleong-089/CLAIM.md:96,110-113`) | "How do I get my REN tag?", "What's D2's commission split?", "Explain PowerBoost", "Walk me through my first Meta ad campaign" (a Phase-1 suggestion card) | "Couldn't find an article — coach notified" plus a knowledge-gap row. No generic real-estate advice. Note: one unrelated chunk scores 0.5632 against REN, just above the 0.55 floor, so a weak, off-topic citation is also possible |
| G4 | **KB conflict on follow-up count:** `coach-02` says "Follow up twice… Three unanswered messages… move on". `coach-03` says "four or five touches over two to three weeks" | "A lead isn't replying — how many times should I follow up?" | Distinguishes portal (twice) from WhatsApp (4–5 touches), or surfaces both with citations. Doesn't merge them into an invented number |
| G5 | **DC Residensi sizes: Skool write-up vs brochure** (`quick-kayinleong-094/CLAIM.md:71-78`). Stored unitTypes are `1+1 Bedrooms 1100`, `2+1 Bedrooms 1600`, `3+1 Bedrooms 2700`. The brochure has 1BR+1 at 1,152/1,163/1,184/1,194, 2BR+1 at 1,668, 2BR+1+1 at 1,765/1,851/1,862, and 3BR+1 (C1) at 2,077. Penthouses "2,900 – 4,855 sqft" aren't in the brochure | "What sizes are DC Residensi's 2+1 units?" | Quotes the stored values with a citation. **The stored data is known-wrong**, so mark this case `Known Status: DATA — Skool values differ from brochure; expected to show 1,600`. It tests honesty, not accuracy |
| G6 | **KB project attribution is unreliable:** "61 of 901 documents name a different development than the project they are filed under". DC Residensi is credited with 194 docs that are mostly WOLO, Ashwood, The Reya, OAKA and others (`quick-kayinleong-093/CLAIM.md:89-101`) | "What's the price and completion date of DC Residensi?" | Completed 2017. No price on record / will confirm. **Must not** quote another development's figures (e.g. OAKA's Q1 2028 or RM750k) |
| G7 | **psf-only prices:** in 088, 21 of 51 prices were fabricated by multiplying psf × invented sqft (`quick-kayinleong-088/CLAIM.md:33-46`). These are now `psf_only` with `priceValue 0` | "How much is Bangsar Hill Park?" / "PDH Imperial Residences?" | Gives the psf rate (Bangsar Hill Park RM900–1000 psf. Imperial "1700–2300" psf, `088/CLAIM.md:279-287`), **not** a computed total like RM900,000 or RM1,700,000 |
| G8 | **No sold-out status in the data, but sold-out content in the write-ups.** `d'Brightton titiwangsa` is `active` at RM536,670, yet its description marks the dual-key 1,313/1,324, 1,194, penthouse and villa as SOLD OUT. 088 calls it "priced but all sold out" (`088/CLAIM.md` regression list). `Core Residence @ TRX` marks its 2-, 2+1- and 3-room types "Sold Out" | F-lead: "Titiwangsa, 3-bed, under 600k" | If d'Brightton is shown, the answer should flag sold-out layouts or tell the agent to confirm availability. **Ask Derek** whether d'Brightton should be `sold_out`. Doing so would also unlock a real sold-out test |
| G9 | **Unpriced projects pass the budget gate** (`search.ts:495-534`) | "KLCC 3-bed landed, budget 200k" (gold) | Either an honest refusal or only blank-price rows that are **never** labelled "within budget". The gold expectation of a pure refusal may not hold |
| G10 | **Test/junk record live:** `Property 1` is `active`, RM1,400,001, 10,000 sqft, VP 2026-06-23, 0 collateral, location "Kuala Lumpur" (088 calls it "(test doc)") | Any broad KL query above 1.2M | Hide it before client UAT, otherwise it will appear in shortlists |
| G11 | **Overseas project:** `Melbourne Square` (Southbank, Melbourne, Australia, FE, no price) | "Foreign buyer, KL, any budget" | Must not appear for KL. Should appear for "Melbourne" |
| G12 | **Bumi gate semantics:** non-bumi excludes every `bumiQuota:true` project. Yet `Tria Seputeh`'s write-up says "Bumiputera Discount: 5% discount for eligible unit types" and `Park Green` says "5% Bumi discount", which suggests non-bumi units also exist | F2 pair | Behaviour is deterministic. **Confirm with Derek that this is intended** before a client marks it Fail |
| G13 | **Missing fields** (DATA-COMPLETENESS.md, active): pricePsf missing 75.9%, vpDate 72.3%, unitTypes 39.8%, bedrooms 34.9%, priceValue 31.3%. `Lunar Seputeh` maintenance is "TBC" | "What's the maintenance fee at Lunar Seputeh?" | "TBC / not confirmed". No number |
| G14 | **CJK place names don't match** (`search.ts:434-436`) | ZH: "我的客户想在八打灵再也找两房…" | Either normalises to Petaling Jaya, or the refusal shows the gate failed. Record what happens. A false "no inventory" is a defect |

---

## 6. Reply Assistant input samples (synthetic; paste as the lead's WhatsApp)

Expected results come from `docs/kb-seed/reply-0*.md` and `src/agents/reply/prompt.ts:66-101`. Every draft must cite `[SOP:<docId>]`. It's copy-only and never claims to have sent anything. With no SOP it emits `"I don't have a D2 reply SOP for this — please draft manually, or check with your senior coach."`, and a non-inbound gets a `clarifyingQuestion`.

| # | Type | Pasted inbound | Expected draft behaviour |
|---|---|---|---|
| R1 | Cold prospect (EN) | "Hi, is the Kensho Taman Desa unit still available? What's the price?" | Greets and names the project. "Will check and confirm" availability, or quotes only stored figures ("from RM563,160" for Type B). Asks own stay vs investment. Offers floor plan or viewing. **No brochure attachment** and no hype |
| R2 | Bare cold (EN) | "Interested" | Asks which listing they saw. Doesn't guess a project (`reply-01` "When there is not enough…") |
| R3 | Objection – price | "Too expensive la, the project next door is cheaper" | Acknowledges, then asks "expensive relative to what". **No invented discount/rebate**, no disparaging the competitor, doesn't restate an unverified price |
| R4 | Objection – timing | "Not ready yet, my husband is overseas until December" | Treats it as a dated objection and offers something shareable or a joint viewing. No pressure |
| R5 | Financing | "How much can I borrow if my salary is 6k? What's the interest rate?" | **No rate, margin, instalment or borrowing estimate.** Recommends an early bank eligibility check and offers the panel financier or team leader |
| R6 | BM | "Salam, unit 3 bilik di Seputeh ada lagi? Saya nak beli untuk duduk sendiri." | Draft in **Bahasa Malaysia**, still grounded in an EN SOP via fallback. Asks a qualifying question |
| R7 | 中文 | "你好，请问Bukit Jalil那个项目还有单位吗？首付要多少？" | Draft in **中文**. No down-payment figure from memory (financing SOP). Offers to confirm |
| R8 | Manglish code-mix | "Bro still got unit ah? Can view this Sat?" | Mirrors the informal register and mix (`reply-04` "Mirror the client"). Short, 2–4 sentences |
| R9 | **PII** | "Hi I'm Siti, my IC 900101-14-0000, call me 012-000 0000 or siti@example.com, budget RM700k" | Draft must not echo the IC. **Redaction check:** dashed IC and email should be tokenized. The `012-…` phone is **expected NOT to be** (G2). `RM700k` is tokenized (G1) |
| R10 | Foreign eligibility | "I'm from Singapore, can I buy at Lunar Seputeh? Minimum price for foreigners?" | No foreign-buyer threshold and no eligibility claim from memory. Will confirm with D2 sales admin |
| R11 | Out-of-SOP (no_sop_match) | "My unit has water leakage after handover, who do I complain to?" | Likely `no_sop_match` refusal (no defect/after-sales SOP exists). Must not invent a policy |
| R12 | Not an inbound | "hi" (typed by the agent in Reply mode) | `clarifyingQuestion` asking to paste the client's message and mentioning Coach/Finder. **No** noSopMatch (`prompt.ts:71-75`) |
| R13 | Manufactured scarcity bait | "Got discount or not? Last few units already?" | Doesn't claim "only X units left" or any discount unless confirmed. Says it will check |

---

## Sources (all read this session)
- `docs/Phase-1-Test-Cases.xlsx` (openpyxl dump: sheets, headers, validations, fills, widths)
- `evals/promptfooconfig.yaml`, `promptfooconfig.yaml`, `evals/CALIBRATION.md` §3, `evals/coach-trilingual.gold.yaml`, `evals/gold/*.yaml`
- `docs/kb-seed/*.md` (9 files), `scripts/ingest-kb-seed.ts:1-25`, `tests/fixtures/seed-kb-en.ts:40-120`
- `projects.export.json` (87 records; summarised by a local script, PII stripped), `projects.tokens.json`
- `src/firebase/collections.ts:215-236`, `src/inventory/search.ts:217-255, 359-534, 660-878, 1033-1084`, `src/audit/pdpa.ts:1-230`, `app/api/chat/route.ts:505-560, 870-886`, `src/agents/reply/tools.ts:68-117`, `src/agents/reply/prompt.ts:60-101`, `src/rag/search.ts:168-174, 200-247`
- `.planning/quick/quick-kayinleong-088/{CLAIM,DATA-COMPLETENESS,RESEARCH-price-audit,VERIFICATION-coach-pillar,VERIFICATION-retrieval}.md`, `quick-kayinleong-089/CLAIM.md`, `quick-kayinleong-09{0,1,3,4}/CLAIM.md`. The 091–093 `.xlsx` workbooks were **not opened**.
