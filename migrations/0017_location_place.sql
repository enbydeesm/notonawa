-- NotoNawa: where a location is: its city, state or province, and country.
--
-- locations.city, locations.state_province, locations.country: typed on
-- the Locations form, all optional. Plain text, like the name and
-- coordinates, so the server can list and (later) filter by them; filling
-- them in from a Maps link or an address is for a later release.
--
-- Only new columns: no table is rebuilt.

ALTER TABLE locations ADD COLUMN city TEXT;
ALTER TABLE locations ADD COLUMN state_province TEXT;
ALTER TABLE locations ADD COLUMN country TEXT;
