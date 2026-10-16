"""Run the whole refresh: pull -> check counts -> build the database -> export the site data.

    python -m scanner.build                  # what the nightly job runs
    python -m scanner.build --force          # a forced run: download again even if unchanged
    python -m scanner.build --require-token  # fail when SOCRATA_APP_TOKEN is missing (CI)

If one city's pull fails (an outage, or the row-count guard refusing a big
drop), the build goes on with that city's last good snapshot, so the other
city still refreshes. The site shows each city's own as-of and checked dates,
so the stale one is visible. In CI the build also writes partial=true to
$GITHUB_OUTPUT: the nightly workflow still publishes, then its last job turns
the run red so the failure is noticed. The build stops if a city has no good
snapshot at all, or if any later step fails, so a bad run never replaces a
good site. Count drift above the warn limit is reported but does not stop the
build; the spec asks for a warning, and late filings move the numbers on their own.
"""

import argparse
import os
import sys

from . import build_db, counts, export, pull
from .config import DATASETS
from .snapshot import snapshot_ok


def annotate(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        print(f"::warning title=Partial refresh::{message}")


def mark_partial() -> None:
    """Tell the nightly workflow that a city kept its last good snapshot (only when run there)."""
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as out:
            out.write("partial=true\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--require-token", action="store_true")
    args = parser.parse_args(argv)

    print("\n== pull", flush=True)
    pull_args = (["--force"] if args.force else []) + (["--require-token"] if args.require_token else [])
    code = pull.main(pull_args)
    if code == 2:  # missing token with --require-token
        return code
    if code:
        missing = [city for city in DATASETS if not snapshot_ok(city)]
        if missing:
            print(f"error: no usable snapshot for {', '.join(missing)}; the site data was not replaced", file=sys.stderr)
            return code
        annotate("a city's pull failed; building with its last good snapshot (see the pull errors above)")
        mark_partial()

    for name, step in (("counts", lambda: counts.main([])), ("database", lambda: build_db.main([])),
                       ("export", lambda: export.main([]))):
        print(f"\n== {name}", flush=True)
        code = step()
        if code:
            print(f"error: step '{name}' failed (exit {code}); the site data was not replaced", file=sys.stderr)
            return code
    return 0


if __name__ == "__main__":
    sys.exit(main())
