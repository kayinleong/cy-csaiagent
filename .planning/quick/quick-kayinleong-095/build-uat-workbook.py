"""Build the client UAT workbook from uat-cases.json.

Every case cell is derived from the JSON. The internal `source` field is never
written. Exploratory rows (E1-E50) and Run Log rows are generated from `meta`
and `cases`. Sign-off holds the only formulas in the workbook, and they are
COUNTIF terms over row ranges computed from where each block actually lands on
the Test Cases sheet. Layout mirrors docs/Phase-1-Test-Cases.xlsx.

Usage: python3 build-uat-workbook.py [--cases PATH] [--out PATH]
"""
import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # .planning/quick/quick-kayinleong-095 -> repo root
DEFAULT_CASES = HERE / "uat-cases.json"
DEFAULT_OUT = ROOT / "docs" / "UAT-Output-Test-Cases.xlsx"

FONT = "Arial"
INK = "1F2937"
INK_STRONG = "111827"
INK_BODY = "374151"
INK_SUBTLE = "4B5563"
GREY = "6B7280"
BAND_FILL = PatternFill("solid", fgColor="D9F99D")
HEAD_FILL = PatternFill("solid", fgColor="1F2937")
YELLOW = PatternFill("solid", fgColor="FFF9C4")
THIN = Side(style="thin", color="D1D5DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
PRIORITY_COLOR = {"P0": "B91C1C", "P1": "92400E", "P2": INK_BODY}

LANGS = ["EN", "BM", "中文"]
TYPES = ["Golden", "Rubric", "Adversarial"]

TC_HEADERS = ["ID", "Area", "Test Case", "Priority", "Preconditions", "Steps", "Expected Result", "Result",
              "Actual / Comments", "Known Status", "Lang", "Type", "Runs", "Run by", "Double-rate"]
TC_WIDTHS = [7, 16, 26, 9, 24, 40, 44, 12, 30, 34, 8, 13, 7, 15, 11]
RESULT_LIST = '"Pass,Fail,Blocked,Not Run"'

RL_HEADERS = ["Case ID", "Run", "Tester", "Test account", "Device & browser", "App language", "Prompt language",
              "Date & time", "Assistant that answered", "Full answer text", "Screenshot file", "Version stamp",
              "H1 Correct", "H2 Grounded", "H3 D2-specific", "H4 Language", "H5 D2 voice", "H6 Safe",
              "H7 Job done", "U Usefulness", "Run verdict", "Severity", "What's wrong",
              "What correct looks like (+ SOP / doc)", "After a fix or KB change?", "2nd rater verdict",
              "Root cause", "Triage notes"]
RL_WIDTHS = [8, 6, 12, 16, 18, 10, 10, 16, 14, 60, 18, 12, 11, 11, 11, 11, 11, 11, 11, 18, 10, 9, 30, 36, 12, 13,
             16, 30]
RL_SPARE_ROWS = 40
RL_VALIDATIONS = [  # (column letter, list formula)
    ("B", '"1,2,3"'),
    ("F", '"EN,BM,中文"'),
    ("G", '"EN,BM,中文"'),
    ("I", '"Coach,Finder,Reply,Error / none"'),
    ("M", '"PASS,FAIL,N/A"'), ("N", '"PASS,FAIL,N/A"'), ("O", '"PASS,FAIL,N/A"'), ("P", '"PASS,FAIL,N/A"'),
    ("Q", '"PASS,FAIL,N/A"'), ("R", '"PASS,FAIL,N/A"'), ("S", '"PASS,FAIL,N/A"'),
    ("T", '"Use as-is,Use after small edits,Not usable"'),
    ("U", '"Pass,Fail"'),
    ("V", '"S1,S2,S3,S4"'),
    ("Y", '"Yes,No"'),
    ("Z", '"Pass,Fail"'),
    ("AA", '"Model / prompt,KB gap,Test-case defect,UI bug,Environment"'),
]

EXPLORATORY_PRECONDITIONS = "Use only made-up names and the placeholder numbers in the Instructions tab."
EXPLORATORY_KNOWN = "Write the answer you expect in Expected Result before you ask."

PLACEHOLDERS = ["012-000 0000", "0120000000", "+60 12-000 0000", "900101-14-0000", "900101140000",
                "siti@example.com"]
SYNTHETIC_NAMES = "Encik Ali, Cik Tan, Ms Tan, Mr Lim, Madam Wong, Puan Wong, Mr Tanaka, Mr Lee, Mr Chen, Siti, "\
                  "阿里先生, 林先生, 田中先生"

# ---------------------------------------------------------------- Instructions text (plain English)
INSTR_SUBTITLE = ("Run each case on your phone, judge the answer with the Rubric tab, then record it in the Run Log "
                  "tab and on the Test Cases tab.")
INSTR_PURPOSE = (
    "This workbook checks the quality of what the three AI assistants say: the Onboarding Coach, the Property Finder "
    "and the Reply Assistant, in English, Bahasa Malaysia and 中文. You are judging the answers, not the buttons and "
    "screens. Each case gives you the exact message to send and what a good answer must and must not contain. "
    "Derek leads the test and signs off at the end. The test runs on the app as it is today, so some cases carry a "
    "Known Status warning about a problem we already expect. Run those cases anyway and record what you see."
)
INSTR_PREREQ = [
    ("Environment", "The test link from the coordinator, opened in a phone browser. Check today's version stamp in the "
                    "tester channel before you start, and write it in every Run Log row."),
    ("Test accounts", "An email and a password for your own tester account, from the coordinator. Ignore any "
                      "\"Google account\" wording on the sign-in page. Accept the AI notice the first time. "
                      "Nobody gets an admin account."),
    ("Test leads", "At least 3 made-up leads in your account, created by the coordinator. Reply cases ask you to pick "
                   "one of them."),
    ("Devices", "A phone is the main device. Note the phone and browser in the Run Log."),
    ("Languages", "English (EN), Bahasa Malaysia (BM) and 中文. Use the Lang and Run by columns on the Test Cases tab "
                  "to find the cases for you."),
    ("Daily limit", "Each account can send 100 messages a day. If you see the daily-limit message, stop and tell the "
                    "coordinator."),
]
INSTR_STEPS = [
    "Open the test link and sign in with the email and password you were given. Ignore any \"Google account\" wording "
    "on the sign-in page. Accept the AI notice the first time.",
    "Check today's version stamp in the tester channel.",
    "Find your cases with the Run by column on the Test Cases tab.",
    "Tap New chat for every run, and set the chip as the case says (Auto, Coach, Finder or Reply).",
    "For Reply cases, pick one of your test leads when asked. To switch lead, reload the page.",
    "Copy the message exactly as written in Steps. Do not paraphrase it or add hints. Follow-up questions are their "
    "own cases.",
    "Wait for the full answer. Long-press and Copy, then paste the full answer into a new row of the Run Log tab. "
    "Take one screenshot that shows the answer and its Sources row.",
    "Judge the answer with the Rubric tab: correctness first, voice last. On a Fail, give a severity, a one-line "
    "\"What's wrong\" and \"What correct looks like\".",
    "Repeat in a new chat for run 2, and run 3 for Adversarial cases. Then set the case's Result on the Test Cases "
    "tab.",
    "Use only the made-up names and placeholder numbers listed at the bottom of this tab. That applies to your own "
    "exploratory questions too.",
    "Do not press thumbs-down on drafts unless the coordinator says so.",
    "If you see the daily-limit message, tell the coordinator.",
]
INSTR_KNOWN_STATUS = ("The Known Status column warns you about cases that are expected to misbehave, or that depend "
                      "on a decision still to be made. Run them anyway, record what you see, and rate them as usual.")
INSTR_PRIORITY = "P0 = must work before the pilot · P1 = important · P2 = polish."
INSTR_EDIT = ("Only edit the yellow cells: Result and Actual / Comments on Test Cases, the Run Log rows, the "
              "exploratory rows, and the yellow cells on Sign-off.")
INSTR_EXAMPLE = [
    "EX", "Own-stay lead in one area",
    "1. Tap New chat and set the chip to Finder.\n2. Send exactly: \"Encik Ali, Malaysian, non-bumi, own stay, "
    "Bukit Jalil, budget up to 800k\"",
    "MUST: The results list a Bukit Jalil project within budget.\nMUST NOT: List a project outside Bukit Jalil.\n"
    "ALSO ACCEPTABLE: A project with no price on record, if it is not called within budget.",
    "Pass",
    "Both runs listed only Bukit Jalil projects. No project over budget.",
]
INSTR_SYNTHETIC = ("Never type a real person's name, phone number, IC number or email, in a scripted case or in your "
                   "own exploratory questions. Use only these:")


# ---------------------------------------------------------------- helpers
def font(size=10, bold=False, color=INK_BODY):
    return Font(name=FONT, size=size, bold=bold, color=color)


def wrap_top(horizontal=None):
    return Alignment(vertical="top", wrap_text=True, horizontal=horizontal)


def units(text):
    # CJK characters are roughly twice as wide as Latin ones.
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in text)


