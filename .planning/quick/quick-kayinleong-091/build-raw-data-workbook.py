#!/usr/bin/env python3
"""
quick-kayinleong-091 — Skool scrape -> single-tab "Raw Data" workbook.

Reads the raw `projects.json` produced by `scripts/scrape-skool/scrape.ts` and
emits an .xlsx with exactly ONE sheet, `Raw Data`: one row per property, one
column per field, values copied verbatim from the Skool write-up.

The D2 write-ups are semi-structured -- `Label: value` lines, sometimes with the
value on the following line(s). So the field set is DISCOVERED from the source
rather than imposed by a schema: every distinct label seen across all projects
becomes a column. Nothing is inferred, normalised, or explained.

    uv run --with openpyxl python .planning/quick/quick-kayinleong-091/build-raw-data-workbook.py \
        --in <scrape>/projects.json --out D2-Property-Raw-Data.xlsx
"""

import argparse
import json
import re
from collections import Counter, OrderedDict

# A label line: optional emoji/bullet junk, then a short-ish caption, then ":".
LABEL_RE = re.compile(
    r"^[\s•\-\*▪●]*"          # leading bullets/space
    r"[\U0001F300-\U0001FAFF☀-➿️←-⇿]*\s*"  # leading emoji
    r"(?P<label>[A-Za-z][^:\n]{0,60}?)"      # the caption itself
    r"\s*:\s*"
    r"(?P<rest>.*)$"
)

# Captions that are really URL schemes / times, not field labels.
NOT_A_LABEL = {"http", "https", "ftp", "mailto", "tel", "www"}


def looks_like_label(caption: str) -> bool:
    """Keep captions that read like a field name, not a sentence fragment."""
    c = caption.strip()
    if not c or c.lower() in NOT_A_LABEL:
        return False
    if len(c) > 60:
        return False
    # "Daily 9" / "5" -- a time like 9:00 splits into a numeric caption.
    if not re.search(r"[A-Za-z]", c):
        return False
    # A field name is a few words, not prose.
    if len(c.split()) > 7:
        return False
    # Sentences that happen to contain a colon usually end with punctuation.
    if c.endswith((".", "!", "?")):
        return False
    return True


def clean_label(caption: str) -> str:
    return re.sub(r"\s+", " ", caption).strip()


