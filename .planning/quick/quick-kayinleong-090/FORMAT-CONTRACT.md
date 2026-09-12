# Finder output format contract

Derived from the user's attached `Fact + Layout + Reason summary (Royal Suites).docx`
(2026-09-12). Verbatim extraction in `source-royal-suites.txt`.

The Finder answers in **exactly two** shapes. There is no third shape, and no prose
summary wrapper around either.

---

## Format A — recommendations ask → markdown table ONLY

Triggered when the user asks for a recommendation, a shortlist, "what's good in <area>",
a comparison, or anything plural.

A GFM markdown table, one row per project. No prose before or after beyond, at most, a
single framing line. No bullet lists.

---

## Format B — single-property ask → the docx fact-sheet layout

Triggered when the user names one project and asks about it.

Three sections, in this order, with these exact headings:

### 1. Fact sheet — `Label: value` lines, in this order

| Label | Royal Suites example value |
|---|---|
| Project Name | Royal Suites, Pavilion Damansara Heights (phase 2) |
| Location | Damansara Heights |
| Developer | Pavilion group |
| Land Tenure | Freehold |
| Land Title | Commercial under HDA |
| No. of Blocks | 1 block (51 storeys) |
| Total Units | 490 units |
| Size Built-up | 452-1679sqft |
| No. of Bedroom | Studio – 3 Bedroom (Dual-key available) |
| Carpark | 1-2 carpark (tandem available) |
| Price Value | RM 650k-3.6mil |
| Price Psf | RM 1.5k-2.1k psf |
| Maintenance Fee | 99 cents psf including sinking fund |
| Completion | Estimate Q1 2029 (SPA 52 months) |

### 2. `LAYOUT SUMMARY BREAKDOWN`

One entry per layout type: `<type> <size range>` then a price line.

```
Studio 452-538sqft
- RM650k - RM1.2mil+
1+1 Room 635-850sqft
- RM900k - RM1.8mil+
2 Room 743sqft
- RM1.3mil - RM1.6mil+
2+1 Room 1,119sqft
- RM1.9mil - RM2.3mil+
3 Room 1,550sqft
- RM2.5mil - RM3.3mil+
Dual Key 1,302-1,679sqft
- RM2.2mil - RM3.6mil+
```

### 3. `TOP REASONS WHY <PROJECT NAME>`

Bullet list of selling points, `<claim> – <supporting detail>`:

```
Branded Developer – Pavilion luxury home track record
Exclusive Prime location – Damansara Heights lowest density aka Beverly Hills of KL
Freehold mixed development – MRT, Premium Mall, Hotel conveniences
Quality fittings – Bosch, Smeg, Marble & Timber flooring, Double-glazed window, etc
Unobstructed view of KL/Bangsar city or PJ/Bukit Kiara greeneries
```

---

## No-summarization rule

Applies to both formats. Stored property detail is emitted **in full**, not condensed,
not paraphrased into prose. A field that is missing from the record is reported as
missing — never inferred, never filled from the model's own knowledge.
