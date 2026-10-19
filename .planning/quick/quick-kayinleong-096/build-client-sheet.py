"""Stage 1 of quick-kayinleong-096: turn the client workbook into gated, reviewable files.

Run as:  python3 -I -B build-client-sheet.py --workbook PATH --export projects.export.json [--regen-mapping]

Outputs (all in the claim dir, or --out-dir):
  project-mapping.json            reviewed workbook name -> docId mapping (only with --regen-mapping)
  client-sheet.normalized.json    the stage 1 -> 2 contract, every invariant enforced
  HELD-BACK.md                    plain-language list of what was not loaded, and why
  factsheets/index.json + *.md    one PII-clean fact sheet per project with facts

The workbook is untrusted data. It is passed by path only, never copied into the repo, and
no cell value is ever printed: only counts, project names, column names and class names.
Every output is built in memory, run through the contact-detail gate, and only then written.
"""
import argparse
import hashlib
import json
import re
import site
import sys
from pathlib import Path

site.addsitedir("/Users/ka.yin.leong/Library/Python/3.9/lib/python/site-packages")
sys.path.insert(0, str(Path(__file__).resolve().parent))

import wbparse as w  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]

EXPECTED_WORKBOOK_SHA256 = "d432ea47c2677afa1dfa00b42db315c8ec15e3f02b9da8f33ce9589f4fe0a95f"
IMPORT_DATE = "2026-10-19"
MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
HEADERS_16 = [
    "Project", "Size", "Rooms", "Nett Price", "Gross Price", "Area", "Developer", "Land Title",
    "Maintenance Fee", "Tenure", "Total Units:", "Total Floors/Storeys:",
    "Expected Completion/Vacant Possession (VP)", "Top Reasons Why", "Furnishing", "Car Park Allocation",
]
VARIANTS = {
    "PDH: Royal Suites(RC)": "Pavilion Damansara Heights: Royal Suites(RC)",
    "Rafflesia @ Hill 4": "Rafflesia @ Hill 2, 3 & 4",
}
SHEET1_ALIASES = {
    "Southpoint Residences (IGB)": "Southpoint Residences (IGB )",
    "AETAS TAMAN DESA": "Aetas Taman Desa",
    "AETAS SEPUTEH": "Aetas Seputeh",
}
SKIPPED_NEW = ["Binastra Cochrane", "Lagenda Tunku (Villa Gemilang)", "Ashbourne"]
PARTIAL_INVENTORY = "Rafflesia @ Hill 2, 3 & 4"
DC_INVENTORY = "Damansara City Residency (DC Residensi)"
BROCHURE = REPO / ".planning/quick/quick-kayinleong-094/unit-types.json"
BROCHURE_SOURCE = "quick-kayinleong-094 brochure transcription"
ABSENT_REASON = "new project, not in the inventory"
UNSURE = "not confirmed (under review)"


class BuildError(Exception):
    pass


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def blank(v):
    return v is None or (isinstance(v, str) and not v.strip())


# ------------------------------------------------------------ workbook reading


def load_workbook_data(path, expected_sha):
    """Gate the file, then read both sheets. Returns {rows, sheet1, sha}."""
    p = Path(path)
    if p.suffix.lower() != ".xlsx":
        raise BuildError("refusing the workbook: the suffix is not .xlsx")
    if not p.is_file():
        raise BuildError("refusing the workbook: the file does not exist")
    if p.stat().st_size > MAX_WORKBOOK_BYTES:
        raise BuildError("refusing the workbook: larger than 5 MB")
    sha = sha256_hex(p.read_bytes())
    if sha != expected_sha:
        raise BuildError("refusing the workbook: sha256 %s differs from the pinned %s" % (sha, expected_sha))
    import openpyxl  # noqa: WPS433 (imported late so -I scripts bootstrap site first)

    wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
    if "Raw Data" not in wb.sheetnames or "Sheet1" not in wb.sheetnames:
        raise BuildError("refusing the workbook: the sheets Raw Data and Sheet1 are not both present")
    raw = []
    for i, r in enumerate(wb["Raw Data"].iter_rows(values_only=True), start=1):
        raw.append((i, tuple(r) + (None,) * max(0, 17 - len(r))))
    header = [w.collapse(c) for c in raw[0][1][:16]]
    if header != HEADERS_16:
        raise BuildError("refusing the workbook: the Raw Data header row differs from the 16 known headers")
    if raw[0][1][16] is not None:
        raise BuildError("refusing the workbook: the Raw Data header has an unexpected 17th column")
    sheet1 = []
    for r in wb["Sheet1"].iter_rows(values_only=True):
        sheet1.append(w.collapse(r[0]) if r else "")
    wb.close()
    return {"rows": raw[1:], "sheet1": sheet1, "sha": sha}


