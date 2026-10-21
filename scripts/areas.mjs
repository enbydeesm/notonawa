// Which checks a change needs: the app split into feature areas, each with
// its files, its tests and its UI walkthrough chunks. Pure, so it's tested
// (test/unit/areas.test.js, which also makes sure every file is in an area).
//
// A path ending in "/" covers everything under it; anything else is one
// file. A file in more than one area runs the checks of all of them.

// The walkthrough's chunks, in the order a full run goes through them. Each
// is scripts/ui/chunks/<name>.mjs and starts from a new account of its own.
export const UI_CHUNKS = [
  "basics", "lock", "settings", "people", "locations", "plans", "ties", "search",
  "notes", "photos", "deleting", "account", "data", "insights", "education",
];

// About how long each chunk takes alone, in seconds (October 2026), for
// sharing them out between parallel runs. Only their sizes against each
// other matter, so they needn't be kept exact; a chunk not listed counts
// as 30.
export const UI_SECONDS = {
  basics: 37, lock: 26, settings: 32, people: 14, locations: 18, plans: 28, ties: 23, search: 35,
  notes: 19, photos: 55, deleting: 26, account: 67, data: 20, insights: 20, education: 30,
};

/**
 * Shares chunks out between `jobs` parallel runs so they finish at about
 * the same time: the longest first, each to the run with least to do so
 * far. Each run keeps the walkthrough's order. No empty runs.
 * @param {string[]} chunks
 * @param {number} jobs
 * @param {Record<string, number>} [seconds]
 * @returns {string[][]}
 */
export function batches(chunks, jobs, seconds = UI_SECONDS) {
  const count = Math.max(1, Math.min(Math.floor(jobs) || 1, chunks.length));
  const runs = Array.from({ length: count }, () => ({ chunks: /** @type {string[]} */ ([]), total: 0 }));
  const time = (/** @type {string} */ name) => seconds[name] ?? 30;
  const longestFirst = [...chunks].sort((a, b) => time(b) - time(a) || chunks.indexOf(a) - chunks.indexOf(b));
  for (const name of longestFirst) {
    const run = runs.reduce((least, r) => (r.total < least.total ? r : least));
    run.chunks.push(name);
    run.total += time(name);
  }
  return runs.map((r) => chunks.filter((name) => r.chunks.includes(name))).filter((r) => r.length);
}

/**
 * Files every part of the app depends on: a change to one runs every test
 * and every walkthrough chunk. So does a change to a file in no area.
 */
export const SHARED = [
  "package.json", "package-lock.json", "wrangler.jsonc", "worker-configuration.d.ts", "vitest.config.js",
  "tsconfig.json", "public/tsconfig.json", "eslint.config.js", "migrations/",
  "src/index.js", "src/errors.js", "src/http.js", "src/parse.js", "src/sql.js", "src/security-headers.js",
  "src/encryption/config.js",
  "public/index.html", "public/app.css", "public/_headers",
  "public/js/app.js", "public/js/api.js", "public/js/dom.js", "public/js/dialog.js", "public/js/router.js",
  "public/js/navigate.js", "public/js/nav.js", "public/js/format.js", "public/js/vault.js",
  "public/js/crypto-worker.js", "public/js/crypto/fields.js", "public/js/crypto/keys.js",
  "public/js/crypto/vault-core.js", "public/js/key-flows.js", ".npmrc",
];

/** What every test file leans on: a change runs every test, but no walkthrough chunk. */
export const TEST_SHARED = ["test/helpers.js", "test/apply-migrations.js", "test/fake-passkey.js", "test/sealed.js", "test/env.d.ts"];

/** The walkthrough's own machinery: a change runs every chunk, but no test. */
export const UI_SHARED = ["scripts/ui-smoke.mjs", "scripts/ui/harness.mjs", "scripts/ui/seed.mjs"];

/** Files no check covers (notes for people, editor settings). */
export const IGNORED = [
  "README.md", "CLAUDE.md", "considerations.md", "roadmap.md", "notes.md", ".gitignore", ".claude/",
  "personal.code-workspace", "public/img/", "public/manifest.webmanifest",
];

/**
 * @typedef {{
 *   name: string,
 *   files: string[],
 *   tests: string[],
 *   ui: string[],
 *   generated?: ("privacy" | "releases" | "welcome" | "vendor")[],
 * }} Area
 *
 * generated: the generated-file checks (`--check`) its files feed.
 */

