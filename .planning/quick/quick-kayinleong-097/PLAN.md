---
claim: quick-kayinleong-097
wave: 1
tasks: 1
files_modified:
  - .planning/quick/quick-kayinleong-095/uat-cases.json
  - .planning/quick/quick-kayinleong-095/build-uat-workbook.py
  - .planning/quick/quick-kayinleong-095/verify-uat-workbook.py
  - docs/UAT-Output-Test-Cases.xlsx
  - docs/UAT-Output-Test-Plan.md
must_haves:
  truths:
    - The tester workbook gains a new section "N · New project data (client sheet, October 2026)" with the 14 cases below, placed right after the F section.
    - Every unit-level fact (layout, size, nett range, sold out), gross figure, fact-sheet fact and focus list claimed in an N case is cross-checked by the gate against the live export (projects.export.json, 2026-10-20) and the claim-096 normalised sheet, and the gate fails if one is wrong.
    - The existing 63 cases are unchanged, and the plan doc tells testers what the N section checks and why.
  artifacts:
    - docs/UAT-Output-Test-Cases.xlsx (Test Cases tab only: F, N, R, C, 77 cases)
    - docs/UAT-Output-Test-Plan.md (counts, runs, exit numbers, appendix updated)
  key_links:
    - .planning/quick/quick-kayinleong-096/client-sheet.normalized.json (facts, focusLists, units with gross)
    - projects.export.json (gitignored; read only name, status, priceValue, foreignEligible, bumiQuota, unitTypes)
---

# Plan: add the new-data UAT cases

## Why

Claim 096 loaded the client's project sheet into live data on 20 October 2026. The existing
63 tester cases were refreshed to it (F14, F24), but none of them shows a tester the new
data. Section N adds 14 cases that only pass if the app uses what was loaded:

- new nett from-prices in budget searches;
- per-unit sold-out flags;
- nett vs gross prices;
- facts that now come from the Finder fact sheets;
- the 2026 focus lists;
- honest answers for values that were held back.

## Section and IDs

- **Section letter:** `N`. The band text is `N · New project data (client sheet, October 2026)`.
  - Use N, not D, because "Type D1" is a layout name.
- **Workbook order:** F, N, R, C. So `meta.tester_sections` = `["F","N","R","C"]`.
- **Pillar:** N cases are Property Finder. Area values start with `Finder /`.
  - For EC3, Finder covers F and N together.
  - The appendix shows N as its own row group.
- **Order inside N:** EN N1–N8, then BM N9–N11, then 中文 N12–N14.
- **Preconditions:** the F section default, `Signed in with your tester account. Chip: Finder. New chat for every run.`
- **Steps:** follow the existing composition rule, then end with `Then paste the full answer into the Actual / Comments column.`
- **Runs:** Golden and Rubric 2, Adversarial 3.
- **Run by:** follow the S1 rule (EN F/N: New agent; BM: BM speaker; 中文: 中文 speaker).
- **Double-rated:** N3 and N4.

## New known-status phrases (add to `known_status_phrases`)

- `KS-NEWDATA`: `NEW DATA: this checks figures loaded from the client's project sheet on 20 October 2026. If the answer still shows older figures, copy exactly what it says.`
- `KS-HELD`: `HELD BACK: this value was not loaded because it needs confirming with the client. An honest "not confirmed" is a pass.`

## The 14 cases (pinned; copy the facts exactly; do not add facts)

**N1 | EN | Golden | P0 | Finder / New from-price**
- Case: Bumiputera lead in Subang Jaya now finds Luminar's new price
- Prompt: "Encik Ali, Malaysian, bumiputera, own stay, Subang Jaya, budget up to 500k"
- MUST: The results list Luminar Residence Subang by BRDB with a price from RM411,000.
- MUST NOT: List Rimbun Saujana Residency (priced above the budget). Show Luminar Residence Subang by BRDB as "Price not on record".
- ALSO ACCEPTABLE: Other Subang Jaya projects shown with "Price not on record", as long as they are not called within budget.
- KS: KS-NEWDATA, KS-TABLE
- Projects: must=[Luminar Residence Subang by BRDB]; must_not=[Rimbun Saujana Residency]

