// Which checks a change needs: the app split into feature areas, each with
// its files and its UI walkthrough chunks. Pure, so it's tested
// (test/unit/areas.test.js, which also makes sure every file is in an area).
//
// Every check runs lint, the type check and every Vitest test (about a
// minute and a half): unit tests run in plain Node, so all of them take
// seconds, and picking test files by area wasn't worth keeping lists of
// them. The areas pick the walkthrough chunks, which are the slow part.
//
// A path ending in "/" covers everything under it; anything else is one
// file. A file in more than one area runs the checks of all of them.

// The walkthrough's chunks, in the order a full run goes through them. Each
// is scripts/ui/chunks/<name>.mjs and starts from a new account of its own.
export const UI_CHUNKS = [
  "basics", "lock", "settings", "people", "locations", "plans", "ties", "search",
  "notes", "photos", "drawings", "poses", "deleting", "account", "data", "insights", "education", "shares",
  "share-items", "convert", "contacts", "link", "push",
];

// About how long each chunk takes alone, in seconds (October 2026), for
// sharing them out between parallel runs. Only their sizes against each
// other matter, so they needn't be kept exact; a chunk not listed counts
// as 30.
export const UI_SECONDS = {
  basics: 37, lock: 26, settings: 32, people: 14, locations: 18, plans: 28, ties: 23, search: 35,
  notes: 19, photos: 55, drawings: 40, poses: 40, deleting: 26, account: 67, data: 20, insights: 20, education: 30,
  shares: 65, "share-items": 45, convert: 40, contacts: 60, link: 30, push: 25,
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
 * Files every part of the app depends on: a change to one runs every
 * walkthrough chunk and every generated-file check. So does a change to a
 * file in no area.
 */
export const SHARED = [
  "package.json", "package-lock.json", "wrangler.jsonc", "worker-configuration.d.ts", "vitest.config.js",
  "tsconfig.json", "public/tsconfig.json", "eslint.config.js", "migrations/",
  "src/index.js", "src/format.js", "src/errors.js", "src/http.js", "src/parse.js", "src/sql.js", "src/security-headers.js",
  "src/encryption/config.js",
  "public/index.html", "public/app.css", "public/_headers",
  "public/js/app.js", "public/js/api.js", "public/js/dom.js", "public/js/dialog.js", "public/js/dialog-icons.js",
  "public/js/form-changes.js", "public/js/router.js",
  "public/js/navigate.js", "public/js/nav.js", "public/js/format.js", "public/js/vault.js",
  "public/js/crypto-worker.js", "public/js/crypto/fields.js", "public/js/crypto/keys.js",
  "public/js/crypto/vault-core.js", "public/js/key-flows.js", ".npmrc", "public/js/store/index.js",
  // The cache and the journal in memory: opened at every unlock (format 2).
  "public/js/cache/", "public/js/store/v2/journal.js",
];

/** The tests and their helpers: Vitest runs them all anyway, so a change runs no chunk. */
export const TESTS = ["test/"];

/** The walkthrough's own machinery: a change runs every chunk. */
export const UI_SHARED = ["scripts/ui-smoke.mjs", "scripts/ui/harness.mjs", "scripts/ui/seed.mjs", "scripts/ui/idle.mjs"];

/** Files no check covers (notes for people, editor settings). */
export const IGNORED = [
  "README.md", "CLAUDE.md", "considerations.md", "roadmap.md", "notes.md", ".gitignore", ".claude/",
  "personal.code-workspace", "public/img/", "public/manifest.webmanifest",
];

/**
 * @typedef {{
 *   name: string,
 *   files: string[],
 *   ui: string[],
 *   generated?: ("privacy" | "releases" | "vendor")[],
 * }} Area
 *
 * generated: the generated-file checks (`--check`) its files feed.
 */

/** @type {Area[]} */
export const AREAS = [
  {
    name: "auth",
    files: ["src/auth/", "src/keys/", "public/js/auth-flows.js", "public/js/webauthn.js", "public/js/webauthn-json.js",
      "public/js/codes.js", "public/js/recovery.js", "public/js/recovery-email.js", "public/js/views/signin.js",
      "public/js/views/unlock.js", "scripts/invite.mjs", "scripts/recovery-code.mjs", "scripts/d1.mjs",
      "scripts/d1-target.mjs"],
    ui: ["basics", "lock", "account", "link"],
  },
  {
    name: "push",
    files: ["src/push/", "public/sw.js", "public/js/push.js", "public/js/push-rules.js", "public/js/push-banner.js",
      "public/js/push-settings.js", "scripts/push-keys.mjs"],
    ui: ["push"],
  },
  {
    name: "link",
    files: ["src/link/", "public/js/crypto/link.js", "public/js/link-flows.js", "public/js/pending-link.js",
      "public/js/views/link.js"],
    ui: ["link"],
  },
  {
    name: "version",
    files: ["src/version/", "public/js/version-check.js", "public/js/version-rules.js"],
    ui: ["lock"],
  },
  {
    name: "lock",
    files: ["public/js/lock.js", "public/js/lock-rules.js"],
    ui: ["lock", "photos"],
  },
  {
    name: "tour",
    files: ["public/js/tour.js", "public/js/tour-steps.js", "public/js/tour-layout.js"],
    ui: ["basics", "settings"],
  },
  {
    name: "settings",
    files: ["src/account/settings.js", "public/js/store/v1/settings.js", "public/js/store/v2/settings.js", "public/js/settings.js", "public/js/settings-dialog.js", "public/js/theme.js",
      "public/js/theme-init.js", "public/js/roles.js"],
    ui: ["settings", "people", "ties", "insights"],
  },
  {
    name: "releases",
    files: ["public/js/whats-new.js", "public/js/release-notes.js", "public/js/releases.js", "src/app-version.js",
      "scripts/releases.mjs", "scripts/releases-lib.mjs", "scripts/releases-build.mjs", "scripts/deploy.mjs", "RELEASES.md", "VERSION"],
    ui: ["basics", "settings"],
    generated: ["releases"],
  },
  {
    name: "feedback",
    files: ["src/feedback/", "public/js/feedback-dialog.js", "scripts/feedback.mjs"],
    ui: ["settings"],
  },
  {
    name: "account",
    // data-grid.js: the passkeys' and devices' grids, and Your data's Shared
    // by me and Connections (the shares chunk).
    files: ["src/account/", "public/js/views/account.js", "public/js/data-grid.js"],
    ui: ["account", "shares"],
  },
  {
    name: "consent",
    files: ["src/consent/", "src/policy-version.js", "src/notices/", "public/js/views/consent.js",
      "public/js/consent-state.js", "public/js/notices.js", "scripts/notice.mjs", "scripts/notice-lib.mjs",
      "scripts/privacy-html.mjs", "scripts/policy-lib.mjs", "PRIVACY.md", "public/privacy.html"],
    ui: ["account"],
    generated: ["privacy"],
  },
  {
    name: "install",
    files: ["public/js/install-rules.js", "public/js/install-banner.js"],
    ui: ["basics", "settings", "push"],
  },
  {
    name: "shell",
    files: ["public/js/views/not-found.js"],
    ui: ["basics"],
  },
  {
    name: "resources",
    files: ["src/resources/", "public/js/resource-page.js", "public/js/store/v1/resources.js", "public/js/store/v2/resources.js",
      "public/js/store/queries/resources.js", "public/js/store/queries/plans.js"],
    ui: ["people", "locations", "plans", "deleting"],
  },
  {
    name: "people",
    files: ["public/js/views/people.js", "public/js/aliases.js", "public/js/list-tools.js", "public/js/list-order.js",
      "public/js/person-about.js"],
    ui: ["people", "locations", "ties", "search", "shares"],
  },
  {
    name: "locations",
    files: ["src/locations/", "public/js/views/locations.js", "public/js/maps.js", "public/js/store/maps.js"],
    ui: ["locations"],
  },
  {
    name: "plans",
    files: ["public/js/views/plans.js", "public/js/plans-view.js", "public/js/plan-form.js"],
    ui: ["plans"],
  },
  {
    name: "tags",
    files: ["src/tags/", "public/js/tag-picker.js", "public/js/tags.js", "public/js/store/v1/tags.js", "public/js/store/v2/tags.js",
      "public/js/store/queries/tags.js"],
    ui: ["plans", "ties", "search", "education"],
  },
  {
    name: "ties",
    files: ["src/ties/", "public/js/tie-form.js", "public/js/search-picker.js", "public/js/search-choices.js",
      "public/js/rope-rating.js", "public/js/tie-card.js", "public/js/people-order.js", "public/js/ties-view.js", "public/js/views/ties.js",
      "public/js/links.js", "public/js/person-rows.js", "public/js/store/v1/ties.js", "public/js/store/v2/ties.js", "public/js/store/queries/ties.js"],
    ui: ["ties", "plans", "search", "notes", "deleting", "education"],
  },
  {
    // Workshops: the Education view, its form and its cards.
    name: "education",
    files: ["src/workshops/", "public/js/views/education.js", "public/js/workshop-form.js", "public/js/workshop-card.js",
      "public/js/workshops-view.js", "public/js/person-rows.js", "public/js/currency.js",
      "public/js/workshop-link.js", "public/js/store/v1/workshops.js", "public/js/store/v2/workshops.js", "public/js/store/queries/workshops.js"],
    ui: ["education"],
  },
  {
    name: "search",
    files: ["src/ties/search.js", "public/js/tie-search.js", "public/js/search-match.js", "public/js/multi-select.js"],
    ui: ["search", "notes", "plans", "insights"],
  },
  {
    name: "encryption",
    files: ["src/encryption/", "public/js/seal-leftovers.js", "public/js/vendor/hpke.js", "public/js/vendor/hpke.d.ts",
      "scripts/vendor/hpke-entry.mjs", "scripts/vendor/hpke.d.ts", "scripts/vendor.mjs"],
    ui: ["notes"],
    generated: ["vendor"],
  },
  {
    name: "photos",
    files: ["src/media/", "public/js/crypto/media.js", "public/js/photo-fit.js", "public/js/photo-prep.js",
      "public/js/store/v1/media.js", "public/js/photo-urls.js", "public/js/photos-ui.js",
      "public/js/drag-order.js", "public/js/tile-drag.js", "public/js/video-fit.js", "public/js/video-prep.js", "public/js/vendor/",
      "scripts/vendor.mjs"],
    ui: ["photos", "data", "education"],
    generated: ["vendor"],
  },
  {
    // Shares: profile invites, their codes, Shared by me, opening one, and
    // the connections between accounts they can make.
    name: "shares",
    files: ["src/shares/", "src/connections/", "public/js/store/v1/connections.js", "public/js/store/v2/connections.js", "public/js/crypto/share.js", "public/js/share-options.js", "public/js/profile-share.js",
      "public/js/contact-merge.js", "public/js/pending-share.js", "public/js/qr.js", "public/js/share-code.js",
      "public/js/share-profile-dialog.js", "public/js/shared-by-me.js", "public/js/views/open.js",
      "public/js/connections.js", "public/js/connection-text.js", "public/js/connection-banner.js",
      "public/js/share-save.js", "public/js/open-profile.js", "public/js/share-item.js", "public/js/share-people.js",
      "public/js/share-to-import.js", "public/js/share-item-dialog.js", "public/js/open-item.js"],
    ui: ["shares", "share-items"],
  },
  {
    name: "drawings",
    files: ["src/drawings/", "public/js/drawing-format.js", "public/js/drawing-edit.js", "public/js/drawing-svg.js",
      "public/js/drawing-editor.js", "public/js/drawing-copy.js", "public/js/drawings-ui.js", "public/js/import-drawings.js",
      "public/js/store/v1/drawings.js",
      "public/js/tile-drag.js", "public/js/tool-icons.js", "public/js/item-targets.js", "public/js/add-to-choices.js"],
    ui: ["drawings", "data"],
  },
  {
    name: "poses",
    files: ["src/poses/", "public/js/figure-rig.js", "public/js/pose-format.js", "public/js/pose-skeleton.js",
      "public/js/pose-scene.js", "public/js/pose-editor.js", "public/js/pose-ik.js", "public/js/poses-ui.js",
      "public/js/import-poses.js", "src/pose-presets/", "public/js/pose-presets.js", "public/js/pose-presets-ui.js", "public/js/preset-picker.js", "public/js/preset-list.js",
      "public/js/drawing-copy.js", "public/js/tile-drag.js", "public/js/tool-icons.js", "scripts/vendor/",
      "public/js/pose-cinch.js", "public/js/pose-gravity.js", "public/js/pose-constraints.js", "public/js/pose-uplines.js", "public/js/pose-hang.js", "public/js/pose-surface.js", "public/js/pose-points.js", "public/js/pose-beside-ui.js", "public/js/pose-beside-paths.js", "public/js/pose-marks.js", "public/js/pose-marks-ui.js",
      "public/js/figure-body.js", "public/js/figure-body-data.js", "public/figure/", "scripts/figure/", "public/js/pose-skinning.js", "public/js/joint-limits.js", "public/js/hip-order.js", "public/js/pose-contact.js", "public/js/wake-lock.js",
      "public/js/standalone-poser.js", "public/js/add-to-picker.js", "public/js/add-to-choices.js", "public/js/item-targets.js",
      "public/js/new-entry-start.js", "public/js/pose-hints.js", "public/js/pose-scene-panel.js", "public/js/pose-rope-panel.js",
      "public/js/store/v1/drawings.js", "public/js/store/v1/presets.js",
      "public/js/store/v2/presets.js"],
    ui: ["poses", "data"],
    generated: ["vendor"],
  },
  {
    name: "visuals",
    files: ["src/visuals/", "public/js/visuals-ui.js", "public/js/visual-viewer.js", "public/js/visual-order.js", "public/js/visual-icons.js",
      "public/js/store/v1/visuals.js", "public/js/store/v2/visuals.js"],
    ui: ["photos", "drawings", "poses", "data"],
  },
  {
    name: "data",
    files: ["src/data/", "public/js/store/v1/data.js", "public/js/store/v2/data.js", "public/js/store/queries/export.js", "public/js/views/data.js", "public/js/csv.js", "public/js/import-csv.js",
      "public/js/import-steps.js", "public/js/import-dedupe.js", "public/js/import-photos.js",
      "public/js/journal-fields.js", "public/js/zip.js", "public/js/download.js", "public/import-template.csv",
      "public/js/import-presets.js"],
    // Adding a shared tie, plan or workshop goes through the import.
    ui: ["data", "share-items"],
  },
  {
    name: "insights",
    files: ["src/stats/", "public/js/store/v1/stats.js", "public/js/store/v2/stats.js", "public/js/stats.js", "public/js/stats-period.js", "public/js/charts.js",
      "public/js/chart-parts.js", "public/js/tie-list-dialog.js", "public/js/views/calendar.js",
      "public/js/views/analytics.js", "public/js/map-geo.js", "public/js/world-map.js", "public/js/world-shapes.js",
      "scripts/world-map.mjs", "scripts/world-map-lib.mjs", "public/js/workshop-stats.js"],
    ui: ["insights"],
  },
  {
    // Format 2 records, ids and v3 files: nothing on the page uses them
    // yet, but the crypto Worker loads them, so a change runs basics.
    name: "records",
    files: ["public/js/records/", "public/js/crypto/records.js", "public/js/crypto/files.js", "src/records/", "src/files/"],
    ui: ["basics"],
  },
  {
    // Converting a format 1 journal to format 2 (phase 5).
    name: "convert",
    files: ["public/js/convert/", "public/js/store/convert.js", "public/js/views/convert.js", "src/convert/",
      "scripts/release-cleanup.mjs", "scripts/release-cleanup-lib.mjs"],
    ui: ["convert"],
  },
  {
    // Identity keys, the acceptance, pair-key messages and safety numbers
    // (the crypto Worker loads them too), and contacts in the store: the
    // invite's offer, accepting, the mailboxes checked; profile updates and
    // reviewing them (merged as adding an invite is).
    name: "contacts",
    files: ["public/js/crypto/identity.js", "public/js/crypto/pair.js", "public/js/crypto/safety-number.js", "src/identity/",
      "src/mailboxes/", "public/js/contacts/", "public/js/store/v2/contacts.js", "public/js/profile-merge.js",
      "public/js/profile-update.js", "public/js/contact-verify.js", "public/js/views/verify.js",
      "public/js/share-back-dialog.js", "public/js/profile-choices.js"],
    ui: ["basics", "shares", "share-items", "people", "contacts"],
  },
  {
    name: "backup",
    files: ["src/backup/", "src/cleanup.js", "scripts/backup.mjs", "scripts/backup-lib.mjs", "scripts/backup-keys.mjs",
      "scripts/restore-backup.mjs", "scripts/ask.mjs"],
    ui: [],
  },
  {
    name: "tooling",
    files: ["scripts/areas.mjs", "scripts/check-changed.mjs"],
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
 *   ui: string[],
 *   generated: ("privacy" | "releases" | "vendor")[],
 *   unmapped: string[],
 *   everything: string[],
 * }} CheckPlan
 *
 * ui: the chunks, in walkthrough order. unmapped: changed files in no area
 * (each runs everything). everything: the changed files that made it run
 * everything.
 */

/**
 * The checks a set of changed files needs.
 * @param {string[]} files paths from the repository's root
 * @returns {CheckPlan}
 */
export function planFor(files) {
  /** @type {Set<string>} */ const areas = new Set();
  /** @type {Set<string>} */ const ui = new Set();
  /** @type {Set<"privacy" | "releases" | "vendor">} */ const generated = new Set();
  const unmapped = [], everything = [];
  let allUi = false;

  for (const file of files) {
    if (matches(file, IGNORED) || matches(file, TESTS)) continue;
    if (matches(file, SHARED)) {
      everything.push(file);
      allUi = true;
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
      if (!matches(file, area.files)) continue;
      found = true;
      areas.add(area.name);
      for (const name of area.ui) ui.add(name);
      for (const check of area.generated ?? []) generated.add(check);
    }
    if (!found) {
      unmapped.push(file);
      everything.push(file);
      allUi = true;
    }
  }

  if (everything.length) {
    for (const area of AREAS) for (const check of area.generated ?? []) generated.add(check);
  }
  return {
    areas: [...areas].sort(),
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
    ui: UI_CHUNKS.filter((name) => chosen.some((a) => a.ui.includes(name))),
    generated: [...new Set(chosen.flatMap((a) => a.generated ?? []))].sort(),
    unmapped: [],
    everything: [],
  };
}
