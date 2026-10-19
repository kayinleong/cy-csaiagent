"""Gate for the client UAT pack: JSON, project facts, hygiene, workbook, plan doc.

Checks (each prints PASS or FAIL, then a total line "N PASS, M FAIL"):
  A  JSON integrity           B  project facts against the project export
  C  client-deliverable hygiene   D  workbook structure   E  plan document

The project export holds PIC names and phone numbers in its description field.
The loader reduces every record to five fields at once and never prints one.

Usage:
  python3 verify-uat-workbook.py [--cases P] [--workbook P] [--plan P] [--export P]
  python3 verify-uat-workbook.py --self-test    (proves the gate bites)
"""
import argparse
import copy
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

try:
    from openpyxl import load_workbook
    from openpyxl.utils import get_column_letter, range_boundaries
except ImportError:
    sys.exit("openpyxl is not importable. Stop and report; do not install anything.")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DEF_CASES = HERE / "uat-cases.json"
DEF_WORKBOOK = ROOT / "docs" / "UAT-Output-Test-Cases.xlsx"
DEF_PLAN = ROOT / "docs" / "UAT-Output-Test-Plan.md"
DEF_EXPORT = ROOT / "projects.export.json"

LANGS = ["EN", "BM", "中文"]
TYPES = ["Golden", "Rubric", "Adversarial"]
EXPORT_KEYS = ("name", "status", "priceValue", "foreignEligible", "bumiQuota")

SHEETS = ["Instructions", "Rubric", "Test Cases", "Run Log", "Sign-off"]
TC_HEADERS = ["ID", "Area", "Test Case", "Priority", "Preconditions", "Steps", "Expected Result", "Result",
              "Actual / Comments", "Known Status", "Lang", "Type", "Runs", "Run by", "Double-rate"]
TC_WIDTHS = [7, 16, 26, 9, 24, 40, 44, 12, 30, 34, 8, 13, 7, 15, 11]
RL_HEADERS = ["Case ID", "Run", "Tester", "Test account", "Device & browser", "App language", "Prompt language",
              "Date & time", "Assistant that answered", "Full answer text", "Screenshot file", "Version stamp",
              "H1 Correct", "H2 Grounded", "H3 D2-specific", "H4 Language", "H5 D2 voice", "H6 Safe",
              "H7 Job done", "U Usefulness", "Run verdict", "Severity", "What's wrong",
              "What correct looks like (+ SOP / doc)", "After a fix or KB change?", "2nd rater verdict",
              "Root cause", "Triage notes"]
RL_VALIDATIONS = [
    ("B", '"1,2,3"'), ("F", '"EN,BM,中文"'), ("G", '"EN,BM,中文"'),
    ("I", '"Coach,Finder,Reply,Error / none"'),
    ("M", '"PASS,FAIL,N/A"'), ("N", '"PASS,FAIL,N/A"'), ("O", '"PASS,FAIL,N/A"'), ("P", '"PASS,FAIL,N/A"'),
    ("Q", '"PASS,FAIL,N/A"'), ("R", '"PASS,FAIL,N/A"'), ("S", '"PASS,FAIL,N/A"'),
    ("T", '"Use as-is,Use after small edits,Not usable"'), ("U", '"Pass,Fail"'), ("V", '"S1,S2,S3,S4"'),
    ("Y", '"Yes,No"'), ("Z", '"Pass,Fail"'),
    ("AA", '"Model / prompt,KB gap,Test-case defect,UI bug,Environment"'),
]
RESULT_LIST = '"Pass,Fail,Blocked,Not Run"'
EXPLORATORY_PRECONDITIONS = "Use only made-up names and the placeholder numbers in the Instructions tab."
EXPLORATORY_KNOWN = "Write the answer you expect in Expected Result before you ask."

PLAN_HEADINGS = ["## 1. Purpose and scope", "## 2. What is being tested", "## 3. Roles",
                 "## 4. Before we start: readiness checklist", "## 5. Schedule",
                 "## 6. How to run a case on your phone", "## 7. How to judge an answer",
                 "## 8. How serious is it? (severity)", "## 9. What to record", "## 10. Exit criteria",
                 "## 11. Known issues", "## 12. Open questions for Derek", "## 13. Appendix: case counts"]
PROBES = [["RM"], ["phone"], ["notified"], ["Reply in"], ["journey"],
          ["previous conversation", "across conversations"], ["brochures"], ["English"], ["cut off"],
          ["Cold prospect"], ["<LEAD_ID"]]

ALLOW = {"012-000 0000", "0120000000", "+60 12-000 0000", "900101-14-0000", "900101140000", "siti@example.com"}
ALLOW_NAMES = {"Encik Ali", "Cik Tan", "Ms Tan", "Mr Lim", "Madam Wong", "Puan Wong", "Mr Tanaka", "Mr Lee",
               "Mr Chen"}
PHONE_RE = re.compile(r"(?<![\d,.])(?:\+?6?0[\s-]?)?1\d[\s-]?\d{3,4}[\s-]?\d{4}(?![\d,])")
IC_RE = re.compile(r"(?<!\d)\d{6}-?\d{2}-?\d{4}(?!\d)")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
LONG_RE = re.compile(r"(?<![\d,.])\d{9,}(?![\d,.])")
NAME_RE = re.compile(r"\b(?:Encik|Cik|Puan|Ms|Mr|Mrs|Madam) [A-Z][a-z]+")
SECRET_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----")
FORBIDDEN_RE = re.compile(r"\b(?:src|app|scripts|evals|tests)/[\w\[.-]|\.(?:tsx?|py|json|yaml)\b|RESEARCH-|"
                          r"quick-kayinleong|projects\.export|gitignore")
