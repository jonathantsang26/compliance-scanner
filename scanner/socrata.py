"""A small client for Socrata open-data APIs (the system both cities use).

Socrata returns only 1,000 rows unless asked for more, so `fetch_all` pages
through the dataset with $limit and $offset. Paging is only safe with a stable
sort order, otherwise rows can shift between pages and get skipped or repeated;
`:id` is Socrata's internal row id, which never changes.

Socrata answers queries from a copy of the data that can lag behind a fresh
publish. Every response says which version it came from
(X-SODA2-Secondary-Last-Modified) and whether that copy is behind
(X-SODA2-Data-Out-Of-Date). `fetch_all` refuses a pull whose pages came from
different versions or from a copy that is behind.
"""

import os
import time

import requests

PAGE_SIZE = 50_000
TIMEOUT_S = 120
RETRY_STATUS = {429, 500, 502, 503, 504}
VERSION_HEADER = "X-SODA2-Secondary-Last-Modified"
STALE_HEADER = "X-SODA2-Data-Out-Of-Date"


class StaleCopy(RuntimeError):
    """The API answered from a copy that is behind, or mixed two versions."""


def make_session() -> tuple[requests.Session, bool]:
    """Return a session, plus whether an app token is being sent.

    Without a token Socrata still answers, but with a lower rate limit.
    """
    session = requests.Session()
    session.headers["User-Agent"] = "compliance-scanner/0.1"
    token = os.environ.get("SOCRATA_APP_TOKEN", "").strip()
    if token:
        session.headers["X-App-Token"] = token
    return session, bool(token)


def _wait_seconds(response, attempt: int) -> float:
    """Honor Retry-After when the server sends one; otherwise back off 2, 4, 8, 16, 32 s."""
    if response is not None:
        try:
            return min(120.0, float(response.headers.get("Retry-After", "")))
        except ValueError:
            pass
    return float(min(60, 2 ** (attempt + 1)))


def get(session: requests.Session, url: str, params: dict | None = None, tries: int = 6):
    """GET a URL, retrying on rate limits and server errors. Returns (json, headers)."""
    last_error = None
    for attempt in range(tries):
        response = None
        try:
            response = session.get(url, params=params, timeout=TIMEOUT_S)
        except requests.RequestException as exc:
            last_error = exc
        else:
            if response.status_code == 200:
                return response.json(), response.headers
            if response.status_code not in RETRY_STATUS:
                response.raise_for_status()
            last_error = RuntimeError(f"HTTP {response.status_code}: {response.text[:200]}")
        if attempt < tries - 1:
            time.sleep(_wait_seconds(response, attempt))
    raise RuntimeError(f"giving up on {url} after {tries} tries: {last_error}")


def get_json(session: requests.Session, url: str, params: dict | None = None):
    return get(session, url, params)[0]


def served_version(headers) -> str | None:
    """Which version of the data answered, or raise StaleCopy if that copy is behind."""
    if headers.get(STALE_HEADER, "false").strip().lower() == "true":
        raise StaleCopy(f"the API says its copy is out of date ({STALE_HEADER}: true)")
    return headers.get(VERSION_HEADER)


def fetch_all(session, dataset) -> tuple[list[dict], int, int, str | None]:
    """Download every row (only the fields we keep).

    Returns (rows, pages, server_row_count, served_version). The row count comes
    from the same data version as the pages, so the two can be compared.
    """
    rows: list[dict] = []
    versions = set()
    pages = 0
    while True:
        page, headers = get(session, dataset.resource_url, {
            "$select": ",".join(dataset.fields),
            "$order": ":id",
            "$limit": PAGE_SIZE,
            "$offset": len(rows),
        })
        versions.add(served_version(headers))
        pages += 1
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
    count, headers = get(session, dataset.resource_url, {"$select": "count(*) AS n"})
    versions.add(served_version(headers))
    if len(versions) > 1:
        raise StaleCopy(f"{dataset.city}: pages came from different data versions {sorted(map(str, versions))}")
    return rows, pages, int(count[0]["n"]), versions.pop()


def metadata(session, dataset) -> dict:
    """Dataset-level facts from the views API, including when rows last changed."""
    meta = get_json(session, dataset.views_url)
    return {
        "name": meta.get("name"),
        "attribution": meta.get("attribution"),
        "rows_updated_at_epoch": meta["rowsUpdatedAt"],
    }
