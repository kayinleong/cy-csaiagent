#!/usr/bin/env python3
"""
quick-kayinleong-093 — verification of the merged sheet.

The merge step checks each value against the harvested candidate lines. That is the
wrong end of the chain to stop at: the candidates are my own intermediate artifact. This
goes back to the SOURCE — the document text exported from the KB — and asks, for every
value written into the sheet:

  1. does its evidence line appear verbatim in the text of the document it names, and
  2. is that value actually sitting in the sheet cell it claims, and
  3. does the named document really belong to that project?

Plus the structural guarantees: one tab, no Drive Doc columns left, and not one Skool
value overwritten.

    uv run --with openpyxl python verify-merge.py --merged <out>.xlsx \
        --baseline <quick-091>.xlsx --kb <scratch>/kb-text.json --audit AUDIT.json
"""

import argparse
import json
import re
from collections import defaultdict

import openpyxl

norm = lambda s: re.sub(r"\s+", " ", str(s or "")).strip()
fold = lambda s: norm(s).lower()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--merged", required=True)
    ap.add_argument("--baseline", required=True)
    ap.add_argument("--kb", required=True)
    ap.add_argument("--audit", required=True)
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.merged)
    ws = wb["Raw Data"]
    hdr = [c.value for c in ws[1]]
    rows = {r["Project"]: r for r in
            (dict(zip(hdr, [c.value for c in x])) for x in ws.iter_rows(min_row=2))}

    base = openpyxl.load_workbook(args.baseline)["Raw Data"]
    bh = [c.value for c in base[1]]
    brows = {r["Project"]: r for r in
             (dict(zip(bh, [c.value for c in x])) for x in base.iter_rows(min_row=2))}

    kb = [d for d in json.load(open(args.kb))["docs"] if d["chars"] > 0]
    doctext = defaultdict(list)
    for d in kb:
        owner = d["fileName"] if d["project"] == "WhatsApp" else d["project"]
        doctext[(owner, d["fileName"])].append(fold(d["text"]))

    audit = json.load(open(args.audit))
    written = audit["written"]

    fails = []

    # --- structure ---------------------------------------------------------
    if wb.sheetnames != ["Raw Data"]:
        fails.append(f"expected exactly one 'Raw Data' sheet, got {wb.sheetnames}")
    leftover = [h for h in hdr if str(h).startswith("Drive Doc")]
    if leftover:
        fails.append(f"{len(leftover)} Drive Doc columns still present: {leftover[:4]}")
    if len(rows) != len(brows):
        fails.append(f"row count changed: {len(brows)} -> {len(rows)}")

    # --- nothing from Skool was overwritten --------------------------------
    clobbered = []
    for proj, br in brows.items():
        mr = rows.get(proj, {})
        for col in bh:
            b, m = norm(br.get(col)), norm(mr.get(col))
            if b and b != m:
                clobbered.append(f"{proj} :: {col}")
    if clobbered:
        fails.append(f"{len(clobbered)} Skool values overwritten, e.g. {clobbered[:4]}")

    # --- every written value traces to real document text ------------------
    bad_ev, bad_cell, bad_doc, ok = [], [], [], 0
    for w in written:
        proj, col, val, ev, doc = (w["project"], w.get("written_to"),
                                   w["value"], w["evidence"], w.get("doc"))
        texts = doctext.get((proj, doc))
        if not texts:
            bad_doc.append(f"{proj} :: {doc}")
            continue
        if not any(fold(ev) in t for t in texts):
            bad_ev.append(f"{proj} :: {col} :: {ev[:60]}")
            continue
        if norm(rows.get(proj, {}).get(col)) != norm(val):
            bad_cell.append(f"{proj} :: {col}")
            continue
        ok += 1
    if bad_doc:
        fails.append(f"{len(bad_doc)} values cite a document not belonging to that project: {bad_doc[:3]}")
    if bad_ev:
        fails.append(f"{len(bad_ev)} evidence lines not found in their source document: {bad_ev[:3]}")
    if bad_cell:
        fails.append(f"{len(bad_cell)} values not present in the cell they claim: {bad_cell[:3]}")

    print(f"sheet            : {wb.sheetnames} | {len(rows)} rows x {len(hdr)} cols")
    print(f"Drive Doc columns: {len(leftover)} (want 0)")
    print(f"Skool values kept: {len(clobbered)} overwritten (want 0)")
    print(f"merged values    : {ok}/{len(written)} traced to verbatim source-document text")
    print(f"rejected upstream: {len(audit['rejected_failed_evidence'])} failed the evidence gate")
    print()
    if fails:
        print("RESULT: FAIL")
        for f in fails:
            print("  ✗", f)
        raise SystemExit(1)
    print("RESULT: PASS — every merged value traces to verbatim text in its source document")


if __name__ == "__main__":
    main()