**N2 | EN | Golden | P0 | Finder / New from-price**
- Case: Non-bumi lead in Bangsar now finds Parkside's new from-price
- Prompt: "Mr Lim, Malaysian, non-bumi, own stay, Bangsar, budget up to 650k"
- MUST: The results list Parkside Residences with a price from RM588,000.
- MUST NOT: List One Eleven Menerung @ Bangsar (a bumi-quota project from RM1.92 million), Rhombus or Enlace Suites @ Pantai Sentral Park (both above the budget).
- ALSO ACCEPTABLE: Lunar Seputeh (from RM607,800). Bangsar projects shown with "Price not on record" (for example Pinnacle Bangsar Residence or Residensi 38 Bangsar), as long as they are not called within budget.
- KS: KS-NEWDATA, KS-TABLE
- Projects: must=[Parkside Residences]; must_not=[One Eleven Menerung @ Bangsar, Rhombus, Enlace Suites @ Pantai Sentral Park]; also=[Lunar Seputeh, Pinnacle Bangsar Residence, Residensi 38 Bangsar]

**N3 | EN | Golden | P0 | Finder / Sold-out units | DR**
- Case: One Eleven Menerung: the sold-out layout is flagged, not offered
- Prompt: "Which 2-bedroom layouts are still available at One Eleven Menerung @ Bangsar, and from what price?"
- MUST: Lists Type M1 (1,001 sq ft, nett from RM1.92 million), Type M1-A, Type M1-B and Type M3 as available, and says Type M2 is sold out.
- MUST NOT: Offer Type M2 as available, or give a price for Type M2.
- ALSO ACCEPTABLE: Gives each layout's full nett range (M1 RM1.92–2.28 million, M1-A RM2.16–2.19 million, M1-B RM2.35 million, M3 RM2.7 million).
- KS: KS-NEWDATA, KS-CUTOFF
- Projects: must=[One Eleven Menerung @ Bangsar]
- Unit facts:
  - Type M1: size 1001, nett 1920000–2280000, available
  - Type M1-A: nett 2160000–2190000, available
  - Type M1-B: nett 2350000–2350000, available
  - Type M3: nett 2700000–2700000, available
  - Type M2: sold out

**N4 | EN | Golden | P0 | Finder / Sold-out units | DR**
- Case: DC Residensi: only the layouts still for sale are offered
- Prompt: "Which layouts at Damansara City Residency (DC Residensi) can my client still buy, and from what nett price?"
- MUST: Offers Type S1 and Type S2 (904 sq ft, nett RM1.2–1.35 million) and Type A3 (1,194 sq ft, nett RM1.36–1.46 million).
- MUST NOT: Offer any sold-out layout (Types A1, A2, A4, A5, A6, B1 to B7, C1 or E1) as available. Give a price for a sold-out layout.
- ALSO ACCEPTABLE: Also lists Type E2 (2,982 sq ft) as available with no price on record. Says most other layouts are sold out.
- KS: KS-NEWDATA, KS-CUTOFF
- Projects: must=[Damansara City Residency (DC Residensi)]
- Unit facts:
  - Type S1 and Type S2: size 904, nett 1200000–1350000, available
  - Type A3: size 1194, nett 1360000–1460000, available
  - Type E2: size 2982, available
  - Sold out: Type A1, A2, A4, A5, A6, B1, B2, B3, B4, B5, B6, B7, C1, E1

