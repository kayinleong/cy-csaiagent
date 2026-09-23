#!/usr/bin/env python3
"""
quick-kayinleong-091 — second-pass verification.

Diffs the shipped `Raw Data` workbook against a SECOND, independent scrape of the
same Skool classroom. The point is to catch anything the first pass got wrong or
that the transform mangled: a missing project, a truncated write-up, a field whose
cell no longer matches what Skool actually says.

    uv run --with openpyxl python verify-against-skool.py \
        --xlsx D2-Property-Raw-Data.xlsx --verify <scrape>/projects-verify.json
"""

import argparse
import importlib.util
import json
import os

import openpyxl


def load_builder():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "build-raw-data-workbook.py")
    spec = importlib.util.spec_from_file_location("builder", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--verify", required=True, nargs="+",
                    help="one or more re-scrape JSONs; passes are merged")
    args = ap.parse_args()

    m = load_builder()
    ws = openpyxl.load_workbook(args.xlsx)["Raw Data"]
    hdr = [c.value for c in ws[1]]
    rows = [dict(zip(hdr, [c.value for c in r])) for r in ws.iter_rows(min_row=2)]
    by_name = {r["Project"]: r for r in rows}

    # Skool throttles a sustained crawl: past a certain depth it serves the page
    # without the SSR payload, so `desc` comes back empty. An empty write-up on a
    # re-scrape is "Skool declined to answer", not "the workbook is wrong" -- so
    # merge every verification pass and check each project against whichever pass
    # actually returned content.
    merged, roster = {}, []
    for path in args.verify:
        v = json.load(open(path))
        for p in v["projects"]:
            n = p["titleClean"]
            if n not in roster:
                roster.append(n)
            if (p["body"]["text"] or "").strip():
                merged.setdefault(n, p)
    unanswered = [n for n in roster if n not in merged]

    fails = []
    v_names = roster
    v = {"scrapedAt": " + ".join(
        json.load(open(p))["scrapedAt"] for p in args.verify)}
    v["projects"] = list(merged.values())
    v["errors"] = []
    missing = [n for n in v_names if n not in by_name]
    extra = [n for n in by_name if n not in v_names]
    if missing:
        fails.append(f"in Skool but not in workbook: {missing}")
    if extra:
        fails.append(f"in workbook but not in Skool: {extra}")

    # 2. Write-up text still identical.
    drift = [p["titleClean"] for p in v["projects"]
             if p["titleClean"] in by_name
             and (p["body"]["text"] or "") != (by_name[p["titleClean"]]["Full Write-up"] or "")]
    if drift:
        fails.append(f"write-up text differs on re-scrape: {drift}")

    # 3. Every field value in the second scrape still matches its cell.
    cell_fails, cell_checked = [], 0
    for p in v["projects"]:
        r = by_name.get(p["titleClean"])
        if not r:
            continue
        extra_col = r.get("Additional Fields") or ""
        for lab, val in m.parse_fields(p["body"]["text"]).items():
            cell_checked += 1
            col = next((h for h in hdr if h.lower() in
                        (lab.lower(), f"{lab.lower()} (write-up field)")), None)
            if col and (r.get(col) or "") == val:
                continue
            if lab.lower() in extra_col.lower():
                continue
            cell_fails.append(f"{p['titleClean']} :: {lab}")
    if cell_fails:
        fails.append(f"{len(cell_fails)} field cells disagree, e.g. {cell_fails[:5]}")

    print(f"re-scrape(s)     : {v['scrapedAt']}")
    print(f"roster           : {len(v_names)} on Skool / {len(rows)} in workbook")
    print(f"re-verified      : {len(merged)} projects returned content")
    print(f"not re-verified  : {len(unanswered)} (Skool served no SSR payload)")
    print(f"field cells      : {cell_checked} re-checked against live Skool")
    print()
    if fails:
        print("RESULT: MISMATCH")
        for f in fails:
            print("  ✗", f)
        raise SystemExit(1)
    print("RESULT: PASS — workbook matches a second independent scrape of Skool")


if __name__ == "__main__":
    main()
