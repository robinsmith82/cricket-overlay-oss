CREATE TABLE scrape_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  match_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status TEXT,
  runs INTEGER,
  wickets INTEGER,
  overs TEXT,
  batting_team TEXT,
  changed INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX scrape_log_ts ON scrape_log(ts DESC);
CREATE INDEX scrape_log_match_ts ON scrape_log(match_id, ts DESC);
