// Made by scripts/privacy-html.mjs from PRIVACY.md. Don't edit it: rebuild.
//
// POLICY_VERSION: the policy as it is now, which new accounts agree to (when
//   it was built). Versions are ISO times, so later ones sort after earlier ones.
// CONSENT_VERSION: the oldest version that still counts as agreeing.
//   Anyone who agreed to an earlier one is asked to agree again
//   (--require-consent moves it up to the current version).
// CONSENT_SUMMARY: what changed, shown when they're asked.
// POLICY_HASH: the wording the version is for (without the date).

export const POLICY_VERSION = "2026-11-15T10:34:00Z";
export const CONSENT_VERSION = "2026-11-15T10:34:00Z";
export const CONSENT_SUMMARY = "Your whole journal is now encrypted on your device, connections between accounts are no longer recorded on our server, and we now count basic usage totals (how many accounts are active, how many entries of each kind, and storage used).";
export const POLICY_HASH = "bad3bceeb3eb4bab8b2201947bb2b662b220099c4f856f4fcb8d1758c144a1bc";
