"""
Fetches the #ranking-table HTML table from FantasyPros ROS overall
rankings and each positional cheatsheet, and writes each as plain
JSON into docs/data/rankings/ so the static site can read it.

Designed to fail *softly*: if one page can't be fetched or the table
isn't found (e.g. FantasyPros changed markup, added a login wall, or
is now rendering the table via JavaScript instead of static HTML),
that one file is skipped and noted in status.json. Existing JSON for
that source is left untouched so the site keeps showing last-known
data instead of going blank.

If a source repeatedly fails, download the table as CSV manually from
your browser and drop it in data/manual/<name>.csv (see data/manual/README.md).
This script will prefer a manual CSV over a failed scrape.
"""
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from sources import OVERALL_URL, POSITION_URLS, TABLE_ID, HEADERS

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "data" / "rankings"
MANUAL_DIR = ROOT / "data" / "manual"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_table(html: str):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find(id=TABLE_ID)
    if table is None:
        return None

    thead = table.find("thead")
    header_cells = []
    if thead:
        header_cells = [th.get_text(" ", strip=True) for th in thead.find_all("th")]

    body = table.find("tbody") or table
    rows = []
    for tr in body.find_all("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all(["td", "th"])]
        cells = [c for c in cells if c != ""] and cells  # keep row even if some cells blank
        if cells:
            rows.append(cells)

    if not header_cells and rows:
        header_cells = [f"col_{i}" for i in range(len(rows[0]))]

    if not rows:
        return None

    return {"headers": header_cells, "rows": rows}


def fetch_source(name: str, url: str):
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
    except Exception as e:
        return None, f"request failed: {e}"

    parsed = parse_table(resp.text)
    if parsed is None:
        return None, "table #ranking-table not found in page (markup changed, JS-rendered, or paywalled)"
    return parsed, None


def load_manual_csv(name: str):
    path = MANUAL_DIR / f"{name}.csv"
    if not path.exists():
        return None
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        return None
    return {"headers": rows[0], "rows": rows[1:]}


def write_json(name: str, payload: dict):
    out_path = OUT_DIR / f"{name}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def process(name: str, url: str, status: dict):
    parsed, error = fetch_source(name, url)
    source = "scrape"

    if parsed is None:
        manual = load_manual_csv(name)
        if manual is not None:
            parsed = manual
            source = "manual_csv"
            error = f"scrape failed ({error}); used manual CSV instead"
        else:
            existing = OUT_DIR / f"{name}.json"
            status[name] = {
                "ok": False,
                "error": error,
                "fetched_at": now_iso(),
                "used_existing_file": existing.exists(),
            }
            print(f"[{name}] FAILED: {error}")
            return

    write_json(name, {
        "source": source,
        "url": url,
        "fetched_at": now_iso(),
        "headers": parsed["headers"],
        "rows": parsed["rows"],
    })
    status[name] = {"ok": True, "source": source, "fetched_at": now_iso(), "row_count": len(parsed["rows"])}
    print(f"[{name}] OK ({source}, {len(parsed['rows'])} rows)")


def main():
    status = {}
    process("overall", OVERALL_URL, status)
    time.sleep(1)  # be polite between requests
    for pos, url in POSITION_URLS.items():
        process(pos, url, status)
        time.sleep(1)

    status_path = OUT_DIR / "status.json"
    status_path.write_text(json.dumps({"updated_at": now_iso(), "sources": status}, indent=2), encoding="utf-8")

    any_failed = any(not s.get("ok") for s in status.values())
    if any_failed:
        print("\nSome sources failed to update — see docs/data/rankings/status.json")
    sys.exit(0)  # never fail the whole job; ESPN fetch should still run


if __name__ == "__main__":
    main()
