PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial_schema.sql','2026-10-12 05:03:32');
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO "users" ("id","email","display_name","created_at") VALUES('f2d6cdef-c4aa-474b-a576-487a99bc3841','itsenbydee@gmail.com',NULL,'2026-10-12 21:04:27');
CREATE TABLE people (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  pronouns        TEXT,
  notes           TEXT,
  is_self         INTEGER NOT NULL DEFAULT 0,          
  linked_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,  
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE profile_notes (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('injury','modification','like','dislike','limit')),
  description  TEXT NOT NULL,
  noted_on     TEXT,                                   
  is_current   INTEGER NOT NULL DEFAULT 1,             
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE locations (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  notes        TEXT,
  hard_points  TEXT,                                   
  maps_url     TEXT,                                   
  latitude     REAL,
  longitude    REAL,
  is_one_off   INTEGER NOT NULL DEFAULT 0,             
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE tags (
  id        TEXT PRIMARY KEY,
  owner_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  UNIQUE (owner_id, name)
);
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
  version         INTEGER NOT NULL DEFAULT 1,          
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE plan_tags (
  plan_id  TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_id, tag_id)
);
CREATE TABLE ties (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  tie_date          TEXT,
  location_id       TEXT REFERENCES locations(id) ON DELETE SET NULL,
  duration_minutes  INTEGER,
  success_rating    INTEGER CHECK (success_rating BETWEEN 1 AND 5),  
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO "ties" ("id","owner_id","title","tie_date","location_id","duration_minutes","success_rating","notes","created_at","updated_at") VALUES('e51c0094-f57c-4d86-b309-0bf89535c7fc','f2d6cdef-c4aa-474b-a576-487a99bc3841','Faux futo online','2026-10-12',NULL,30,3,'We did a thing also','2026-10-12 21:04:52','2026-10-12 21:04:52');
CREATE TABLE tie_plans (
  tie_id        TEXT NOT NULL REFERENCES ties(id) ON DELETE CASCADE,
  plan_id       TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  plan_version  INTEGER NOT NULL,
  PRIMARY KEY (tie_id, plan_id)
);
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
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE INDEX idx_people_owner      ON people(owner_id);
CREATE INDEX idx_notes_person      ON profile_notes(person_id);
CREATE INDEX idx_locations_owner   ON locations(owner_id);
CREATE INDEX idx_plans_owner       ON plans(owner_id);
CREATE INDEX idx_ties_owner_date   ON ties(owner_id, tie_date);
CREATE INDEX idx_tie_plans_plan    ON tie_plans(plan_id);
CREATE INDEX idx_participants_person ON tie_participants(person_id);
