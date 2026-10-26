# Data patch applied: quick-kayinleong-098

- Target: live
- Read at: 2026-10-26T09:01:49.941Z
- Projects read: 87 (83 active)
- Changes planned: 8; skipped: 0
- Plan fingerprint: `bfe09eaee925651226d3211964dcc190ed304ee130c2a8624aede2e9fcba3882`

## Changes

| Project | Field | Before | After | Why |
|---|---|---|---|---|
| Alstonia Hilltop Homes | locationText | `Bukit Rahman Putra, Sungai Buloh, KL North (Mont Kiara/Dutamas region)` | `Bukit Rahman Putra (BRP), Sungai Buloh, Selangor` | Sungai Buloh is not in the Mont Kiara/Dutamas region (UAT F5). Text is the client sheet Area. |
| St. Regis Residences Kuala Lumpur | locationText | `KL Sentral, Kuala Lumpur (Mont Kiara/Dutamas area, KL North)` | `KL Sentral, Kuala Lumpur` | A KL Sentral project tagged as Mont Kiara/Dutamas passes a North Kiara search. |
| Rimbun Saujana Residency | locationText | `Shah Alam, KL West/PJ/Subang region` | `Shah Alam, Selangor` | A Shah Alam project tagged "PJ/Subang region" passes a Subang search. Text is the client sheet Area. |
| d'Brightton titiwangsa | locationText | `Jalan Tiara Titiwangsa, KL East; near Taman Tasik Titiwangsa, KLCC` | `Jalan Tiara Titiwangsa, KL East; near Taman Tasik Titiwangsa and KLCC` | The trailing ", KLCC" read as a KLCC address (UAT F9). KLCC stays, as a landmark. |
| Aspire office @ KL ecocity | propertyType | _(absent)_ | `commercial` | Office development (UAT N2). |
| The Stride Office @ BBCC | propertyType | _(absent)_ | `commercial` | Office development. |
| E&O – City of Elmina (Laman Embun Commercial) | propertyType | _(absent)_ | `commercial` | 2–3 storey commercial shops on commercial land. |
| The MET, Corporate Tower | propertyType | _(absent)_ | `commercial` | Grade A office tower. |

## Skipped

None.

## Effect on Finder area searches (location gate only, active projects)

| Search | Leaves the results | Joins the results |
|---|---|---|
| Mont Kiara | St. Regis Residences Kuala Lumpur, Alstonia Hilltop Homes | — |
| Dutamas | St. Regis Residences Kuala Lumpur, Alstonia Hilltop Homes | — |
| KL North | St. Regis Residences Kuala Lumpur, Alstonia Hilltop Homes | — |
| Subang | Rimbun Saujana Residency | — |

The property-type tags change no area search. They exclude these projects from residential searches, which the name rule in `propertyTypeOf` already does, so the tag makes the record itself correct.

## Applied

- Records written: 8
- Backup: `.planning/quick/quick-kayinleong-098/backups/2026-10-26T09-01-49-942Z.json`