def est_height(text, width, pt=10):
    # Only used for merged cells, which spreadsheets never auto-fit.
    per_line = max(8, int(width * 1.05))
    lines = 0
    for para in str(text).split("\n"):
        lines += max(1, math.ceil(units(para) / per_line))
    return lines * (pt + 3.5) + 6


def set_widths(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def header_cells(ws, row, values, size=10, center=True):
    for c, v in enumerate(values, start=1):
        cell = ws.cell(row=row, column=c, value=v)
        cell.font = font(size, True, "FFFFFF")
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(vertical="center" if center else "top", wrap_text=True)
        cell.border = BORDER


def band_row(ws, row, text, last_col, height=22):
    ws.cell(row=row, column=1, value=text)
    for c in range(1, last_col + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = BAND_FILL
        cell.font = font(11, True, INK)
        cell.border = BORDER
        cell.alignment = Alignment(vertical="center")
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_col)
    ws.row_dimensions[row].height = height


def plain_band(ws, row, text, last_col):
    """Phase-1 section heading: fill on the first cell, merged across."""
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = font(11, True, INK)
    for c in range(1, last_col + 1):
        ws.cell(row=row, column=c).fill = BAND_FILL
    if last_col > 1:
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_col)


def compose_expected(case):
    e = case["expected"]
    return "MUST: {}\nMUST NOT: {}\nALSO ACCEPTABLE: {}".format(e["must"], e["must_not"], e["also_acceptable"])


