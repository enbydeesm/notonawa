// Made by scripts/releases.mjs from RELEASES.md. Don't edit it: rebuild.

/** The app's version: the newest release. */
export const APP_VERSION = "2026.10.19.001";

/** @type {{ version: string, notes: string[] }[]} newest first */
export const RELEASES = [
  {
    "version": "2026.10.19.001",
    "notes": [
      "Every tie now has a type. Ties logged without one are now hashira: change any that should be something else.",
      "Plans can have a tie type and tags, like ties.",
      "Ties and plans can link to a photo album (Google Photos, iCloud or anywhere else). The link is encrypted, like your notes.",
      "Plan difficulty is chosen with rope hanks, and your default location stays at the top of Locations.",
      "\"What's new\" in the menu shows these notes again."
    ]
  }
];
