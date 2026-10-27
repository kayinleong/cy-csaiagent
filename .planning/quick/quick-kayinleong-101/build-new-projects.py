"""Build the three projects claim 096 skipped as new (quick-kayinleong-101).

Binastra Cochrane, Lagenda Tunku (Villa Gemilang) and Ashbourne are in the client's project
info sheet but were never created in the inventory. This reuses the 096 builder's own parsing
(row grouping, fact gating, unit parsing, fact-sheet rendering) so the three come out in exactly
the shape the other 81 did, and writes:

  new-projects/client-sheet.new.json   client-sheet/1 shape, read by scripts/add-client-workbook-projects.ts
  new-projects/factsheets/*.md         one fact sheet per project
  new-projects/factsheets/index.json   manifest for scripts/ingest-client-factsheets.ts --manifest
  new-projects/HELD-BACK.md            values the gates held back, if any

The project document IDs are allocated once, here, and kept in new-project-ids.json so the
fact sheets can name their project before it exists and a re-run produces identical output.

    python3 -I -B build-new-projects.py --workbook PATH
"""

import argparse
import hashlib
import importlib.util
import json
import secrets
import string
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
B096_DIR = HERE.parent / "quick-kayinleong-096"

_spec = importlib.util.spec_from_file_location("build096", B096_DIR / "build-client-sheet.py")
b = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b)
w = b.w

EXPECTED_WORKBOOK_SHA256 = "8b7c1c9aa4cd1ebc3b1fe78409691587dfb4bd266c9310b5967a6c06c80bad51"
SOURCE_LABEL = "D2 project info sheet supplied by the client, 27 October 2026"
IMPORT_DATE = "2026-10-27"
IDS_FILE = HERE / "new-project-ids.json"
ID_ALPHABET = string.ascii_letters + string.digits


def allocate_ids(names):
    """Read the pinned IDs, adding a Firestore-style 20-char ID for any name without one."""
    ids = json.loads(IDS_FILE.read_text("utf-8")) if IDS_FILE.exists() else {}
    changed = False
    for n in names:
        if n not in ids:
            ids[n] = "".join(secrets.choice(ID_ALPHABET) for _ in range(20))
            changed = True
    if changed:
        IDS_FILE.write_bytes(b.dump_json(ids))
    return ids


def build(workbook, expected_sha):
    data = b.load_workbook_data(workbook, expected_sha)
    groups, _ignored = b.group_rows(data["rows"])
    by_name = dict((g["name"], g) for g in groups)
    missing = [n for n in b.SKIPPED_NEW if n not in by_name]
    if missing:
        raise b.BuildError("refusing: the sheet no longer lists %s" % ", ".join(missing))
    ids = allocate_ids(b.SKIPPED_NEW)
    ids_sha = b.sha256_hex(IDS_FILE.read_bytes())
    sheet1_pairs = b.parse_sheet1(data["sheet1"])

    w.SOURCE_LABEL = SOURCE_LABEL  # render_factsheet reads it at call time
    files, projects, held_all, sheets_index = {}, [], [], []
    for name in b.SKIPPED_NEW:
        g = by_name[name]
        held = []
        facts, tenure, completion = b.build_project_fields(g, held)
        units_cells = b.build_units(g, held)
        doc_id = ids[name]
        focus = []
        for heading, n in sheet1_pairs:
            if n == name and heading not in focus:
                focus.append(heading)
        p = {
            "docId": doc_id, "inventoryName": name, "sheetName": name, "sheetRow": g["row"],
            "unitMode": "merge" if units_cells else "none", "labelPrefix": "",
            "units": [u for u, _ in units_cells], "tenure": tenure, "completion": completion,
            "area": facts["area"], "facts": dict((k, facts[k]) for k, _, _ in w.FACT_COLUMNS),
            "focusLists": focus,
        }
        text = b.render_factsheet(p, units_cells)
        if text is None:
            p["factSheet"] = None
        else:
            rel = "factsheets/%s-%s.md" % (b.slugify(name), doc_id[:6])
            p["factSheet"] = rel
            raw = text.encode("utf-8")
            files[rel] = raw
            sheets_index.append({"file": rel, "docId": doc_id, "inventoryName": name,
                                 "title": "%s — D2 project facts (client sheet)" % w.clean_fact(name),
                                 "category": w.clean_fact(name), "sha256": b.sha256_hex(raw)})
        for h in held:
            h["inventoryName"] = name
            h["docId"] = doc_id
        held_all.extend(held)
        projects.append(p)

    files["factsheets/index.json"] = b.dump_json({
        "meta": {"schema": "factsheets/1", "source_label": SOURCE_LABEL, "workbook_sha256": data["sha"]},
        "sheets": sheets_index,
    })
    doc = {
        "meta": {"schema": "client-sheet/1", "source_label": SOURCE_LABEL, "import_date": IMPORT_DATE,
                 "workbook_sha256": data["sha"], "mapping_sha256": ids_sha},
        "projects": projects,
        "skipped": [],
        "heldBack": [{"docId": h["docId"], "inventoryName": h["inventoryName"], "sheetRow": h["sheetRow"],
                      "unit": h["unit"], "column": h["column"], "sheetText": h["sheetText"],
                      "reason": h["reason"]} for h in held_all],
        "conflicts": [],
    }
    errs = w.check_invariants(doc)
    if errs:
        raise b.BuildError("invariant violations:\n  " + "\n  ".join(errs))
    files["client-sheet.new.json"] = b.dump_json(doc)

    lines = ["# Held back from the three new projects", ""]
    if not held_all:
        lines.append("Nothing was held back.")
    for h in held_all:
        lines.append("- %s, row %d%s, %s: %s. %s" % (
            h["inventoryName"], h["sheetRow"], (" (%s)" % h["unit"]) if h["unit"] else "", h["column"],
            h["reason"], h.get("ask", "")))
    files["HELD-BACK.md"] = ("\n".join(lines) + "\n").encode("utf-8")

    bad = b.pii_check_files(files)
    if bad:
        raise b.BuildError("refusing: contact details in %s" % ", ".join(f for f, _, _ in bad))
    return files, projects, held_all


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workbook", required=True)
    ap.add_argument("--workbook-sha256", default=EXPECTED_WORKBOOK_SHA256)
    ap.add_argument("--out-dir", default=str(HERE / "new-projects"))
    args = ap.parse_args(argv)
    try:
        files, projects, held = build(args.workbook, args.workbook_sha256)
    except b.BuildError as e:
        print("build refused: %s" % e, file=sys.stderr)
        return 1
    b.write_files(files, args.out_dir)
    for p in projects:
        print("%-32s %s units=%d tenure=%s completion=%s factSheet=%s" % (
            p["inventoryName"], p["docId"], len(p["units"]), p["tenure"], p["completion"], p["factSheet"]))
    print("held back: %d | files: %d -> %s" % (len(held), len(files), args.out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