def compose_known(case, phrases):
    return "\n".join(phrases[k] for k in case["known_status_keys"])


def ceil_pct(n, pct):
    return -(-n * pct // 100)


# ---------------------------------------------------------------- Instructions
def build_instructions(wb, data):
    ws = wb.active
    ws.title = "Instructions"
    ws.sheet_view.showGridLines = False
    set_widths(ws, [26, 70, 32, 34, 12, 34])
    ws["A1"] = data["meta"]["title"]
    ws["A1"].font = font(15, True, INK)
    ws["A2"] = INSTR_SUBTITLE
    ws["A2"].font = font(10, False, INK_SUBTLE)

    r = 4
    plain_band(ws, r, "Purpose", 2)
    r += 1
    ws.cell(row=r, column=1, value=INSTR_PURPOSE)
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    ws.cell(row=r, column=1).font = font()
    ws.cell(row=r, column=1).alignment = wrap_top()
    ws.row_dimensions[r].height = est_height(INSTR_PURPOSE, 96)

    r += 2
    plain_band(ws, r, "Before you start — prerequisites", 2)
    for label, text in INSTR_PREREQ:
        r += 1
        ws.cell(row=r, column=1, value=label).font = font(10, True, INK_STRONG)
        ws.cell(row=r, column=2, value=text).font = font()
        ws.cell(row=r, column=1).alignment = wrap_top()
        ws.cell(row=r, column=2).alignment = wrap_top()

    r += 2
    plain_band(ws, r, "How to fill this in", 2)
    for n, text in enumerate(INSTR_STEPS, start=1):
        r += 1
        ws.cell(row=r, column=1, value=str(n)).font = font(10, True, INK_STRONG)
        ws.cell(row=r, column=2, value=text).font = font()
        ws.cell(row=r, column=1).alignment = wrap_top()
        ws.cell(row=r, column=2).alignment = wrap_top()
    r += 1
    ws.cell(row=r, column=1, value="Known Status").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value=INSTR_KNOWN_STATUS).font = font()
    ws.cell(row=r, column=1).alignment = wrap_top()
    ws.cell(row=r, column=2).alignment = wrap_top()
    for rule in data["pass_rules"]:
        label, _, text = rule.partition(": ")
        text = text[:1].upper() + text[1:]
        r += 1
        ws.cell(row=r, column=1, value="Pass rule — " + label).font = font(10, True, INK_STRONG)
        ws.cell(row=r, column=2, value=text).font = font()
        ws.cell(row=r, column=1).alignment = wrap_top()
        ws.cell(row=r, column=2).alignment = wrap_top()

    r += 2
    ws.cell(row=r, column=1, value="Priority").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value=INSTR_PRIORITY).font = font()
    r += 1
    ws.cell(row=r, column=1, value="Only edit the yellow cells").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value=INSTR_EDIT).font = font()
    for rr in (r - 1, r):
        ws.cell(row=rr, column=1).alignment = wrap_top()
        ws.cell(row=rr, column=2).alignment = wrap_top()

    r += 2
    plain_band(ws, r, "Example (how a filled row looks — do not edit here)", 2)
    r += 1
    header_cells(ws, r, ["ID", "Test Case", "Steps", "Expected Result", "Result", "Actual / Comments"], size=9,
                 center=False)
    r += 1
    for c, v in enumerate(INSTR_EXAMPLE, start=1):
        cell = ws.cell(row=r, column=c, value=v)
        cell.font = font(9)
        cell.alignment = wrap_top()
        cell.border = BORDER
        if c in (5, 6):
            cell.fill = YELLOW

    r += 2
    plain_band(ws, r, "Synthetic data only", 2)
    r += 1
    ws.cell(row=r, column=1, value="Why").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value=INSTR_SYNTHETIC).font = font()
    r += 1
    ws.cell(row=r, column=1, value="Placeholder numbers and email").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value="\n".join(PLACEHOLDERS)).font = font()
    r += 1
    ws.cell(row=r, column=1, value="Made-up names").font = font(10, True, INK_STRONG)
    ws.cell(row=r, column=2, value=SYNTHETIC_NAMES).font = font()
    for rr in (r - 2, r - 1, r):
        ws.cell(row=rr, column=1).alignment = wrap_top()
        ws.cell(row=rr, column=2).alignment = wrap_top()

    r += 2
    plain_band(ws, r, "Tester roster", 4)
    r += 1
    header_cells(ws, r, ["Tester", "Name", "Role", "Languages"], size=9, center=False)
    for k in range(1, data["meta"]["testers"] + 1):
        r += 1
        ws.cell(row=r, column=1, value="Tester {}".format(k))
        for c in range(1, 5):
            cell = ws.cell(row=r, column=c)
            cell.font = font(9, c == 1, INK_STRONG if c == 1 else INK_BODY)
            cell.alignment = wrap_top()
            cell.border = BORDER
            if c > 1:
                cell.fill = YELLOW


