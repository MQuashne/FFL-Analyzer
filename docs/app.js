// ---------- Global state ----------
const RANKING_SOURCES = ["overall", "qb", "rb", "wr", "te", "flex", "k", "dst"];
const state = {
  rankings: {},      // name -> {headers, rows, meta}
  rankingIndex: {},  // name -> Map(normalizedPlayerName -> {rank, raw})
  espnTeams: [],
  espnFreeAgents: [],
  espnSettings: null,
  statusInfo: null,
};

// ---------- Utilities ----------
function normalizeName(raw) {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, "")          // strip "(SF)" style team tags
    .replace(/[.'`]/g, "")            // strip periods/apostrophes
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "") // strip suffixes
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findColumnIndex(headers, candidates) {
  const lower = headers.map(h => (h || "").toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h === cand);
    if (idx !== -1) return idx;
  }
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function fetchJsonSafe(path) {
  try {
    const resp = await fetch(path, { cache: "no-store" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

// ---------- Loading & indexing rankings ----------
function localOverrideKey(name) { return `manualRankings_${name}`; }

async function loadRankingSource(name) {
  const override = localStorage.getItem(localOverrideKey(name));
  if (override) {
    try { return { data: JSON.parse(override), fromOverride: true }; } catch (e) { /* fall through */ }
  }
  const data = await fetchJsonSafe(`data/rankings/${name}.json`);
  return { data, fromOverride: false };
}

function buildIndexFromTable(headers, rows) {
  const rankIdx = findColumnIndex(headers, ["rk", "rank", "#"]);
  const nameIdx = findColumnIndex(headers, ["player", "player name", "name"]);
  const teamIdx = findColumnIndex(headers, ["team"]);
  const posIdx = findColumnIndex(headers, ["pos", "position"]);

  const map = new Map();
  rows.forEach((row, i) => {
    const rank = rankIdx !== -1 ? parseInt(row[rankIdx], 10) : i + 1;
    const nameRaw = nameIdx !== -1 ? row[nameIdx] : row[0];
    if (!nameRaw) return;
    const key = normalizeName(nameRaw);
    if (!key) return;
    map.set(key, {
      rank: Number.isFinite(rank) ? rank : i + 1,
      name: nameRaw,
      team: teamIdx !== -1 ? row[teamIdx] : null,
      pos: posIdx !== -1 ? row[posIdx] : null,
      raw: row,
    });
  });
  return { map, rankIdx, nameIdx, teamIdx, posIdx };
}

async function loadAllRankings() {
  for (const name of RANKING_SOURCES) {
    const { data, fromOverride } = await loadRankingSource(name);
    if (!data) continue;
    const idx = buildIndexFromTable(data.headers || [], data.rows || []);
    state.rankings[name] = { ...data, fromOverride };
    state.rankingIndex[name] = idx;
  }
}

function lookupRank(playerName, position) {
  const key = normalizeName(playerName);
  const posMap = {
    "QB": "qb", "RB": "rb", "WR": "wr", "TE": "te", "K": "k",
    "D/ST": "dst", "DST": "dst",
  };
  const sourceName = posMap[position];
  if (sourceName && state.rankingIndex[sourceName]) {
    const hit = state.rankingIndex[sourceName].map.get(key);
    if (hit) return { rank: hit.rank, source: sourceName };
  }
  if (state.rankingIndex.overall) {
    const hit = state.rankingIndex.overall.map.get(key);
    if (hit) return { rank: hit.rank, source: "overall" };
  }
  return { rank: null, source: null };
}

// ---------- Loading ESPN data ----------
async function loadEspnData() {
  const teams = await fetchJsonSafe("data/espn/teams.json");
  const freeAgents = await fetchJsonSafe("data/espn/free_agents.json");
  const settings = await fetchJsonSafe("data/espn/settings.json");
  state.espnTeams = teams ? teams.teams : [];
  state.espnFreeAgents = freeAgents ? freeAgents.players : [];
  state.espnSettings = settings || null;
}

// ---------- Status banner ----------
async function renderStatusBanner() {
  const status = await fetchJsonSafe("data/rankings/status.json");
  state.statusInfo = status;
  const el = document.getElementById("status-banner");
  const parts = [];
  if (!state.espnTeams.length) {
    parts.push(`<span class="fail">No ESPN data found yet — check that the Action has run and secrets are set.</span>`);
  }
  if (status && status.sources) {
    const failed = Object.entries(status.sources).filter(([, v]) => !v.ok);
    if (failed.length) {
      parts.push(`<span class="fail">Failed rankings sources: ${failed.map(([k]) => k).join(", ")} (see Upload CSV tab)</span>`);
    } else {
      parts.push(`<span class="ok">All ranking sources updated ${new Date(status.updated_at).toLocaleString()}</span>`);
    }
  }
  el.innerHTML = parts.join(" &middot; ");
}

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

// ---------- Free Agents tab ----------
function renderFreeAgents() {
  const posFilter = document.getElementById("fa-position-filter").value;
  const search = document.getElementById("fa-search").value.toLowerCase();
  const tbody = document.querySelector("#fa-table tbody");
  tbody.innerHTML = "";

  const enriched = state.espnFreeAgents.map(p => {
    const { rank, source } = lookupRank(p.name, p.position);
    return { ...p, rank, rankSource: source };
  }).filter(p => p.rank !== null);

  enriched.sort((a, b) => a.rank - b.rank);

  enriched
    .filter(p => posFilter === "ALL" || p.position === posFilter)
    .filter(p => !search || p.name.toLowerCase().includes(search))
    .slice(0, 150)
    .forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.rank}</td><td>${p.name}</td><td>${p.position || ""}</td><td>${p.pro_team || ""}</td><td>${p.percent_owned != null ? p.percent_owned.toFixed(1) + "%" : "-"}</td>`;
      tbody.appendChild(tr);
    });
}

// ---------- Lineup tab ----------
function parseRosterPositions(rosterPositions) {
  // espn_api's settings.roster_positions is typically a list of slot names,
  // one entry per roster spot, e.g. ["QB","RB","RB","WR","WR","TE","FLEX","D/ST","K","BE","BE",...]
  const counts = {};
  (rosterPositions || []).forEach(slot => {
    counts[slot] = (counts[slot] || 0) + 1;
  });
  return counts;
}

const SLOT_ELIGIBILITY = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  "D/ST": ["D/ST", "DST"],
  FLEX: ["RB", "WR", "TE"],
  "RB/WR": ["RB", "WR"],
  "WR/TE": ["WR", "TE"],
  OP: ["QB", "RB", "WR", "TE"], // superflex-style, if present
};

function populateTeamSelect() {
  const sel = document.getElementById("lineup-team-select");
  sel.innerHTML = "";
  state.espnTeams.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.team_id;
    opt.textContent = t.team_name + (t.is_my_team ? " (me)" : "");
    if (t.is_my_team) opt.selected = true;
    sel.appendChild(opt);
  });
}

function optimizeLineup(roster, slotCounts) {
  // Enrich roster with rank
  const players = roster.map(p => {
    const { rank } = lookupRank(p.name, p.position);
    return { ...p, rank: rank === null ? 9999 : rank };
  });

  // Slots to fill, most specific (fewest eligible positions) first, so
  // flex-type slots don't grab players that a strict slot needed.
  const slotNames = Object.keys(slotCounts).filter(s => s !== "BE" && s !== "IR");
  slotNames.sort((a, b) => {
    const ea = (SLOT_ELIGIBILITY[a] || [a]).length;
    const eb = (SLOT_ELIGIBILITY[b] || [b]).length;
    return ea - eb;
  });

  const used = new Set();
  const lineup = {};

  slotNames.forEach(slot => {
    const count = slotCounts[slot];
    const eligiblePositions = SLOT_ELIGIBILITY[slot] || [slot];
    const candidates = players
      .filter(p => !used.has(p.playerId) && eligiblePositions.includes(p.position))
      .sort((a, b) => a.rank - b.rank);
    lineup[slot] = candidates.slice(0, count);
    lineup[slot].forEach(p => used.add(p.playerId));
  });

  const bench = players.filter(p => !used.has(p.playerId)).sort((a, b) => a.rank - b.rank);
  return { lineup, bench };
}

function renderLineup() {
  const teamId = document.getElementById("lineup-team-select").value;
  const team = state.espnTeams.find(t => String(t.team_id) === String(teamId));
  const out = document.getElementById("lineup-output");
  if (!team) { out.innerHTML = "<p class='hint'>No team data loaded yet.</p>"; return; }

  const rosterPositions = state.espnSettings ? state.espnSettings.roster_positions : null;
  if (!rosterPositions) {
    out.innerHTML = "<p class='hint'>League roster settings not loaded — check data/espn/settings.json.</p>";
    return;
  }
  const slotCounts = parseRosterPositions(rosterPositions);
  const { lineup, bench } = optimizeLineup(team.roster, slotCounts);

  let html = "";
  Object.entries(lineup).forEach(([slot, players]) => {
    html += `<div class="slot-block"><h4>${slot}</h4>`;
    if (!players.length) {
      html += `<div class="hint">No eligible player found for this slot.</div>`;
    }
    players.forEach(p => {
      html += `<div>#${p.rank === 9999 ? "?" : p.rank} — ${p.name} (${p.position}${p.injury_status && p.injury_status !== "ACTIVE" ? ", " + p.injury_status : ""})</div>`;
    });
    html += `</div>`;
  });

  html += `<div class="slot-block"><h4>Bench</h4>`;
  bench.forEach(p => {
    html += `<div>#${p.rank === 9999 ? "?" : p.rank} — ${p.name} (${p.position})</div>`;
  });
  html += `</div>`;

  out.innerHTML = html;
}

