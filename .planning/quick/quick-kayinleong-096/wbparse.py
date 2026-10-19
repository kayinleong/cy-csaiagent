"""Pure parsing and gating functions for the client workbook (quick-kayinleong-096, stage 1).

Everything here is a pure function over plain values: no file access, no printing.
Both build-client-sheet.py and verify-client-sheet.py import it, so the verifier
exercises the very same code that built the committed files.

The workbook is untrusted input. No function here ever returns or logs a Developer
cell; the scanner returns class names only.

Python 3.9: no match statements, no X | Y unions.
"""
import re
import unicodedata
from decimal import Decimal, ROUND_HALF_UP

IMPORT_YEAR = 2026
SOURCE_LABEL = "D2 project info sheet supplied by the client, 19 October 2026"
PARTIAL_PREFIX = "Hill 4 · "  # "Hill 4" + space + U+00B7 + space
SQFT_PER_SQM = 10.7639

SHEET1_HEADINGS = [
    "TOP PROJECTS IN 2026 TO CROSS-SELL",
    "TOP PERFORMING PROJECTS IN 2026",
    "HIGH COMM 8% OR > RM100K COMMISSION MAIN CONTRIBUTORS",
    "RM3MIL TO RM6MIL TO RM16MIL BECAME A NORM TO D2 CLOSERS",
    "HIGH TICKET SUBSALE",
]

# ---------------------------------------------------------------- text helpers


def collapse(text):
    """Whitespace-collapse a cell: newlines and runs of spaces become one space."""
    if text is None:
        return ""
    if not isinstance(text, str):
        text = str(text)
    return re.sub(r"\s+", " ", text).strip()


# ----------------------------------------------------------- contact scanner

_SCAN = [
    ("email", [re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.I)]),
    ("url", [
        re.compile(r"https?://\S+", re.I),
        re.compile(r"\bwww\.\S+", re.I),
        re.compile(r"\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|my|net|org|io|co|biz|info|asia)(?:\.[a-z]{2})?\b", re.I),
    ]),
    ("wa.me", [re.compile(r"\bwa\.me\b", re.I)]),
    ("phone", [
        re.compile(r"(?<![0-9A-Za-z,.])\+?\d(?:[ -]?\d){8,12}(?![0-9A-Za-z,])", re.I),
        re.compile(r"\(0\d{1,2}\)\s?\d{3,4}[ -]?\d{4}", re.I),
    ]),
    ("ic", [re.compile(r"(?<!\d)\d{6}-\d{2}-\d{4}(?!\d)", re.I)]),
]


def scan_contact_details(text):
    """Return the class names (never the matched text) of contact details found in text."""
    if not text:
        return []
    found = []
    for name, patterns in _SCAN:
        for p in patterns:
            if p.search(text):
                found.append(name)
                break
    return found


# ------------------------------------------------------------ fact cleaning

_INJECTION = re.compile(
    r"ignore (?:all |any )?(?:previous|prior|above) instructions|system prompt|"
    r"disregard (?:the )?(?:above|previous)|you are now",
    re.I,
)


def injection_hit(text):
    return bool(text and _INJECTION.search(text))


def clean_fact(text, table_cell=False):
    """Strip control characters and angle brackets, collapse whitespace.

    A newline, tab or no-break space becomes a space (so words do not fuse); other
    control and format characters are removed. In a table cell a pipe becomes a slash.
    """
    if text is None:
        return ""
    s = text if isinstance(text, str) else str(text)
    s = s.replace("<", "").replace(">", "")
    out = []
    for ch in s:
        cat = unicodedata.category(ch)
        if ch in "\n\r\t\xa0  " or cat == "Zs":
            out.append(" ")
        elif cat in ("Cc", "Cf"):
            continue
        else:
            out.append(ch)
    s = re.sub(r" +", " ", "".join(out)).strip()
    if table_cell:
        s = s.replace("|", "/")
    return s


def clean_heading(text):
    """Fact-sheet rendering of a Sheet1 heading. A greater-than sign carries meaning
    there ("8% OR > RM100K"), so it becomes words rather than being stripped."""
    s = (text or "").replace(">", " more than ").replace("<", " less than ")
    return clean_fact(s)


