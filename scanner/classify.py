"""Turn each city's raw labels into one shared vocabulary, and assign segments.

Everything here is a small pure function, so tests can feed in made-up rows.
The raw label always travels next to the normalized one, because outreach
quotes the city's exact words.
"""

import html
import re


class UnknownLabel(ValueError):
    """A status string we have never seen. The build stops, so a new label
    from the city can't be quietly misfiled."""


# ---- filing status -------------------------------------------------------

LA_STATUS = {"COMPLIED": "complied", "NOT COMPLIED": "not_complied"}

SF_STATUS = {
    "Complied": "complied",
    "Violation - Did Not Report": "did_not_report",
    "Violation - Insufficient Data": "insufficient_data",
    "Exempt": "exempt",
    # Labels seen only in old years (2017-2020). See DRIFT.md item 7.
    "Data Not Verified": "other",
    "Upcoming": "other",
    "Pending - Submitted": "other",
}

NON_COMPLIANT = {"not_complied", "did_not_report", "insufficient_data"}


def la_status(raw: str) -> str:
    if raw not in LA_STATUS:
        raise UnknownLabel(f"LA compliance {raw!r}")
    return LA_STATUS[raw]


def sf_status(raw: str, year: int) -> str:
    """SF labels start with the year, e.g. '2025 - Violation - Did Not Report'."""
    prefix = f"{year} - "
    if not raw.startswith(prefix):
        raise UnknownLabel(f"SF benchmark_status {raw!r} does not start with {prefix!r}")
    rest = raw[len(prefix):]
    if rest not in SF_STATUS:
        raise UnknownLabel(f"SF benchmark_status {raw!r}")
    return SF_STATUS[rest]


# ---- history segments -------------------------------------------------------

def history_segment(statuses: dict[int, str], year: int) -> str | None:
    """lapsed / chronic / other for a building that is non-compliant in `year`.

    lapsed:  non-compliant this year, complied last year.
    chronic: non-compliant this year and both years before.
    other:   non-compliant this year, any other history (including no row).
    Returns None when the building is compliant, exempt, or absent this year.
    """
    if statuses.get(year) not in NON_COMPLIANT:
        return None
    last_year = statuses.get(year - 1)
    if last_year == "complied":
        return "lapsed"
    if last_year in NON_COMPLIANT and statuses.get(year - 2) in NON_COMPLIANT:
        return "chronic"
    return "other"


# ---- size bands -------------------------------------------------------------

SIZE_RANK = {
    "100,000+ sqft": 7,
    "50,000 to 99,999 sqft": 6,
    "20,000 to 49,999 sqft": 5,
    "15,000 to 19,999 sqft": 4,
    "10,000 to 19,999 sqft": 3,
    "7,500 to 14,999 sqft": 2,
    "Under 10,000 sqft": 1,
    "Unknown": 0,
}

# The only suffixes LADBS uses (checked 2026-10-15). Anything else in brackets
# stops the build: a reworded suffix must never turn city-owned buildings
# into prospects by accident.
LA_CITY_OWNED_SUFFIXES = ("(CITY OWNED BUILDING)", "(CITY OWNED BUILDINGS)")
_PAREN_SUFFIX = re.compile(r"\s*(\([^)]*\))\s*$")


def _la_band_parts(programclass: str) -> tuple[str, str | None]:
    text = (programclass or "").strip()
    m = _PAREN_SUFFIX.search(text)
    suffix = m.group(1).upper() if m else None
    if suffix is not None and suffix not in LA_CITY_OWNED_SUFFIXES:
        raise UnknownLabel(f"LA size band suffix {m.group(1)!r} in {programclass!r}")
    band = text[: m.start()].strip() if m else text
    if band not in SIZE_RANK:
        raise UnknownLabel(f"LA size band {programclass!r}")
    return band, suffix


def la_size_band(programclass: str) -> str:
    """'7,500 to 14,999 sqft (CITY OWNED BUILDING)' -> '7,500 to 14,999 sqft'."""
    return _la_band_parts(programclass)[0]


def la_city_owned(programclass: str) -> bool:
    return _la_band_parts(programclass)[1] is not None


# Floor-area range of each band, for spotting self-reported areas that can't be right.
BAND_RANGE = {
    "100,000+ sqft": (100_000, None),
    "50,000 to 99,999 sqft": (50_000, 99_999),
    "20,000 to 49,999 sqft": (20_000, 49_999),
    "15,000 to 19,999 sqft": (15_000, 19_999),
    "10,000 to 19,999 sqft": (10_000, 19_999),
    "7,500 to 14,999 sqft": (7_500, 14_999),
}