// ---------- Trades tab ----------
function teamPositionalDepth(team) {
  const byPos = {};
  team.roster.forEach(p => {
    const { rank } = lookupRank(p.name, p.position);
    if (rank === null) return;
    if (!byPos[p.position]) byPos[p.position] = [];
    byPos[p.position].push({ name: p.name, rank });
  });
  const avg = {};
  Object.entries(byPos).forEach(([pos, list]) => {
    list.sort((a, b) => a.rank - b.rank);
    avg[pos] = {
      avgRank: list.reduce((s, x) => s + x.rank, 0) / list.length,
      players: list,
    };
  });
  return avg;
}

function renderTrades() {
  const out = document.getElementById("trades-output");
  const myTeam = state.espnTeams.find(t => t.is_my_team) || state.espnTeams[0];
  if (!myTeam) { out.innerHTML = "<p class='hint'>No team data loaded yet.</p>"; return; }

  const myDepth = teamPositionalDepth(myTeam);
  let html = "";

  state.espnTeams.filter(t => t.team_id !== myTeam.team_id).forEach(other => {
    const otherDepth = teamPositionalDepth(other);
    const ideas = [];

    Object.keys(myDepth).forEach(pos => {
      if (!otherDepth[pos]) return;
      const myAvg = myDepth[pos].avgRank;
      const otherAvg = otherDepth[pos].avgRank;
      // If I'm notably stronger at this position, this is my trade chip
      if (myAvg < otherAvg - 15) {
        // find a position where THEY are stronger than me, to complete the idea
        const theirStrength = Object.keys(otherDepth).find(p2 =>
          myDepth[p2] && otherDepth[p2].avgRank < myDepth[p2].avgRank - 15 && p2 !== pos
        );
        if (theirStrength) {
          const myChip = myDepth[pos].players[myDepth[pos].players.length - 1]; // my weakest starter/depth at strong pos = expendable
          const theirChip = otherDepth[theirStrength].players[otherDepth[theirStrength].players.length - 1];
          ideas.push({ pos, theirStrength, myChip, theirChip });
        }
      }
    });

    if (ideas.length) {
      html += `<div class="trade-idea"><strong>${other.team_name}</strong>`;
      ideas.slice(0, 2).forEach(idea => {
        html += `<div>You're deep at ${idea.pos}, they're deep at ${idea.theirStrength}. Consider offering <em>${idea.myChip.name}</em> (#${idea.myChip.rank} ${idea.pos}) for <em>${idea.theirChip.name}</em> (#${idea.theirChip.rank} ${idea.theirStrength}).</div>`;
      });
      html += `</div>`;
    }
  });

  out.innerHTML = html || "<p class='hint'>No clear positional-depth mismatches found against other rosters right now.</p>";
}

