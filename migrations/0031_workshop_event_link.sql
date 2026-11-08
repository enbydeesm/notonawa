-- NotoNawa: a workshop's event link (the listing or event page), encrypted
-- on the device like its album link: it can show what I went to. Checked as
-- an http or https link on the device (public/js/links.js) before sealing.

ALTER TABLE workshops ADD COLUMN event_url TEXT;
