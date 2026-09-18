"""
Central place to configure which FantasyPros pages get scraped.
Edit these URLs if FantasyPros changes their paths, or if you want
weekly (not rest-of-season) rankings for a given position.
"""

BASE = "https://www.fantasypros.com/nfl/rankings"

# Overall rest-of-season PPR rankings
OVERALL_URL = f"{BASE}/ros-ppr-overall.php"

# Positional cheatsheets. Adjust to "ros-{pos}.php" per-position if
# FantasyPros exposes a rest-of-season version for that slot and you
# prefer it over the weekly cheatsheet.
POSITIONS = ["qb", "rb", "wr", "te", "flex", "k", "dst"]

POSITION_URLS = {pos: f"{BASE}/{pos}.php" for pos in POSITIONS}

TABLE_ID = "ranking-table"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}