def parse_fields(text: str) -> "OrderedDict[str, str]":
    """Split a write-up into {label: verbatim value}.

    A label's value is the remainder of its own line plus every following line
    until the next label. Repeated labels are joined rather than overwritten so
    no source content is silently dropped.
    """
    fields: "OrderedDict[str, list]" = OrderedDict()
    current = None
    buf: list = []

    def flush():
        if current is None:
            return
        value = "\n".join(buf).strip()
        fields.setdefault(current, []).append(value)

    for raw_line in (text or "").splitlines():
        line = raw_line.rstrip()
        m = LABEL_RE.match(line)
        if m and looks_like_label(m.group("label")):
            flush()
            current = clean_label(m.group("label"))
            buf = [m.group("rest").strip()] if m.group("rest").strip() else []
        else:
            if line.strip():
                buf.append(line.strip())
    flush()

    out: "OrderedDict[str, str]" = OrderedDict()
    for k, vals in fields.items():
        joined = "\n".join(v for v in vals if v).strip()
        out[k] = joined
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--min-count", type=int, default=2,
                    help="labels seen in fewer than this many projects go to the overflow column")
    ap.add_argument("--diagnose", action="store_true", help="print field stats and exit")
    args = ap.parse_args()

    with open(args.src) as fh:
        data = json.load(fh)
    projects = data["projects"]

    parsed = []
    for p in projects:
        parsed.append((p, parse_fields(p.get("body", {}).get("text", ""))))

    # Merge labels that differ only by case/spacing ("Project co-leader" vs
    # "Project Co-leader"). Purely cosmetic collapsing -- labels that differ in
    # WORDING ("Tenure" vs "Land Tenure") stay separate, since deciding they mean
    # the same thing would be interpretation, and this sheet is meant to be raw.
    casing = {}
    for _, f in parsed:
        for lab in f:
            casing.setdefault(lab.lower(), Counter())[lab] += 1
    canon = {k: v.most_common(1)[0][0] for k, v in casing.items()}
    parsed = [
        (p, OrderedDict((canon[lab.lower()], val) for lab, val in f.items()))
        for p, f in parsed
    ]

    counts = Counter()
    for _, f in parsed:
        counts.update(f.keys())

    if args.diagnose:
        print(f"projects: {len(projects)}   distinct labels: {len(counts)}")
        print(f"labels in >={args.min_count} projects: "
              f"{sum(1 for _, c in counts.items() if c >= args.min_count)}")
        for label, c in counts.most_common():
            print(f"{c:4d}  {label}")
        return

    common = [lab for lab, c in counts.most_common() if c >= args.min_count]
    rare = {lab for lab, c in counts.items() if c < args.min_count}

    # Scrape-level columns first, then discovered fields by how often they occur.
    meta_cols = [
        "Project", "Section", "Heat", "Skool ID", "Skool URL",
        "Video Link", "Video Thumbnail",
        "Attachment Count", "Attachment Names", "Attachment URLs",
        "Body Links", "Full Write-up",
    ]
    # Some write-ups carry a literal "Project:" line, which would collide with the
    # scrape-level "Project" column and silently overwrite it. Give any colliding
    # discovered label its own distinct header instead of dropping either one.
    taken = {m.lower() for m in meta_cols}
    col_of = {lab: (f"{lab} (write-up field)" if lab.lower() in taken else lab)
              for lab in common}
    headers = meta_cols + [col_of[lab] for lab in common] + (
        ["Additional Fields"] if rare else [])

    rows = []
    for p, f in parsed:
        atts = p.get("attachments", [])
        links = p.get("body", {}).get("links", [])
        video = p.get("video") or {}
        row = {
            "Project": p.get("titleClean", ""),
            "Section": p.get("section", ""),
            "Heat": p.get("heat", 0),
            "Skool ID": p.get("id", ""),
            "Skool URL": p.get("url", ""),
            "Video Link": video.get("link", "") if video else "",
            "Video Thumbnail": video.get("thumbnail", "") if video else "",
            "Attachment Count": len(atts),
            "Attachment Names": "\n".join(
                a.get("fileName") or a.get("label") or a.get("url", "") for a in atts),
            "Attachment URLs": "\n".join(a.get("url", "") for a in atts),
            "Body Links": "\n".join(f'{l.get("text","")} -> {l.get("href","")}' for l in links),
            "Full Write-up": p.get("body", {}).get("text", ""),
        }
        for lab in common:
            row[col_of[lab]] = f.get(lab, "")
        if rare:
            extra = [f"{k}: {v}" for k, v in f.items() if k in rare]
            row["Additional Fields"] = "\n".join(extra)
        rows.append(row)

    write_xlsx(args.out, headers, rows)
    print(f"[raw] {len(rows)} properties x {len(headers)} columns -> {args.out}")
    print(f"[raw] discovered {len(counts)} distinct field labels "
          f"({len(common)} as columns, {len(rare)} in Additional Fields)")


def write_xlsx(path, headers, rows):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = "Raw Data"

    head_fill = PatternFill("solid", fgColor="1F3864")
    head_font = Font(bold=True, color="FFFFFF", size=10)
    ws.append(headers)
    for i in range(1, len(headers) + 1):
        c = ws.cell(row=1, column=i)
        c.fill = head_fill
        c.font = head_font
        c.alignment = Alignment(vertical="center", wrap_text=True)

    for r in rows:
        ws.append([r.get(h, "") for h in headers])

    for i, h in enumerate(headers, start=1):
        letter = get_column_letter(i)
        longest = max([len(str(h))] + [len(str(r.get(h, "")).split("\n")[0]) for r in rows] or [10])
        ws.column_dimensions[letter].width = min(max(12, longest + 2), 52)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)

    ws.freeze_panes = "B2"
    ws.auto_filter.ref = (
        f"A1:{get_column_letter(len(headers))}{len(rows) + 1}")
    wb.save(path)


if __name__ == "__main__":
    main()