**N5 | EN | Golden | P1 | Finder / Nett and gross price**
- Case: SO Sofitel Type B1A: the nett price comes first
- Prompt: "What is the price of SO Sofitel Residences KLCC Type B1A?"
- MUST: Gives the nett price RM1,525,440 for Type B1A (681 sq ft, 1 bedroom).
- MUST NOT: Give only the gross price (RM1,906,800) as the price. Quote a discount or rebate that is not on record.
- ALSO ACCEPTABLE: Also shows the gross price RM1,906,800, labelled as gross.
- KS: KS-NEWDATA, KS-CUTOFF
- Projects: must=[SO Sofitel Residences KLCC]
- Unit facts: Type B1A: size 681, bedrooms 1, nett 1525440–1525440
- Gross facts (from the 096 normalised sheet): Type B1A gross 1906800–1906800

**N6 | EN | Golden | P1 | Finder / Fact sheet**
- Case: Eden BRDB developer, units and completion, from the client fact sheet
- Prompt: "Who is the developer of Eden BRDB, Taman Duta, how many units does it have, and when is completion?"
- MUST: Developer BRDB. 146 units (including 22 duplex penthouses). Completion mid 2029.
- MUST NOT: Use another project's developer, unit count or completion date.
- ALSO ACCEPTABLE: Also mentions the maintenance fee of RM0.70 psf (inclusive of sinking fund), or that it is freehold.
- KS: KS-NEWDATA
- Projects: must=[Eden BRDB, Taman Duta]
- Sheet facts:
  - developer = "BRDB"
  - totalUnits = "146 units (including 22 duplex penthouses)"
  - completion = "Completion Date: Mid 2029"
  - maintenanceFee = "RM0.70 psf (inclusive of sinking fund)"

**N7 | EN | Rubric | P1 | Finder / 2026 focus lists**
- Case: Is Southpoint one of D2's 2026 focus projects?
- Prompt: "Is Southpoint Residences one of D2's top projects to cross-sell in 2026?"
- MUST: Says yes: Southpoint Residences is on D2's 2026 list of top projects to cross-sell.
- MUST NOT: Say it is not on the list. Name a D2 list that is not on record.
- ALSO ACCEPTABLE: Also says it is one of D2's top performing projects in 2026. Mentions its developer, MVCSP Sdn Bhd (an IGB Group subsidiary).
- KS: KS-NEWDATA
- Projects: must=[Southpoint Residences (IGB )]
- Focus facts: "TOP PROJECTS IN 2026 TO CROSS-SELL" and "TOP PERFORMING PROJECTS IN 2026" are both in Southpoint's `focusLists`
- Sheet facts: developer = "MVCSP Sdn Bhd (a subsidiary of IGB Group)"

**N8 | EN | Adversarial | P0 | Finder / Held-back value**
- Case: DC Residensi Type E1 size is not confirmed yet
- Prompt: "What is the built-up size of DC Residensi Type E1?"
- MUST: Says the Type E1 size is not confirmed yet, and offers to confirm with D2. It may also say Type E1 is sold out.
- MUST NOT: State 2,072 sq ft or 2,702 sq ft as the confirmed size of Type E1.
- ALSO ACCEPTABLE: Gives the sizes of other 3-bedroom layouts (Type C1 2,077 sq ft, Type E2 2,982 sq ft), clearly labelled as other layouts.
- KS: KS-HELD
- Projects: must=[Damansara City Residency (DC Residensi)]
- Unit facts:
  - Type E1: sold out, size null in export
  - Type C1: size 2077
  - Type E2: size 2982
- Held facts: DC Residensi Type E1 `held` contains "Size" in the 096 normalised sheet

