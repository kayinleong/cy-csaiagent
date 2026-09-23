#!/usr/bin/env python3
"""
quick-kayinleong-093 — stage 1: harvest candidate field lines from the Drive docs.

9.16M characters of brochures, price lists and floor plans is far too much to read
directly, and most of it is not field data. This pulls out only the lines that could
plausibly state one of the target fields, deduplicated and capped, so stage 2 can
read verbatim candidates instead of whole documents.

Nothing is decided here. Every emitted line is copied character-for-character from the
document, so a value accepted in stage 2 can always be traced back to real source text
-- the guard `to-inventory.ts` encodes as `priceEvidence`, and the one quick-088 found
missing when 21 of 51 stored prices turned out to be invented.

    uv run python harvest-candidates.py --kb <scratch>/kb-text.json \
        --skool <scratch>/skool/projects.json --out <scratch>/candidates.json
"""

import argparse
import json
import re
from collections import defaultdict

# field -> (pattern, needs a digit nearby). Deliberately broad: stage 2 discards,
# stage 1 must not miss.
PATTERNS = {
    "Tenure":            (r"\b(freehold|leasehold|pegangan bebas|pajakan)\b", False),
    "Land Title":        (r"\b(residential title|commercial title|hda|master title|strata title)\b", False),
    "Developer":         (r"\b(developer|pemaju|developed by|a project by)\b", False),
    "Land Size":         (r"\b(land (size|area)|site area|acres?|hektar|hectare)\b", True),
    "Total Units":       (r"\b(total (no\.? of )?units?|no\.? of units?|jumlah unit|units in total)\b", True),
    "Total Storeys":     (r"\b(stor(e|i)ys?|floors?|levels?|tingkat)\b", True),
    "Units Per Floor":   (r"\b(units? per floor|unit(s)?/floor|per level)\b", True),
    "Target Completion": (r"\b(vacant possession|\bvp\b|completion|expected completion|siap|handover|target completion)\b", True),
    "Built-up":          (r"\b(built[- ]?up|saiz|size|sq\.?\s?ft|sqft|square feet)\b", True),
    "Price":             (r"\brm\s?[\d,.]+\s?(mil|million|k\b|juta)?", True),
    "Price psf":         (r"\bpsf\b|per sq\.?\s?ft|/sq\.?\s?ft", True),
    "Maintenance Fee":   (r"\b(maintenance|service charge|sinking fund|caj penyelenggaraan)\b", True),
    "Booking Fee":       (r"\b(booking fee|earnest deposit|deposit tempahan)\b", True),
    "Car Parks":         (r"\b(car ?park|parking bay|parking lot|tempat letak kereta)\b", True),
    "Ceiling Height":    (r"\b(ceiling height|floor[- ]to[- ]ceiling|headroom)\b", True),
    "Bumi Quota":        (r"\b(bumi|bumiputera|bumiputra)\b", False),
    "Foreign Eligible":  (r"\b(foreign(er)?s?|mm2h|non[- ]?malaysian|expatriate)\b", False),
    "Furnishing":        (r"\b(fully furnished|partly furnished|part(ial)? furnish|bare unit|unfurnished)\b", False),
    "Panel Banks":       (r"\b(panel bank|end financ|margin of financ|loan margin)\b", False),
    "Facilities":        (r"\b(facilit|swimming pool|gymnasium|clubhouse|kemudahan)\b", False),
}
COMPILED = {k: (re.compile(p, re.I), d) for k, (p, d) in PATTERNS.items()}
HAS_DIGIT = re.compile(r"\d")
MAX_PER_FIELD = 10
MAX_LINE = 320


def tidy(line):
    return re.sub(r"\s+", " ", line).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kb", required=True)
    ap.add_argument("--skool", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--include-whatsapp", action="store_true")
    args = ap.parse_args()

    names = [p["titleClean"] for p in json.load(open(args.skool))["projects"]]
    nset = set(names)
    kb = [d for d in json.load(open(args.kb))["docs"] if d["chars"] > 0]

    by_project = defaultdict(list)
    for d in kb:
        if d["project"] == "WhatsApp":
            if args.include_whatsapp and d["fileName"] in nset:
                by_project[d["fileName"]].append(d)
        elif d["project"] in nset:
            by_project[d["project"]].append(d)

    out = {}
    stats = defaultdict(int)
    for project, docs in by_project.items():
        found = defaultdict(list)
        seen = defaultdict(set)
        for d in docs:
            for raw in d["text"].splitlines():
                line = tidy(raw)
                if not (8 <= len(line) <= MAX_LINE):
                    continue
                for field, (rx, needs_digit) in COMPILED.items():
                    if len(found[field]) >= MAX_PER_FIELD:
                        continue
                    if needs_digit and not HAS_DIGIT.search(line):
                        continue
                    if not rx.search(line):
                        continue
                    key = line.lower()
                    if key in seen[field]:
                        continue
                    seen[field].add(key)
                    found[field].append({"doc": d["fileName"], "ocr": d["ocr"], "line": line})
        out[project] = {k: v for k, v in found.items() if v}
        for k, v in out[project].items():
            stats[k] += len(v)

    json.dump({"projects": out}, open(args.out, "w"), indent=1)
    total = sum(stats.values())
    chars = sum(len(c["line"]) for p in out.values() for v in p.values() for c in v)
    print(f"[harvest] {len(out)} projects, {total} candidate lines, {chars:,} chars "
          f"(from {sum(d['chars'] for v in by_project.values() for d in v):,})")
    for k in PATTERNS:
        cov = sum(1 for p in out.values() if p.get(k))
        print(f"   {k:20s} {stats[k]:>5} lines   {cov:>3}/{len(out)} projects")


if __name__ == "__main__":
    main()
