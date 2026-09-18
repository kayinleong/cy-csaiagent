#!/usr/bin/env python3
"""
build-property-workbook.py — quick-kayinleong-090

Generates D2-Property-Data-Gaps.xlsx: a client-facing workbook enumerating every
attribute on the `projects` record, one row per project, blank where D2 has not
supplied a value, so Derek can fill the gaps.

INPUT  (committed, no Firestore access needed):
  .planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md
    — per-project field coverage measured against LIVE Firestore by
      scripts/data-completeness-report.ts. Presence/absence only, never values.
  src/firebase/collections.ts  (ProjectDoc / UnitTypeEntry / CollateralDoc)
    — transcribed by hand into DICT/UNIT/COLL below.

OUTPUT:
  .planning/quick/quick-kayinleong-090/D2-Property-Data-Gaps.xlsx

RUN:
  uv run --with openpyxl python .planning/quick/quick-kayinleong-090/build-property-workbook.py

NOTE: coverage is a snapshot as of quick-088. Re-run the upstream report for fresh
numbers, then re-run this script:
  node_modules/.bin/tsx --env-file=.env.local scripts/data-completeness-report.ts
"""
import os, re, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC  = os.path.join(REPO, ".planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md")
OUT  = os.path.join(HERE, "D2-Property-Data-Gaps.xlsx")

# ── palette ─────────────────────────────────────────────────────────────────
HDR_FILL  = PatternFill("solid", fgColor="1F3864")
HDR_FONT  = Font(bold=True, color="FFFFFF", size=10)
FILL_ME   = PatternFill("solid", fgColor="FFF2CC")   # yellow — client must fill
CONFIRM   = PatternFill("solid", fgColor="FBE2D5")   # peach  — client must confirm
HAVE      = PatternFill("solid", fgColor="E2EFDA")   # green  — already on file
NA_FILL   = PatternFill("solid", fgColor="F2F2F2")   # grey   — system-derived
RED_FILL  = PatternFill("solid", fgColor="FCE4E4")
TITLE     = Font(bold=True, size=14, color="1F3864")
BOLD      = Font(bold=True)
WRAP      = Alignment(wrap_text=True, vertical="top")
CTR       = Alignment(horizontal="center", vertical="center")
THIN      = Side(style="thin", color="BFBFBF")
BOX       = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

def hdr(ws, height=34):
    for c in range(1, ws.max_column + 1):
        x = ws.cell(row=1, column=c)
        x.fill, x.font, x.border = HDR_FILL, HDR_FONT, BOX
        x.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = height

