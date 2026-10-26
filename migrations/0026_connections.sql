-- NotoNawa: connecting accounts, chosen through a profile invite (see
-- considerations.md, "Sharing between accounts": "Connecting accounts").
--
-- connections: one row for each side of a connection, so each account's
-- row is its own (its id, its sealed label, whether it's answered), scoped
-- by owner_id like every other table. A connection is always two rows, made
-- in one batch (src/connections/db.js); deleting either deletes the other
-- (trg_connections_pair). Account ids never leave the server: pages see only
-- their own row's id.
--   owner_id: whose row this is. peer_id: the other account.
--   invited: 1 on the side whose invite was accepted.
--   label: sealed with the owner's data key. The inviter's is the invite's
--     name; the accepter's is the name the profile was shared as.
--   answered: 0 until the inviter has put the connection on a Person, made
--     a new one, or chosen Not now (their banner). Always 1 for the accepter.
-- Deleted with either account (both columns cascade).
--
-- connection_offers: made when someone else opens a profile invite that
-- offers to connect (shares.connect), and spent when they accept. Only a
-- hash of its token is kept, not who opened it. Expired ones are deleted
-- by the daily job.
--   label: the invite's sealed name, copied, as the invite may be used up
--     before they accept.
--
-- shares.connect: 1 on a profile invite that offers to connect. Plain: the
-- server must know, as it can't read the invite.
--
-- people.connection_id: my row of a connection, on the card for that
-- person. Only one of my own rows, only on someone other than me, and on
-- one card at most; cleared when the connection goes.
--
-- Only new tables, columns, indexes and triggers: nothing is rebuilt. Each
-- trigger's BEGIN … END stays on one line: the test setup splits statements
-- at a ";" that ends a line.

CREATE TABLE connections (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited     INTEGER NOT NULL CHECK (invited IN (0, 1)),
  label       TEXT,
  answered    INTEGER NOT NULL DEFAULT 1 CHECK (answered IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (owner_id <> peer_id),
  UNIQUE (owner_id, peer_id)
);

CREATE INDEX idx_connections_peer ON connections(peer_id);

-- A connection never moves between accounts or changes sides.
CREATE TRIGGER trg_connections_fixed BEFORE UPDATE OF id, owner_id, peer_id, invited ON connections
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: connection cannot move'); END;

-- Removing one side removes the other.
CREATE TRIGGER trg_connections_pair AFTER DELETE ON connections
BEGIN DELETE FROM connections WHERE owner_id = OLD.peer_id AND peer_id = OLD.owner_id; END;

CREATE TABLE connection_offers (
  token_hash  TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_connection_offers_expires ON connection_offers(expires_at);

ALTER TABLE shares ADD COLUMN connect INTEGER NOT NULL DEFAULT 0 CHECK (connect IN (0, 1) AND (connect = 0 OR kind = 'profile'));

ALTER TABLE people ADD COLUMN connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_people_connection ON people(connection_id) WHERE connection_id IS NOT NULL;

CREATE TRIGGER trg_people_connection_insert BEFORE INSERT ON people WHEN NEW.connection_id IS NOT NULL AND (NEW.is_self = 1 OR NOT EXISTS (SELECT 1 FROM connections WHERE id = NEW.connection_id AND owner_id = NEW.owner_id))
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: connection'); END;

CREATE TRIGGER trg_people_connection_update BEFORE UPDATE OF connection_id, is_self ON people WHEN NEW.connection_id IS NOT NULL AND (NEW.is_self = 1 OR NOT EXISTS (SELECT 1 FROM connections WHERE id = NEW.connection_id AND owner_id = NEW.owner_id))
BEGIN SELECT RAISE(ABORT, 'ownership mismatch: connection'); END;