# ---------------------------------------------------------------- Rubric
def build_rubric(wb, data):
    ws = wb.create_sheet("Rubric")
    ws.sheet_view.showGridLines = False
    widths = [16, 22, 40, 40, 40, 18]
    set_widths(ws, widths)
    ws["A1"] = "How to judge an answer"
    ws["A1"].font = font(15, True, INK)
    ws["A2"] = "Rate correctness first (H1, H2, H3, H6, H7), then language and voice (H4, H5), then usefulness (U)."
    ws["A2"].font = font(10, False, INK_SUBTLE)

    def body_row(r, values, bold_first=True, size=9):
        for c, v in enumerate(values, start=1):
            cell = ws.cell(row=r, column=c, value=v)
            cell.font = font(size, bold_first and c == 1, INK_STRONG if (bold_first and c == 1) else INK_BODY)
            cell.alignment = wrap_top()
            cell.border = BORDER

    r = 4
    plain_band(ws, r, "Seven questions and a usefulness check", 6)
    r += 1
    header_cells(ws, r, ["Code", "Dimension", "Ask yourself", "PASS looks like", "FAIL looks like", "Applies to"],
                 size=9, center=False)
    for item in data["rubric"]:
        r += 1
        body_row(r, [item["code"], item["name"], item["question"], item["pass"], item["fail"], item["applies_to"]])

    r += 2
    plain_band(ws, r, "Pass rules", 6)
    for rule in data["pass_rules"]:
        r += 1
        ws.cell(row=r, column=1, value=rule)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        ws.cell(row=r, column=1).font = font()
        ws.cell(row=r, column=1).alignment = wrap_top()
        ws.row_dimensions[r].height = est_height(rule, sum(widths))

    r += 2
    plain_band(ws, r, "How serious is it? (severity)", 6)
    r += 1
    header_cells(ws, r, ["Level", "Name", "What it means", "D2 examples"], size=9, center=False)
    for item in data["severity"]:
        r += 1
        body_row(r, [item["level"], item["name"], item["meaning"], item["examples"]])

    r += 2
    plain_band(ws, r, "Root cause (set at triage)", 6)
    r += 1
    header_cells(ws, r, ["Root cause (set at triage)", "Meaning"], size=9, center=False)
    for item in data["root_causes"]:
        r += 1
        body_row(r, [item["tag"], item["meaning"]])
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=5)
        for c in range(3, 6):
            ws.cell(row=r, column=c).border = BORDER
        ws.row_dimensions[r].height = max(est_height(item["tag"], widths[0], 9),
                                          est_height(item["meaning"], sum(widths[1:5]), 9))


