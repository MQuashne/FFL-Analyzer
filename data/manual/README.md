# Manual CSV fallback (repo-level)

This folder is a fallback for the **scheduled Action's scraper**, not for
your browser session (for that, use the "Upload CSV" tab on the live site —
it's simpler and doesn't require a commit).

Use this folder if you want a manually-downloaded CSV to be picked up
automatically every time the GitHub Action runs, permanently, until you
remove it.

1. Go to the relevant FantasyPros page in your browser.
2. Select the table (or use their export/download option if present).
3. Save/paste it as a CSV with a header row.
4. Name the file to match the source: `overall.csv`, `qb.csv`, `rb.csv`,
   `wr.csv`, `te.csv`, `flex.csv`, `k.csv`, `dst.csv`.
5. Commit and push it into this folder.

`scripts/fetch_fantasypros.py` will use this CSV automatically for any
source where the live scrape fails, and will note that in
`docs/data/rankings/status.json`.