**N9 | BM | Golden | P0 | Finder / New from-price**
- Case: Non-bumi lead in Bangsar finds Parkside (BM)
- Prompt: "Cik Tan, warganegara Malaysia, bukan bumiputera, untuk duduk sendiri, Bangsar, bajet sehingga 650k"
- MUST: The results list Parkside Residences with a price from RM588,000. Any written text is in BM.
- MUST NOT: List One Eleven Menerung @ Bangsar, Rhombus or Enlace Suites @ Pantai Sentral Park.
- ALSO ACCEPTABLE: Lunar Seputeh. Bangsar projects shown with "Price not on record", as long as they are not called within budget.
- KS: KS-NEWDATA, KS-TABLE, KS-UI-EN
- Projects: same must and must_not as N2; also=[Lunar Seputeh]

**N10 | BM | Golden | P1 | Finder / Fact sheet**
- Case: Kensho maintenance fee (BM)
- Prompt: "Berapakah yuran penyelenggaraan di Kensho @ Taman Desa?"
- MUST: Answers in BM: RM0.44 psf, inclusive of the sinking fund.
- MUST NOT: Give a different fee, or another project's fee.
- ALSO ACCEPTABLE: Also mentions the developer, Regal Path Sdn Bhd (a Malton Berhad subsidiary), or completion in Q4 2026.
- KS: KS-NEWDATA, KS-UI-EN
- Projects: must=[Kensho @ Taman Desa]
- Sheet facts:
  - maintenanceFee = "RM0.44 psf (inclusive of sinking fund)"
  - developer = "Regal Path Sdn Bhd (a subsidiary of Malton Berhad)"
  - completion = "Completion Date: Q4 2026"

**N11 | BM | Adversarial | P1 | Finder / Held-back value**
- Case: Imperial Residences Type H1a nett price is not confirmed (BM)
- Prompt: "Berapakah harga nett PDH: Imperial Residences RA jenis H1a?"
- MUST: Says in BM that the nett price for H1a is not confirmed yet, and offers to confirm.
- MUST NOT: Quote Type H1's nett price (RM5.05–7.15 million) as the H1a nett price. Quote "RM4.77 mil – RM6.59 mil" as a confirmed price.
- ALSO ACCEPTABLE: Gives the H1a gross price (RM5.17–7.15 million), labelled as gross.
- KS: KS-HELD, KS-UI-EN
- Projects: must=[PDH: Imperial Residences RA]
- Unit facts:
  - "Type H1A (South Wing)": nett null in export
  - "Type H1 (North Wing)": nett 5050000–7150000
- Held facts: Imperial H1a `held` contains "Nett"
- Gross facts: H1a gross 5170000–7150000

**N12 | 中文 | Golden | P0 | Finder / Sold-out units**
- Case: One Eleven Menerung sold-out layout (中文)
- Prompt: "One Eleven Menerung @ Bangsar 还有哪些两房户型可以买？价格从多少起？"
- MUST: Answers in 中文. Lists Type M1 (1,001 sq ft, nett from RM1.92 million), Type M1-A, Type M1-B and Type M3 as available, and says Type M2 is sold out.
- MUST NOT: Offer Type M2 as available, or give a price for Type M2.
- ALSO ACCEPTABLE: Gives each layout's full nett range.
- KS: KS-NEWDATA, KS-CUTOFF, KS-UI-EN
- Projects: must=[One Eleven Menerung @ Bangsar]
- Unit facts: as N3

**N13 | 中文 | Golden | P1 | Finder / New from-price**
- Case: Bumiputera lead in Subang Jaya (中文)
- Prompt: "阿里先生，马来西亚人，土著，自住，Subang Jaya，预算50万以内"
- MUST: The results list Luminar Residence Subang by BRDB with a price from RM411,000. Any written text is in 中文.
- MUST NOT: List Rimbun Saujana Residency. Show Luminar Residence Subang by BRDB as "Price not on record".
- ALSO ACCEPTABLE: Other Subang Jaya projects shown with "Price not on record", as long as they are not called within budget.
- KS: KS-NEWDATA, KS-TABLE, KS-UI-EN
- Projects: as N1

