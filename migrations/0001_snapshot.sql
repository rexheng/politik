-- The curated policy snapshot. The tables are wiped and reloaded by the seed script.
-- Keep this file free of semicolons inside comments and strings, the test helper splits on them.

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  short_title TEXT,
  status TEXT NOT NULL,
  status_date TEXT,
  published TEXT,
  last_activity TEXT NOT NULL,
  landmark INTEGER NOT NULL,
  review_state TEXT NOT NULL,
  topics_json TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX records_jurisdiction ON records (jurisdiction);
CREATE INDEX records_type ON records (type);
CREATE INDEX records_last_activity ON records (last_activity);

CREATE TABLE record_topics (
  record_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  PRIMARY KEY (record_id, topic)
);

CREATE INDEX record_topics_topic ON record_topics (topic);

CREATE TABLE timeline_events (
  record_id TEXT NOT NULL,
  date TEXT NOT NULL,
  event TEXT NOT NULL
);

CREATE INDEX timeline_events_date ON timeline_events (date);

CREATE TABLE passages (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  UNIQUE (record_id, seq)
);

CREATE VIRTUAL TABLE passages_fts USING fts5(passage_id UNINDEXED, title, heading, text, tokenize='porter unicode61');

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
