-- Rope Journal: initial database schema
-- IDs are text (random UUIDs created by the app).
-- Dates/times are stored as ISO text, e.g. '2026-10-11' or '2026-10-11T21:51:00Z'.
-- True/false fields are stored as 0/1.

-- Journal owners (just you for now)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- People profiles, private to each journal owner
CREATE TABLE people (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  pronouns        TEXT,
  notes           TEXT,
  is_self         INTEGER NOT NULL DEFAULT 0,          -- 1 = this profile is the journal owner
  linked_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,  -- for later, if they join the app
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dated notes on a person: injuries, modifications, likes, dislikes, limits
CREATE TABLE profile_notes (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('injury','modification','like','dislike','limit')),
  description  TEXT NOT NULL,
  noted_on     TEXT,                                   -- date the note applies from
  is_current   INTEGER NOT NULL DEFAULT 1,             -- 0 = resolved / no longer applies
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Saved locations (and one-off spots)
CREATE TABLE locations (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  notes        TEXT,
  hard_points  TEXT,                                   -- suspension points, ratings, quirks
  maps_url     TEXT,                                   -- Google Maps pin link
  latitude     REAL,
  longitude    REAL,
  is_one_off   INTEGER NOT NULL DEFAULT 0,             -- 1 = hide from the regular pick list
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags, per owner
CREATE TABLE tags (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  UNIQUE (owner_id, name)
);

-- Plans: ideas through ready-to-tie sequences
CREATE TABLE plans (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  stage           TEXT NOT NULL DEFAULT 'idea'
                    CHECK (stage IN ('idea','developing','ready','retired')),
  description     TEXT,
  notes           TEXT,
  est_difficulty  INTEGER CHECK (est_difficulty BETWEEN 1 AND 5),
  variation_of    TEXT REFERENCES plans(id) ON DELETE SET NULL,
  version         INTEGER NOT NULL DEFAULT 1,          -- bumps on substantive edits (for future plan history)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_tags (
  plan_id  TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, tag_id)
);

-- Ties: what actually happened
CREATE TABLE ties (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  tie_date          TEXT,
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  duration_minutes  INTEGER,
  success_rating    INTEGER CHECK (success_rating BETWEEN 1 AND 5),  -- how it went overall / vs plan
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Which plan(s) a tie was an attempt at, and which plan version
CREATE TABLE tie_plans (
  tie_id        TEXT NOT NULL REFERENCES ties(id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  plan_version  INTEGER NOT NULL,
  PRIMARY KEY (tie_id, plan_id)
);

-- Who was in the tie, in what role, and their own ratings
CREATE TABLE tie_participants (
  tie_id             TEXT NOT NULL REFERENCES ties(id) ON DELETE CASCADE,
  person_id          TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role               TEXT NOT NULL
                       CHECK (role IN ('rigger','top','model','bottom','spotter','photographer')),
  difficulty_rating  INTEGER CHECK (difficulty_rating BETWEEN 1 AND 5),
  experience_rating  INTEGER CHECK (experience_rating BETWEEN 1 AND 5),
  notes              TEXT,
  PRIMARY KEY (tie_id, person_id, role)
);

CREATE TABLE tie_tags (
  tie_id  TEXT NOT NULL REFERENCES ties(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (tie_id, tag_id)
);

-- Indexes to keep common lookups fast
CREATE INDEX idx_people_owner      ON people(owner_id);
CREATE INDEX idx_notes_person      ON profile_notes(person_id);
CREATE INDEX idx_locations_owner   ON locations(owner_id);
CREATE INDEX idx_plans_owner       ON plans(owner_id);
CREATE INDEX idx_ties_owner_date   ON ties(owner_id, tie_date);
CREATE INDEX idx_tie_plans_plan    ON tie_plans(plan_id);
CREATE INDEX idx_participants_person ON tie_participants(person_id);