# ---------------------------------------------------------------- Test Cases
def build_test_cases(wb, data):
    ws = wb.create_sheet("Test Cases")
    ws.sheet_view.showGridLines = False
    set_widths(ws, TC_WIDTHS)
    header_cells(ws, 1, TC_HEADERS)
    ws.row_dimensions[1].height = 28
    ws.freeze_panes = "A2"
    phrases = data["known_status_phrases"]

    layout = {"blocks": {}, "sections": {}, "case_rows": [], "e_rows": [], "bands": []}
    dv = DataValidation(type="list", formula1=RESULT_LIST, allow_blank=True)
    ws.add_data_validation(dv)

    def style_case_row(r, yellow_cols):
        for c in range(1, 16):
            cell = ws.cell(row=r, column=c)
            cell.font = font(9, c == 1, INK_STRONG if c == 1 else INK_BODY)
            cell.alignment = wrap_top("center" if c in (8, 11, 13, 15) else None)
            cell.border = BORDER
            if c in yellow_cols:
                cell.fill = YELLOW
        ws.cell(row=r, column=10).font = font(9, False, GREY)

    r = 1
    for section in data["sections"]:
        r += 1
        band_row(ws, r, section["band"], 15)
        layout["bands"].append(r)
        sec_cases = [c for c in data["cases"] if c["section"] == section["letter"]]
        sec_first = r + 1
        for lang in LANGS:
            lang_first = None
            for case in [c for c in sec_cases if c["lang"] == lang]:
                r += 1
                if lang_first is None:
                    lang_first = r
                values = [case["id"], case["area"], case["title"], case["priority"], case["preconditions"],
                          case["steps"], compose_expected(case), "Not Run", None, compose_known(case, phrases),
                          case["lang"], case["type"], case["runs"], case["run_by"],
                          "Yes" if case["double_rate"] else None]
                for c, v in enumerate(values, start=1):
                    ws.cell(row=r, column=c, value=v)
                style_case_row(r, {8, 9})
                ws.cell(row=r, column=4).font = font(9, False, PRIORITY_COLOR[case["priority"]])
                dv.add("H{}".format(r))
                layout["case_rows"].append(r)
            if lang_first is not None:
                layout["blocks"][(section["letter"], lang)] = (lang_first, r)
        layout["sections"][section["letter"]] = (sec_first, r)

    r += 1
    band_row(ws, r, data["exploratory_band"], 15)
    layout["bands"].append(r)
    per = data["meta"]["exploratory_slots_per_tester"]
    slots = data["meta"]["testers"] * per
    for n in range(1, slots + 1):
        r += 1
        k = (n - 1) // per + 1
        values = ["E{}".format(n), "Exploratory", "Your own question (Tester {})".format(k), None,
                  EXPLORATORY_PRECONDITIONS, None, None, "Not Run", None, EXPLORATORY_KNOWN, None, "Exploratory",
                  1, "Tester {}".format(k), None]
        for c, v in enumerate(values, start=1):
            ws.cell(row=r, column=c, value=v)
        style_case_row(r, {3, 6, 7, 8, 9, 11})
        dv.add("H{}".format(r))
        layout["e_rows"].append(r)
    layout["last_row"] = r
    return layout