// ---------- Rankings browse tab ----------
function renderRankingsTable() {
  const name = document.getElementById("rankings-source-select").value;
  const data = state.rankings[name];
  const thead = document.querySelector("#rankings-table thead");
  const tbody = document.querySelector("#rankings-table tbody");
  const meta = document.getElementById("rankings-meta");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  if (!data) {
    meta.textContent = "No data loaded for this source yet.";
    return;
  }
  meta.textContent = `Source: ${data.fromOverride ? "manual CSV override" : (data.source || "scrape")} · Fetched: ${data.fetched_at ? new Date(data.fetched_at).toLocaleString() : "unknown"} · ${data.rows.length} rows`;

  const headerRow = document.createElement("tr");
  data.headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  data.rows.slice(0, 300).forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// ---------- Upload tab ----------
function renderOverrideList() {
  const list = document.getElementById("override-list");
  list.innerHTML = "";
  RANKING_SOURCES.forEach(name => {
    if (localStorage.getItem(localOverrideKey(name))) {
      const li = document.createElement("li");
      li.innerHTML = `${name} <button data-clear="${name}">Clear</button>`;
      list.appendChild(li);
    }
  });
  list.querySelectorAll("button[data-clear]").forEach(btn => {
    btn.addEventListener("click", () => {
      localStorage.removeItem(localOverrideKey(btn.dataset.clear));
      renderOverrideList();
    });
  });
}

function setupUpload() {
  document.getElementById("upload-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const target = document.getElementById("upload-target").value;
    const statusEl = document.getElementById("upload-status");
    if (!file) return;

    Papa.parse(file, {
      complete: (results) => {
        const rows = results.data.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
        if (!rows.length) {
          statusEl.textContent = "Couldn't read any rows from that file.";
          return;
        }
        const headers = rows[0];
        const dataRows = rows.slice(1);
        const payload = {
          source: "manual_csv",
          fetched_at: new Date().toISOString(),
          headers,
          rows: dataRows,
        };
        localStorage.setItem(localOverrideKey(target), JSON.stringify(payload));
        statusEl.textContent = `Loaded ${dataRows.length} rows for "${target}". Reloading data...`;
        renderOverrideList();
        init(); // reload everything so the override takes effect app-wide
      },
      error: (err) => {
        statusEl.textContent = "Error parsing CSV: " + err.message;
      },
    });
  });
}

// ---------- Init ----------
async function init() {
  await loadAllRankings();
  await loadEspnData();
  await renderStatusBanner();
  populateTeamSelect();
  renderFreeAgents();
  renderLineup();
  renderTrades();
  renderRankingsTable();
  renderOverrideList();
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupUpload();
  document.getElementById("fa-position-filter").addEventListener("change", renderFreeAgents);
  document.getElementById("fa-search").addEventListener("input", renderFreeAgents);
  document.getElementById("lineup-team-select").addEventListener("change", renderLineup);
  document.getElementById("rankings-source-select").addEventListener("change", renderRankingsTable);
  init();
});
