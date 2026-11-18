// Made by scripts/privacy-html.mjs from PRIVACY.md. Don't edit it: rebuild.
//
// POLICY_VERSION: the policy as it is now, which new accounts agree to (when
//   it was built). Versions are ISO times, so later ones sort after earlier ones.
// CONSENT_VERSION: the oldest version that still counts as agreeing.
//   Anyone who agreed to an earlier one is asked to agree again
//   (--require-consent moves it up to the current version).
// CONSENT_SUMMARY: what changed, shown when they're asked.
// POLICY_HASH: the wording the version is for (without the date).

export const POLICY_VERSION = "2026-11-18T02:36:21Z";
export const CONSENT_VERSION = "2026-11-16T00:31:05Z";
export const CONSENT_SUMMARY = "Your whole journal is now encrypted on your device, connections between accounts are no longer recorded on our server, and we now count basic usage totals (how many accounts are active, how many entries of each kind, and storage used).";
export const POLICY_HASH = "a1db450a84fce952791f7d3e089c3e3b0a5f4f217b303decfc37c0c92f1c93cd";
