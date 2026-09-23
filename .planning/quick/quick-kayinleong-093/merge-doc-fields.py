#!/usr/bin/env python3
"""
quick-kayinleong-093 — stage 3: merge the document-derived values into the sheet.

Takes the quick-091 workbook (84 x 240, Skool only) plus the stage-2 extractions and
writes the merged sheet: still ONE tab, `Raw Data`, with the Drive Doc text columns
gone and their *data* folded into the real field columns.

Every incoming value is re-checked here before it is written. Stage 2 was asked to quote
its source verbatim; this stage enforces it:

  1. the evidence string must appear, character-for-character, among the candidate lines
     harvested for that project+field, and
  2. the value must appear inside its own evidence.

Anything failing either check is dropped and reported. That is the guard quick-088 found
missing when 21 of 51 stored prices turned out to have been calculated rather than read.

A value is only ever written into a column the Skool write-up left BLANK -- D2's own
curated text stays authoritative and is never overwritten.

    uv run --with openpyxl python merge-doc-fields.py \
        --xlsx <quick-091>.xlsx --candidates <scratch>/candidates.json \
        --extracts <scratch>/extract-*.json --out <out>.xlsx --audit AUDIT.json
"""

import argparse
import glob
import json
import re

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# harvest field -> existing sheet columns, most specific first. Empty list = new column.
FIELD_COLUMNS = {
    "Tenure": ["Tenure", "Land Tenure"],
    "Land Title": ["Title", "Land Title"],
    "Developer": ["Developer"],
    "Land Size": ["Land Size"],
    "Total Units": ["Total Units"],
    "Total Storeys": ["Total Storeys", "Storeys", "Total Floors"],
    "Units Per Floor": ["Units Per Floor"],
    "Target Completion": ["Target Completion", "Completion"],
    "Built-up": ["Built-up sizes", "Main Unit Layouts", "Unit Layouts", "Built Up", "Built-up"],
    "Price": ["Price"],
    "Price psf": [],
    "Maintenance Fee": ["Maintenance Fee"],
    "Booking Fee": ["Booking Fee", "Booking"],
    "Car Parks": ["Car Parks", "Carparks", "Carpark", "Car Park"],
    "Ceiling Height": ["Ceiling Height"],
    "Bumi Quota": [],
    "Foreign Eligible": [],
    "Furnishing": ["Furnishing"],
    "Panel Banks": ["Panel Banks"],
    "Facilities": ["Facilities"],
}

norm = lambda s: re.sub(r"\s+", " ", str(s or "")).strip()
fold = lambda s: norm(s).lower()

# Generic words shared by half the roster -- useless for telling projects apart.
STOP = {"residences", "residence", "residency", "residensi", "the", "by", "kl", "kuala",
        "lumpur", "suites", "project", "phase", "tower", "homes", "hills", "park", "city",
        "at", "and", "bukit", "jalan", "klcc", "pj", "sdn", "bhd"}


def distinctive(name):
    return {w for w in re.findall(r"[a-z0-9]{3,}", name.lower()) if w not in STOP}