def scrub_developer(text):
    """Drop every line that hits the contact scanner. Returns (text, removed_count).

    Remaining lines are cleaned and joined with " / ". Empty lines are not counted.
    The removed text is never returned.
    """
    if text is None:
        return "", 0
    kept = []
    removed = 0
    for line in str(text).splitlines():
        if not line.strip():
            continue
        if scan_contact_details(line):
            removed += 1
            continue
        c = clean_fact(line)
        if c:
            kept.append(c)
    joined = " / ".join(kept)
    # backstop: a contact detail split across lines can only show up after joining
    if scan_contact_details(joined):
        return "", removed + len(kept)
    return joined, removed


# ---------------------------------------------------------------- unit parsing

_LABEL_TYPE = re.compile(r"Type\s+[A-Z][A-Za-z0-9]*(?:-[A-Z0-9]+)?(?:\s*&\s*[A-Z][A-Za-z0-9]*)?")
_LABEL_CODE = re.compile(r"[A-Z]{1,3}\d+[a-z]?")
_NUM = r"(\d{1,3}(?:,\d{3})+|\d+)"
_SQFT_UNIT = r"(?:sq\.?\s*ft\.?|sqft|sft|sf)"
_SIZE_RE = re.compile(r"(?<![\d,])" + _NUM + r"\s*" + _SQFT_UNIT + r"(?![a-z])", re.I)
_BU_RE = re.compile(r"\bBU\s*" + _NUM + r"\s*" + _SQFT_UNIT + r"(?![a-z])", re.I)
_BU_WORD = re.compile(r"\bBU\b", re.I)
_SQM_RE = re.compile(r"(?<![\d,])" + _NUM + r"\s*sq\.?\s*m(?![a-z])", re.I)


def parse_label(size_text):
    """Unit label from a Size cell, or None when the row has no label."""
    t = (size_text or "").strip()
    m = _LABEL_TYPE.match(t) or _LABEL_CODE.match(t)
    if not m:
        return None
    return re.sub(r"\s+", " ", re.sub(r"\s*&\s*", " & ", m.group(0)))


def _int(num_text):
    return int(num_text.replace(",", ""))


def parse_size(size_text):
    """Size cell -> (sizeSqft or None, hold reason or None, parsed number or None).

    BU (built-up) wins when present; LA (land area) is never a size. A sqm figure
    that disagrees with the sqft figure by more than 3% holds the size. The parsed
    number is returned even when held, for the DC Residensi cross-check only.
    """
    t = size_text or ""
    m = None
    if _BU_WORD.search(t):
        m = _BU_RE.search(t)
    if m is None:
        m = _SIZE_RE.search(t)
    if m is None:
        return None, "the size could not be read as a number of square feet", None
    sqft = _int(m.group(1))
    sq = _SQM_RE.search(t)
    if sq:
        sqm = _int(sq.group(1))
        if sqm > 0 and abs(sqft / SQFT_PER_SQM - sqm) / sqm > 0.03:
            return None, (
                "sqft and sqm disagree by more than 3%% (%s sqft is %d sqm, the sheet says %d)"
                % (format(sqft, ","), int(round(sqft / SQFT_PER_SQM)), sqm)
            ), sqft
    if sqft < 100 or sqft > 30000:
        return None, "the size is outside 100 to 30,000 sqft", sqft
    return sqft, None, sqft


_STUDIO = re.compile(r"^\s*studio\b", re.I)
_BEDS = re.compile(r"^\s*(\d{1,2})\s*(?:\+\s*\d\s*)*bed", re.I)


def parse_rooms(text):
    """Rooms cell -> bedrooms (0 for a studio) or None. The "+N" never counts."""
    t = text or ""
    if _STUDIO.search(t):
        return 0
    m = _BEDS.search(t)
    return int(m.group(1)) if m else None


def rooms_layout_code(text):
    """Layout code used only for the DC Residensi brochure cross-check: N then
    "+1" once per "+ digit" group before the first comma. "2 Bedroom + 1" -> 2BR+1."""
    head = (text or "").split(",")[0]
    m = _BEDS.search(head)
    if not m:
        return None
    plus = len(re.findall(r"\+\s*\d", head))
    return "%dBR%s" % (int(m.group(1)), "+1" * plus)