SIGNOFF_RE = re.compile(r"^=COUNTIF\(.+\)(\+COUNTIF\(.+\))*$")
ID_RE = re.compile(r"^[FRCX][1-9]\d*$")

FAILURES = []
PASSES = []


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg)
    (PASSES if ok else FAILURES).append(msg)
    return ok


def short(items, n=4):
    items = list(items)
    s = "; ".join(str(i) for i in items[:n])
    return s + (" (+{} more)".format(len(items) - n) if len(items) > n else "")


def ceil_pct(n, pct):
    return -(-n * pct // 100)


def iter_strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            for s in iter_strings(k):
                yield s
            for s in iter_strings(v):
                yield s
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            for s in iter_strings(v):
                yield s


def compose_expected(case):
    e = case["expected"]
    return "MUST: {}\nMUST NOT: {}\nALSO ACCEPTABLE: {}".format(e["must"], e["must_not"], e["also_acceptable"])


def hygiene_hits(text):
    hits = []
    for rx in (PHONE_RE, IC_RE, EMAIL_RE, LONG_RE):
        hits.extend(m.group(0) for m in rx.finditer(text))
    return [h for h in hits if h not in ALLOW]


def name_hits(text):
    return [m.group(0) for m in NAME_RE.finditer(text) if m.group(0) not in ALLOW_NAMES]


def load_export(path):
    """Reduce every record to the five allowed fields at once; never print a record."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    exported_at = raw.get("exportedAt")
    reduced = []
    for rec in raw.get("records", []):
        reduced.append({k: rec.get(k) for k in EXPORT_KEYS})
    del raw
    for rec in reduced:
        assert set(rec.keys()) == set(EXPORT_KEYS)
    return exported_at, reduced


def cell_text(v):
    return None if v is None else str(v)


# ------------------------------------------------------------------ A: JSON
def run_a(data):
    cases = data["cases"]
    n = len(cases)
    check(n == 77 and 60 <= n <= 80, "A1 scripted case count is 77 and within 60-80 (got {})".format(n))

    ids = [c["id"] for c in cases]
    dup = [i for i, k in Counter(ids).items() if k > 1]
    check(not dup, "A2 IDs are unique (duplicates: {})".format(short(dup) or "none"))
    bad_fmt = [c["id"] for c in cases if not ID_RE.match(c["id"])
               or c["id"][0] != c["section"]]
    check(not bad_fmt, "A2 IDs match the pattern and their section letter ({})".format(short(bad_fmt) or "ok"))
    seq_bad = []
    for letter in [s["letter"] for s in data["sections"]]:
        nums = []
        for c in cases:
            if c["section"] == letter and ID_RE.match(c["id"]):
                nums.append(int(c["id"][1:]))
        if nums != list(range(1, len(nums) + 1)):
            seq_bad.append(letter)
    check(not seq_bad, "A2 IDs are sequential from 1 within each section (broken: {})".format(
        short(seq_bad) or "none"))
    order_ok = [c["section"] for c in cases] == sorted(
        [c["section"] for c in cases], key=lambda x: [s["letter"] for s in data["sections"]].index(x))
    check(order_ok, "A2 cases are listed section by section in workbook order")

    blk_bad = []
    for s in data["sections"]:
        langs = [c["lang"] for c in cases if c["section"] == s["letter"]]
        collapsed = [langs[i] for i in range(len(langs)) if i == 0 or langs[i] != langs[i - 1]]
        if collapsed != LANGS:
            blk_bad.append(s["letter"])
    check(not blk_bad, "A3 each section has contiguous EN, BM, 中文 blocks in that order (broken: {})".format(
        short(blk_bad) or "none"))

    cnt = Counter(c["type"] for c in cases)
    shares = {t: cnt.get(t, 0) * 100.0 / n for t in TYPES}
    check(40 <= shares["Golden"] <= 50 and 15 <= shares["Rubric"] <= 25 and 25 <= shares["Adversarial"] <= 40,
          "A4 type shares within bands (Golden {:.0f}%, Rubric {:.0f}%, Adversarial {:.0f}%)".format(
              shares["Golden"], shares["Rubric"], shares["Adversarial"]))
    runs_bad = [c["id"] for c in cases if c["runs"] != (3 if c["type"] == "Adversarial" else 2)]
    check(not runs_bad, "A5 runs is 3 for Adversarial and 2 otherwise ({})".format(short(runs_bad) or "ok"))

    # A6: required fields, allowed sets
    a6 = []
    required = ["id", "section", "lang", "type", "priority", "area", "title", "preconditions", "steps", "expected",
                "known_status_keys", "runs", "run_by", "double_rate", "repoint_when_real_sops", "projects",
                "source"]
    for c in cases:
        cid = c.get("id", "?")
        for k in required:
            if k not in c:
                a6.append("{} missing {}".format(cid, k))
        for k in ["id", "section", "lang", "type", "priority", "area", "title", "preconditions", "steps", "run_by",
                  "source"]:
            if not (isinstance(c.get(k), str) and c.get(k).strip()):
                a6.append("{} empty {}".format(cid, k))
        exp = c.get("expected") or {}
        for k in ["must", "must_not", "also_acceptable"]:
            if not (isinstance(exp.get(k), str) and exp.get(k).strip()):
                a6.append("{} empty expected.{}".format(cid, k))
        if not c.get("known_status_keys"):
            a6.append("{} no known_status_keys".format(cid))
        if c.get("lang") not in LANGS:
            a6.append("{} bad lang".format(cid))
        if c.get("type") not in TYPES:
            a6.append("{} bad type".format(cid))
        if c.get("priority") not in ("P0", "P1", "P2"):
            a6.append("{} bad priority".format(cid))
        if not isinstance(c.get("double_rate"), bool):
            a6.append("{} double_rate not boolean".format(cid))
        want = None
        if c.get("lang") == "BM":
            want = "BM speaker"
        elif c.get("lang") == "中文":
            want = "中文 speaker"
        elif c.get("section") in ("F", "X"):
            want = "New agent"
        elif c.get("section") in ("R", "C"):
            want = "Senior coach"
        if c.get("run_by") != want:
            a6.append("{} run_by {!r} should be {!r}".format(cid, c.get("run_by"), want))
    check(not a6, "A6 every field present and non-empty with allowed values ({})".format(short(a6) or "ok"))

    a7 = [c["id"] for c in cases if not re.search(r'"[^"\n]{2,}"', c["steps"])]
    check(not a7, "A7 steps contain a double-quoted prompt ({})".format(short(a7) or "ok"))

    # A8
    ph = data["known_status_phrases"]
    a8 = []
    for c in cases:
        keys = c["known_status_keys"]
        steps = c["steps"]
        if re.search(r"RM\d", steps) and "KS-RM" not in keys:
            a8.append("{} needs KS-RM".format(c["id"]))
        if any(p in steps for p in ("012-000 0000", "0120000000", "900101140000")) and "KS-PHONE" not in keys:
            a8.append("{} needs KS-PHONE".format(c["id"]))
        if c["section"] == "R" and c["lang"] in ("BM", "中文") and "KS-BADGE" not in keys:
            a8.append("{} needs KS-BADGE".format(c["id"]))
        if c["section"] == "C" and c["type"] == "Golden" and not (
                "KS-PLACEHOLDER" in keys and c["repoint_when_real_sops"] is True):
            a8.append("{} needs KS-PLACEHOLDER and repoint".format(c["id"]))
        if c["area"] == "Coach / KB miss" and "KS-TOAST" not in keys:
            a8.append("{} needs KS-TOAST".format(c["id"]))
        for k in keys:
            if k not in ph:
                a8.append("{} unknown key {}".format(c["id"], k))
        if "KS-OK" in keys and len(keys) > 1:
            a8.append("{} KS-OK combined".format(c["id"]))
    check(not a8, "A8 known-status rules hold ({})".format(short(a8) or "ok"))

    dr = sum(1 for c in cases if c["double_rate"])
    check(12 <= dr <= 18, "A9 double-rated cases within 12-18 (got {})".format(dr))

    a10 = []
    if [r["code"] for r in data["rubric"]] != ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "U"]:
        a10.append("rubric codes")
    for r in data["rubric"]:
        for k in ("question", "pass", "fail"):
            if not str(r.get(k, "")).strip():
                a10.append("{} empty {}".format(r.get("code"), k))
    if [s["level"] for s in data["severity"]] != ["S1", "S2", "S3", "S4"]:
        a10.append("severity levels")
    if len(data["root_causes"]) != 5:
        a10.append("root causes count")
    if [e["id"] for e in data["exit_criteria"]] != ["EC{}".format(i) for i in range(1, 8)]:
        a10.append("exit criteria ids")
    check(not a10, "A10 rubric, severity, root causes and exit criteria are complete ({})".format(
        short(a10) or "ok"))


# ------------------------------------------------------------------ B: project facts
def run_b(data, export_path):
    try:
        exported_at, recs = load_export(export_path)
    except Exception as exc:  # message only, never content
        check(False, "B1 export loads ({})".format(type(exc).__name__))
        return
    check(exported_at == data["meta"]["snapshot_exported_at"] and len(recs) > 0,
          "B1 export loads ({} records reduced to 5 fields) and exportedAt matches the snapshot".format(len(recs)))
    by_name = {}
    for r in recs:
        by_name.setdefault(r["name"], []).append(r)

    declared = []
    for c in data["cases"]:
        for p in c["projects"]:
            declared.append((c["id"], p))
    b2 = [(cid, p["name"]) for cid, p in declared if len(by_name.get(p["name"], [])) != 1]
    check(not b2, "B2 every declared project name exists exactly once in the export ({})".format(
        short(["{}: {}".format(a, b) for a, b in b2]) or "{} declared".format(len(declared))))

    b3, b4, b5 = [], [], []
    for cid, p in declared:
        rows = by_name.get(p["name"], [])
        if len(rows) != 1:
            continue
        r = rows[0]
        e = p["expect"]
        pv = r["priceValue"] or 0
        if (e["status"] != r["status"] or abs(float(e["priceValue"]) - float(pv)) > 1
                or bool(e["foreignEligible"]) != bool(r["foreignEligible"])
                or bool(e["bumiQuota"]) != bool(r["bumiQuota"])):
            b3.append("{}: {}".format(cid, p["name"]))
        if p["clause"] == "must" and r["status"] != "active":
            b4.append("{}: {} is {} in the export".format(cid, p["name"], r["status"]))
        case = next(c for c in data["cases"] if c["id"] == cid)
        if p["name"] not in case["expected"].get(p["clause"], ""):
            b5.append("{}: {}".format(cid, p["name"]))
    check(not b3, "B3 every expect value equals the export ({})".format(short(b3) or "ok"))
    check(not b4, "B4 projects under MUST are active in the export ({})".format(short(b4) or "ok"))
    check(not b5, "B5 every declared name appears verbatim in its clause text ({})".format(short(b5) or "ok"))

    names = sorted((n for n in by_name if n), key=len, reverse=True)
    b6 = []
    for c in data["cases"]:
        decl = {(p["name"], p["clause"]) for p in c["projects"]}
        for clause in ("must", "must_not", "also_acceptable"):
            text = c["expected"].get(clause, "")
            masked = text
            for n in names:
                if n in masked:
                    if (n, clause) not in decl:
                        b6.append("{}: {} in {}".format(c["id"], n, clause))
                    masked = masked.replace(n, "\0" * len(n))
    check(not b6, "B6 every export project name found in a clause is declared for that clause ({})".format(
        short(b6) or "ok"))


# ------------------------------------------------------------------ workbook cells
def workbook_cells(wb):
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.value is not None:
                    yield ws.title, c


# ------------------------------------------------------------------ C: hygiene
def run_c(data, wb, plan_text):
    wb_strings = [(ws_name + "!" + c.coordinate, str(c.value)) for ws_name, c in workbook_cells(wb)]
    json_strings = [("json", s) for s in iter_strings(data)]
    plan_strings = [("plan", plan_text)]
    everything = json_strings + wb_strings + plan_strings

    c1 = []
    for where, s in everything:
        for h in hygiene_hits(s):
            c1.append("{} contains {!r}".format(where, h))
    check(not c1, "C1 every phone, IC, email and long-digit match is a placeholder ({})".format(
        short(c1) or "none outside the allowlist"))
    c2 = []
    for where, s in everything:
        for h in name_hits(s):
            c2.append("{} has {!r}".format(where, h))
    check(not c2, "C2 every honorific name is a synthetic name ({})".format(short(c2) or "ok"))

    c3 = []
    for where, s in wb_strings + plan_strings:
        m = FORBIDDEN_RE.search(s)
        if m:
            c3.append("{} has {!r}".format(where, m.group(0)))
    src_values = [c["source"] for c in data["cases"]]
    for where, s in wb_strings:
        for sv in src_values:
            if sv in s:
                c3.append("{} contains a source label".format(where))
                break
    check(not c3, "C3 no internal reference, path or source label in the plan doc or any workbook cell ({})".format(
        short(c3) or "ok"))

    c4 = []
    for where, s in everything:
        if SECRET_RE.search(s):
            c4.append(where)
    check(not c4, "C4 no secrets in any deliverable ({})".format(short(c4) or "ok"))


# ------------------------------------------------------------------ D: workbook structure
def dv_cells(ws):
    """Map each data-validation formula to the set of cells it covers."""
    out = {}
    for dv in ws.data_validations.dataValidation:
        cells = out.setdefault(dv.formula1, set())
        for rng in str(dv.sqref).split():
            c1, r1, c2, r2 = range_boundaries(rng)
            for rr in range(r1, r2 + 1):
                for cc in range(c1, c2 + 1):
                    cells.add((rr, cc))
    return out


def fill_of(cell):
    return cell.fill.fgColor.rgb[-6:] if cell.fill and cell.fill.fill_type == "solid" else None


def font_color(cell):
    col = cell.font.color
    return col.rgb[-6:] if col is not None and isinstance(col.rgb, str) else None


def analyse_test_cases(ws):
    """Derive blocks from the sheet itself (independent of the builder)."""
    rows = {}
    for r in range(2, ws.max_row + 1):
        a = ws.cell(row=r, column=1).value
        if isinstance(a, str) and re.match(r"^[FRCXE][1-9]\d*$", a):
            rows[a] = r
    return rows


def run_d(data, wb):
    cases = data["cases"]
    phrases = data["known_status_phrases"]

    check(wb.sheetnames == SHEETS, "D1 sheet names and order are {} (got {})".format(SHEETS, wb.sheetnames))
    if wb.sheetnames != SHEETS:
        return
    tc, rl, so, rb = wb["Test Cases"], wb["Run Log"], wb["Sign-off"], wb["Rubric"]

    heads = [tc.cell(row=1, column=c).value for c in range(1, 16)]
    check(heads == TC_HEADERS and tc.cell(row=1, column=16).value is None,
          "D2 Test Cases headers A-O are exact (got {})".format(heads))

    # row map
    id_rows = analyse_test_cases(tc)
    band_texts = [s["band"] for s in data["sections"]] + [data["exploratory_band"]]
    band_rows = {}
    for r in range(2, tc.max_row + 1):
        a = tc.cell(row=r, column=1).value
        if a in band_texts:
            band_rows[a] = r
    merged = {str(m) for m in tc.merged_cells.ranges}
    d3 = []
    for c in range(1, 16):
        h = tc.cell(row=1, column=c)
        if fill_of(h) != "1F2937" or font_color(h) != "FFFFFF" or not h.font.b:
            d3.append("header col {}".format(c))
    if len(band_rows) != 5:
        d3.append("expected 5 bands, found {}".format(len(band_rows)))
    for text, r in band_rows.items():
        if "A{r}:O{r}".format(r=r) not in merged:
            d3.append("band row {} not merged A:O".format(r))
        cell = tc.cell(row=r, column=1)
        if fill_of(cell) != "D9F99D" or not cell.font.b:
            d3.append("band row {} style".format(r))
    for ident, r in id_rows.items():
        for col in (8, 9):
            if fill_of(tc.cell(row=r, column=col)) != "FFF9C4":
                d3.append("{} col {} not yellow".format(ident, col))
        if font_color(tc.cell(row=r, column=10)) != "6B7280":
            d3.append("{} Known Status colour".format(ident))
        if ident[0] == "E":
            for col in (3, 6, 7, 11):
                if fill_of(tc.cell(row=r, column=col)) != "FFF9C4":
                    d3.append("{} col {} not yellow".format(ident, col))
    if tc.freeze_panes != "A2":
        d3.append("freeze panes {}".format(tc.freeze_panes))
    for i, w in enumerate(TC_WIDTHS, start=1):
        got = tc.column_dimensions[get_column_letter(i)].width
        if got is None or abs(got - w) > 0.01:
            d3.append("width {} is {}".format(get_column_letter(i), got))
    fonts = {c.font.name for _, c in workbook_cells(wb)}
    if fonts != {"Arial"}:
        d3.append("fonts {}".format(sorted(fonts)))
    check(not d3, "D3 header and band fills, merges, yellow cells, grey J, freeze, widths, Arial ({})".format(
        short(d3) or "ok"))

    # D4
    dvs = dv_cells(tc)
    covered = dvs.get(RESULT_LIST, set())
    want = {(r, 8) for r in id_rows.values()}
    d4 = []
    if covered != want:
        d4.append("covered {} cells, wanted {} (missing {}, extra {})".format(
            len(covered), len(want), len(want - covered), len(covered - want)))
    if any((r, 8) in covered for r in band_rows.values()):
        d4.append("a band row is covered")
    notrun = [i for i, r in id_rows.items() if tc.cell(row=r, column=8).value != "Not Run"]
    if notrun:
        d4.append("H not 'Not Run': {}".format(short(notrun)))
    if len(id_rows) != 77 + 50:
        d4.append("{} ID rows".format(len(id_rows)))
    check(not d4, "D4 Result validation is exactly {} on every case and E row, no band row, all Not Run ({})".format(
        RESULT_LIST, short(d4) or "ok"))

    # D5: order and values
    seq = []
    for s in data["sections"]:
        seq.append(s["band"])
        seq.extend(c["id"] for c in cases if c["section"] == s["letter"])
    seq.append(data["exploratory_band"])
    seq.extend("E{}".format(n) for n in range(1, 51))
    got_seq = [tc.cell(row=r, column=1).value for r in range(2, tc.max_row + 1)]
    d5 = []
    if got_seq != seq:
        d5.append("row order differs from JSON (first diff at index {})".format(
            next((i for i, (x, y) in enumerate(zip(got_seq, seq)) if x != y), min(len(got_seq), len(seq)))))
    for c in cases:
        r = id_rows.get(c["id"])
        if r is None:
            d5.append("{} missing".format(c["id"]))
            continue
        exp = [c["id"], c["area"], c["title"], c["priority"], c["preconditions"], c["steps"], compose_expected(c),
               "Not Run", None, "\n".join(phrases[k] for k in c["known_status_keys"]), c["lang"], c["type"],
               c["runs"], c["run_by"], "Yes" if c["double_rate"] else None]
        got = [tc.cell(row=r, column=k).value for k in range(1, 16)]
        for k, (g, e) in enumerate(zip(got, exp), start=1):
            if g != e:
                d5.append("{} {} differs".format(c["id"], get_column_letter(k)))
    check(not d5, "D5 every case row equals the JSON-composed values ({})".format(short(d5) or "77 rows ok"))

    # D6: exploratory rows
    d6 = []
    per = data["meta"]["exploratory_slots_per_tester"]
    for n in range(1, data["meta"]["testers"] * per + 1):
        r = id_rows.get("E{}".format(n))
        if r is None:
            d6.append("E{} missing".format(n))
            continue
        k = (n - 1) // per + 1
        exp = ["E{}".format(n), "Exploratory", "Your own question (Tester {})".format(k), None,
               EXPLORATORY_PRECONDITIONS, None, None, "Not Run", None, EXPLORATORY_KNOWN, None, "Exploratory", 1,
               "Tester {}".format(k), None]
        got = [tc.cell(row=r, column=j).value for j in range(1, 16)]
        if got != exp:
            d6.append("E{}".format(n))
    check(not d6, "D6 E1-E50 rows match the exploratory spec ({})".format(short(d6) or "50 rows ok"))

    # D7: Run Log
    d7 = []
    heads = [rl.cell(row=1, column=c).value for c in range(1, 29)]
    if heads != RL_HEADERS or rl.cell(row=1, column=29).value is not None:
        d7.append("headers")
    expect_rows = []
    for s in data["sections"]:
        for c in cases:
            if c["section"] == s["letter"]:
                for run in range(1, c["runs"] + 1):
                    expect_rows.append((c["id"], run))
    n_scripted = len(expect_rows)
    for n in range(1, 51):
        expect_rows.append(("E{}".format(n), 1))
    for _ in range(40):
        expect_rows.append((None, None))
    if n_scripted != 181:
        d7.append("{} scripted runs in JSON".format(n_scripted))
    if rl.max_row != len(expect_rows) + 1:
        d7.append("{} rows, wanted {}".format(rl.max_row - 1, len(expect_rows)))
    bad_rows = 0
    for i, (cid, run) in enumerate(expect_rows):
        r = i + 2
        if rl.cell(row=r, column=1).value != cid or rl.cell(row=r, column=2).value != run:
            bad_rows += 1
        for c in range(3, 29):
            cell = rl.cell(row=r, column=c)
            if cell.value is not None or fill_of(cell) != "FFF9C4":
                bad_rows += 1
                break
    if bad_rows:
        d7.append("{} Run Log rows wrong".format(bad_rows))
    if rl.freeze_panes != "C2":
        d7.append("freeze {}".format(rl.freeze_panes))
    rl_dvs = dv_cells(rl)
    last = len(expect_rows) + 1
    for col, formula in RL_VALIDATIONS:
        cidx = range_boundaries(col + "1")[0]
        want_cells = {(r, cidx) for r in range(2, last + 1)}
        if not want_cells <= rl_dvs.get(formula, set()):
            d7.append("validation {} {}".format(col, formula))
    check(not d7, "D7 Run Log: exact headers, 181 + 50 + 40 rows, dropdowns, freeze ({})".format(short(d7) or "ok"))

    # D8: Rubric sheet equals JSON
    d8 = []
    grid = {}
    for r in range(1, rb.max_row + 1):
        a = rb.cell(row=r, column=1).value
        if a is not None:
            grid.setdefault(a, []).append(r)
    if rb["A1"].value != "How to judge an answer":
        d8.append("title")
    rub_head = ["Code", "Dimension", "Ask yourself", "PASS looks like", "FAIL looks like", "Applies to"]
    if not any([rb.cell(row=r, column=c).value for c in range(1, 7)] == rub_head for r in grid.get("Code", [])):
        d8.append("rubric header row")
    sev_head = ["Level", "Name", "What it means", "D2 examples"]
    if not any([rb.cell(row=r, column=c).value for c in range(1, 5)] == sev_head for r in grid.get("Level", [])):
        d8.append("severity header row")
    rc_head = ["Root cause (set at triage)", "Meaning"]
    if not any([rb.cell(row=r, column=c).value for c in range(1, 3)] == rc_head
               for r in grid.get("Root cause (set at triage)", [])):
        d8.append("root cause header row")
    for item in data["rubric"]:
        want_row = [item["code"], item["name"], item["question"], item["pass"], item["fail"], item["applies_to"]]
        ok = any([rb.cell(row=r, column=c).value for c in range(1, 7)] == want_row for r in grid.get(item["code"], []))
        if not ok:
            d8.append("rubric {}".format(item["code"]))
    all_cells = {str(c.value) for t, c in workbook_cells(wb) if t == "Rubric"}
    for rule in data["pass_rules"]:
        if rule not in all_cells:
            d8.append("pass rule {}".format(rule[:12]))
    for item in data["severity"]:
        want_row = [item["level"], item["name"], item["meaning"], item["examples"]]
        if not any([rb.cell(row=r, column=c).value for c in range(1, 5)] == want_row
                   for r in grid.get(item["level"], [])):
            d8.append("severity {}".format(item["level"]))
    for item in data["root_causes"]:
        want_row = [item["tag"], item["meaning"]]
        if not any([rb.cell(row=r, column=c).value for c in range(1, 3)] == want_row
                   for r in grid.get(item["tag"], [])):
            d8.append("root cause {}".format(item["tag"]))
    check(not d8, "D8 Rubric sheet text equals the JSON ({})".format(short(d8) or "ok"))

    # D9: formulas
    d9 = []
    for ws in wb.worksheets:
        if ws.title == "Sign-off":
            continue
        for row in ws.iter_rows():
            for c in row:
                if c.data_type == "f" or (isinstance(c.value, str) and c.value.startswith("=")):
                    d9.append("{}!{}".format(ws.title, c.coordinate))
    formulas = {}
    for row in so.iter_rows():
        for c in row:
            if c.data_type == "f" or (isinstance(c.value, str) and c.value.startswith("=")):
                formulas[c.coordinate] = str(c.value)
                if not SIGNOFF_RE.match(str(c.value)):
                    d9.append("Sign-off!{} not COUNTIF-only".format(c.coordinate))

    def block(letter, lang=None):
        rs = [id_rows[c["id"]] for c in cases if c["section"] == letter and (lang is None or c["lang"] == lang)]
        return (min(rs), max(rs)) if rs else None

    def rng(b):
        return "'Test Cases'!$H${}:$H${}".format(b[0], b[1])

    def cif(b, crit):
        return 'COUNTIF({},"{}")'.format(rng(b), crit)

    letters = [s["letter"] for s in data["sections"]]
    pillar_of = {s["letter"]: s["pillar"] for s in data["sections"]}
    scripted = (id_rows[cases[0]["id"]], id_rows[cases[-1]["id"]])
    sign_rows = {}  # band text -> row
    for r in range(1, so.max_row + 1):
        a = so.cell(row=r, column=1).value
        if isinstance(a, str):
            sign_rows.setdefault(a, r)
    expected_formulas = []  # (coordinate, formula)

    def need(label):
        if label not in sign_rows:
            d9.append("Sign-off missing section {!r}".format(label))
            return None
        return sign_rows[label]

    r0 = need("Result summary (auto — from the Test Cases tab)")
    if r0:
        for off, crit in enumerate(["Pass", "Fail", "Blocked", "Not Run"], start=2):
            expected_formulas.append(("B{}".format(r0 + off), "=" + cif(scripted, crit)))
    r1 = need("By pillar (auto)")
    if r1:
        for i, letter in enumerate(letters):
            b = block(letter)
            expected_formulas.append(("C{}".format(r1 + 2 + i), "=" + cif(b, "Pass")))
            expected_formulas.append(("D{}".format(r1 + 2 + i), "=" + cif(b, "Fail")))
    r2 = need("By language (auto)")
    if r2:
        for i, lang in enumerate(LANGS):
            blocks = [block(letter, lang) for letter in letters]
            expected_formulas.append(("C{}".format(r2 + 2 + i), "=" + "+".join(cif(b, "Pass") for b in blocks)))
            expected_formulas.append(("D{}".format(r2 + 2 + i), "=" + "+".join(cif(b, "Fail") for b in blocks)))
    r3 = need("Pillar × language")
    if r3:
        i = 0
        for letter in letters:
            for lang in LANGS:
                expected_formulas.append(("D{}".format(r3 + 2 + i), "=" + cif(block(letter, lang), "Pass")))
                i += 1
    r4 = need("Defects logged (auto)")
    if r4:
        e_first, e_last = n_scripted + 2, n_scripted + 51
        expected_formulas.append(("B{}".format(r4 + 1), '=COUNTIF(\'Run Log\'!$V$2:$V${},"S1")'.format(last)))
        expected_formulas.append(("B{}".format(r4 + 2), '=COUNTIF(\'Run Log\'!$V$2:$V${},"S2")'.format(last)))
        expected_formulas.append(("B{}".format(r4 + 3),
                                  '=COUNTIF(\'Run Log\'!$U${}:$U${},"?*")'.format(e_first, e_last)))
    for coord, f in expected_formulas:
        if formulas.get(coord) != f:
            d9.append("Sign-off!{} is {!r}, wanted {!r}".format(coord, formulas.get(coord), f))
    if len(formulas) != len(expected_formulas):
        d9.append("{} formulas found, {} expected".format(len(formulas), len(expected_formulas)))
    check(not d9, "D9 no formula outside Sign-off; Sign-off is COUNTIF-only on the real block ranges ({} formulas) "
          "({})".format(len(formulas), short(d9) or "ok"))

    # D10: Sign-off structure and static numbers
    d10 = []
    so_dvs = dv_cells(so)
    verdict_row = sign_rows.get("Overall verdict (GO / NO-GO)")
    if not verdict_row or (verdict_row, 2) not in so_dvs.get('"GO,NO-GO"', set()):
        d10.append("GO/NO-GO validation")
    for label in ("Signed by", "Role", "Date", "Summary / blockers"):
        if label not in sign_rows or fill_of(so.cell(row=sign_rows[label], column=2)) != "FFF9C4":
            d10.append("yellow cell for {}".format(label))
    ec_title = "Exit criteria (Proposed — Derek to confirm)"
    re_ = sign_rows.get(ec_title)
    if not re_:
        d10.append("exit criteria title with Proposed — Derek to confirm")
    else:
        adversarial = sum(1 for c in cases if c["type"] == "Adversarial")
        for i, item in enumerate(data["exit_criteria"]):
            rr = re_ + 2 + i
            a = so.cell(row=rr, column=1).value
            if a != "{} — {}".format(item["id"], item["text"]):
                d10.append("{} text".format(item["id"]))
            if (rr, 2) not in so_dvs.get('"Pass,Fail,Partial,Not Tested"', set()):
                d10.append("{} validation".format(item["id"]))
            if item["id"] == "EC5":
                note = so.cell(row=rr, column=3).value or ""
                if "Needed: {} of {}".format(ceil_pct(adversarial, 90), adversarial) not in note:
                    d10.append("EC5 needed count")
    if r0 and so.cell(row=r0 + 1, column=2).value != len(cases):
        d10.append("Scripted cases count")
    if r1:
        for i, letter in enumerate(letters):
            n = sum(1 for c in cases if c["section"] == letter)
            row = [so.cell(row=r1 + 2 + i, column=k).value for k in (1, 2, 5)]
            if row != [pillar_of[letter], n, ceil_pct(n, 85)]:
                d10.append("pillar row {}".format(letter))
    if r2:
        for i, lang in enumerate(LANGS):
            n = sum(1 for c in cases if c["lang"] == lang)
            row = [so.cell(row=r2 + 2 + i, column=k).value for k in (1, 2, 5)]
            if row != [lang, n, ceil_pct(n, 80)]:
                d10.append("language row {}".format(lang))
    if r3:
        i = 0
        for letter in letters:
            for lang in LANGS:
                n = sum(1 for c in cases if c["section"] == letter and c["lang"] == lang)
                row = [so.cell(row=r3 + 2 + i, column=k).value for k in (1, 2, 3, 5)]
                if row != [pillar_of[letter], lang, n, "80% gate" if n >= 10 else "Report only"]:
                    d10.append("pillar x language row {} {}".format(letter, lang))
                i += 1
    check(not d10, "D10 Sign-off: GO/NO-GO, EC1-EC7, Proposed label, static Cases and Needed numbers ({})".format(
        short(d10) or "ok"))


# ------------------------------------------------------------------ E: plan doc
def run_e(data, plan_text):
    cases = data["cases"]
    pos = [plan_text.find(h) for h in PLAN_HEADINGS]
    check(all(p >= 0 for p in pos) and pos == sorted(pos),
          "E1 the 13 plan headings are present in order (positions {})".format(pos))

    # E2
    start = plan_text.find("## 13. Appendix: case counts")
    appendix = plan_text[start:] if start >= 0 else ""
    table = []
    for line in appendix.splitlines():
        if line.startswith("|"):
            cells = [x.strip() for x in line.strip().strip("|").split("|")]
            if not all(re.match(r"^:?-+:?$", x) for x in cells):
                table.append(cells)
    letters = [s["letter"] for s in data["sections"]]
    want = [["Section", "Language", "Golden", "Rubric", "Adversarial", "Total"]]
    for s in data["sections"]:
        for lang in LANGS:
            sub = [c for c in cases if c["section"] == s["letter"] and c["lang"] == lang]
            cnt = Counter(c["type"] for c in sub)
            want.append([s["pillar"], lang] + [str(cnt.get(t, 0)) for t in TYPES] + [str(len(sub))])
    cnt = Counter(c["type"] for c in cases)
    want.append(["All sections", "All"] + [str(cnt.get(t, 0)) for t in TYPES] + [str(len(cases))])
    e2 = []
    if table != want:
        bad = [i for i in range(max(len(table), len(want)))
               if i >= len(table) or i >= len(want) or table[i] != want[i]]
        e2.append("table rows differ at {}".format(bad[:6]))
    runs = sum(c["runs"] for c in cases)
    slots = data["meta"]["testers"] * data["meta"]["exploratory_slots_per_tester"]
    dr = sum(1 for c in cases if c["double_rate"])
    lines = [
        "Exploratory: {} slots ({} per tester × {} testers), not counted above.".format(
            slots, data["meta"]["exploratory_slots_per_tester"], data["meta"]["testers"]),
        "Planned scripted runs: {} (2 per Golden or Rubric case, 3 per Adversarial case).".format(runs),
        "Double-rated cases: {}.".format(dr),
    ]
    for ln in lines:
        if ln not in appendix:
            e2.append("summary line missing: {}".format(ln[:30]))
    check(not e2, "E2 appendix table and the three summary lines equal the JSON counts ({})".format(
        short(e2) or "13 table rows ok"))

    # E3
    s10 = plan_text[plan_text.find("## 10. Exit criteria"):plan_text.find("## 11. Known issues")]
    check("Proposed — Derek to confirm" in s10, "E3 'Proposed — Derek to confirm' appears in section 10")

    # E4
    s11 = plan_text[plan_text.find("## 11. Known issues"):plan_text.find("## 12.")].lower()
    miss = [" / ".join(p) for p in PROBES if not any(w.lower() in s11 for w in p)]
    check(not miss, "E4 section 11 mentions every known issue (missing: {})".format(short(miss) or "none"))

    # E5
    m = FORBIDDEN_RE.search(plan_text)
    check(m is None, "E5 plan doc is plain English, no paths or internal labels ({})".format(
        m.group(0) if m else "ok"))


# ------------------------------------------------------------------ main
def verify(cases_path, workbook_path, plan_path, export_path):
    del FAILURES[:]
    del PASSES[:]
    data = json.loads(Path(cases_path).read_text(encoding="utf-8"))
    plan_text = Path(plan_path).read_text(encoding="utf-8")
    run_a(data)
    run_b(data, export_path)
    wb = load_workbook(str(workbook_path))
    run_c(data, wb, plan_text)
    run_d(data, wb)
    run_e(data, plan_text)
    print("\n{} PASS, {} FAIL".format(len(PASSES), len(FAILURES)))
    return 1 if FAILURES else 0


def self_test(args):
    script = str(Path(__file__).resolve())
    ok_all = True
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        def stage(name):
            d = tmp / name
            d.mkdir()
            cj, wx, pl = d / "uat-cases.json", d / "wb.xlsx", d / "plan.md"
            shutil.copy(args.cases, cj)
            shutil.copy(args.workbook, wx)
            shutil.copy(args.plan, pl)
            return cj, wx, pl

        def run(cj, wx, pl):
            p = subprocess.run([sys.executable, script, "--cases", str(cj), "--workbook", str(wx), "--plan",
                                str(pl), "--export", str(args.export)], capture_output=True, text=True)
            return p.returncode, p.stdout + p.stderr

        cj, wx, pl = stage("control")
        rc, out = run(cj, wx, pl)
        print("{} control copy passes (exit {})".format("OK  " if rc == 0 else "FAIL", rc))
        ok_all &= rc == 0
        if rc != 0:
            print("\n".join(l for l in out.splitlines() if l.startswith("FAIL")))

        def edit_json(name, mutate):
            cj, wx, pl = stage(name)
            d = json.loads(cj.read_text(encoding="utf-8"))
            mutate(d)
            cj.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
            return cj, wx, pl

        def case(d, cid):
            return next(c for c in d["cases"] if c["id"] == cid)

        def m1(d):
            case(d, "R2")["id"] = "R1"

        def m2(d):
            c = case(d, "F5")
            c["expected"]["must"] += " Papyrus North Kiara"
            c["projects"].append({"name": "Papyrus North Kiara", "clause": "must",
                                  "expect": {"status": "hidden", "priceValue": 760000, "foreignEligible": False,
                                             "bumiQuota": False}})

        def m3(d):
            c = case(d, "X7")
            c["steps"] = c["steps"].replace("012-000 0000", "012-345 6789")

        def m4(d):
            case(d, "C3")["expected"]["must_not"] = ""

        defects = [
            ("duplicate ID", edit_json("d1", m1), "FAIL A2 IDs are unique"),
            ("hidden project under MUST", edit_json("d2", m2), "FAIL B4"),
            ("non-placeholder phone", edit_json("d3", m3), "FAIL C1"),
            ("empty MUST NOT", edit_json("d4", m4), "FAIL A6"),
        ]
        cj, wx, pl = stage("d5")
        wb = load_workbook(str(wx))
        wb["Test Cases"]["J1"] = "Status"
        wb.save(str(wx))
        defects.append(("changed header", (cj, wx, pl), "FAIL D2"))
        cj, wx, pl = stage("d6")
        text = pl.read_text(encoding="utf-8")
        needle = "| All sections | All | 35 | 15 | 27 | 77 |"
        if needle in text:
            pl.write_text(text.replace(needle, "| All sections | All | 35 | 15 | 27 | 78 |"), encoding="utf-8")
        else:
            print("FAIL appendix total row not found in the plan copy")
            ok_all = False
        defects.append(("changed appendix total", (cj, wx, pl), "FAIL E2"))

        for name, paths, expect in defects:
            rc, out = run(*paths)
            bites = rc != 0 and expect in out
            print("{} {}{}".format("BITES" if bites else "MISSED", name,
                                   "" if bites else " (exit {}, expected {!r})".format(rc, expect)))
            ok_all &= bites
    print("\nself-test {}".format("PASSED" if ok_all else "FAILED"))
    return 0 if ok_all else 1


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(DEF_CASES))
    ap.add_argument("--workbook", default=str(DEF_WORKBOOK))
    ap.add_argument("--plan", default=str(DEF_PLAN))
    ap.add_argument("--export", default=str(DEF_EXPORT))
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test(args)
    return verify(args.cases, args.workbook, args.plan, args.export)


if __name__ == "__main__":
    sys.exit(main())
