// The privacy policy's date and version, for scripts/privacy-html.mjs.
// Pure, so it's easy to test.

const DATE_LINE = /^\*\*Last updated:\*\* .*$/m;

/**
 * PRIVACY.md with its "Last updated" line blanked, so a new date alone
 * doesn't count as a change.
 * @param {string} markdown
 */
export function unstamped(markdown) {
  return markdown.replace(DATE_LINE, "**Last updated:**");
}

/**
 * PRIVACY.md with a new "Last updated" date.
 * @param {string} markdown
 * @param {string} date as it's shown, e.g. "October 17, 2026"
 */
export function stamp(markdown, date) {
  if (!DATE_LINE.test(markdown)) throw new Error('PRIVACY.md needs a "**Last updated:** …" line.');
  return markdown.replace(DATE_LINE, `**Last updated:** ${date}`);
}

/**
 * The date as the policy shows it, on this computer's calendar.
 * @param {Date} when
 */
export function policyDate(when) {
  return when.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * src/policy-version.js.
 * @param {{ version: string, hash: string, consent: { version: string, summary: string | null } }} values
 */
export function consentFile({ version, hash, consent }) {
  return `// Made by scripts/privacy-html.mjs from PRIVACY.md. Don't edit it: rebuild.
//
// POLICY_VERSION: the policy as it is now, which new accounts agree to (when
//   it was built). Versions are ISO times, so later ones sort after earlier ones.
// CONSENT_VERSION: the oldest version that still counts as agreeing.
//   Anyone who agreed to an earlier one is asked to agree again
//   (--require-consent moves it up to the current version).
// CONSENT_SUMMARY: what changed, shown when they're asked.
// POLICY_HASH: the wording the version is for (without the date).

export const POLICY_VERSION = ${JSON.stringify(version)};
export const CONSENT_VERSION = ${JSON.stringify(consent.version)};
export const CONSENT_SUMMARY = ${JSON.stringify(consent.summary)};
export const POLICY_HASH = ${JSON.stringify(hash)};
`;
}