# ---------------------------------------------------------------- Run Log
def build_run_log(wb, data):
    ws = wb.create_sheet("Run Log")
    ws.sheet_view.showGridLines = False
    set_widths(ws, RL_WIDTHS)
    header_cells(ws, 1, RL_HEADERS, size=9)
    ws.row_dimensions[1].height = 44
    ws.freeze_panes = "C2"

    rows = []  # (id, run) in order
    for section in data["sections"]:
        for case in [c for c in data["cases"] if c["section"] == section["letter"]]:
            for run in range(1, case["runs"] + 1):
                rows.append((case["id"], run))
    scripted = len(rows)
    slots = data["meta"]["testers"] * data["meta"]["exploratory_slots_per_tester"]
    for n in range(1, slots + 1):
        rows.append(("E{}".format(n), 1))
    for _ in range(RL_SPARE_ROWS):
        rows.append((None, None))

    ncols = len(RL_HEADERS)
    for i, (cid, run) in enumerate(rows):
        r = i + 2
        for c in range(1, ncols + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = font(9, c == 1, INK_STRONG if c == 1 else INK_BODY)
            cell.alignment = wrap_top("center" if c == 2 else None)
            cell.border = BORDER
            if c >= 3 or cid is None:
                cell.fill = YELLOW
        if cid is not None:
            ws.cell(row=r, column=1, value=cid)
            ws.cell(row=r, column=2, value=run)
    last = len(rows) + 1
    for col, formula in RL_VALIDATIONS:
        dv = DataValidation(type="list", formula1=formula, allow_blank=True)
        dv.add("{c}2:{c}{n}".format(c=col, n=last))
        ws.add_data_validation(dv)
    return {"scripted": scripted, "slots": slots, "last_row": last,
            "e_first": scripted + 2, "e_last": scripted + 1 + slots}


# ---------------------------------------------------------------- Sign-off
def build_signoff(wb, data, tc, rl):
    ws = wb.create_sheet("Sign-off")
    ws.sheet_view.showGridLines = False
    widths = [60, 16, 16, 16, 24]
    set_widths(ws, widths)
    ncol = len(widths)
    ws["A1"] = "AI Output UAT — Result summary & Sign-off"
    ws["A1"].font = font(15, True, INK)
    ws["A2"] = ("Counts fill in automatically from the Test Cases tab. Fill the yellow cells. "
                "All thresholds are proposed and Derek confirms them.")
    ws["A2"].font = font(10, False, INK_SUBTLE)

    def rng(first, last, sheet="Test Cases", col="H"):
        return "'{}'!${c}${a}:${c}${b}".format(sheet, c=col, a=first, b=last)

    def countif(first, last, crit):
        return 'COUNTIF({},"{}")'.format(rng(first, last), crit)

    def label_cell(r, c, text, bold=True):
        cell = ws.cell(row=r, column=c, value=text)
        cell.font = font(10, bold, INK_STRONG)
        cell.border = BORDER
        return cell

    def value_cell(r, c, v, yellow=False, size=10):
        cell = ws.cell(row=r, column=c, value=v)
        cell.font = font(size, False, INK_STRONG)
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")
        if yellow:
            cell.fill = YELLOW
        return cell

    pillars = [(s["letter"], s["pillar"]) for s in data["sections"]]
    sec_range = tc["sections"]
    first_scripted = sec_range[pillars[0][0]][0]
    last_scripted = sec_range[pillars[-1][0]][1]
    cases_in = lambda letter, lang=None: sum(  # noqa: E731
        1 for c in data["cases"] if c["section"] == letter and (lang is None or c["lang"] == lang))
    total = len(data["cases"])

    r = 4
    plain_band(ws, r, "Result summary (auto — from the Test Cases tab)", ncol)
    r += 1
    label_cell(r, 1, "Scripted cases")
    value_cell(r, 2, total)
    for name, crit in [("Passed", "Pass"), ("Failed", "Fail"), ("Blocked", "Blocked"), ("Not run", "Not Run")]:
        r += 1
        label_cell(r, 1, name)
        value_cell(r, 2, "=" + countif(first_scripted, last_scripted, crit))

    r += 2
    plain_band(ws, r, "By pillar (auto)", ncol)
    r += 1
    header_cells(ws, r, ["Pillar", "Cases", "Passed", "Failed", "Needed to pass (85%)"], size=10)
    for letter, pillar in pillars:
        r += 1
        a, b = sec_range[letter]
        n = cases_in(letter)
        label_cell(r, 1, pillar)
        value_cell(r, 2, n)
        value_cell(r, 3, "=" + countif(a, b, "Pass"))
        value_cell(r, 4, "=" + countif(a, b, "Fail"))
        value_cell(r, 5, ceil_pct(n, 85))

    r += 2
    plain_band(ws, r, "By language (auto)", ncol)
    r += 1
    header_cells(ws, r, ["Language", "Cases", "Passed", "Failed", "Needed to pass (80%)"], size=10)
    for lang in LANGS:
        r += 1
        blocks = [tc["blocks"][(letter, lang)] for letter, _ in pillars if (letter, lang) in tc["blocks"]]
        n = sum(1 for c in data["cases"] if c["lang"] == lang)
        label_cell(r, 1, lang)
        value_cell(r, 2, n)
        value_cell(r, 3, "=" + "+".join(countif(a, b, "Pass") for a, b in blocks))
        value_cell(r, 4, "=" + "+".join(countif(a, b, "Fail") for a, b in blocks))
        value_cell(r, 5, ceil_pct(n, 80))

    r += 2
    plain_band(ws, r, "Pillar × language", ncol)
    r += 1
    header_cells(ws, r, ["Pillar", "Language", "Cases", "Passed", "Gate"], size=10)
    for letter, pillar in pillars:
        for lang in LANGS:
            r += 1
            a, b = tc["blocks"][(letter, lang)]
            n = cases_in(letter, lang)
            label_cell(r, 1, pillar)
            value_cell(r, 2, lang)
            value_cell(r, 3, n)
            value_cell(r, 4, "=" + countif(a, b, "Pass"))
            value_cell(r, 5, "80% gate" if n >= 10 else "Report only")

    r += 2
    plain_band(ws, r, "Defects logged (auto)", ncol)
    run_v = "'Run Log'!$V$2:$V${}".format(rl["last_row"])
    run_u = "'Run Log'!$U${}:$U${}".format(rl["e_first"], rl["e_last"])
    for name, formula in [("S1 defects (critical)", '=COUNTIF({},"S1")'.format(run_v)),
                          ("S2 defects (major)", '=COUNTIF({},"S2")'.format(run_v)),
                          ("Exploratory runs completed", '=COUNTIF({},"?*")'.format(run_u))]:
        r += 1
        label_cell(r, 1, name)
        value_cell(r, 2, formula)

    r += 2
    plain_band(ws, r, "Exit criteria (Proposed — Derek to confirm)", ncol)
    r += 1
    header_cells(ws, r, ["Criterion", "Result", "Notes", None, None], size=10)
    ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=ncol)
    dv_ec = DataValidation(type="list", formula1='"Pass,Fail,Partial,Not Tested"', allow_blank=True)
    ws.add_data_validation(dv_ec)
    adversarial = sum(1 for c in data["cases"] if c["type"] == "Adversarial")
    for item in data["exit_criteria"]:
        r += 1
        crit = "{} — {}".format(item["id"], item["text"])
        label_cell(r, 1, crit, bold=False).font = font(9, False, INK_BODY)
        ws.cell(row=r, column=1).alignment = wrap_top()
        value_cell(r, 2, "Not Tested", yellow=True, size=9)
        dv_ec.add("B{}".format(r))
        note = None
        if item["id"] == "EC5":
            note = "Needed: {} of {} Adversarial cases must pass (90%).".format(ceil_pct(adversarial, 90),
                                                                                 adversarial)
        for c in range(3, ncol + 1):
            cell = ws.cell(row=r, column=c)
            cell.fill = YELLOW
            cell.border = BORDER
            cell.font = font(9, False, INK_BODY)
            cell.alignment = wrap_top()
        ws.cell(row=r, column=3, value=note)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=ncol)
        ws.row_dimensions[r].height = max(30, est_height(crit, widths[0], 9))

    r += 2
    dv_go = DataValidation(type="list", formula1='"GO,NO-GO"', allow_blank=True)
    ws.add_data_validation(dv_go)
    for label in ["Overall verdict (GO / NO-GO)", "Signed by", "Role", "Date", "Summary / blockers"]:
        label_cell(r, 1, label)
        for c in range(2, ncol + 1):
            cell = ws.cell(row=r, column=c)
            cell.fill = YELLOW
            cell.border = BORDER
            cell.font = font(10, False, INK_STRONG)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=ncol)
        if label.startswith("Overall"):
            dv_go.add("B{}".format(r))
        if label.startswith("Summary"):
            ws.row_dimensions[r].height = 60
        r += 1


# ---------------------------------------------------------------- main
def build(cases_path, out_path):
    data = json.loads(Path(cases_path).read_text(encoding="utf-8"))
    wb = Workbook()
    build_instructions(wb, data)
    build_rubric(wb, data)
    tc = build_test_cases(wb, data)
    rl = build_run_log(wb, data)
    build_signoff(wb, data, tc, rl)
    stamp = datetime(2026, 10, 19, 0, 0, 0)  # fixed, so a rebuild changes nothing
    wb.properties.creator = "UAT build"
    wb.properties.created = stamp
    wb.properties.modified = stamp
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out_path))
    return data, tc, rl


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(DEFAULT_CASES))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args(argv)
    data, tc, rl = build(args.cases, args.out)
    print("wrote {}".format(args.out))
    print("Test Cases: {} scripted cases, {} exploratory rows, last row {}".format(
        len(tc["case_rows"]), len(tc["e_rows"]), tc["last_row"]))
    print("Run Log: {} scripted runs + {} exploratory + {} spare = {} rows".format(
        rl["scripted"], rl["slots"], RL_SPARE_ROWS, rl["last_row"] - 1))


if __name__ == "__main__":
    sys.exit(main())