def area_fits_band(area: int | None, band: str) -> bool:
    if area is None or band not in BAND_RANGE:
        return False
    low, high = BAND_RANGE[band]
    return area >= low and (high is None or area <= high)


def sf_size_band(floor_area: int | None) -> str:
    if floor_area is None:
        return "Unknown"
    if floor_area >= 100_000:
        return "100,000+ sqft"
    if floor_area >= 50_000:
        return "50,000 to 99,999 sqft"
    if floor_area >= 20_000:
        return "20,000 to 49,999 sqft"
    if floor_area >= 10_000:
        return "10,000 to 19,999 sqft"
    return "Under 10,000 sqft"


def sf_city_owned(property_type: str | None, audit_status_raw: str | None) -> str | None:
    """Heuristic from the spec; SF publishes no owner field. Returns the reason, or None.

    SF's property_type column holds values like 'Commercial - Port Facility'
    (see DRIFT.md item 1), so we look for the phrase rather than an exact match.
    """
    if "Port Facility" in (property_type or ""):
        return "Port Facility"
    if (audit_status_raw or "").strip() == "Exempt - Municipal":
        return "Exempt - Municipal"
    return None


# ---- SF audits ----------------------------------------------------------------

AUDIT_STATUS = {
    "Upcoming": "upcoming",
    "Delayed Till Next Cycle": "upcoming",
    "Did Not Comply": "did_not_comply",
    "Pending - Contracted": "pending",
    "Pending - Waiting for Clarification": "pending",
    "Complied": "complied",
}


def audit_status(raw: str | None) -> str:
    if raw is None or not raw.strip():
        return "none"
    if raw.startswith("Exempt"):
        return "exempt"
    if raw in AUDIT_STATUS:
        return AUDIT_STATUS[raw]
    raise UnknownLabel(f"SF energy_audit_status {raw!r}")


# ---- small parsers --------------------------------------------------------------

def present(value) -> bool:
    """Socrata leaves null fields out of a row; treat blank strings the same way."""
    return value is not None and str(value).strip() != ""