# --------------------------------------------------------------- price parsing

_AMOUNT = r"(?:rm\s*)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(mil|m|k)?"
_TOTAL_RE = re.compile(r"^" + _AMOUNT + r"(?:-" + _AMOUNT + r")?$")
_PSF_RE = re.compile(r"^(?:from\s+)?(?:rm\s*)?(\d[\d,]*)\s*psf$")
_BARE_RE = re.compile(r"^\d[\d,]*(?:\.\d+)?$")
_MULT = {"mil": Decimal(1000000), "m": Decimal(1000000), "k": Decimal(1000), None: Decimal(1)}


def _money(num, suffix):
    v = Decimal(num.replace(",", "")) * _MULT[suffix]
    return int(v.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def classify_price_cell(cell):
    """Price cell -> (kind, lo, hi, reason).

    kind: blank | sold_out | tbc | psf | psf_held | total | ambiguous | unparseable.
    psf carries the rate in lo and hi. A held kind has lo and hi None.
    """
    if cell is None:
        return ("blank", None, None, None)
    if not isinstance(cell, str):
        return ("ambiguous", None, None, "a bare number with no unit (it could be a price per square foot or a total)")
    s = collapse(cell).lower()
    if not s:
        return ("blank", None, None, None)
    s = s.replace("–", "-").replace("—", "-")
    s = re.sub(r"\s*-\s*", "-", s)
    if re.fullmatch(r"sold\s*out", s):
        return ("sold_out", None, None, None)
    if s == "tbc":
        return ("tbc", None, None, "the price is marked TBC")
    m = _PSF_RE.match(s)
    if m:
        v = _int(m.group(1))
        if 200 <= v <= 5000:
            return ("psf", v, v, None)
        return ("psf_held", None, None, "the price per square foot is outside RM200 to RM5,000")
    if _BARE_RE.match(s):
        try:
            if Decimal(s.replace(",", "")) < 10000:
                return ("ambiguous", None, None,
                        "a bare number with no unit (it could be a price per square foot or a total)")
        except Exception:
            pass
    m = _TOTAL_RE.match(s)
    if not m:
        return ("unparseable", None, None, "the price could not be read as an amount of money")
    n1, s1, n2, s2 = m.group(1), m.group(2), m.group(3), m.group(4)
    if n2 is not None and (s1 is None) != (s2 is None):
        return ("unparseable", None, None, "the two ends of the price range are written differently")
    lo = _money(n1, s1)
    hi = _money(n2, s2) if n2 is not None else lo
    if lo < 50000 or hi > 100000000 or lo > hi:
        return ("unparseable", None, None, "the price is outside the plausible range or the range is reversed")
    return ("total", lo, hi, None)


def build_unit(row, size_cell, rooms_cell, nett_cell, gross_cell):
    """Build one unit from the four unit cells.

    Returns (unit, held_info, cells) or (None, held_info, cells) when the row has no label.
    unit: the Contract 1 unit dict (key order exact).
    held_info: list of {column, sheetText, reason} for every held cell.
    cells: the whitespace-collapsed cell texts, for the fact-sheet table (not in the JSON).
    """
    size_t = collapse(size_cell)
    rooms_t = collapse(rooms_cell)
    nett_t = collapse(nett_cell)
    gross_t = collapse(gross_cell)
    cells = {"size": size_t, "rooms": rooms_t, "nett": nett_t, "gross": gross_t}
    held_info = []
    label = parse_label(size_t)
    if label is None:
        held_info.append({"column": "Size", "sheetText": size_t or None,
                          "reason": "the row has no unit label (Type or code)"})
        return None, held_info, cells

    sqft, size_reason, size_num = parse_size(size_t)
    held = set()
    if size_reason:
        held.add("Size")
        held_info.append({"column": "Size", "sheetText": size_t, "reason": size_reason})
    bedrooms = parse_rooms(rooms_t)

    nk, nlo, nhi, nreason = classify_price_cell(nett_cell)
    gk, glo, ghi, greason = classify_price_cell(gross_cell)
    sold_out = nk == "sold_out" or gk == "sold_out"

    nett_min = nett_max = gross_min = gross_max = psf = None
    if not sold_out:
        if nk == "total":
            nett_min, nett_max = nlo, nhi
        elif nk != "blank":
            held.add("Nett")
            held_info.append({"column": "Nett", "sheetText": nett_t,
                              "reason": nreason or "a price per square foot in the nett column"})
        if gk == "total":
            gross_min, gross_max = glo, ghi
        elif gk == "psf":
            psf = glo
        elif gk != "blank":
            held.add("Gross")
            held_info.append({"column": "Gross", "sheetText": gross_t, "reason": greason})
        if nett_min is not None and gross_min is not None and (gross_min < nett_min or gross_max < nett_max):
            nett_min = nett_max = gross_min = gross_max = None
            for col, txt in (("Nett", nett_t), ("Gross", gross_t)):
                held.add(col)
                held_info.append({"column": col, "sheetText": txt, "reason": "the gross price is lower than the nett price"})

    pieces = []
    pieces.append(("%s: size not confirmed" % label) if "Size" in held else size_t)
    if rooms_t:
        pieces.append(rooms_t)
    if nett_t:
        pieces.append("Nett: TBC" if nk == "tbc" else ("Nett not confirmed" if "Nett" in held else "Nett: " + nett_t))
    if gross_t:
        pieces.append("Gross: TBC" if gk == "tbc" else ("Gross not confirmed" if "Gross" in held else "Gross: " + gross_t))
    raw = " | ".join(p for p in pieces if p)

    unit = {
        "sheetRow": row,
        "label": label,
        "sizeSqft": sqft,
        "bedrooms": bedrooms,
        "nettMinRM": nett_min,
        "nettMaxRM": nett_max,
        "grossMinRM": gross_min,
        "grossMaxRM": gross_max,
        "psfRM": psf,
        "soldOut": bool(sold_out),
        "raw": raw,
        "held": [c for c in ("Size", "Rooms", "Nett", "Gross") if c in held],
    }
    cells["size_num"] = size_num
    return unit, held_info, cells


# ------------------------------------------------------ tenure and completion


def normalise_tenure(cell):
    """Tenure cell -> (value or None, hold reason or None, column_shift bool)."""
    t = collapse(cell)
    if not t:
        return None, None, False
    low = t.lower()
    if re.search(r"\bunits?\b", low):
        return None, "the cell holds a count of units, so the columns look shifted for this row", True
    has_free = "freehold" in low
    has_lease = "leasehold" in low
    if low.startswith("freehold") and not has_lease:
        return "Freehold", None, False
    if has_lease and not has_free:
        years = set(re.findall(r"\b(20[5-9]\d|21\d\d|2200)\b", t))
        if len(years) == 1:
            return "Leasehold " + next(iter(years)), None, False
        return "Leasehold", None, False
    return None, "not a tenure value (the cell says something else)", False


_COMPLETION_LABEL = re.compile(r"^\s*(?:completion\s*/\s*vp|completion|vp)\s*date\s*:?", re.I)
_YEARS = re.compile(r"\b(199\d|20\d\d|2100)\b")
_MARKER = re.compile(r"\bcompleted\b|ready to move in", re.I)
_EXPECT = re.compile(r"target|estimat|\best\.|planned|expected|anticipat|tentative|phase|from spa|months", re.I)


def classify_completion(text, import_year=IMPORT_YEAR):
    """Completion cell -> (kind or None, year or None). None kind means blank.

    kind: completed_year | completed_no_year | future_or_expected | ambiguous.
    year is an integer only for completed_year.
    """
    t = collapse(text)
    t = _COMPLETION_LABEL.sub("", t, count=1).strip()
    if not t:
        return None, None
    years = sorted(set(int(y) for y in _YEARS.findall(t)))
    marker = bool(_MARKER.search(t))
    expect = bool(_EXPECT.search(t))
    if marker and not years:
        return "completed_no_year", None
    if len(years) > 1:
        return "ambiguous", None
    if len(years) == 1:
        y = years[0]
        if expect:
            return ("future_or_expected", None) if y >= import_year else ("ambiguous", None)
        return ("completed_year", y) if y < import_year else ("future_or_expected", None)
    return "ambiguous", None


# ----------------------------------------------------------------- fact gates

FACT_COLUMNS = [
    # (json key, sheet header as reported, 0-based Raw Data column)
    ("area", "Area", 5),
    ("developer", "Developer", 6),
    ("landTitle", "Land Title", 7),
    ("maintenanceFee", "Maintenance Fee", 8),
    ("tenure", "Tenure", 9),
    ("totalUnits", "Total Units", 10),
    ("floors", "Total Floors/Storeys", 11),
    ("completion", "Expected Completion/Vacant Possession (VP)", 12),
    ("topReasons", "Top Reasons Why", 13),
    ("furnishing", "Furnishing", 14),
    ("carPark", "Car Park Allocation", 15),
]
FACT_HEADER = dict((k, h) for k, h, _ in FACT_COLUMNS)
_FEE_OK = re.compile(r"rm|psf|tbc|per\s*sq", re.I)


def gate_fact(key, raw):
    """Gate one project-level fact cell. Returns (value or None, hold reason or None).

    A blank cell is (None, None). The developer cell is not handled here (see
    scrub_developer); tenure column-shift logic lives in the caller.
    """
    if raw is None:
        return None, None
    if isinstance(raw, str) and not raw.strip():
        return None, None
    if not isinstance(raw, str):
        if key in ("totalUnits", "floors") and isinstance(raw, (int, float)):
            f = float(raw)
            return (str(int(f)) if f.is_integer() else str(raw)), None
        shown = str(int(raw)) if isinstance(raw, float) and raw.is_integer() else str(raw)
        return None, "the cell holds the number %s, not text" % shown
    if key == "topReasons":
        lines = []
        for ln in raw.splitlines():
            c = re.sub(r"^#+\s*", "", clean_fact(ln))
            if c:
                lines.append(c)
        value = "\n".join(lines)
    else:
        value = clean_fact(raw)
    if not value:
        return None, None
    if len(value) > 2000:
        return None, "longer than 2,000 characters"
    if injection_hit(value):
        return None, "contains instruction-like text"
    hits = scan_contact_details(value)
    if hits:
        return None, "contains contact details (%s)" % ", ".join(hits)
    if key == "maintenanceFee" and not _FEE_OK.search(value):
        return None, "not a fee amount"
    if key in ("totalUnits", "floors") and not re.search(r"\d", value):
        return None, "no number in the cell"
    return value, None


# ------------------------------------------------------------------ PII gate


def pii_gate(texts):
    """texts: dict of name -> string. Returns a list of (name, [classes]) for every hit."""
    bad = []
    for name in sorted(texts):
        hits = scan_contact_details(texts[name])
        if hits:
            bad.append((name, hits))
    return bad


def iter_strings(obj):
    """Yield every string value in a JSON-like structure."""
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            for s in iter_strings(v):
                yield s
    elif isinstance(obj, list):
        for v in obj:
            for s in iter_strings(v):
                yield s


_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def scan_json_strings(obj):
    """Contact classes found in any string under obj (hex digests are skipped)."""
    classes = set()
    for s in iter_strings(obj):
        if _HEX64.match(s):
            continue
        for c in scan_contact_details(s):
            classes.add(c)
    return sorted(classes)


# ---------------------------------------------------------------- mapping


class MappingError(Exception):
    pass


def resolve_names(sheet_names, export_by_name, variants, sheet1_aliases, skipped_new):
    """Resolve Raw Data names to inventory records. No fuzzy matching.

    Returns (resolved, skipped) where resolved is a list of
    (sheet_name, inventory_name, matched_by) and skipped a list of names.
    An unmatched name that is not in the reviewed tables raises MappingError
    listing the names.
    """
    resolved = []
    skipped = []
    unmatched = []
    for name in sheet_names:
        if name in export_by_name:
            resolved.append((name, name, "exact"))
        elif name in variants:
            if variants[name] not in export_by_name:
                unmatched.append(name)
            else:
                resolved.append((name, variants[name], "variant"))
        elif name in skipped_new:
            skipped.append(name)
        else:
            unmatched.append(name)
    if unmatched:
        raise MappingError("unmatched project names (not in the reviewed tables): " + "; ".join(unmatched))
    return resolved, skipped


# -------------------------------------------------------------- invariants

TENURE_RE = re.compile(r"^(Freehold|Leasehold( \d{4})?)$")
COMPLETION_KINDS = ("completed_year", "completed_no_year", "future_or_expected", "ambiguous")


def _in_int(v, lo, hi):
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def check_invariants(doc):
    """Contract 1 invariants 1-10 over a loaded document. Returns a list of violation
    strings that name the project and unit, never a cell text."""
    errs = []
    for p in doc.get("projects", []):
        pid = "%s" % p.get("inventoryName")
        units = p.get("units", [])
        mode = p.get("unitMode")
        prefix = p.get("labelPrefix")
        # 8
        if mode not in ("merge", "partial", "none"):
            errs.append("%s: unitMode invalid (8)" % pid)
        if mode == "merge" and prefix != "":
            errs.append("%s: merge needs an empty labelPrefix (8)" % pid)
        if mode == "partial" and prefix != PARTIAL_PREFIX:
            errs.append("%s: partial needs the Hill 4 prefix (8)" % pid)
        if mode == "none" and (units or prefix != ""):
            errs.append("%s: none needs no units and an empty prefix (8)" % pid)
        if mode in ("merge", "partial") and not units:
            errs.append("%s: %s needs at least one unit (8)" % (pid, mode))
        for u in units:
            tag = "%s / %s" % (pid, u.get("label"))
            if not u.get("label") or not u.get("raw"):
                errs.append("%s: label and raw must be non-empty (1)" % tag)
            s = u.get("sizeSqft")
            if s is not None and not _in_int(s, 100, 30000):
                errs.append("%s: sizeSqft out of range (2)" % tag)
            b = u.get("bedrooms")
            if b is not None and not _in_int(b, 0, 10):
                errs.append("%s: bedrooms out of range (3)" % tag)
            for kind, lo_k, hi_k in (("nett", "nettMinRM", "nettMaxRM"), ("gross", "grossMinRM", "grossMaxRM")):
                lo, hi = u.get(lo_k), u.get(hi_k)
                if (lo is None) != (hi is None):
                    errs.append("%s: %s must be both null or both set (4)" % (tag, kind))
                elif lo is not None:
                    if not (_in_int(lo, 50000, 100000000) and _in_int(hi, 50000, 100000000)):
                        errs.append("%s: %s out of range (4)" % (tag, kind))
                    elif lo > hi:
                        errs.append("%s: %s min above max (4)" % (tag, kind))
            if u.get("nettMinRM") is not None and u.get("grossMinRM") is not None:
                if u["grossMinRM"] < u["nettMinRM"] or u["grossMaxRM"] < u["nettMaxRM"]:
                    errs.append("%s: gross below nett (5)" % tag)
            f = u.get("psfRM")
            if f is not None and not _in_int(f, 200, 5000):
                errs.append("%s: psfRM out of range (6)" % tag)
            if u.get("soldOut") is True:
                if any(u.get(k) is not None for k in
                       ("nettMinRM", "nettMaxRM", "grossMinRM", "grossMaxRM", "psfRM")):
                    errs.append("%s: soldOut with a price (7)" % tag)
        # 9
        t = p.get("tenure")
        if t is not None and not (isinstance(t, str) and TENURE_RE.match(t)):
            errs.append("%s: tenure invalid (9)" % pid)
        c = p.get("completion")
        if c is not None:
            kind = c.get("kind") if isinstance(c, dict) else None
            yr = c.get("year") if isinstance(c, dict) else None
            if kind not in COMPLETION_KINDS:
                errs.append("%s: completion kind invalid (9)" % pid)
            elif kind == "completed_year":
                if not (isinstance(yr, int) and not isinstance(yr, bool) and yr < IMPORT_YEAR):
                    errs.append("%s: completed_year needs a year before %d (9)" % (pid, IMPORT_YEAR))
            elif yr is not None:
                errs.append("%s: only completed_year may carry a year (9)" % pid)
    # 10
    for part in ("projects", "skipped", "heldBack", "conflicts"):
        cls = scan_json_strings(doc.get(part, []))
        if cls:
            errs.append("%s: contact detail class %s found (10)" % (part, ",".join(cls)))
    return errs