**N14 | 中文 | Adversarial | P1 | Finder / Sold-out units**
- Case: Asking for a sold-out Eden layout (中文)
- Prompt: "Eden BRDB, Taman Duta 的 Type C1 还可以买吗？"
- MUST: Says in 中文 that Type C1 is sold out.
- MUST NOT: Offer Type C1 as available, or give a price for Type C1.
- ALSO ACCEPTABLE: Offers other available layouts, such as Type A2 (5,307 sq ft, nett from RM8.5 million), Type C, Type A3a or Type D1.
- KS: KS-NEWDATA, KS-UI-EN
- Projects: must=[Eden BRDB, Taman Duta]
- Unit facts:
  - Type C1: sold out
  - Type A2: size 5307, nett 8500000–11800000, available

### Expected totals after the change

| Section | Language | Golden | Rubric | Adversarial | Total |
|---|---|---:|---:|---:|---:|
| New project data (N) | EN | 6 | 1 | 1 | 8 |
| New project data (N) | BM | 2 | 0 | 1 | 3 |
| New project data (N) | 中文 | 2 | 0 | 1 | 3 |

- The workbook total becomes 77 tester cases (63 + 14).
- Planned runs become 180 (149 + 31).
- Double-rated cases become 16.

<tasks>
<task type="auto">
  <name>T1: add section N to the case source, builder, gate and plan doc; rebuild; prove the gate bites</name>
  <files>.planning/quick/quick-kayinleong-095/uat-cases.json, .planning/quick/quick-kayinleong-095/build-uat-workbook.py, .planning/quick/quick-kayinleong-095/verify-uat-workbook.py, docs/UAT-Output-Test-Cases.xlsx, docs/UAT-Output-Test-Plan.md</files>
  <action>
**1. JSON**

- Add section N to `sections`, using the band text above.
- Set `meta.tester_sections` to `["F","N","R","C"]`.
- Add the two KS phrases.
- Append the 14 cases. Follow the existing case schema exactly, with every existing field.
- `source` is internal. Use labels like "quick-kayinleong-097 N3 (096 import: unit facts)".
- Add two optional per-case fields, internal and never written to the workbook:
  - `unit_facts`: a list of `{project, label, sizeSqft?, bedrooms?, nettMinRM?, nettMaxRM?, soldOut?, grossMinRM?, grossMaxRM?, held?}`.
  - `sheet_facts`: a list of `{project, field, value}` or `{project, focus: "<list heading>"}`.
- Copy every value from the pinned facts above.
- Do NOT change any existing case.

**2. Builder**

- Place N right after F, in the `tester_sections` order.
- Nothing else changes: same columns, styling and validation.

**3. Gate.** Extend `verify-uat-workbook.py`:

- **Section rules.** Section N follows every existing rule: ordering, counts, hygiene, the D8 project cross-check and freeze panes.
- **New check: unit facts against the export.**
  - Load `unitTypes` for each named project from `projects.export.json`. Read only `name`, `status`, `priceValue`, `foreignEligible`, `bumiQuota` and `unitTypes`. Never read or print `description`.
  - Match units by exact label.
  - Each claimed size, bedrooms, nettMin/Max and soldOut must equal the export. `soldOut` absent in the export means available.
- **New check: sheet facts.**
  - Gross figures, `held` columns, facts and focus lists must equal `.planning/quick/quick-kayinleong-096/client-sheet.normalized.json`, matched by `inventoryName` and unit label.
- **New check: MUST clauses show the numbers.**
  - For each N case, every number in its MUST clause that names a size or price must also appear in its `unit_facts` or `sheet_facts`, after normalising "RM1.92 million" to 1920000 and "1,001 sq ft" to 1001.
  - Keep the parser simple and tolerant; if a phrase can't be parsed, skip it and report it.
- **Update existing checks:**
  - plan-doc counts, appendix and exit numbers;
  - the E6 pattern, which must not flag `\bN\d+\b` (N is a tester section now);
  - any hard-coded 63/149/14.
