-- NotoNawa: a person's "About", kept apart from their private notes.
--
-- people.about: on my own profile, "About me": what a profile invite can
-- share (planned; see considerations.md, "Sharing between accounts"). On
-- anyone else's card, "About them": what they shared with me. Encrypted in
-- the browser, like notes. people.notes stays private: it's never shared.
--
-- Only a new column: no table is rebuilt.

ALTER TABLE people ADD COLUMN about TEXT;
