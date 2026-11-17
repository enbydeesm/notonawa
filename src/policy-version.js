// Made by scripts/privacy-html.mjs from PRIVACY.md. Don't edit it: rebuild.
//
// POLICY_VERSION: the policy as it is now, which new accounts agree to (when
//   it was built). Versions are ISO times, so later ones sort after earlier ones.
// CONSENT_VERSION: the oldest version that still counts as agreeing.
//   Anyone who agreed to an earlier one is asked to agree again
//   (--require-consent moves it up to the current version).
// CONSENT_SUMMARY: what changed, shown when they're asked.
// POLICY_HASH: the wording the version is for (without the date).

export const POLICY_VERSION = "2026-11-17T05:12:48Z";
export const CONSENT_VERSION = "2026-11-16T00:31:05Z";
export const CONSENT_SUMMARY = "Your whole journal is now encrypted on your device, connections between accounts are no longer recorded on our server, and we now count basic usage totals (how many accounts are active, how many entries of each kind, and storage used).";
export const POLICY_HASH = "7f2aa4624e09eef1a741fabb88e6a1c988af6606d32c3f377c54edddbe5751d4";
