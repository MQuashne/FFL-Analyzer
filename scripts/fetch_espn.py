"""
Pulls your private ESPN league (teams/rosters, free agents, settings,
current-week matchups) using the espn_api package, and writes plain
JSON into docs/data/espn/ for the static site to read.

Required environment variables (set as GitHub Actions secrets):
  ESPN_LEAGUE_ID
  ESPN_YEAR         e.g. 2026
  ESPN_S2           value of the espn_s2 cookie
  ESPN_SWID         value of the SWID cookie (include the curly braces)
Optional:
  ESPN_TEAM_ID      your team's numeric id, to mark "my_team" in the output
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "data" / "espn"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_env(name, required=True):
    val = os.environ.get(name)
    if required and not val:
        print(f"ERROR: missing required environment variable {name}")
        sys.exit(1)
    return val


def player_to_dict(player):
    return {
        "name": player.name,
        "playerId": player.playerId,
        "position": player.position,
        "eligible_slots": getattr(player, "eligibleSlots", []),
        "pro_team": getattr(player, "proTeam", None),
        "injury_status": getattr(player, "injuryStatus", None),
        "percent_owned": getattr(player, "percent_owned", None),
        "percent_started": getattr(player, "percent_started", None),
        "projected_total_points": getattr(player, "projected_total_points", None),
        "total_points": getattr(player, "total_points", None),
    }


def main():
    try:
        from espn_api.football import League
    except ImportError:
        print("ERROR: espn_api not installed. Check scripts/requirements.txt")
        sys.exit(1)

    league_id = int(get_env("ESPN_LEAGUE_ID"))
    year = int(get_env("ESPN_YEAR"))
    espn_s2 = get_env("ESPN_S2")
    swid = get_env("ESPN_SWID")
    my_team_id = os.environ.get("ESPN_TEAM_ID")

    try:
        league = League(league_id=league_id, year=year, espn_s2=espn_s2, swid=swid)
    except Exception as e:
        print(f"ERROR: could not connect to ESPN league: {e}")
        sys.exit(1)

    # --- League settings ---
    settings = league.settings
    settings_out = {
        "name": getattr(settings, "name", None),
        "team_count": getattr(settings, "team_count", None),
        # espn_api's Settings has no "roster_positions" attribute — the real
        # one is "position_slot_counts", a dict like {"QB": 1, "RB": 2, ...}
        # (including bench/IR as "BE"/"IR"). We keep the JSON key name
        # "roster_positions" for the front-end, but it's now this dict
        # directly rather than a flat per-slot list.
        "roster_positions": getattr(settings, "position_slot_counts", None),
        "scoring_type": getattr(settings, "scoring_type", None),
        "playoff_team_count": getattr(settings, "playoff_team_count", None),
        "trade_deadline": getattr(settings, "trade_deadline", None),
        "current_week": getattr(league, "current_week", None),
        "fetched_at": now_iso(),
    }
    (OUT_DIR / "settings.json").write_text(json.dumps(settings_out, indent=2), encoding="utf-8")

    # --- Teams and rosters ---
    teams_out = []
    for team in league.teams:
        teams_out.append({
            "team_id": team.team_id,
            "team_name": team.team_name,
            "owner": getattr(team, "owners", None),
            "wins": team.wins,
            "losses": team.losses,
            "is_my_team": (str(team.team_id) == str(my_team_id)) if my_team_id else False,
            "roster": [player_to_dict(p) for p in team.roster],
        })
    (OUT_DIR / "teams.json").write_text(json.dumps({
        "fetched_at": now_iso(),
        "teams": teams_out,
    }, indent=2), encoding="utf-8")

    # --- Free agents (available players) ---
    try:
        free_agents = league.free_agents(size=300)
    except Exception as e:
        print(f"WARNING: could not fetch free agents: {e}")
        free_agents = []
    (OUT_DIR / "free_agents.json").write_text(json.dumps({
        "fetched_at": now_iso(),
        "players": [player_to_dict(p) for p in free_agents],
    }, indent=2), encoding="utf-8")

    # --- Current week matchups / box scores ---
    try:
        box_scores = league.box_scores()
        matchups_out = []
        for bs in box_scores:
            matchups_out.append({
                "home_team": getattr(bs.home_team, "team_name", None) if bs.home_team else None,
                "home_score": bs.home_score,
                "away_team": getattr(bs.away_team, "team_name", None) if bs.away_team else None,
                "away_score": bs.away_score,
            })
    except Exception as e:
        print(f"WARNING: could not fetch matchups: {e}")
        matchups_out = []
    (OUT_DIR / "matchups.json").write_text(json.dumps({
        "fetched_at": now_iso(),
        "week": getattr(league, "current_week", None),
        "matchups": matchups_out,
    }, indent=2), encoding="utf-8")

    print(f"ESPN data updated: {len(teams_out)} teams, {len(free_agents)} free agents.")


if __name__ == "__main__":
    main()
