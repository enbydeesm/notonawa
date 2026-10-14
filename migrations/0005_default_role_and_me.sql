-- Rope Journal: a person's usual role, filled in when they're added to a
-- tie, and a "Me" profile for every account. New accounts get theirs when
-- they're created (src/auth/db.js); this adds one to existing accounts
-- that don't have a "this is me" profile yet.

-- The same roles as tie_participants.role (ROLES in src/ties/parse.js).
-- Optional: empty means no usual role.
ALTER TABLE people ADD COLUMN default_role TEXT
  CHECK (default_role IN ('rigger', 'top', 'model', 'bottom', 'spotter', 'photographer'));

-- Ids look like crypto.randomUUID()'s, as in migration 0002.
INSERT INTO people (id, owner_id, name, is_self)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' ||
             hex(randomblob(2)) || '-' || hex(randomblob(6))),
       u.id, 'Me', 1
  FROM users u
 WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.owner_id = u.id AND p.is_self = 1);