def to_float(value) -> float | None:
    """Numbers arrive as strings; LA also uses 'Not Available'."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value) -> int | None:
    number = to_float(value)
    return int(round(number)) if number is not None else None


# ---- LA filer names ------------------------------------------------------------
# LADBS's "ENTITY RESPONSIBLE FOR BENCHMARK" is usually a company (a filing
# vendor, manager or owner entity), but about 3% of values name people:
# "Last, First TR ... Family Trust", "First Last and First Last, Co-Owners".
# The spec's guardrail is "no owner or personal data", so a name is published
# only when it reads as an organization. Anything else is withheld. Withholding
# a company by mistake costs little; publishing a person by mistake breaks a
# hard rule. Firms named after a founder ("Given Surname Properties, Inc") still
# show: no rule can tell them from a one-person company, so that is the
# founder's call (README, decisions).

FILER_PLACEHOLDERS = {"unknown", "n/a", "na", "none", "-", ".", "my organization", "owner", "test", "tbd"}

# Strong signs of a person: always withheld, even next to "LLC".
_PERSON_MARKERS = re.compile(
    r"\b(TR|TRS|TTEE|TTEES|TRUSTEES?|CO[- ]?TRS?|ET\s*AL|ETAL|C/O|CO-?OWNERS?|ESTATE OF|DECEASED)\b"
    r"|\b(LIVING|FAMILY|REVOCABLE|IRREVOCABLE|SURVIVORS?'?|BYPASS|MARITAL|DECEDENTS?'?|SEPARATE PROPERTY|EXEMPTION|"
    r"CHILDREN'?S?|GRANTOR|SPECIAL NEEDS)\s+TRUST\b"
    r"|\bTRUST\s+(OF|DATED|DTD|U/?D/?T|U/?A)\b",
    re.I,
)
# Weaker signs ("Last, First" assessor style, "Owner"): withheld unless the
# name also carries a legal-entity suffix such as LLC or Inc.
_WEAK_PERSON_MARKERS = re.compile(r"^[A-Z][A-Za-z'\-]+\s*,\s*[A-Z]|\bOWNERS?\b", re.I)
_ENTITY_SUFFIX = re.compile(
    r"\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO\.|LP|L\.P|LLP|LTD|LIMITED|PLLC)\b", re.I)

_ORG_WORDS = re.compile(
    r"\b(LLC|L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|COMPANIES|CO\.|LP|L\.P|LLP|LTD|LIMITED|PLLC|"
    r"GROUP|PARTNERS|PARTNERSHIP|ASSOCIATES|ASSOC|ASSOCIATION|PROPERTIES|PROPERTY|REALTY|REAL ESTATE|MANAGEMENT|MGMT|"
    r"INVESTMENTS?|INVESTORS|HOLDINGS?|CAPITAL|VENTURES?|DEVELOPMENT|ENTERPRISES?|SERVICES?|SOLUTIONS|ENERGY|"
    r"CONSULTING|CONSULTANTS|ENGINEERS?|ENGINEERING|UNIVERSITY|COLLEGE|SCHOOLS?|DISTRICT|CITY|COUNTY|STATE|"
    r"DEPARTMENT|AUTHORITY|HOSPITALS?|MEDICAL|HEALTH|HEALTHCARE|CHURCH|TEMPLE|FOUNDATION|INSTITUTE|SOCIETY|BANK|"
    r"FUND|REIT|APARTMENTS|HOTELS?|STORAGE|INDUSTRIAL|INDUSTRIES|RESIDENTIAL|COMMUNITIES|COMMUNITY|HOUSING|"
    r"AIRPORTS?|STUDIOS?|PICTURES|MARKETS?|SUPERMARKETS?|GROCERIES|STORES?|INSURANCE|SYSTEMS|TECHNOLOGIES|NETWORK|"
    r"COMMUNICATIONS|MEDIA|ENTERTAINMENT|ARCHITECTURE|ARCHITECTS|CONSTRUCTION|BUILDERS|CENTERS?|CENTRES?|PLAZA|"
    r"TOWERS?|BUILDING|FINANCIAL|EQUITIES|EQUITY|ASSETS?|ADVISORS|COOPERATIVE|CLUB|ACADEMY|MUSEUM|LIBRARY|"
    r"THEATRES?|THEATERS?|COUNCIL|COMMISSION|BOARD|AGENCY|LOGISTICS|MANUFACTURING|WHOLESALE|LIVING|SENIOR|"
    r"POWER|WATER|UTILITY|UTILITIES|ELECTRONICS|COSMETICS|BIOLOGICALS|WORLDWIDE|INTERNATIONAL|NATIONAL|AMERICA|"
    r"BUSINESS PARK|CROSSING|IQ|PLUS|COMMERCIAL|RETAIL|OFFICES?|ELECTRIC|DEPOT|OIL|HOMES|CONDOMINIUMS?|PARKING|YMCA|YWCA|PORT OF|TRUST COMPANY)\b",
    re.I,
)

# Shapes of people's names that a company word or suffix does not cancel:
# "Given and Given Surname LLC", "G and J Surname LLC", "Surname Family LP",
# "Given M. Surname, Inc", "Surname, Given and ... LP". They also cover the
# bare form ("Given and Given Surname"), so a page can't withhold one year's
# value and show the same people in a longer value for another year.
_NAME_WORD = r"[A-Za-z][A-Za-z'\-]+"
_LEGAL_WORD = r"(?:LLC|L\.?L\.?C\.?|INC\.?|INCORPORATED|CORP\.?|CORPORATION|LP|L\.?P\.?|LLP|LTD\.?|PLLC|LIMITED)"
_TWO_PEOPLE = re.compile(rf"\b({_NAME_WORD})\s+(?:and|&)\s+({_NAME_WORD})\s+({_NAME_WORD})", re.I)
_INITIALS_JOINED = re.compile(
    rf"(?<![A-Za-z.])[A-Z]\.?\s*(?:and|&)\s*[A-Z]\.?\s+({_NAME_WORD})(?=\s*,?\s*(?:{_LEGAL_WORD}|PARTNERSHIP|PARTNERS|FAMILY)\b|\s*$)",
    re.I)
# "Family" names a family unless it is part of a service name ("Family Health Center").
_FAMILY = re.compile(
    rf"\b({_NAME_WORD})\s+FA?MILY\b(?!\s+(?:HEALTH|CENTERS?|CENTRES?|HOUSING|SERVICES|CARE|GUIDANCE|CLINIC|MEDICAL|DOLLAR|RESOURCES?)\b)",
    re.I)
_NOT_A_FAMILY_NAME = {"the", "a", "our", "first", "la", "child", "and"}
_MIDDLE_INITIAL = re.compile(rf"\b([A-Z][a-z]+)\s+([A-Z])\.?\s+([A-Z][a-z][A-Za-z'\-]*)")
_LAST_FIRST = re.compile(rf"^\s*({_NAME_WORD})\s*,\s*({_NAME_WORD})\b")


def _company_word(word: str) -> bool:
    return bool(_ORG_WORDS.fullmatch(word) or re.fullmatch(_LEGAL_WORD, word, re.I) or re.fullmatch(r"[IVX]+", word))


def _person_shape(name: str) -> bool:
    # The middle-initial shape reads capitals, so a value sent in capitals is checked as Title Case too.
    return _shape(name) or (name.isupper() and _shape(name.title()))


def _shape(name: str) -> bool:
    for m in _TWO_PEOPLE.finditer(name):
        if m.group(1).lower() != "the" and not any(_company_word(w) for w in m.groups()):
            return True
    for m in _INITIALS_JOINED.finditer(name):
        if not _company_word(m.group(1)):
            return True
    for m in _FAMILY.finditer(name):
        if m.group(1).lower() not in _NOT_A_FAMILY_NAME and not _company_word(m.group(1)):
            return True
    for m in _MIDDLE_INITIAL.finditer(name):
        given, initial, surname = m.groups()
        if initial not in "IVX" and not _company_word(given) and not _company_word(surname):
            return True
    m = _LAST_FIRST.match(name)
    return bool(m) and not _company_word(m.group(1)) and not _company_word(m.group(2))


def looks_personal(name: str) -> bool:
    """True when a value carries a sign of a person that no company word cancels."""
    return bool(_PERSON_MARKERS.search(name)) or _person_shape(name)


# Frequent LA filers whose names carry no company word (checked by hand on
# 2026-10-15 against the 2016-2025 data). Matched case-insensitively. A bare
# "Given Surname" is left out even when it is a firm's short name: in an
# outreach line it would read as a person.
KNOWN_FILERS = {
    "bay efficiency", "ece_cola_gsd", "ece_ecom_energy", "aum", "servidyne", "landmark", "kroger", "cbre",
    "wegowise", "wegowise by appfolio", "labbc", "cushman & wakefield", "cushman && wakefield", "scg",
    "prologis", "lbpm", "berglas & garfield", "conservice", "transwestern", "aimco",
    "smart and final", "dws", "link logistics", "jll", "gbworks", "target", "invesco", "cedars-sinai",
    "vallarta supermarkets", "rcmi", "kennedy wilson", "home depot", "the home depot", "greystone", "macy's",
    "kidder matthews", "gid", "costco wholesale", "a community of friends", "salsbury industries", "ssp",
    "nbcuniversal", "lafh", "hsr", "extra space", "best buy", "abm", "mosser companies", "lpc",
    "jones lang lasalle", "jpmorgan", "jp morgan chase", "green econome", "tishman speyer", "regency centers",
    "nuveen", "hines", "greystar", "cim", "amc theatres", "ups", "zc sustainability", "sol vista",
    "safeway", "the j. paul getty trust", "the j paul getty trust", "transformco", "office depot",
}


def filer_name(value) -> tuple[str | None, str | None]:
    """Decide how an LA organization value may be shown.

    Returns (name, note): (name, None) to publish it; (None, "withheld") when it
    may name a person; (None, None) when there is no usable name at all.
    """
    if not present(value):
        return None, None
    name = " ".join(html.unescape(str(value)).split())  # '&amp;' and doubled spaces
    lowered = name.lower()
    if lowered in FILER_PLACEHOLDERS or not re.search(r"[a-z]{2}", lowered):
        return None, None
    if lowered in KNOWN_FILERS:
        return name, None
    # Free text such as "Tenant is X / Y is building owner" is not a name.
    if " is " in f" {lowered} ":
        return None, "withheld"
    if looks_personal(name):
        return None, "withheld"
    if _WEAK_PERSON_MARKERS.search(name) and not _ENTITY_SUFFIX.search(name):
        return None, "withheld"
    if _ORG_WORDS.search(name):
        return name, None
    return None, "withheld"
