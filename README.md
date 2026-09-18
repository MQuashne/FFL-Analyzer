# Fantasy League Assistant

A static site (GitHub Pages) backed by a scheduled GitHub Action that:

- Scrapes FantasyPros rest-of-season **overall** rankings and per-position
  cheatsheets (`table#ranking-table`) for QB/RB/WR/TE/FLEX/K/DST.
- Pulls your **private ESPN league** (rosters, free agents, league settings,
  current-week matchups) using your `espn_s2`/`SWID` cookies, kept as
  GitHub Secrets — never exposed to site visitors.
- Commits the results as JSON into `docs/data/`.
- The static site (`docs/index.html`) reads that JSON and gives you:
  - **Free Agents** — available players ranked and sorted, with search/filter.
  - **Lineup** — a suggested starting lineup per team, built from your
    league's actual roster slots (QB/RB/WR/TE/FLEX/K/D-ST/etc.) and rankings.
  - **Trade Ideas** — heuristic suggestions based on positional depth
    mismatches between your roster and each opponent's.
  - **Rankings** — browse the raw scraped tables.
  - **Upload CSV** — manual fallback for any source that fails to scrape.

## How it works (architecture)

GitHub Pages only serves static files — it cannot run server code or keep
secrets private from anyone viewing the page. So the private/sensitive work
(logging into your ESPN league, scraping FantasyPros) happens in **GitHub
Actions**, on a schedule, using repo *Secrets*. The Action writes plain,
already-public-safe JSON (rankings, roster names, etc.) into `docs/data/`
and commits it. The published site then just reads those JSON files — no
secrets ever reach the browser.

```
scripts/fetch_fantasypros.py   → docs/data/rankings/*.json
scripts/fetch_espn.py          → docs/data/espn/*.json
docs/index.html + app.js       → reads that JSON, renders the UI
.github/workflows/update-data.yml → runs both scripts every 6 hours
```

## Setup

### 1. Create the repo

Push this folder to a new GitHub repository (public or private — private
repos can still use Pages if your plan supports it, or make the repo public
since the committed data contains no secrets, only rankings and your own
roster/free-agent info).

### 2. Get your ESPN cookies

1. Log into fantasy.espn.com in Chrome, open your league.
2. Open DevTools (F12) → **Application** tab → **Cookies** →
   `https://fantasy.espn.com`.
3. Copy the values of `espn_s2` and `SWID` (include the curly braces on
   SWID, e.g. `{ABCD1234-...}`).

### 3. Add GitHub Secrets

Repo → **Settings → Secrets and variables → Actions → New repository
secret**. Add:

| Secret name       | Value                                  |
|--------------------|-----------------------------------------|
| `ESPN_LEAGUE_ID`   | Your league ID (from the ESPN league URL) |
| `ESPN_YEAR`        | e.g. `2026`                             |
| `ESPN_S2`          | The `espn_s2` cookie value              |
| `ESPN_SWID`        | The `SWID` cookie value (with braces)   |
| `ESPN_TEAM_ID`     | Your team's numeric ID (optional, marks "my team" in the UI — you can also just pick your team from the dropdown on the Lineup tab without this) |

### 4. Enable GitHub Pages

Repo → **Settings → Pages** → **Source: Deploy from a branch** → Branch:
`main`, folder: `/docs` → Save.

### 5. Run the Action once manually

Repo → **Actions** tab → **Update Fantasy Data** → **Run workflow**. This
fetches everything and commits `docs/data/*.json` for the first time. After
that it runs automatically every 6 hours (edit the cron line in
`.github/workflows/update-data.yml` to change frequency).

### 6. Visit your site

`https://<your-username>.github.io/<repo-name>/`

## When scraping fails

FantasyPros may change their page markup, rate-limit requests from GitHub's
shared runner IPs, or gate some tables behind login — any of these will
make `table#ranking-table` unavailable to a plain HTTP fetch. When that
happens the Action doesn't fail the whole job; it logs the problem to
`docs/data/rankings/status.json`, and the site shows a warning banner
naming the failed source(s).

Two fallback options, both described in more detail in-app (**Upload CSV**
tab) and in `data/manual/README.md`:

- **Browser-only fix (fastest):** open the FantasyPros page yourself, copy
  the table into a spreadsheet, export as CSV, and upload it on the
  **Upload CSV** tab. Stored in your browser's `localStorage`, overrides
  that source until you clear it. No commit needed.
- **Permanent fix (repo-level):** save the same CSV as
  `data/manual/<source>.csv` (e.g. `data/manual/te.csv`) and commit it. The
  next Action run will use it automatically for that source whenever the
  live scrape fails.

## Known limitations (read before trusting the suggestions blindly)

- **Player-name matching** between ESPN and FantasyPros is done by
  normalizing names (lowercase, strip suffixes/punctuation). Uncommon name
  formats can occasionally fail to match — those players just won't show a
  rank. Check the **Rankings** tab if a specific player seems to be missing.
- **Lineup optimizer** is a greedy algorithm (fills the most restrictive
  slots first, then FLEX-type slots) — it's a good heuristic, not a proven
  global optimum, and it uses rest-of-season/cheatsheet rank as a stand-in
  for *this week's* projection. It doesn't know about bye weeks or matchups
  unless that's reflected in the rankings source you're using.
- **Trade Ideas** are a simple positional-depth heuristic (comparing
  average rank by position across rosters) — a starting point for
  conversation, not a fairness or win-probability calculator.
- **Scraping FantasyPros** may be against their Terms of Service depending
  on how you use it — this is for personal use analyzing publicly viewable
  rankings for your own league. Review FantasyPros' ToS yourself, and check
  if their API/partner products offer a supported alternative if you plan
  heavier use.

## Local testing

```bash
cd scripts
pip install -r requirements.txt
python fetch_fantasypros.py           # writes docs/data/rankings/*.json
ESPN_LEAGUE_ID=... ESPN_YEAR=2026 ESPN_S2=... ESPN_SWID=... python fetch_espn.py
cd ../docs
python -m http.server 8000            # then open http://localhost:8000
```

## Extending

- Add more advanced trade logic (multi-player packages, projected points
  instead of rank) in `docs/app.js` → `renderTrades()`.
- Swap the lineup optimizer for a true optimal assignment (e.g. Hungarian
  algorithm) if the greedy approach isn't good enough for unusual roster
  configurations (multiple flex-type slots).
- Add weekly (not just ROS) rankings by pointing `scripts/sources.py` at
  FantasyPros' weekly cheatsheet URLs for a second data set.