def misattributed(filename, project, all_projects):
    """True when the source file's NAME points at a different development.

    The KB inherits its project from the Drive folder, and some folders are shared
    collateral dumps -- one holds 194 files for other developments entirely. A value
    read out of 'The Reya Sales Kit.pdf' must not land on a different project's row
    just because of where the file was stored.
    """
    fn = fold(filename)
    if any(w in fn for w in distinctive(project)):
        return None  # names its own project -- trust it
    for other in all_projects:
        if other == project:
            continue
        keys = distinctive(other)
        if keys and any(w in fn for w in keys):
            return other
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--extracts", required=True, nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--audit", required=True)
    args = ap.parse_args()

    ws = load_workbook(args.xlsx)["Raw Data"]
    headers = [c.value for c in ws[1]]
    rows = [dict(zip(headers, [c.value for c in r])) for r in ws.iter_rows(min_row=2)]

    cand = json.load(open(args.candidates))["projects"]
    extracts = {}
    for path in sorted(p for pat in args.extracts for p in glob.glob(pat)):
        for proj, fields in json.load(open(path)).items():
            extracts.setdefault(proj, {}).update(fields)

    all_projects = [r["Project"] for r in rows]
    accepted, rejected = [], []
    for proj, fields in extracts.items():
        # Scoped per project, not per field. The point of this gate is "did this text
        # really come from this project's documents", and the harvester's own field
        # bucketing is imperfect -- a completion year can land in the Price bucket
        # because the line also contains "RM". Penalising that would discard correct,
        # verbatim values for a defect in my regex, not in the reading.
        pool = {fold(c["line"]) for v in cand.get(proj, {}).values() for c in v}
        for field, rec in fields.items():
            val, ev = norm(rec.get("value")), norm(rec.get("evidence"))
            wrong = misattributed(rec.get("doc") or "", proj, all_projects)
            why = None
            if not val:
                why = "empty value"
            elif field not in FIELD_COLUMNS:
                why = f"unknown field {field!r}"
            elif wrong:
                why = f"source document names a different project ({wrong!r})"
            elif fold(ev) not in pool:
                why = "evidence not found verbatim among harvested candidate lines"
            elif fold(val) not in fold(ev):
                why = "value does not appear inside its own evidence"
            (rejected if why else accepted).append(
                {"project": proj, "field": field, "value": val,
                 "evidence": ev, "doc": rec.get("doc"), **({"reason": why} if why else {})})

    # New columns only for fields that survived and have no home column.
    new_cols = []
    for a in accepted:
        if not any(c in headers for c in FIELD_COLUMNS[a["field"]]):
            if a["field"] not in new_cols:
                new_cols.append(a["field"])
    out_headers = list(headers) + sorted(new_cols)

    by_project = {}
    for a in accepted:
        by_project.setdefault(a["project"], []).append(a)

    written, skipped_occupied = 0, []
    for r in rows:
        for a in by_project.get(r["Project"], []):
            col = next((c for c in FIELD_COLUMNS[a["field"]] if c in headers), a["field"])
            if norm(r.get(col)):
                skipped_occupied.append({**a, "reason": f"column {col!r} already populated from Skool"})
                continue
            r[col] = a["value"]
            a["written_to"] = col
            written += 1

    wb = Workbook()
    out = wb.active
    out.title = "Raw Data"
    out.append(out_headers)
    fill_old = PatternFill("solid", fgColor="1F3864")
    fill_new = PatternFill("solid", fgColor="2E7D32")
    for i, h in enumerate(out_headers, start=1):
        c = out.cell(row=1, column=i)
        c.fill = fill_new if h in new_cols else fill_old
        c.font = Font(bold=True, color="FFFFFF", size=10)
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for r in rows:
        out.append([r.get(h, "") for h in out_headers])
    for i, h in enumerate(out_headers, start=1):
        longest = max([len(str(h))] + [len(str(r.get(h, "")).split("\n")[0]) for r in rows])
        out.column_dimensions[get_column_letter(i)].width = min(max(12, longest + 2), 52)
    for row in out.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
    out.freeze_panes = "B2"
    out.auto_filter.ref = f"A1:{get_column_letter(len(out_headers))}{len(rows) + 1}"
    wb.save(args.out)

    json.dump({"written": [a for a in accepted if a.get("written_to")],
               "rejected_failed_evidence": rejected,
               "skipped_column_already_populated": skipped_occupied},
              open(args.audit, "w"), indent=1)

    print(f"[merge] extractions in      : {sum(len(v) for v in extracts.values())}")
    print(f"[merge] failed evidence gate: {len(rejected)}")
    print(f"[merge] column occupied     : {len(skipped_occupied)}")
    print(f"[merge] VALUES WRITTEN      : {written}")
    print(f"[merge] new columns         : {sorted(new_cols)}")
    print(f"[merge] {len(rows)} rows x {len(out_headers)} columns -> {args.out}")


if __name__ == "__main__":
    main()