- **Self-test.** Add 3 injected defects, all of which must BITE:
  - change N3's Type M1 size to 1010 in a temp copy;
  - mark One Eleven Type M2 as available (`soldOut: false`) in a temp export copy;
  - change Eden's totalUnits in the N6 `sheet_facts`.

**4. Plan doc** (`docs/UAT-Output-Test-Plan.md`). Write in plain English and keep the 13 headings.

- **Title summary and §1:** say the project data was refreshed from the client's project sheet on 20 October 2026, and that the new section N checks it.
- **§2:** add a short "New project data (cases N1–N14)" subsection:
  - what it checks: new from-prices in searches, sold-out layouts flagged and never offered, nett vs gross, facts from the new project fact sheets, 2026 focus lists, and honest "not confirmed" answers for values still with the client;
  - what a good answer looks like.
- **§5:** total runs become 180.
- **§10:** recompute the exact needed counts.
  - EC3: Finder now has 42 cases (F + N); Reply and Coach are unchanged.
  - EC4: per-language counts.
  - EC5: adversarial (23 + 3 = 26).
  - EC6: double-rated (16).
  - EC4 cells with 10 or more cases.
- **§11:** add one short note that answers drawing on the new fact sheets may cite them. Keep the existing items.
- **§13:** add the N rows, update the totals row, write `Planned scripted runs: 180 …` and `Double-rated cases: 16.`

**5. Run**

- Run the builder, then the verifier (0 FAIL), then `--self-test` (all BITES).
- Rebuild twice and confirm the output is identical both times.
- Dump the N rows of the built workbook (ID, Test Case, Steps, Expected Result, Known Status) and read them as a tester on a phone would.

**Rules**

- Never read `.env*`.
- Never print an export `description`.
- Do not touch app code or any other claim's files.
- No git writes; the orchestrator commits.
- Use only synthetic names from the existing allowlist: "Encik Ali", "Cik Tan", "Mr Lim" and the Chinese 阿里先生. If the allowlist doesn't include 阿里先生, check how F22 handles it and follow the same rule.

<verification_required>
Before reporting completion, you MUST run a self-verification pass:

1. **Output exists**: Verify every file you were asked to create/modify actually exists on disk.
2. **Correctness check**: Run the relevant test suite, type checker, or linter for any code changed.
3. **Regression scan**: List every code path your changes touched. For each, confirm no adjacent feature is broken (grep for callers, run affected tests).
4. **Diff review**: Read your own diff. For each hunk ask: "What existing behavior could this break?" Investigate any hunk you cannot answer confidently.
5. **Artifacts complete**: Confirm your SUMMARY.md / output document exists and has `status: complete`.

Report verification results explicitly. If any check fails, fix it before returning — do not report completion with known failures.
</verification_required>
  </action>
  <verify>
    <automated>python3 .planning/quick/quick-kayinleong-095/build-uat-workbook.py && python3 .planning/quick/quick-kayinleong-095/verify-uat-workbook.py && python3 .planning/quick/quick-kayinleong-095/verify-uat-workbook.py --self-test</automated>
  </verify>
  <done>The workbook has F, N, R and C (77 cases). The gate shows 0 FAIL, and every N unit fact, gross figure, sheet fact and focus list is cross-checked. The self-test bites on all old and new defects. The plan doc counts equal the workbook. The 63 existing cases are byte-identical in the JSON.</done>
</task>
</tasks>

<threat_model>
| Threat | Mitigation |
|---|---|
| A client-facing case states a wrong figure | Every N fact is pinned here from the live export and the 096 normalised sheet, and is re-checked by the gate against both. |
| PII or contact details in client docs | Existing S11 hygiene checks cover the N rows. The export loader never reads `description`. |
| Existing cases are altered by accident | The done criterion requires the 63 existing cases to be byte-identical. The orchestrator diffs the JSON. |
</threat_model>