def group_rows(rows):
    """Group Raw Data rows by carrying the Project name down.

    Returns (groups, ignored). A later group with the same name and no values is ignored
    and reported; a duplicate name WITH values is refused.
    """
    groups = []
    ignored = []
    seen = set()
    cur = None  # current group, an ignored duplicate, or None
    for rn, cells in rows:
        if all(blank(c) for c in cells[:16]):
            continue
        name = w.collapse(cells[0])
        if name:
            has_values = any(not blank(cells[k]) for k in list(range(1, 6)) + list(range(7, 16)))
            if name in seen:
                if has_values:
                    raise BuildError("refusing: the project %s appears twice and the second entry has values" % name)
                cur = {"name": name, "row": rn, "ignored": True, "developer_present": not blank(cells[6])}
                ignored.append(cur)
                continue
            seen.add(name)
            cur = {"name": name, "row": rn, "ignored": False, "rows": [(rn, cells)]}
            groups.append(cur)
            continue
        if cur is None:
            raise BuildError("refusing: row %d has values before any project name" % rn)
        if cur["ignored"]:
            raise BuildError("refusing: a continuation row (%d) follows an ignored duplicate project" % rn)
        cur["rows"].append((rn, cells))
    for g in groups:
        for rn, cells in g["rows"][1:]:
            for k in list(range(5, 16)):
                if not blank(cells[k]):
                    raise BuildError("refusing: %s has a project-level value on a continuation row (row %d, column %s)"
                                     % (g["name"], rn, HEADERS_16[k]))
    return groups, ignored


def unit_rows_of(g):
    return [(rn, c) for rn, c in g["rows"] if any(not blank(c[k]) for k in (1, 2, 3, 4))]


def parse_sheet1(lines):
    """Sheet1 -> ordered list of (heading, project name). A heading is an exact match."""
    out = []
    heading = None
    for text in lines:
        if not text:
            continue
        if text in w.SHEET1_HEADINGS:
            heading = text
            continue
        if heading is None:
            raise BuildError("refusing: Sheet1 has a name before any known heading")
        out.append((heading, text))
    return out