/** @type {Area[]} */
export const AREAS = [
  {
    // The tests of the shared files: a change to one runs just it (a change
    // to a shared file runs everything anyway).
    name: "core",
    files: [],
    tests: ["test/unit/assemble-and-errors.test.js", "test/unit/parse.test.js", "test/unit/router.test.js",
      "test/unit/security-headers.test.js", "test/api/security-headers.test.js", "test/unit/crypto-fields.test.js",
      "test/unit/crypto-keys.test.js", "test/unit/vault-core.test.js", "test/db/schema.test.js"],
    ui: [],
  },
  {
    name: "auth",
    files: ["src/auth/", "src/keys/", "public/js/auth-flows.js", "public/js/webauthn.js", "public/js/webauthn-json.js",
      "public/js/codes.js", "public/js/recovery.js", "public/js/recovery-email.js", "public/js/views/signin.js",
      "public/js/views/unlock.js", "scripts/invite.mjs", "scripts/recovery-code.mjs", "scripts/d1.mjs"],
    tests: ["test/api/auth.test.js", "test/unit/auth.test.js", "test/unit/webauthn-json.test.js",
      "test/unit/recovery-email.test.js", "test/unit/keys-parse.test.js"],
    ui: ["basics", "lock", "account"],
  },
  {
    name: "lock",
    files: ["public/js/lock.js", "public/js/lock-rules.js"],
    tests: ["test/unit/lock-rules.test.js"],
    ui: ["lock", "photos"],
  },
  {
    name: "welcome",
    files: ["public/js/welcome.js", "public/js/welcome-text.js", "scripts/welcome.mjs", "scripts/welcome-lib.mjs", "WELCOME.md"],
    tests: ["test/unit/welcome-lib.test.js"],
    ui: ["basics"],
    generated: ["welcome"],
  },
  {
    name: "settings",
    files: ["src/account/settings.js", "public/js/settings.js", "public/js/settings-dialog.js", "public/js/theme.js",
      "public/js/theme-init.js", "public/js/roles.js"],
    tests: ["test/api/settings.test.js", "test/unit/account-settings.test.js", "test/unit/theme.test.js", "test/unit/roles.test.js"],
    ui: ["settings", "people", "ties", "insights"],
  },
  {
    name: "releases",
    files: ["public/js/whats-new.js", "public/js/release-notes.js", "public/js/releases.js", "src/app-version.js",
      "scripts/releases.mjs", "scripts/releases-lib.mjs", "RELEASES.md"],
    tests: ["test/unit/releases.test.js"],
    ui: ["basics", "settings"],
    generated: ["releases"],
  },
  {
    name: "feedback",
    files: ["src/feedback/", "public/js/feedback-dialog.js", "scripts/feedback.mjs"],
    tests: ["test/api/feedback.test.js", "test/unit/feedback-mail.test.js", "test/unit/feedback-parse.test.js"],
    ui: ["settings"],
  },
  {
    name: "account",
    files: ["src/account/", "public/js/views/account.js"],
    tests: ["test/api/account-delete.test.js", "test/api/settings.test.js"],
    ui: ["account"],
  },
  {
    name: "consent",
    files: ["src/consent/", "src/policy-version.js", "src/notices/", "public/js/views/consent.js",
      "public/js/consent-state.js", "public/js/notices.js", "scripts/notice.mjs", "scripts/notice-lib.mjs",
      "scripts/privacy-html.mjs", "scripts/policy-lib.mjs", "PRIVACY.md", "public/privacy.html"],
    tests: ["test/api/notices-consent.test.js", "test/unit/consent.test.js", "test/unit/notice-lib.test.js",
      "test/unit/policy-lib.test.js"],
    ui: ["account"],
    generated: ["privacy"],
  },
  {
    name: "shell",
    files: ["public/js/views/not-found.js"],
    tests: [],
    ui: ["basics"],
  },
  {
    name: "resources",
    files: ["src/resources/", "public/js/resource-page.js"],
    tests: ["test/api/resources.test.js", "test/unit/resources-config.test.js"],
    ui: ["people", "locations", "plans", "deleting"],
  },
  {
    name: "people",
    files: ["public/js/views/people.js", "public/js/aliases.js", "public/js/list-tools.js", "public/js/list-order.js"],
    tests: ["test/api/resources.test.js", "test/unit/aliases.test.js", "test/unit/list-order.test.js"],
    ui: ["people", "locations", "ties", "search"],
  },
  {
    name: "locations",
    files: ["src/locations/", "public/js/views/locations.js"],
    tests: ["test/api/resources.test.js", "test/unit/maps.test.js"],
    ui: ["locations"],
  },
  {
    name: "plans",
    files: ["public/js/views/plans.js", "public/js/plans-view.js"],
    tests: ["test/api/resources.test.js", "test/unit/plans-view.test.js"],
    ui: ["plans"],
  },
  {
    name: "tags",
    files: ["src/tags/", "public/js/tag-picker.js", "public/js/tags.js"],
    tests: ["test/api/tags.test.js", "test/unit/tags.test.js", "test/unit/tags-parse.test.js"],
    ui: ["plans", "ties", "search", "education"],
  },
  {
    name: "ties",
    files: ["src/ties/", "public/js/tie-form.js", "public/js/search-picker.js", "public/js/search-choices.js",
      "public/js/rope-rating.js", "public/js/tie-card.js", "public/js/ties-view.js", "public/js/views/ties.js",
      "public/js/links.js", "public/js/person-rows.js"],
    tests: ["test/api/ties.test.js", "test/unit/ties-parse.test.js", "test/unit/search-choices.test.js",
      "test/unit/links.test.js", "test/unit/pages.test.js"],
    ui: ["ties", "plans", "search", "notes", "deleting", "education"],
  },
  {
    // Workshops: the Education view, its form and its cards.
    name: "education",
    files: ["src/workshops/", "public/js/views/education.js", "public/js/workshop-form.js", "public/js/workshop-card.js",
      "public/js/workshops-view.js", "public/js/person-rows.js"],
    tests: ["test/api/workshops.test.js", "test/unit/workshops-parse.test.js", "test/unit/workshops-view.test.js"],
    ui: ["education"],
  },
  {
    name: "search",
    files: ["src/ties/search.js", "public/js/tie-search.js", "public/js/search-match.js", "public/js/multi-select.js"],
    tests: ["test/api/ties-search.test.js", "test/unit/ties-search.test.js", "test/unit/tie-search.test.js",
      "test/unit/search-match.test.js"],
    ui: ["search", "notes", "plans", "insights"],
  },
  {
    name: "encryption",
    files: ["src/encryption/", "public/js/seal-leftovers.js"],
    tests: ["test/api/encryption.test.js"],
    ui: ["notes"],
  },
  {
    name: "photos",
    files: ["src/media/", "public/js/crypto/media.js", "public/js/photo-fit.js", "public/js/photo-prep.js",
      "public/js/photo-upload.js", "public/js/photo-urls.js", "public/js/photos-ui.js",
      "public/js/drag-order.js", "public/js/video-fit.js", "public/js/video-prep.js", "public/js/vendor/",
      "scripts/vendor.mjs"],
    tests: ["test/api/media.test.js", "test/unit/media-parse.test.js", "test/unit/crypto-media.test.js", "test/unit/photo-fit.test.js",
      "test/unit/drag-order.test.js", "test/unit/video-fit.test.js"],
    ui: ["photos", "data", "education"],
    generated: ["vendor"],
  },
  {
    name: "data",
    files: ["src/data/", "public/js/views/data.js", "public/js/csv.js", "public/js/import-csv.js",
      "public/js/import-steps.js", "public/js/import-dedupe.js", "public/js/import-photos.js",
      "public/js/journal-fields.js", "public/js/zip.js", "public/js/download.js", "public/import-template.csv"],
    tests: ["test/api/data-export.test.js", "test/api/data-import.test.js", "test/unit/data-shape.test.js",
      "test/unit/import.test.js", "test/unit/csv-import.test.js", "test/unit/journal-fields.test.js",
      "test/unit/import-photos.test.js", "test/unit/zip.test.js"],
    ui: ["data"],
  },
  {
    name: "insights",
    files: ["src/stats/", "public/js/stats.js", "public/js/stats-period.js", "public/js/charts.js",
      "public/js/chart-parts.js", "public/js/tie-list-dialog.js", "public/js/views/calendar.js",
      "public/js/views/analytics.js", "public/js/map-geo.js", "public/js/world-map.js", "public/js/world-shapes.js",
      "scripts/world-map.mjs", "scripts/world-map-lib.mjs"],
    tests: ["test/api/stats.test.js", "test/unit/stats.test.js", "test/unit/stats-parse.test.js",
      "test/unit/stats-period.test.js", "test/unit/chart-parts.test.js", "test/unit/map-geo.test.js"],
    ui: ["insights"],
  },
  {
    name: "backup",
    files: ["src/backup/", "src/cleanup.js", "scripts/backup.mjs", "scripts/backup-lib.mjs", "scripts/backup-keys.mjs",
      "scripts/restore-backup.mjs", "scripts/ask.mjs"],
    tests: ["test/api/backup.test.js", "test/api/cleanup.test.js", "test/unit/backup-cloud.test.js", "test/unit/backup-lib.test.js"],
    ui: [],
  },
  {
    name: "tooling",
    files: ["scripts/areas.mjs", "scripts/check-changed.mjs"],
    tests: ["test/unit/areas.test.js"],
    ui: [],
  },
];