def widths(ws, ws_w):
    for i, w in enumerate(ws_w, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

def box_all(ws, wrap_from=1):
    for r in range(2, ws.max_row + 1):
        for c in range(1, ws.max_column + 1):
            x = ws.cell(row=r, column=c)
            x.border = BOX
            x.alignment = WRAP if c >= wrap_from else Alignment(vertical="top", wrap_text=True)

# ── parse upstream coverage report ──────────────────────────────────────────
REPORT_FIELDS = ["priceValue","pricePsf","bedrooms","size","tenure",
                 "locationText","vpDate","unitTypes","description","collateral"]

def load_rows(path):
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if not re.match(r"^\|\s*\d+\s*\|", line):
                continue
            p = [x.strip() for x in line.strip().strip("|").split("|")]
            kb = p[15].replace("**", "")
            m  = re.match(r"^\s*(\d+)", kb)
            amb = re.search(r"\(\+(\d+)\?\)", kb)
            out.append({
                "missing": int(p[0]), "name": p[1], "status": p[2],
                "present": {k: (p[i] == "✓") for i, k in zip(range(3, 13), REPORT_FIELDS)},
                "descChars": int(p[13]), "collateralCount": int(p[14]),
                "kb": int(m.group(1)) if m else 0,
                "kbNote": f"+{amb.group(1)} fuzzy" if amb else ("no KB content" if "none" in kb else ""),
            })
    out.sort(key=lambda r: r["name"].lower())
    return out

rows = load_rows(SRC)
if len(rows) != 87:
    sys.exit(f"ERROR: expected 87 projects, parsed {len(rows)} from {SRC}")

# The 5 Firestore rows that are NOT part of D2's Skool project roster.
# `Property 1` is a test doc; the 4 hidden ones are WhatsApp-import placeholders.
# The client roster is 82 — do not ask Derek to fill these in.
NON_ROSTER = {
    "Property 1":            "test record",
    "Aetas Damansara":       "WhatsApp-import placeholder",
    "Stonor 3":              "WhatsApp-import placeholder",
    "Tribeca Bukit Bintang": "WhatsApp-import placeholder",
    "Papyrus North Kiara":   "WhatsApp-import placeholder",
}

wb = Workbook()

# ═══ 1. Read Me ═════════════════════════════════════════════════════════════
ws = wb.active; ws.title = "Read Me"
ws["A1"] = "D2 Property Inventory — Data Completeness & Gap Request"; ws["A1"].font = TITLE
README = [
 ("", ""),
 ("Purpose", "One row per D2 project, one column per attribute the AI Property Finder uses. "
             "Green = already on file. YELLOW = missing, please supply. PEACH = on file but unverified, please confirm."),
 ("Who fills this", "Derek / D2 ops. Fill the yellow cells; confirm the peach ones."),
 ("", ""),
 ("Scope", "The `projects` collection holds 87 records, but the CLIENT ROSTER IS 82. The other 5 are not D2 "
            "projects: 'Property 1' is a test record, and Aetas Damansara / Stonor 3 / Tribeca Bukit Bintang / "
            "Papyrus North Kiara are hidden WhatsApp-import placeholders. They are marked 'skip' in column C — "
            "please do not fill those rows."),
 ("Source", "Measured against LIVE Firestore by scripts/data-completeness-report.ts, committed at "
            ".planning/quick/quick-kayinleong-088/DATA-COMPLETENESS.md. This workbook reformats that report."),
 ("Number provenance", "Two conflicting sets of price-gap figures exist in .planning/. The ones used here come from "
            "DATA-COMPLETENESS.md, last regenerated 2026-09-07 (commit 1f4586e) AFTER quick-089 recovered prices "
            "from WhatsApp. The older figures in quick-088/CLAIM.md (2026-09-06) are pre-recovery — do not use them."),
 ("Caveat — read this", "Field VALUES are not reproduced here. The upstream report records presence/absence only "
            "(deliberately: no PII, no values), so a green cell means 'a value exists', not 'the value is correct'. "
            "Coverage is a snapshot as of quick-088; quick-089 has since changed some prices. Re-run "
            "scripts/data-completeness-report.ts for a fresh snapshot."),
 ("", ""),
 ("Why blanks matter", "The Finder refuses to invent data. A blank price renders as an em-dash to the agent, and a "
            "project with no bedrooms or size cannot be matched against a client brief. Every yellow cell is a "
            "question a D2 agent cannot answer at 11pm."),
 ("", ""),
 ("Sheets", ""),
 ("  2. Property Details", "The fill-in matrix — 87 projects. This is the sheet to send to the client."),
 ("  3. Data Dictionary", "Every field on the project record: type, required, allowed values, meaning, who supplies it."),
 ("  4. Gap Summary", "How many projects miss each field, worst first, with priority."),
 ("  5. Unit Types", "Sub-record: the per-layout price/size table."),
 ("  6. Collateral", "Sub-record: marketing assets (poster / video / fact sheet)."),
 ("  7. Not Yet Captured", "Attributes D2 talks about that the system has NO field for at all — developer, maintenance "
            "fee, facilities, car parks and more. Decide per row whether to add a field or drop the attribute."),
 ("  8. Data Traps", "Conventions that will corrupt the data if misread. Read before filling anything in."),
 ("", ""),
 ("Legend", ""),
 ("  Green 'on file'", "A value is stored. Nothing needed."),
 ("  Yellow (blank)", "MISSING — please supply the value."),
 ("  Peach (blank)", "A value is stored but was never verified, and a wrong one is consequential. Please confirm."),
 ("  Grey 'n/a'", "System-derived. Never filled in by hand."),
]
for i, (k, v) in enumerate(README, start=2):
    ws.cell(row=i, column=1, value=k).font = BOLD
    ws.cell(row=i, column=2, value=v).alignment = WRAP
widths(ws, [24, 118])

# ═══ 2. Property Details ════════════════════════════════════════════════════
ws = wb.create_sheet("Property Details")
# (header, coverage key or None, width, kind)   kind: id | roster | cover | confirm | diag
COLS = [
 ("Project",                     None,           40, "id"),
 ("Status",                      None,            9, "id"),
 ("In client\nroster?",          None,           13, "roster"),
 ("Missing\nfields",             None,            8, "id"),
 ("Price — total (RM)",          "priceValue",   17, "cover"),
 ("Price — per sqft\n(RM/sqft)", "pricePsf",     16, "cover"),
 ("Bedrooms",                    "bedrooms",     10, "cover"),
 ("Built-up size\n(sqft)",       "size",         14, "cover"),
 ("Tenure",                      "tenure",       12, "cover"),
 ("Location",                    "locationText", 13, "cover"),
 ("VP date",                     "vpDate",       12, "cover"),
 ("Unit-type /\nlayout table",   "unitTypes",    15, "cover"),
 ("Description",                 "description",  12, "cover"),
 ("Marketing\ncollateral",       "collateral",   13, "cover"),
 ("VP completed?\n(confirm y/n)",     None,      15, "confirm"),
 ("Bumi quota?\n(confirm y/n)",       None,      15, "confirm"),
 ("Foreign eligible?\n(confirm y/n)", None,      16, "confirm"),
 ("Description\nlength (chars)", None,           13, "diag"),
 ("Collateral\ndocs",            None,           11, "diag"),
 ("KB chunks",                   None,           10, "diag"),
 ("KB chunk\nambiguity",         None,           14, "diag"),
]
IDX = {i: (key, kind) for i, (_h, key, _w, kind) in enumerate(COLS, start=1)}
DIAG = [i for i, (_k, kind) in IDX.items() if kind == "diag"]

ws.append([c[0] for c in COLS])
hdr(ws); widths(ws, [c[2] for c in COLS])

for r_i, rec in enumerate(rows, start=2):
    skip = rec["name"] in NON_ROSTER
    ws.cell(row=r_i, column=1, value=rec["name"]).alignment = Alignment(wrap_text=True, vertical="center")
    ws.cell(row=r_i, column=2, value=rec["status"]).alignment = CTR
    rc = ws.cell(row=r_i, column=3, value=("SKIP" if skip else "yes"))
    rc.alignment = CTR
    if skip:
        rc.fill = NA_FILL; rc.font = Font(bold=True, size=9, color="808080")
        rc.comment = None
    ws.cell(row=r_i, column=4, value=rec["missing"]).alignment = CTR

    for c_i, (key, kind) in IDX.items():
        cell = ws.cell(row=r_i, column=c_i)
        if kind == "cover":
            if rec["present"][key]:
                cell.value = "on file"; cell.fill = HAVE; cell.font = Font(size=9, color="375623")
            elif not skip:
                cell.fill = FILL_ME
            else:
                cell.fill = NA_FILL
            cell.alignment = CTR
        elif kind == "confirm":
            cell.fill = NA_FILL if skip else CONFIRM
        if kind in ("cover", "confirm"):
            cell.border = BOX

    for c_i, v in zip(DIAG, (rec["descChars"], rec["collateralCount"], rec["kb"], rec["kbNote"])):
        x = ws.cell(row=r_i, column=c_i, value=v); x.alignment = CTR; x.border = BOX
    if rec["kbNote"]:
        ws.cell(row=r_i, column=DIAG[3]).fill = FILL_ME
    if skip:
        for c in (1, 2, 4):
            ws.cell(row=r_i, column=c).font = Font(italic=True, color="808080")

ws.auto_filter.ref = f"A1:{get_column_letter(len(COLS))}{len(rows)+1}"
ws.freeze_panes = "E2"

# ═══ 3. Data Dictionary ═════════════════════════════════════════════════════
ws = wb.create_sheet("Data Dictionary")
ws.append(["#","Field","Type","Required?","Allowed values / format","What it means","Who supplies it","Notes & traps"])
C, Cd, D = "CLIENT supplies", "Client (via description)", "System-derived"
DICT = [
 ("tenantId","TenantId","always set","'d2'","Tenant partition key.",D,"Never edited."),
 ("name","string","REQUIRED","free text","Project name as D2 refers to it.",C,"Feeds the embedding; shown to agents."),
 ("status","enum","REQUIRED","active | sold_out | hidden","Whether the Finder may recommend it.",C,
  "searchProjects hard-filters status:'active' — a sold-out project is never recommended. 83 of 87 active."),
 ("priceBand","enum","always set","price_unknown | under_500k | 500k_800k | 800k_1.2m | above_1.2m",
  "Equality-filterable band used as the findNearest pre-filter.",D,
  "Derived from priceValue. 'price_unknown' is NOT a price — never treat it as satisfying a budget bound."),
 ("priceValue","number (RM)","REQUIRED","0 or positive","Total asking price in RM.",C,
  "0 is the documented UNKNOWN sentinel, not 'cheap'. 27 of 87 have no total."),
 ("tenure","string","REQUIRED","e.g. Freehold / Leasehold 99 yrs","Land tenure.",C,"4 of 87 missing (all hidden)."),
 ("vpStatus","boolean","REQUIRED","true | false","Has Vacant Possession completed?",C,
  "Never measured for correctness — please confirm per project on the Property Details sheet."),
 ("vpDate","date or null","nullable","YYYY-MM-DD or null","VP completion date.",C,
  "null when VP not yet completed. Backs 'which projects completed VP this year'. 64 of 87 missing."),
 ("bumiQuota","boolean","REQUIRED","true | false","Does the project carry a Bumiputera quota?",C,
  "Eligibility rule with legal weight. Never measured — please confirm per project."),
 ("foreignEligible","boolean","REQUIRED","true | false","Can a foreign buyer purchase?",C,
  "Eligibility rule with legal weight. Never measured — please confirm per project."),
 ("description","string","REQUIRED","free text write-up","The project write-up. Feeds the embedding.",C,
  "0 missing — but length ranges 46 to 6,855 chars. Short write-ups are why other fields cannot be extracted."),
 ("locationText","string","REQUIRED","e.g. 'Cheras, KL — near LRT Taman Connaught'",
  "Human-readable location; drives semantic location matching.",C,"4 of 87 missing (all hidden)."),
 ("bedrooms","number","REQUIRED","0 or positive integer","Bedroom count.",C,
  "0 is the UNKNOWN sentinel. 33 of 87 missing."),
 ("sizeMinSqft","number or null","optional","sqft","Smallest built-up layout.",Cd,
  "Parsed from description by extractSizeRange, persisted by backfill-project-sizes.ts. null = unknown, not zero."),
 ("sizeMaxSqft","number or null","optional","sqft","Largest built-up layout.",Cd,"20 of 87 have no size at all."),
 ("pricePsfMin","number or null","optional","RM/sqft","Stated asking rate, low end.",Cd,
  "TRAP: asking psf is RM200–5,000; maintenance psf is RM0.20–2.00. One line apart in most write-ups."),
 ("pricePsfMax","number or null","optional","RM/sqft","Stated asking rate, high end.",Cd,
  "Never multiply a psf rate by a size to synthesise a total — that defect is why these fields exist."),
 ("priceProvenance","enum","optional","stated | psf_only | unknown","Where priceValue came from.",D,
  "Guards against re-introducing model-authored prices. Absent on legacy docs."),
 ("priceSource","enum","optional","'whatsapp-kb'","Set when a price was recovered from a WhatsApp transcript.",D,
  "Chat is WEAKER evidence — the agent may have quoted one unit or a competitor's project."),
 ("priceSourceChunkId","string","optional","kbChunks/{id}","Audit trail to the exact message a price came from.",D,
  "Grounding is mandatory; a disputed price can be checked rather than argued about."),
 ("unitTypes","array","optional","see 'Unit Types' sheet","Per-layout size → bedrooms → price range.",Cd,
  "Parsed from description. Absent means the write-up has no layout table — true for 37 of 87."),
 ("embedding","number[1024]","always set","normalized vector","Semantic search vector (gemini-embedding-001).",D,
  "Recomputed when name, description, locationText, tenure, bedrooms or priceValue changes."),
]
for i, row in enumerate(DICT, start=1):
    ws.append([i] + list(row))
hdr(ws); widths(ws, [4,19,15,11,34,42,17,64]); box_all(ws)
for r in range(2, ws.max_row + 1):
    who = ws.cell(row=r, column=7).value
    ws.cell(row=r, column=7).fill = FILL_ME if who == C else (NA_FILL if who == D else HAVE)
    ws.cell(row=r, column=2).font = Font(bold=True, name="Menlo", size=9)

# ═══ 4. Gap Summary ═════════════════════════════════════════════════════════
ws = wb.create_sheet("Gap Summary")
ws.append(["Field","Missing (all 87)","%","Missing (active 83)","%","Priority","Why it matters"])
for g in [
 ("pricePsf",67,"77.0%",63,"75.9%","Medium","Only needed where no total exists — but then it is the only honest price signal."),
 ("vpDate",64,"73.6%",60,"72.3%","HIGH","Blocks the 'which projects completed VP this year' query outright."),
 ("unitTypes",37,"42.5%",33,"39.8%","Medium","Without it the agent cannot answer 'what layouts, at what price'."),
 ("bedrooms",33,"37.9%",29,"34.9%","HIGH","The most common client filter. 0 = unknown, so these projects silently fail to match."),
 ("priceValue",27,"31.0%",26,"31.3%","HIGH","The single most-asked question. Renders as an em-dash to the agent."),
 ("size",20,"23.0%",16,"19.3%","HIGH","Built-up sqft is in almost every brief; blank Size cell in the Finder table."),
 ("tenure",4,"4.6%",0,"0.0%","Low","All 4 are hidden projects — no active project is missing tenure."),
 ("locationText",4,"4.6%",0,"0.0%","Low","All 4 are hidden projects."),
 ("collateral",1,"1.1%",1,"1.2%","Low","One active project has no marketing asset attached."),
 ("description",0,"0.0%",0,"0.0%","None","Complete — though length ranges from 46 to 6,855 chars."),
]: ws.append(list(g))
ws.append([])
ws.append(["PRICE SIGNAL — what a client asking 'how much?' can actually be told"])
ws.cell(row=ws.max_row, column=1).font = Font(bold=True, color="1F3864")
for g in [
 ("Total price stated",60,"69.0%",57,"68.7%","",""),
 ("psf rate only",20,"23.0%",20,"24.1%","","Honest fallback — never multiply into a total."),
 ("Per-layout prices only",0,"0.0%",0,"0.0%","",""),
 ("Nothing at all",7,"8.0%",6,"7.2%","HIGH","All 7 have KB content, so a price may be recoverable from chat. 0 are truly dark."),
]: ws.append(list(g))
hdr(ws); widths(ws,[24,16,9,18,9,11,74])
for r in range(2, ws.max_row + 1):
    for c in range(1, 8):
        x = ws.cell(row=r, column=c); x.border = BOX
        x.alignment = WRAP if c == 7 else (CTR if c > 1 else Alignment(vertical="center"))
    pr = ws.cell(row=r, column=6).value
    if pr == "HIGH":   ws.cell(row=r, column=6).fill = RED_FILL
    elif pr == "Medium": ws.cell(row=r, column=6).fill = FILL_ME
    elif pr in ("Low","None"): ws.cell(row=r, column=6).fill = HAVE

# ═══ 5. Unit Types ══════════════════════════════════════════════════════════
ws = wb.create_sheet("Unit Types")
ws.append(["Sub-field","Type","Required?","Format","What it means","Who supplies it","Notes & traps"])
for row in [
 ("label","string","REQUIRED","'Studio', '1+1 Room', 'Type H1 (North Wing)'","Layout label as written.",Cd,"Verbatim — do not normalise."),
 ("sizeSqft","number or null","nullable","sqft","Built-up size of this layout.",Cd,"null when the write-up states no size."),
 ("bedrooms","number or null","nullable","integer","Bedroom count for this layout.",Cd,
  "TRAP: a '1+1' layout stores 1. The '+1' is a study/utility room, not a bedroom — counting it inflates matches."),
 ("priceMinRM","number or null","nullable","RM","Low end of this layout's price range.",Cd,"Both null when no price is stated."),
 ("priceMaxRM","number or null","nullable","RM","High end of this layout's price range.",Cd,""),
 ("raw","string","REQUIRED","verbatim source line","The exact line this entry was parsed from.",D,
  "The audit trail. Grounding is mandatory — every rendered figure traces back to the write-up."),
]: ws.append(list(row))
hdr(ws, 30); widths(ws,[14,16,11,40,38,22,66]); box_all(ws)
ws.append([])
ws.append(["Context","37 of 87 projects have NO layout table. Where one exists it backs the 'more details' answer a D2 agent "
           "gives a client — e.g. '504sf Studio from RM1.24–1.8mil / 770sf 1+1 Room from RM1.8–2.7mil'. A single "
           "project-level price plus a size span cannot express that."])
ws.cell(row=ws.max_row, column=1).font = BOLD
ws.cell(row=ws.max_row, column=2).alignment = WRAP
ws.merge_cells(start_row=ws.max_row, start_column=2, end_row=ws.max_row, end_column=7)

# ═══ 6. Collateral ══════════════════════════════════════════════════════════
ws = wb.create_sheet("Collateral")
ws.append(["Field","Type","Required?","Allowed values / format","What it means","Who supplies it","Notes & traps"])
for row in [
 ("tenantId","TenantId","always set","'d2'","Tenant partition key.",D,""),
 ("projectId","string","REQUIRED","projects/{id}","Which project the asset belongs to.",D,"Set when attached in the admin app."),
 ("type","string","REQUIRED","poster | video | fact_sheet","Kind of marketing asset.",C,
  "These three are what the admin collateral form offers."),
 ("storagePath","string","REQUIRED","collateral/{project-id}/poster.pdf","Firebase Storage object path.",C,
  "A path alone is NOT web-addressable — externalUrl must be written alongside it. That gap once left "
  "11,774 of 12,020 collateral docs as dead links."),
 ("externalUrl","string","optional","https URL","Share URL for assets not in Firebase Storage.",C,
  "Use for Drive / OneDrive share links. The Drive API is forbidden by the no-GCP constraint; the URL is a plain string."),
 ("lang","enum","REQUIRED","en | ms | zh","Language of the asset.",C,
  "Drives trilingual delivery. An asset tagged with the wrong lang is invisible to agents working in that language."),
]: ws.append(list(row))
hdr(ws, 30); widths(ws,[14,14,11,34,36,22,72]); box_all(ws)
for r in range(2, ws.max_row + 1):
    who = ws.cell(row=r, column=6).value
    ws.cell(row=r, column=6).fill = FILL_ME if who == C else NA_FILL
ws.append([])
ws.append(["Context","Only 1 of 87 projects has no collateral at all, but counts are very uneven — 0 to 1,060 assets per "
           "project. Coverage is not the problem; per-asset correctness (type, lang, reachable URL) is."])
ws.cell(row=ws.max_row, column=1).font = BOLD
ws.cell(row=ws.max_row, column=2).alignment = WRAP
ws.merge_cells(start_row=ws.max_row, start_column=2, end_row=ws.max_row, end_column=7)


# ═══ 7. Not Yet Captured ════════════════════════════════════════════════════
# Attributes D2 talks about that have NO field on ProjectDoc at all.
# "In source" counts are over the 82 Skool write-ups (quick-088 RESEARCH-detail-output.md).
ws = wb.create_sheet("Not Yet Captured")
ws.append(["Attribute","Field exists?","Stated in the write-ups\n(of 82)","Where it would come from",
           "Why D2 wants it","What to do"])
ADD, DROP, PART = "Add a field", "Deliberately excluded", "Partial today"
for row in [
 ("Developer","No","70 / 82","`description` prose","The client's number-one Quick Fact.",ADD),
 ("Facilities (and which floor)","No","65 facilities / 21 with a floor","`description` prose",
  "Best-populated missing attribute — the data is already written down.",ADD),
 ("Maintenance fee (RM psf)","No","61 mention / 28 explicit `RM x psf`","`description` prose",
  "Named in the SOPs as a never-guess fact an agent must state correctly.",ADD),
 ("Furnishing + appliance brands","No","50 / 82","`description` prose","Own-stay differentiator.",ADD),
 ("Sizes by unit type code","No","31 / 82","`description` prose","Feeds the per-layout table.",ADD),
 ("Title type (e.g. Commercial / HDA)","No","25 / 82","`description` prose","Legal and financing relevance.",ADD),
 ("Booking fee / booking amounts","No","19–25 / 82","`description` prose",
  "The Reply Assistant is required to state it from inventory, not invent it.",ADD),
 ("Car parks / parking per layout","No","18 / 82","`description` prose","Buyer-critical in KL.",ADD),
 ("360° virtual tour link","Partial","9–18 / 82","`collateral.externalUrl`",
  "Already storable as collateral, but not typed as its own kind.",PART),
 ("Completion ('52 months from SPA')","No","7 / 82","`description` prose","Own-stay move-in fit.",ADD),
 ("Main contractor","No","4 / 82","`description` prose","Build-quality signal.",ADD),
 ("'Top N reasons to invest'","No","3 / 82","`description` prose","Investor pitch material.",ADD),
 ("Panel bankers","No","2 / 82","`description` prose","The financing SOP depends on it.",ADD),
 ("Billing / construction stage","No","2 / 82","`description` prose","Progress-payment stage.",ADD),
 ("VP target as 'Q4 2029'","Partial (`vpDate`)","2 / 82","`description` prose",
  "The field exists; the source rarely states a quarter.",PART),
 ("Margin of finance %","No","0 / 82","Client must supply","Financing SOP. Not in any write-up.",ADD),
 ("Developer company reg. no.","No","0 / 82","Client must supply","Not in any write-up.",ADD),
 ("Total units / phases","No","in source, dropped","`description` prose","Scarcity and scale context.",ADD),
 ("Land size","No","in source, dropped","`description` prose","Landed-property briefs need it.",ADD),
 ("Bathrooms","No","not tracked","Client must supply","Common client filter; no field, no source.",ADD),
 ("Property type (condo / landed / office)","No","only inferable from the name","Client must supply",
  "Agents query by type and there is nothing to filter on.",ADD),
 ("Malaysian state","No","not tracked","Client must supply",
  "Foreign-buyer price thresholds are set per state — a real eligibility risk.",ADD),
 ("Transport links (MRT / LRT)","No","inside `locationText` prose","Client must supply",
  "Named a high-value differentiator; only searchable as free text today.",ADD),
 ("School proximity","No","not tracked","Client must supply","Specified as an own-stay ranking factor; never built.",ADD),
 ("Nearby amenities","No","not tracked","Client must supply","Part of the lifestyle matching that was specified.",ADD),
 ("Rental yield / rental demand","No","not tracked","Client must supply",
  "Investment ranking is a proxy (VP status + price) because these were never built.",ADD),
 ("Units remaining","No","not tracked","Client must supply",
  "The SOPs forbid scarcity claims that cannot be verified — there is nothing to verify against.",ADD),
 ("Rebates / packages / incentives","No","not tracked","Client must supply",
  "The SOPs forbid inventing these; there is no field to confirm them against.",ADD),
 ("Unit-level Bumi / foreign eligibility","No","not tracked","Client must supply",
  "Only project-level booleans were built; the spec called for per-unit.",ADD),
 ("Launch date","No","not tracked","Client must supply","No field, no source.",ADD),
 ("Inventory freshness / last-verified date","No","n/a","System",
  "Specified as a staleness flag ('this data is 90 days old'); never built. No timestamps exist on the record.",ADD),
 ("Booking bank-in account details","No","2 / 82","—",
  "Account-number data. Keep OUT of the chat surface — PDPA.",DROP),
 ("Commission structure","No","not tracked","—","Listed as an explicit anti-feature for the AI.",DROP),
]: ws.append(list(row))
hdr(ws); widths(ws,[34,17,22,26,60,20]); box_all(ws)
for r in range(2, ws.max_row + 1):
    act = ws.cell(row=r, column=6).value
    ws.cell(row=r, column=6).fill = (FILL_ME if act == ADD else HAVE if act == PART else NA_FILL)
    ws.cell(row=r, column=1).font = BOLD

# ═══ 8. Data Traps ══════════════════════════════════════════════════════════
ws = wb.create_sheet("Data Traps")
ws.append(["#","Trap","Why it bites","What to do instead"])
for i, row in enumerate([
 ("`0` is the UNKNOWN sentinel, not a value",
  "On `priceValue` and `ProjectDoc.bedrooms`, 0 means 'not known'. It once made 36 unpriced projects "
  "sort as the cheapest stock in the inventory.",
  "Leave the cell blank rather than entering 0. (On a unit-type row, 0 bedrooms legitimately means a studio.)"),
 ("`tenure` may say the literal 'Unknown'",
  "The importer defaults `tenure` to the string \"Unknown\" when the write-up states none. The completeness "
  "check only tests for a non-empty string, so those rows count as PRESENT.",
  "Treat tenure as unverified everywhere. A green cell here does not mean the tenure is known."),
 ("`bedrooms` is the SMALLEST layout, not the largest",
  "11 of the 18 projects storing `bedrooms: 1` also sell 2–6 bedroom units. A 'Beds: 1' column is "
  "accurate-but-misleading.",
  "Supply the full layout range in the unit-type table, not just one number."),
 ("Never multiply a psf rate by a size to get a total",
  "This exact defect stored Luminar Residence Subang at RM360,000 from 'RM720 psf' on a write-up that "
  "said 'Prices below RM800K'. 21 of 51 stored prices were fabricated this way and have since been nulled.",
  "Record a psf rate as a psf rate. Leave the total blank."),
 ("Asking psf vs maintenance psf",
  "An asking rate is RM200–5,000 psf. A maintenance/sinking-fund rate is RM0.20–2.00 psf. They sit one "
  "line apart in most write-ups.",
  "Check the magnitude before entering either."),
 ("`priceBand` is never a client column",
  "It is computed from `priceValue`. Writing it by hand desynchronises it from the price.",
  "Supply `priceValue` only; the band follows."),
 ("There is no stable join key",
  "Project IDs are Firestore auto-IDs, and there are no created/updated timestamps on the record. "
  "Names are the only handle, and they drift ('Southpoint Residences (IGB )' has a trailing space).",
  "Do not rename a project in this sheet. If a name must change, flag it separately."),
 ("A green cell means 'a value exists', not 'it is correct'",
  "The upstream report measures presence only — it never reads the value.",
  "Spot-check the fields that matter most: price, bedrooms, tenure, eligibility."),
 ("`status: 'sold_out'` is never written",
  "No code path sets it; projects are only `active` or `hidden`. Sold-out stock is therefore "
  "indistinguishable from available stock.",
  "Tell us which projects are sold out — the system cannot currently represent it."),
], start=1):
    ws.append([i] + list(row))
hdr(ws); widths(ws,[4,40,66,62]); box_all(ws)
for r in range(2, ws.max_row + 1):
    ws.cell(row=r, column=2).font = BOLD

wb.save(OUT)
print(f"WROTE {OUT}")
print(f"  projects: {len(rows)}   sheets: {', '.join(wb.sheetnames)}")