def load_export(path):
    """Reduce every record to {projectId, name, status} immediately. description is never touched."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    exported_at = data.get("exportedAt")
    recs = [{"projectId": r["projectId"], "name": r["name"], "status": r.get("status")} for r in data["records"]]
    del data
    return recs, exported_at


# -------------------------------------------------------------------- mapping


def mode_for(inventory_name, n_units):
    if n_units == 0:
        return "none", ""
    if inventory_name == PARTIAL_INVENTORY:
        return "partial", w.PARTIAL_PREFIX
    return "merge", ""


def build_mapping(groups, sheet1_pairs, recs, exported_at, sha):
    by_name = dict((r["name"], r) for r in recs)
    resolved, skipped = w.resolve_names([g["name"] for g in groups], by_name, VARIANTS, SHEET1_ALIASES, SKIPPED_NEW)
    for s in skipped:
        if s not in SKIPPED_NEW:
            raise BuildError("unexpected skipped project: %s" % s)
    if sorted(skipped) != sorted(SKIPPED_NEW):
        raise BuildError("the skipped list differs from the reviewed one: got %s" % ", ".join(skipped))
    unit_count = dict((g["name"], len(unit_rows_of(g))) for g in groups)
    raw_inv = {}
    entries = []
    for sheet_name, inv_name, matched in resolved:
        mode, prefix = mode_for(inv_name, unit_count[sheet_name])
        entries.append({"sheet": "Raw Data", "sheetName": sheet_name, "docId": by_name[inv_name]["projectId"],
                        "inventoryName": inv_name, "matchedBy": matched, "unitMode": mode, "labelPrefix": prefix})
        raw_inv[sheet_name] = inv_name
    mode_by_doc = dict((e["docId"], (e["unitMode"], e["labelPrefix"])) for e in entries)
    seen_alias = set()
    unmatched = []
    for _, name in sheet1_pairs:
        if name in raw_inv or name in by_name:
            continue
        if name in SHEET1_ALIASES:
            if name in seen_alias:
                continue
            seen_alias.add(name)
            inv_name = SHEET1_ALIASES[name]
            if inv_name not in by_name:
                unmatched.append(name)
                continue
            doc = by_name[inv_name]["projectId"]
            mode, prefix = mode_by_doc.get(doc, ("none", ""))
            entries.append({"sheet": "Sheet1", "sheetName": name, "docId": doc, "inventoryName": inv_name,
                            "matchedBy": "sheet1-alias", "unitMode": mode, "labelPrefix": prefix})
        else:
            unmatched.append(name)
    if unmatched:
        raise BuildError("unmatched Sheet1 names (not in the reviewed tables): " + "; ".join(unmatched))
    return {
        "meta": {"schema": "project-mapping/1", "export_exported_at": exported_at, "workbook_sha256": sha},
        "entries": entries,
        "skippedNew": skipped,
    }


def check_mapping_file(mapping, generated, recs):
    """A mapping loaded from disk must cover every sheet name and agree with the export."""
    by_doc = dict((r["projectId"], r["name"]) for r in recs)
    have = dict(((e["sheet"], e["sheetName"]), e) for e in mapping["entries"])
    want = dict(((e["sheet"], e["sheetName"]), e) for e in generated["entries"])
    missing = sorted(k[1] for k in want if k not in have)
    if missing:
        raise BuildError("project-mapping.json does not cover: " + "; ".join(missing)
                         + " (re-run with --regen-mapping to regenerate and review it)")
    for k, e in have.items():
        if by_doc.get(e["docId"]) != e["inventoryName"]:
            raise BuildError("project-mapping.json entry for %s does not match the export" % k[1])
        if k in want and (want[k]["unitMode"], want[k]["labelPrefix"]) != (e["unitMode"], e["labelPrefix"]):
            raise BuildError("project-mapping.json unitMode for %s disagrees with the workbook" % k[1])


def dump_json(obj):
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


# ---------------------------------------------------------------- DC cross-check


def dc_cross_check(units_with_cells, brochure_path=BROCHURE):
    """Compare DC Residensi sheet units with the quick-094 brochure transcription."""
    data = json.loads(Path(brochure_path).read_text(encoding="utf-8"))
    by_code = dict((u["type"], u) for u in data["units"])
    out = []
    for unit, cells in units_with_cells:
        code = unit["label"][len("Type "):] if unit["label"].startswith("Type ") else unit["label"]
        b = by_code.get(code)
        if b is None:
            continue
        layout = w.rooms_layout_code(cells["rooms"])
        if layout is not None and layout != b["layout"]:
            out.append({"inventoryName": DC_INVENTORY, "unit": unit["label"], "column": "Rooms", "sheet": layout,
                        "reference": b["layout"], "referenceSource": BROCHURE_SOURCE, "action": "sheet value written"})
        num = cells.get("size_num")
        if num is not None and num != b["sqft"]:
            out.append({"inventoryName": DC_INVENTORY, "unit": unit["label"], "column": "Size",
                        "sheet": "%s sqft" % format(num, ","), "reference": "%s sqft" % format(b["sqft"], ","),
                        "referenceSource": BROCHURE_SOURCE,
                        "action": "held back" if "Size" in unit["held"] else "sheet value written"})
    return out


# -------------------------------------------------------------- project records

ASKS = {
    "Size": "Please confirm the built-up size in square feet.",
    "Rooms": "Please confirm the number of bedrooms.",
    "Nett": "Please confirm the nett price range.",
    "Gross": "Please confirm the gross price range.",
    "Tenure": "Please confirm whether the project is freehold or leasehold, and the expiry year if leasehold.",
    "Maintenance Fee": "Please send the maintenance fee as an amount per square foot.",
    "Total Units": "Please confirm the total number of units.",
    "Total Floors/Storeys": "Please confirm the number of floors.",
    "Top Reasons Why": "Please send the reasons as text.",
    "Developer": "Please confirm the developer name.",
}


def _held_text(raw, reason):
    """The cell text to show for a held value. Nothing is shown when the reason is a
    contact detail or instruction-like text, so the held record can never leak either."""
    if "contact details" in reason or "instruction-like" in reason:
        return None
    if raw is None:
        return None
    if isinstance(raw, float) and raw.is_integer():
        return str(int(raw))
    t = w.collapse(raw)
    return (t[:300] + "...") if len(t) > 300 else (t or None)


def build_project_fields(g, held):
    """Project-level facts for one Raw Data group. Appends to held (project-level entries)."""
    c = g["rows"][0][1]
    row = g["row"]

    def hold(column, raw, reason, category="value", ask=None):
        held.append({"sheetRow": row, "unit": None, "column": column, "sheetText": _held_text(raw, reason),
                     "reason": reason, "category": category, "ask": ask or ASKS.get(column, "Please re-send this value.")})

    facts = dict((k, None) for k, _, _ in w.FACT_COLUMNS)

    # developer: contact lines are dropped, only the count is reported
    if not blank(c[6]):
        dev_text, removed = w.scrub_developer(c[6])
        if removed:
            held.append({"sheetRow": row, "unit": None, "column": "Developer", "sheetText": None,
                         "reason": "%d line(s) with contact details removed" % removed, "category": "developer",
                         "ask": "Nothing needed. The contact details were removed for privacy."})
        if dev_text:
            val, reason = w.gate_fact("developer", dev_text)
            if reason:
                hold("Developer", dev_text, reason, "developer")
            else:
                facts["developer"] = val

    # simple text facts
    for key in ("area", "landTitle", "maintenanceFee", "topReasons", "furnishing", "carPark"):
        col = [x for x in w.FACT_COLUMNS if x[0] == key][0]
        val, reason = w.gate_fact(key, c[col[2]])
        if reason:
            hold(col[1], c[col[2]], reason)
        else:
            facts[key] = val

    # tenure, total units and floors share the column-shift logic
    tenure = None
    tv, treason, shift = w.normalise_tenure(c[9])
    if shift:
        hold("Tenure", c[9], treason,
             ask="Please check the Tenure, Total Units and Floors cells for this project; they look shifted.")
        for key, col_i, header in (("totalUnits", 10, "Total Units"), ("floors", 11, "Total Floors/Storeys")):
            if not blank(c[col_i]):
                hold(header, c[col_i], "the columns look shifted for this row",
                     ask="Please check the Tenure, Total Units and Floors cells for this project; they look shifted.")
    else:
        if treason:
            hold("Tenure", c[9], treason)
        elif tv is not None:
            ft, fr = w.gate_fact("tenure", c[9])
            if fr:
                hold("Tenure", c[9], fr)
            else:
                tenure = tv
                facts["tenure"] = ft
        for key, col_i, header in (("totalUnits", 10, "Total Units"), ("floors", 11, "Total Floors/Storeys")):
            val, reason = w.gate_fact(key, c[col_i])
            if reason:
                hold(header, c[col_i], reason)
            else:
                facts[key] = val

    # completion
    completion = None
    ctext, creason = w.gate_fact("completion", c[12])
    if creason:
        hold(w.FACT_HEADER["completion"], c[12], creason)
    elif ctext is not None:
        facts["completion"] = ctext
        kind, year = w.classify_completion(ctext)
        if kind is not None:
            completion = {"kind": kind, "year": year}
        if kind == "ambiguous":
            held.append({"sheetRow": row, "unit": None, "column": w.FACT_HEADER["completion"], "sheetText": ctext,
                         "reason": "the completion date is ambiguous; not written to the record",
                         "category": "completion",
                         "ask": "Please confirm a single completion or handover date."})
    return facts, tenure, completion


def build_units(g, held):
    """Units for one group. Returns a list of (unit, cells)."""
    out = []
    for rn, c in unit_rows_of(g):
        unit, held_info, cells = w.build_unit(rn, c[1], c[2], c[3], c[4])
        for h in held_info:
            reason = h["reason"]
            held.append({"sheetRow": rn, "unit": unit["label"] if unit else None, "column": h["column"],
                         "sheetText": h["sheetText"], "reason": reason,
                         "category": "tbc" if "TBC" in reason else "value",
                         "ask": ("Please send the price once it is set." if "TBC" in reason
                                 else ASKS.get(h["column"], "Please re-send this value."))})
        if unit is not None:
            out.append((unit, cells))
    return out


# ---------------------------------------------------------------- fact sheets


def slugify(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:60].strip("-") or "project"


def fs_cell(unit, cells, col):
    if col == "size":
        return UNSURE if "Size" in unit["held"] else w.clean_fact(cells["size"], table_cell=True)
    if col == "rooms":
        return w.clean_fact(cells["rooms"], table_cell=True)
    key = "Nett" if col == "nett" else "Gross"
    text = cells[col]
    if key in unit["held"] and text.strip().lower() != "tbc":
        return UNSURE
    return w.clean_fact(text, table_cell=True)


def render_factsheet(p, unit_cells):
    name = w.clean_fact(p["inventoryName"])
    f = p["facts"]
    out = ["# %s: D2 project facts" % name, "", "Source: %s." % w.SOURCE_LABEL]
    if p["sheetName"] != p["inventoryName"]:
        out.append("Listed in the sheet as: %s." % w.clean_fact(p["sheetName"]))
    sections = []
    lines = []
    for label, key in (("Area", "area"), ("Developer", "developer"), ("Land title", "landTitle"),
                       ("Tenure", "tenure"), ("Maintenance fee", "maintenanceFee"), ("Total units", "totalUnits"),
                       ("Total floors / storeys", "floors"),
                       ("Expected completion / vacant possession", "completion"),
                       ("Furnishing", "furnishing"), ("Car park allocation", "carPark")):
        if f.get(key) is not None:
            lines.append("- %s: %s" % (label, f[key]))
    if lines:
        sections.append(["## %s: project facts" % name] + lines)
    if f.get("topReasons"):
        sections.append(["## %s: top reasons why" % name] + f["topReasons"].split("\n"))
    if p["focusLists"]:
        sections.append(["## %s: D2 focus lists (2026)" % name] + ["- " + w.clean_heading(h) for h in p["focusLists"]])
    if unit_cells:
        parts = [unit_cells[i:i + 8] for i in range(0, len(unit_cells), 8)]
        for k, part in enumerate(parts, start=1):
            base = "Hill 4 unit types" if p["unitMode"] == "partial" else "unit types"
            suffix = "" if (p["unitMode"] == "partial" and len(parts) == 1) else " (part %d of %d)" % (k, len(parts))
            sec = ["## %s: %s%s" % (name, base, suffix),
                   "| Type | Size | Rooms | Nett price | Gross price | Sold out |",
                   "|---|---|---|---|---|---|"]
            for unit, cells in part:
                sec.append("| %s | %s | %s | %s | %s | %s |" % (
                    w.clean_fact(unit["label"], table_cell=True), fs_cell(unit, cells, "size"),
                    fs_cell(unit, cells, "rooms"), fs_cell(unit, cells, "nett"), fs_cell(unit, cells, "gross"),
                    "Yes" if unit["soldOut"] else ""))
            sections.append(sec)
    if not sections:
        return None
    text = "\n".join(out) + "\n\n" + "\n\n".join("\n".join(s) for s in sections) + "\n"
    return text


# ------------------------------------------------------------------ HELD-BACK


def _q(text):
    return '"%s"' % text if text else "(not shown)"


def render_held_back(ctx):
    L = []
    L.append("# Held-back values and open questions")
    L.append("")
    L.append("Source: %s." % w.SOURCE_LABEL)
    L.append("")
    L.append("This list is for the client and for the team. Nothing on it was loaded into our project records "
             "unless the entry says so. Where we could not trust a value we kept it out and listed it here, "
             "with what we need to load it.")
    L.append("")
    L.append("## Values we did not load")
    L.append("")
    values = [h for h in ctx["held"] if h["category"] != "completion"]
    if not values:
        L.append("None.")
        L.append("")
    cur = None
    for h in values:
        if h["inventoryName"] != cur:
            if cur is not None:
                L.append("")
            cur = h["inventoryName"]
            L.append("### %s" % cur)
            L.append("")
        what = ("%s, %s" % (h["unit"], h["column"])) if h["unit"] else h["column"]
        if h["column"] == "Developer" and h["sheetText"] is None and "removed" in h["reason"]:
            L.append("- %s: %s. %s" % (what, h["reason"], h["ask"]))
        elif h["sheetText"] is None:
            L.append("- %s: not loaded. Why: %s. What we need: %s" % (what, h["reason"], h["ask"]))
        else:
            L.append("- %s: the sheet says %s. Why we did not load it: %s. What we need: %s"
                     % (what, _q(h["sheetText"]), h["reason"], h["ask"]))
    if values:
        L.append("")
    L.append("## Differences from the DC Residensi brochure")
    L.append("")
    L.append("The client sheet and the DC Residensi brochure disagree on the types below. Where the difference is "
             "in the room layout, the sheet value is used and the brochure value is shown for comparison. Where "
             "the difference is in the size, we held the size back until the client confirms it.")
    L.append("")
    if ctx["conflicts"]:
        L.append("| Type | Item | The sheet says | The brochure says | What we did |")
        L.append("|---|---|---|---|---|")
        for cf in ctx["conflicts"]:
            L.append("| %s | %s | %s | %s | %s |" % (cf["unit"], "Rooms" if cf["column"] == "Rooms" else "Built-up size",
                                                    cf["sheet"], cf["reference"], cf["action"]))
    else:
        L.append("No differences found.")
    L.append("")
    L.append("## Completion dates not written to the record")
    L.append("")
    L.append("These dates could not be read as one clear date, so they were not written to the project record.")
    L.append("")
    comp = [h for h in ctx["held"] if h["category"] == "completion"]
    if not comp:
        L.append("None.")
    for h in comp:
        L.append("- %s: the sheet says %s. %s" % (h["inventoryName"], _q(h["sheetText"]), h["ask"]))
    L.append("")
    L.append("%d project(s) give an expected future date. Those dates are kept in the fact sheet only and are not "
             "written to the project record." % ctx["future_count"])
    L.append("")
    L.append("## New projects skipped")
    L.append("")
    L.append("These projects are in the sheet but not in our inventory. They were left out; adding a new project "
             "is a separate step.")
    L.append("")
    for s in ctx["skipped"]:
        extra = (" (%d unit types listed)" % s["unitRows"]) if s["unitRows"] else ""
        L.append("- %s%s" % (s["sheetName"], extra))
    L.append("")
    L.append("## Duplicate row")
    L.append("")
    if ctx["ignored"]:
        for ig in ctx["ignored"]:
            L.append("- %s appears a second time (row %d), with only a different Developer entry. The second entry was ignored; please confirm which developer is correct."
                     % (ig["name"], ig["row"]))
    else:
        L.append("None.")
    L.append("")
    L.append("## Projects with no facts")
    L.append("")
    if ctx["no_facts"]:
        for n in ctx["no_facts"]:
            L.append("- %s: the sheet gives no usable facts, so no fact sheet was made." % n)
    else:
        L.append("None.")
    L.append("")
    L.append("## Sold-out units")
    L.append("")
    L.append("%d unit(s) are marked sold out across %d project(s). They stay in the record, marked sold out, and "
             "never count towards the price or size range." % (ctx["sold_out_units"], ctx["sold_out_projects"]))
    L.append("")
    if ctx["all_sold_out"]:
        L.append("These projects have every unit sold out. Their status was not changed; please decide what to do:")
        for n in ctx["all_sold_out"]:
            L.append("- %s" % n)
    else:
        L.append("No project has every unit sold out. If one did, its status would stay as it is for you to decide.")
    L.append("")
    return "\n".join(L)


# --------------------------------------------------------------------- build


def build_all(workbook, export, import_date=IMPORT_DATE, regen_mapping=False,
              expected_sha=EXPECTED_WORKBOOK_SHA256, mapping_path=None):
    """Build every output in memory. Returns (files, stats) where files maps a path
    relative to the output dir to bytes."""
    mapping_path = Path(mapping_path) if mapping_path else HERE / "project-mapping.json"
    data = load_workbook_data(workbook, expected_sha)
    groups, ignored = group_rows(data["rows"])
    sheet1_pairs = parse_sheet1(data["sheet1"])
    recs, exported_at = load_export(export)
    by_name = dict((r["name"], r) for r in recs)

    generated = build_mapping(groups, sheet1_pairs, recs, exported_at, data["sha"])
    files = {}
    if regen_mapping or not mapping_path.exists():
        mapping = generated
        mapping_bytes = dump_json(mapping)
        files["project-mapping.json"] = mapping_bytes
    else:
        mapping_bytes = mapping_path.read_bytes()
        mapping = json.loads(mapping_bytes.decode("utf-8"))
        check_mapping_file(mapping, generated, recs)
    mapping_sha = sha256_hex(mapping_bytes)

    entry_by_raw = dict((e["sheetName"], e) for e in mapping["entries"] if e["sheet"] == "Raw Data")
    group_by_name = dict((g["name"], g) for g in groups)

    # Sheet1 focus lists by docId, in Sheet1 order, deduplicated
    alias_entry = dict((e["sheetName"], e) for e in mapping["entries"] if e["sheet"] == "Sheet1")
    focus = {}
    for heading, name in sheet1_pairs:
        if name in entry_by_raw:
            doc = entry_by_raw[name]["docId"]
        elif name in by_name:
            doc = by_name[name]["projectId"]
        else:
            doc = alias_entry[name]["docId"]
        lst = focus.setdefault(doc, [])
        if heading not in lst:
            lst.append(heading)

    # Developer text shared with another project (Exsim-style copy errors)
    dev_owner = {}
    for g in groups:
        c = g["rows"][0][1]
        if not blank(c[6]):
            dev_owner.setdefault(w.collapse(c[6]), []).append(g["name"])

    projects = []
    held_all = []
    skipped = []
    unit_cells_by_doc = {}
    no_facts = []
    future_count = 0
    sold_out_units = 0
    sold_out_projects = 0
    all_sold_out = []
    conflicts = []

    for g in groups:
        if g["name"] in SKIPPED_NEW:
            skipped.append({"sheetName": g["name"], "sheetRow": g["row"], "unitRows": len(unit_rows_of(g)),
                            "reason": ABSENT_REASON})
            continue
        e = entry_by_raw[g["name"]]
        inv = e["inventoryName"]
        held = []
        facts, tenure, completion = build_project_fields(g, held)
        units_cells = build_units(g, held) if e["unitMode"] != "none" else []
        units = [u for u, _ in units_cells]
        # a project whose only content is a Developer cell copied from another project
        c0 = g["rows"][0][1]
        only_dev = (all(blank(c0[k]) for k in list(range(1, 6)) + list(range(7, 16)))
                    and not unit_rows_of(g) and e["docId"] not in focus)
        if only_dev and not blank(c0[6]):
            others = [n for n in dev_owner.get(w.collapse(c0[6]), []) if n != g["name"]]
            if others and facts["developer"] is not None:
                facts["developer"] = None
                held.append({"sheetRow": g["row"], "unit": None, "column": "Developer", "sheetText": None,
                             "reason": "the Developer cell is identical to the one for %s and the project has "
                                       "nothing else in the sheet, so it was probably copied by mistake" % others[0],
                             "category": "developer",
                             "ask": "Please confirm the developer for this project."})
        for h in held:
            h["inventoryName"] = inv
            h["docId"] = e["docId"]
        held_all.extend(held)
        if units_cells and e["inventoryName"] == DC_INVENTORY:
            conflicts.extend(dc_cross_check(units_cells))
        if completion and completion["kind"] == "future_or_expected":
            future_count += 1
        so = [u for u in units if u["soldOut"]]
        sold_out_units += len(so)
        if so:
            sold_out_projects += 1
            if len(so) == len(units):
                all_sold_out.append(inv)
        p = {
            "docId": e["docId"], "inventoryName": inv, "sheetName": g["name"], "sheetRow": g["row"],
            "unitMode": e["unitMode"], "labelPrefix": e["labelPrefix"], "units": units,
            "tenure": tenure, "completion": completion, "area": facts["area"],
            "facts": dict((k, facts[k]) for k, _, _ in w.FACT_COLUMNS),
            "focusLists": focus.get(e["docId"], []),
        }
        projects.append(p)
        unit_cells_by_doc[e["docId"]] = units_cells

    # Sheet1-only projects (no Raw Data group), last, sorted by inventory name
    raw_docs = set(p["docId"] for p in projects)
    extra = {}
    for e in mapping["entries"]:
        if e["sheet"] == "Sheet1" and e["docId"] not in raw_docs and e["docId"] not in extra:
            extra[e["docId"]] = e
    for e in sorted(extra.values(), key=lambda x: x["inventoryName"]):
        p = {
            "docId": e["docId"], "inventoryName": e["inventoryName"], "sheetName": e["sheetName"], "sheetRow": None,
            "unitMode": "none", "labelPrefix": "", "units": [], "tenure": None, "completion": None, "area": None,
            "facts": dict((k, None) for k, _, _ in w.FACT_COLUMNS),
            "focusLists": focus.get(e["docId"], []),
        }
        projects.append(p)
        unit_cells_by_doc[e["docId"]] = []

    # fact sheets
    sheets_index = []
    for p in projects:
        text = render_factsheet(p, unit_cells_by_doc[p["docId"]])
        if text is None:
            p["factSheet"] = None
            no_facts.append(p["inventoryName"])
            continue
        rel = "factsheets/%s-%s.md" % (slugify(p["inventoryName"]), p["docId"][:6])
        p["factSheet"] = rel
        b = text.encode("utf-8")
        files[rel] = b
        sheets_index.append({"file": rel, "docId": p["docId"], "inventoryName": p["inventoryName"],
                             "title": "%s — D2 project facts (client sheet)" % w.clean_fact(p["inventoryName"]),
                             "category": w.clean_fact(p["inventoryName"]), "sha256": sha256_hex(b)})
    files["factsheets/index.json"] = dump_json({
        "meta": {"schema": "factsheets/1", "source_label": w.SOURCE_LABEL, "workbook_sha256": data["sha"]},
        "sheets": sheets_index,
    })

    # held-back for the JSON: stable order, internal keys removed
    order = dict((p["docId"], i) for i, p in enumerate(projects))
    held_all.sort(key=lambda h: (order[h["docId"]], h["sheetRow"] if h["unit"] else 0))  # stable
    held_json = [{"docId": h["docId"], "inventoryName": h["inventoryName"], "sheetRow": h["sheetRow"],
                  "unit": h["unit"], "column": h["column"], "sheetText": h["sheetText"], "reason": h["reason"]}
                 for h in held_all]

    doc = {
        "meta": {"schema": "client-sheet/1", "source_label": w.SOURCE_LABEL, "import_date": import_date,
                 "workbook_sha256": data["sha"], "mapping_sha256": mapping_sha},
        "projects": projects,
        "skipped": skipped,
        "heldBack": held_json,
        "conflicts": conflicts,
    }
    errs = w.check_invariants(doc)
    if errs:
        raise BuildError("invariant violations:\n  " + "\n  ".join(errs))
    files["client-sheet.normalized.json"] = dump_json(doc)

    ctx = {"held": [dict(h) for h in held_all], "conflicts": conflicts, "future_count": future_count,
           "skipped": skipped, "ignored": ignored, "no_facts": no_facts, "sold_out_units": sold_out_units,
           "sold_out_projects": sold_out_projects, "all_sold_out": all_sold_out}
    files["HELD-BACK.md"] = render_held_back(ctx).encode("utf-8")

    stats = {
        "raw_projects": len(groups), "mapped": len([g for g in groups if g["name"] not in SKIPPED_NEW]),
        "skipped_new": [s["sheetName"] for s in skipped], "ignored": [i["name"] for i in ignored],
        "projects_in_json": len(projects), "unit_rows": sum(len(p["units"]) for p in projects),
        "unit_projects": len([p for p in projects if p["units"]]), "sold_out_units": sold_out_units,
        "held_by_column": {}, "fact_sheets": len(sheets_index), "no_facts": no_facts,
        "conflicts": len(conflicts), "mapping_sha256": mapping_sha, "matched_by": {},
    }
    for h in held_json:
        stats["held_by_column"][h["column"]] = stats["held_by_column"].get(h["column"], 0) + 1
    for e in mapping["entries"]:
        stats["matched_by"][e["matchedBy"]] = stats["matched_by"].get(e["matchedBy"], 0) + 1
    return files, stats


def pii_check_files(files):
    """Run the contact scanner over every output. Returns a list of (file, line numbers, classes)."""
    bad = []
    for rel in sorted(files):
        text = files[rel].decode("utf-8")
        if rel.endswith(".json"):
            obj = json.loads(text)
            if isinstance(obj, dict) and "meta" in obj and rel in ("client-sheet.normalized.json",):
                obj = dict((k, v) for k, v in obj.items() if k != "meta")
            classes = w.scan_json_strings(obj)
            if classes:
                bad.append((rel, [], classes))
        else:
            lines = []
            classes = set()
            for i, line in enumerate(text.split("\n"), start=1):
                hits = w.scan_contact_details(line)
                if hits:
                    lines.append(i)
                    classes.update(hits)
            if classes:
                bad.append((rel, lines, sorted(classes)))
    return bad


def write_files(files, out_dir):
    out_dir = Path(out_dir)
    (out_dir / "factsheets").mkdir(parents=True, exist_ok=True)
    for rel, b in files.items():
        (out_dir / rel).write_bytes(b)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--workbook", required=True)
    ap.add_argument("--export", default="projects.export.json")
    ap.add_argument("--import-date", default=IMPORT_DATE)
    ap.add_argument("--regen-mapping", action="store_true")
    ap.add_argument("--workbook-sha256", default=EXPECTED_WORKBOOK_SHA256)
    ap.add_argument("--out-dir", default=str(HERE))
    args = ap.parse_args(argv)
    out_dir = Path(args.out_dir)
    try:
        files, stats = build_all(args.workbook, args.export, args.import_date, args.regen_mapping,
                                 args.workbook_sha256, mapping_path=out_dir / "project-mapping.json")
    except (BuildError, w.MappingError) as e:
        print("BUILD FAILED: %s" % e, file=sys.stderr)
        return 1
    bad = pii_check_files(files)
    if bad:
        for rel, lines, classes in bad:
            print("PII GATE FAILED: %s lines=%s classes=%s" % (rel, lines, ",".join(classes)), file=sys.stderr)
        print("nothing was written", file=sys.stderr)
        return 1
    write_files(files, out_dir)
    print("raw projects: %d | mapped: %d | skipped (new): %d %s | ignored duplicates: %d %s"
          % (stats["raw_projects"], stats["mapped"], len(stats["skipped_new"]), stats["skipped_new"],
             len(stats["ignored"]), stats["ignored"]))
    print("mapping entries by matchedBy: %s" % json.dumps(stats["matched_by"], sort_keys=True))
    print("projects in JSON: %d | unit rows: %d across %d projects | sold out: %d"
          % (stats["projects_in_json"], stats["unit_rows"], stats["unit_projects"], stats["sold_out_units"]))
    print("held-back items by column: %s" % json.dumps(stats["held_by_column"], sort_keys=True))
    print("DC conflicts: %d | fact sheets: %d | projects with no facts: %s"
          % (stats["conflicts"], stats["fact_sheets"], stats["no_facts"]))
    print("wrote %d files to %s" % (len(files), out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