/**
 * Whether a path is one of the entries (a file, or a folder ending in "/").
 * @param {string} file
 * @param {string[]} entries
 */
export function matches(file, entries) {
  return entries.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));
}

/**
 * @typedef {{
 *   areas: string[],
 *   tests: "all" | string[],
 *   ui: string[],
 *   generated: ("privacy" | "releases" | "welcome" | "vendor")[],
 *   unmapped: string[],
 *   everything: string[],
 * }} CheckPlan
 *
 * tests: "all", or the test files to run (none if empty). ui: the chunks, in
 * walkthrough order. unmapped: changed files in no area (each runs
 * everything). everything: the changed files that made it run everything.
 */

/**
 * The checks a set of changed files needs.
 * @param {string[]} files paths from the repository's root
 * @returns {CheckPlan}
 */
export function planFor(files) {
  /** @type {Set<string>} */ const areas = new Set();
  /** @type {Set<string>} */ const tests = new Set();
  /** @type {Set<string>} */ const ui = new Set();
  /** @type {Set<"privacy" | "releases" | "welcome" | "vendor">} */ const generated = new Set();
  const unmapped = [], everything = [];
  let allTests = false, allUi = false;

  for (const file of files) {
    if (matches(file, IGNORED)) continue;
    if (matches(file, SHARED)) {
      everything.push(file);
      allTests = allUi = true;
      continue;
    }
    if (matches(file, TEST_SHARED)) {
      allTests = true;
      continue;
    }
    if (matches(file, UI_SHARED)) {
      allUi = true;
      continue;
    }
    const chunk = /^scripts\/ui\/chunks\/([a-z-]+)\.mjs$/.exec(file)?.[1];
    if (chunk && UI_CHUNKS.includes(chunk)) {
      ui.add(chunk);
      continue;
    }
    let found = false;
    for (const area of AREAS) {
      if (!matches(file, area.files) && !area.tests.includes(file)) continue;
      found = true;
      areas.add(area.name);
      for (const test of area.tests) tests.add(test);
      for (const name of area.ui) ui.add(name);
      for (const check of area.generated ?? []) generated.add(check);
    }
    // A changed test runs itself, even before it's put in an area.
    if (/^test\/.*\.test\.js$/.test(file)) {
      tests.add(file);
      found = true;
    }
    if (!found) {
      unmapped.push(file);
      everything.push(file);
      allTests = allUi = true;
    }
  }

  if (everything.length) {
    for (const area of AREAS) for (const check of area.generated ?? []) generated.add(check);
  }
  return {
    areas: [...areas].sort(),
    tests: allTests ? "all" : [...tests].sort(),
    ui: allUi ? [...UI_CHUNKS] : UI_CHUNKS.filter((name) => ui.has(name)),
    generated: [...generated].sort(),
    unmapped,
    everything,
  };
}

/**
 * The checks for areas named by hand (`npm run check:changed -- people`).
 * Throws on a name that isn't an area.
 * @param {string[]} names
 * @returns {CheckPlan}
 */
export function planForAreas(names) {
  const chosen = names.map((name) => {
    const area = AREAS.find((a) => a.name === name);
    if (!area) throw new Error(`No area called "${name}". The areas: ${AREAS.map((a) => a.name).join(", ")}.`);
    return area;
  });
  return {
    areas: chosen.map((a) => a.name).sort(),
    tests: [...new Set(chosen.flatMap((a) => a.tests))].sort(),
    ui: UI_CHUNKS.filter((name) => chosen.some((a) => a.ui.includes(name))),
    generated: [...new Set(chosen.flatMap((a) => a.generated ?? []))].sort(),
    unmapped: [],
    everything: [],
  };
}
