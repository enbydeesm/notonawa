// The UI walkthrough's machinery (scripts/ui-smoke.mjs runs it): a fresh
// local database, wrangler dev on it, headless Chrome driven over the
// DevTools protocol, and the helpers each chunk (scripts/ui/chunks/) uses.
// Importing it starts all that; stop() ends it.

import { newVapidKeys } from "../../src/push/webpush.js";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { IDLE_TRACKER, WAIT_HELPERS } from "./idle.mjs";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// Several walkthroughs can run at once (scripts/ui-smoke.mjs --jobs), each
// with its own database, app and Chrome: UI_SLOT (0, 1, 2…) gives each its
// own ports.
const SLOT = Number(process.env.UI_SLOT ?? 0);
/** The format this run's accounts are in: UI_FORMAT, set by ui-smoke.mjs's --format. */
export const FORMAT = process.env.UI_FORMAT === "2" ? 2 : 1;
const PORT = 8799 + SLOT;
const DEBUG_PORT = 9333 + SLOT;
const INSPECTOR_PORT = 9430 + SLOT;
export const BASE = `http://localhost:${PORT}`;
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const workDir = mkdtempSync(path.join(tmpdir(), "rope-ui-"));
const children = [];
// Failed checks, and chunks that stopped part-way (each counts as one).
let failures = 0;
export const failureCount = () => failures;
export const addFailure = () => { failures++; };

/**
 * Sends a signal to each program's whole process group: `npx wrangler dev`
 * starts wrangler and workerd under it, which killing npx alone leaves
 * running (on Linux).
 * @param {NodeJS.Signals | 0} signal 0 only asks whether any are still running
 * @returns {boolean} whether any group was still there
 */
function signalChildren(signal) {
  let running = false;
  for (const child of children) {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), signal);
      running = true;
    } catch {
      // that group has gone
    }
  }
  return running;
}

/**
 * Deletes the work folder. Never throws: a program still shutting down can
 * write to it as it goes (macOS then refuses with ENOTEMPTY), and a folder
 * left in the temp folder is harmless; a crash here would fail a run whose
 * checks all passed.
 */
function removeWorkDir() {
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (err) {
    console.log(`  (couldn't delete ${workDir}: ${/** @type {Error} */ (err).message})`);
  }
}

// When the process is ending anyway (a crash, Ctrl-C): no time to wait.
function cleanup() {
  signalChildren("SIGTERM");
  children.length = 0;
  removeWorkDir();
}
// However this process ends (a crash or Ctrl-C too), its app and Chrome end
// with it: one left running would hold its ports, and the next run on them
// would test it instead of its own (or wait on it for good).
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => process.exit(130));

/**
 * Starts a program this walkthrough needs, stopping everything if it can't.
 * @param {string} command
 * @param {string[]} args
 * @param {import("node:child_process").SpawnOptions} options
 */
function start(command, args, options) {
  // In a process group of its own, so cleanup() stops everything it starts.
  const child = spawn(command, args, { ...options, detached: true });
  child.on("error", (err) => {
    console.error(`Couldn't start ${command}: ${err.message}`);
    process.exit(1);
  });
  children.push(child);
}

/**
 * Stops if something is already answering on a port this run needs (most
 * likely one left from an earlier run), rather than testing that.
 * @param {string} url
 * @param {string} what
 */
async function refuseIfInUse(url, what) {
  const inUse = await fetch(url).then(() => true, () => false);
  if (inUse) {
    console.error(`Something is already running at ${url}, where ${what} goes. Stop it (an earlier walkthrough left running?) and try again.`);
    process.exit(1);
  }
}

// Checks left out on this machine (skip()): not failures, but said.
let skipped = 0;
export const skippedCount = () => skipped;

/**
 * Leaves out checks this machine can't run, saying so; they aren't failures.
 * Only for what a machine lacks (Claude's cloud machine's Chrome can't
 * encode AAC sound), never for a check that fails.
 * @param {string} what
 * @param {string} why
 */
export function skip(what, why) {
  skipped++;
  console.log(`  ↷ skipped: ${what} (${why})`);
}

export function check(label, actual, expected) {
  if (isDeepStrictEqual(actual, expected)) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
}

async function waitFor(url, what) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error(`${what} didn't start`);
}

// --- start the app on a fresh database -------------------------------------

export const dbDir = path.join(workDir, "state");
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "notonawa", "--local", "--persist-to", dbDir], { encoding: "utf8" });
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr);
  cleanup();
  process.exit(1);
}

// The app's own wrangler.jsonc, with a higher sign-in rate limit: every page
// load here locks the journal and unlocking signs in, so this walkthrough
// signs in far more often a minute than a person would (the limit itself is
// tested in test/api/auth.test.js). Paths are made absolute, as the copy
// lives in the work folder. Only whole-line comments are stripped (the file
// has URLs with // in them).
const projectDir = path.resolve(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(path.join(projectDir, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));
config.main = path.join(projectDir, config.main);
config.assets.directory = path.join(projectDir, config.assets.directory);
config.ratelimits = config.ratelimits.map((r) => ({ ...r, simple: { ...r.simple, limit: 1000 } }));
for (const db of config.d1_databases) db.migrations_dir = path.join(projectDir, "migrations");
// Local D1 and R2 only: wrangler.jsonc marks them remote for `npm run dev`,
// and this walkthrough must never touch the real ones.
for (const binding of [...config.d1_databases, ...config.r2_buckets]) delete binding.remote;
// wrangler dev rewrites each request's Origin to dev.host (see wrangler.jsonc),
// so it must be this walkthrough's own address.
config.dev = { ...config.dev, host: `localhost:${PORT}` };
// The format new accounts start in (npm run test:ui -- --format 2):
// every chunk signs up its own account, so this runs the whole walkthrough
// on format 1 or format 2 journals.
// Format 1 accounts stay format 1 here (no conversion at unlock), so the
// walkthrough still runs on them until phase 8 removes format 1; the
// convert chunk converts its own account directly.
config.vars = { ...config.vars, NEW_ACCOUNT_FORMAT: FORMAT === 2 ? "2" : "1", CONVERT_ON_UNLOCK: FORMAT === 2 ? "1" : "0" };
// Push notifications offered (a public key to subscribe with), but none sent:
// no private key, so nothing here ever posts to a real push service.
config.vars.VAPID_PUBLIC_KEY = (await newVapidKeys()).publicKey;
const configPath = path.join(workDir, "wrangler.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));

await refuseIfInUse(`${BASE}/`, "wrangler dev");
start("npx", [
  "wrangler", "dev", "--config", configPath, "--persist-to", dbDir, "--port", String(PORT),
  "--inspector-port", String(INSPECTOR_PORT),
  "--var", `ORIGIN:${BASE}`, "--var", "RP_ID:localhost",
], { stdio: "ignore", cwd: projectDir });
await waitFor(`${BASE}/`, "wrangler dev");

// --- start Chrome and connect ------------------------------------------------

await refuseIfInUse(`http://127.0.0.1:${DEBUG_PORT}/json`, "Chrome's debugging port");
// --enable-unsafe-swiftshader: the poser's 3D view draws even where
// headless Chrome has no GPU to use (recent Chrome only falls back to its
// software renderer for WebGL when asked). It only draws our own pages.
start(CHROME, [
  "--headless=new", "--enable-unsafe-swiftshader", `--remote-debugging-port=${DEBUG_PORT}`, "--window-size=420,1400",
  "--no-first-run", `--user-data-dir=${path.join(workDir, "chrome")}`, "about:blank",
], { stdio: "ignore" });
const targets = await (await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json`, "Chrome")).json();

// Tabs: the walkthrough drives one at a time (useTab), "main" unless a
// chunk needs a second account at once (the contacts chunk). Each other tab
// is a browser context of its own, like another person's browser: its own
// cookies, storage, passkey device and recovery code.

/**
 * @typedef {{ name: string, ws: WebSocket, nextId: number, pending: Map<number, (msg: any) => void>, authenticatorId: string,
 *   code: string }} Tab
 */

export const consoleErrors = [];

/**
 * Connects to a DevTools target.
 * @param {string} url its webSocketDebuggerUrl
 * @param {string} name
 * @returns {Promise<Tab>}
 */
async function connect(url, name) {
  const ws = new WebSocket(url);
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  /** @type {Tab} */
  const tab = { name, ws, nextId: 1, pending: new Map(), authenticatorId: "", code: "" };
  // Another tab's errors say which.
  const note = (/** @type {string} */ text) => consoleErrors.push(name === "main" ? text : `[${name}] ${text}`);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && tab.pending.has(msg.id)) {
      tab.pending.get(msg.id)(msg);
      tab.pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      note(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      note(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    }
    // The browser's own messages, e.g. a script or style blocked by the CSP.
    // Network ones are left out: some steps get a 400 on purpose.
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && msg.params.entry.source !== "network") {
      note(msg.params.entry.text);
    }
    // An alert() blocks the page (and so the step waiting on it): note it as
    // an error and dismiss it.
    if (msg.method === "Page.javascriptDialogOpening") {
      note(`${msg.params.type}: ${msg.params.message}`);
      ws.send(JSON.stringify({ id: tab.nextId++, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
  });
  return tab;
}

/**
 * @param {Tab} tab
 * @param {string} method
 * @param {object} [params]
 * @returns {Promise<any>}
 */
const tabSend = (tab, method, params = {}) => new Promise((resolve) => {
  const id = tab.nextId++;
  tab.pending.set(id, resolve);
  tab.ws.send(JSON.stringify({ id, method, params }));
});

/** @type {Map<string, Tab>} */
const tabs = new Map();
let current = await connect(targets.find((t) => t.type === "page").webSocketDebuggerUrl, "main");
tabs.set("main", current);

/** Sends a DevTools command to the tab in use. */
export const send = (method, params = {}) => tabSend(current, method, params);

// A virtual passkey, like a phone's: discoverable, verifies the user, and can
// derive encryption keys (PRF). Chrome answers passkey requests with it.
// prf: false is a device that can sign in but not unlock (no PRF).
export const addAuthenticator = async ({ prf = true } = {}) => (await send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf,
  },
})).result.authenticatorId;

/** Readies the tab in use: its events, the idle tracker, focus, and a passkey device. */
async function prepare() {
  await send("Runtime.enable");
  await send("Page.enable");
  // Lets steps wait only while the app is busy (scripts/ui/idle.mjs).
  await send("Page.addScriptToEvaluateOnNewDocument", { source: IDLE_TRACKER });
  // The notifications offer counts as answered on every page, so it isn't
  // over every chunk's views; the push chunk asks for it (sessionStorage).
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { if (!sessionStorage.getItem("ui-push-banner")) localStorage.setItem("push-asked", "1"); } catch {}`,
  });
  // Headless Chrome isn't a focused window, so focus and blur events wouldn't
  // fire (the tie form's location picker opens and settles on them).
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Log.enable");
  await send("WebAuthn.enable", { enableUI: false });
  current.authenticatorId = await addAuthenticator();
}
await prepare();

/**
 * Swaps the passkey device for a new one (a lost phone, or a new person).
 * @param {{ prf?: boolean }} [options]
 */
export async function replaceAuthenticator(options) {
  await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: current.authenticatorId });
  current.authenticatorId = await addAuthenticator(options);
}

/** @type {Tab | null} the browser itself, for making tabs */
let browser = null;

/**
 * Drives another tab from here on, made the first time: "main" is the one
 * every chunk starts in (and is put back in after each). A new one starts
 * blank, as a new person's browser.
 * @param {string} name
 */
export async function useTab(name) {
  if (!tabs.has(name)) {
    if (!browser) {
      const version = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json();
      browser = await connect(version.webSocketDebuggerUrl, "browser");
    }
    const { browserContextId } = (await tabSend(browser, "Target.createBrowserContext")).result;
    const { targetId } = (await tabSend(browser, "Target.createTarget", { url: "about:blank", browserContextId, width: 420, height: 1400 })).result;
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    current = await connect(list.find((/** @type {any} */ t) => t.id === targetId).webSocketDebuggerUrl, name);
    tabs.set(name, current);
    await prepare();
    return;
  }
  current = /** @type {Tab} */ (tabs.get(name));
}

// Helpers available inside the page for each step.
const PAGE_HELPERS = `
  const $ = (s) => document.querySelector(s);
  // The journal, read and changed as the app does it (public/js/store/):
  // through format 1's API or format 2's records, whichever the account is,
  // so a check works on both. The same module the app has loaded.
  const store = await import("/js/store/index.js");
  // Whether some text is anywhere the server keeps the journal, in plain
  // text: format 1's rows (its export, fields still sealed) or format 2's
  // records. Notes, captions and the like never should be.
  const plainOnServer = async (text) => {
    const { format } = await (await fetch("/api/keys")).json();
    return JSON.stringify(await (await fetch(format === 2 ? "/api/sync?since=0" : "/api/data/export")).json()).includes(text);
  };
  // A saved photo's or video's part as the server keeps it, sealed: format
  // 1's media or format 2's files.
  const rawPart = async (id, part) => {
    const { format } = await (await fetch("/api/keys")).json();
    return fetch((format === 2 ? "/api/files/" : "/api/media/") + id + "/" + part);
  };
  ${WAIT_HELPERS}
  // Bubbling, as typing's are: an edit form watches for changes (form-changes.js).
  const set = (sel, v) => { const el = $(sel); if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); };
  const optionValue = (select, text) => [...select.options].find((o) => o.text === text).value;
  // The tie form's search pickers: what one lists, and picking from one.
  const pickerList = (box) => [...document.querySelectorAll("#" + box.id + "-list li")].map((li) => li.innerText.replace(/\\n+/g, " | "));
  const searchIn = (box, text) => { box.focus(); box.value = text; box.dispatchEvent(new Event("input")); };
  const choosePick = async (box, text, shown = text) => {
    searchIn(box, text); await wait(50);
    [...document.querySelectorAll("#" + box.id + "-list .combo-option")].find((o) => o.textContent === shown).click(); await wait(50);
  };
  const lastBox = (rows) => [...document.querySelectorAll(rows + " [role=combobox]")].pop();
  const submit = async () => { $("form button[type=submit]").click(); await calm(700); };
  const flat = (el) => el.innerText.replace(/\\n+/g, " | ");
  // List rows on the plans, people and locations pages, and tie cards on the Ties page.
  const items = () => [...document.querySelectorAll(".item, .tie-card")].map(flat);
  const titles = () => [...document.querySelectorAll(".item-title, .tie-title")].map((t) => t.innerText);
  // A tie card's parts: date, "type at location", filled rating hanks, the
  // visible "With:" line and the tags.
  const card = (i = 0) => {
    const c = document.querySelectorAll(".tie-card")[i];
    const text = (sel) => c.querySelector(sel)?.innerText ?? null;
    return [text(".tie-date") !== null, text(".tie-place"), c.querySelectorAll(".tie-rating .hank.filled").length,
      text(".tie-with"), [...c.querySelectorAll(".tie-tags .tag")].map((t) => t.innerText)];
  };
  // A row's button, by its label. Plans are cards with no buttons but the
  // title: "Edit" taps the card's text, and the rest are in its dialog.
  const clickIn = async (title, label) => {
    const item = [...document.querySelectorAll(".item, .plan-card")]
      .find((i) => i.querySelector(".item-title, .tie-title").innerText === title);
    if (!item.classList.contains("plan-card")) {
      [...item.querySelectorAll("button")].find((b) => b.textContent === label).click();
    } else {
      item.querySelector(".tie-place").click();
      if (label !== "Edit") {
        await calm(300);
        [...document.querySelectorAll("dialog[open] [data-item-actions] button")].find((b) => b.getAttribute("aria-label").startsWith(label)).click();
      }
    }
    await calm(500);
  };
  // Waits until the ties list has stopped changing (up to 4 seconds), rather
  // than guessing how long a search takes.
  const settle = async () => {
    let last = null, same = 0;
    for (let i = 0; i < 40 && same < 4; i++) {
      await wait(100);
      const now = $("#tie-list")?.innerText ?? "";
      same = now === last ? same + 1 : 0;
      last = now;
    }
  };
  const type = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event("input")); await calm(400); await settle(); };
  const post = async (path, body) => (await (await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).id;
  const filterOptions = (sel) => [...document.querySelectorAll(sel + " label")].map((l) => l.textContent + (l.classList.contains("archived") ? " (muted)" : ""));
  const pick = async (sel, name) => {
    const box = [...document.querySelectorAll(sel + " label")].find((l) => l.textContent === name).querySelector("input");
    box.click(); await calm(800);
  };
  const pagerButtons = () => [...document.querySelectorAll("#pager button")].map((b) => b.textContent + (b.getAttribute("aria-current") ? "*" : ""));
  // Open dialogs only: the Plans view keeps its form's dialog on the page, closed.
  const dialogButtons = () => [...document.querySelectorAll("dialog[open] button")].map((b) => b.textContent);
  const tagBubbles = () => [...document.querySelectorAll("#tags-list .tag")].map((t) =>
    t.querySelector(".tag-toggle").textContent + (t.classList.contains("selected") ? "*" : "") + (t.querySelector(".tag-x") ? " ×" : ""));
  const tagChips = (sel) => [...document.querySelectorAll(sel + " .tag")].map((t) => t.firstChild.textContent);
  const tagsJson = async () => (await store.listTags()).map((t) => t.name + ":" + t.tie_count);
  // Fields that could leak what's typed into form history or spellcheck.
  const leakyFields = () => [...document.querySelectorAll("input:not([type=checkbox]), textarea")]
    .filter((f) => f.getAttribute("autocomplete") !== "off" || f.getAttribute("spellcheck") !== "false")
    .map((f) => f.id || f.name || f.getAttribute("aria-label") || f.type);
  const visibleCard = () => [...document.querySelectorAll("#view > section.card")].find((c) => !c.hidden)?.id;
  const recoveryDialog = () => [$("#recovery-code")?.textContent ?? null, $("dialog[open] button.primary")?.disabled ?? null];
  const finishRecoveryDialog = async () => { $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await calm(1200); };
  const openMenu = async () => { $(".nav-menu").click(); await calm(300); };
  // Whether this page has fetched a file (by path).
  const fetched = (path) => performance.getEntriesByName(new URL(path, location.href).href).length > 0;
  // The logo in sel, app.css's masks: whether its files have loaded, its
  // name for screen readers, its files, and the pencil's and the name's colors. An image the
  // page before showed comes from Chrome's memory cache, which leaves no
  // timing entry, but an image of it is complete at once.
  const loadedImage = (path) => { const img = new Image(); img.src = path; return img.complete && img.naturalWidth > 0; };
  const logo = (sel) => {
    const el = $(sel);
    const parts = el ? ["::before", "::after"].map((p) => getComputedStyle(el, p)) : [];
    const files = parts.map((s) => new URL(s.maskImage.slice(5, -2)).pathname);
    return [files.length > 0 && files.every((f) => fetched(f) || loadedImage(f)), el?.getAttribute("aria-label") ?? null, files,
      parts.map((s) => s.backgroundColor)];
  };
  // People's and Locations' cards: each name is a button that opens its dialog.
  const personNames = () => [...document.querySelectorAll(".name-button")].map((b) => b.textContent);
  const openPerson = async (name) => { [...document.querySelectorAll(".name-button")].find((b) => b.textContent === name).click(); await calm(500); };
  const openItem = openPerson;
  // A person's card: name, pronouns, role tag, educator's cap, the rows under the name, and how many buttons.
  const personCard = (name) => {
    const item = [...document.querySelectorAll(".name-button")].find((b) => b.textContent === name).closest(".item");
    return [name, item.querySelector(".name-title .item-meta")?.textContent ?? null, item.querySelector(".role-tag")?.textContent ?? null,
      !!item.querySelector(".educator-icon"), [...item.querySelectorAll(":scope > .item-meta")].map((m) => m.textContent), item.querySelectorAll("button").length];
  };
  // An edit dialog's icons on its heading row, by name (dialog-icons.js).
  const headerIcons = (sel) => [...document.querySelectorAll(sel + " .dialog-header button.icon-button")].map((b) => b.getAttribute("aria-label"));
  const personButtons = () => headerIcons("#person-dialog");
  // An edit dialog's ✕, saying Discard changes if it asks.
  const closeDiscarding = async (sel) => {
    $(sel).click(); await calm(300);
    const discard = [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === "Discard changes");
    if (discard) { discard.click(); await calm(300); }
  };
  const clickDialog = async (label) => { [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === label).click(); await calm(800); };
`;

// A step that hasn't finished after this long is stuck: fail with what the
// page shows, rather than wait forever.
const STEP_TIMEOUT_MS = 60_000;

export async function run(code) {
  const res = await Promise.race([
    send("Runtime.evaluate", {
      expression: `(async () => { ${PAGE_HELPERS} ${code} })()`,
      awaitPromise: true,
      returnByValue: true,
    }),
    sleep(STEP_TIMEOUT_MS).then(() => {
      throw new Error(`A step took over a minute. Browser errors so far: ${JSON.stringify(consoleErrors)}`);
    }),
  ]);
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description);
  return res.result?.result?.value;
}

// The recovery code that currently unlocks the journal (each new one shown
// replaces it): set it whenever a new one is shown.
// Each tab's own.
export const account = {
  get currentCode() { return current.code; },
  set currentCode(code) { current.code = code; },
};

// Loads a page. Loading locks the journal (the key is only in memory), so
// unless told not to, this unlocks it again: with the passkey, or the
// recovery code if the passkey can't unlock.
export async function go(pagePath, { unlock = true } = {}) {
  await loadPage(pagePath);
  await run("await calm(1200);");
  if (!unlock) return;
  // Steps through Unlock until it's gone (up to 10 seconds), rather than
  // guessing how long a sign-in takes.
  const state = await run(`
    let usedPasskey = false, usedCode = false;
    for (let i = 0; i < 100; i++) {
      const choose = $("#unlock-choose"), code = $("#unlock-code");
      if (!choose) return "done";
      if (!choose.hidden && !usedPasskey) { usedPasskey = true; $("#unlock-passkey").click(); }
      if (!code.hidden && !usedCode) {
        usedCode = true; $("#unlock-code-input").value = ${JSON.stringify(account.currentCode)}; $("#unlock-code-form button[type=submit]").click();
      }
      await wait(100);
    }
    return "stuck: " + JSON.stringify([document.title, location.pathname,
      [...document.querySelectorAll("#view > section.card")].filter((c) => !c.hidden).map((c) => c.id),
      [...document.querySelectorAll("#view .message")].map((m) => m.textContent).filter(Boolean),
      [...document.querySelectorAll("dialog[open]")].map((d) => d.innerText.slice(0, 120))]);`);
  if (state !== "done") throw new Error(`Couldn't unlock to show ${pagePath}: ${state}`);
  await run("await calm(600);");
}

// Loads a page and waits until the new page has finished loading, rather
// than guessing: a step started while the old page is being replaced can be
// left waiting for an answer that never comes. The old page is marked
// first, so the new one is told apart even if the app then moves on to
// another address (e.g. signed out, / goes to /signin). Each look is a
// plain, short evaluation, given up after 2 seconds if the page is
// mid-change.
export async function loadPage(pagePath) {
  const look = (/** @type {string} */ expression) => Promise.race([
    send("Runtime.evaluate", { expression, returnByValue: true }),
    sleep(2000).then(() => null),
  ]);
  await look("window.__oldPage = true");
  await send("Page.navigate", { url: BASE + pagePath });
  for (let i = 0; i < 50; i++) {
    const res = await look("!window.__oldPage && document.readyState === 'complete'");
    if (res?.result?.result?.value === true) return;
    await sleep(200);
  }
  throw new Error(`${pagePath} didn't finish loading`);
}

// Runs a script from scripts/ against the walkthrough's database.
export function script(name, ...args) {
  const done = spawnSync("node", [`scripts/${name}`, ...args, "--persist-to", dbDir], { encoding: "utf8", cwd: projectDir });
  if (done.status !== 0) throw new Error(`${name} failed: ${done.stdout} ${done.stderr}`);
  return done.stdout.trim();
}

/**
 * Runs SQL on the walkthrough's database, for states the app can't make
 * (an account from before a feature, a notice from us).
 * @param {string} command
 * @returns {any[]} the rows
 */
export function sql(command) {
  const done = spawnSync("npx", ["wrangler", "d1", "execute", "notonawa", "--local", "--persist-to", dbDir, "--json",
    "--command", command], { encoding: "utf8", cwd: projectDir });
  if (done.status !== 0) throw new Error(`SQL failed: ${done.stdout} ${done.stderr}`);
  return JSON.parse(done.stdout)[0].results;
}

/** A page step: the sign-in and unlock pages' line saying who to email for help. */
// innerText, so the line break before "Email" shows; the two lines are centred.
export const HELP_LINE = `const p = $("#view .help-line"); return [p?.innerText, p?.querySelector("a")?.getAttribute("href"), p?.offsetParent !== null, p && getComputedStyle(p).textAlign];`;

/** A new invite code. */
export const newInvite = () => script("invite.mjs", "--quiet");

/**
 * Leaves the browser as a new visitor's: signed out, nothing stored, a new
 * passkey device, the device's own light/dark setting unset.
 */
export async function resetBrowser() {
  await loadPage("/privacy.html");
  await send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" });
  await send("Network.clearBrowserCookies");
  await send("Emulation.setEmulatedMedia", { features: [] });
  await replaceAuthenticator();
  account.currentCode = "";
}

/**
 * Starts a chunk: a new account of its own, signed up with a new passkey
 * ("Test phone") and unlocked on the Ties list, the welcome tour skipped
 * for good and the What's new after it closed. The checks of signing up,
 * the tour and that What's new are the basics chunk's.
 * @returns {Promise<string>} the recovery code shown at sign-up
 */
export async function freshAccount() {
  await resetBrowser();
  const invite = newInvite();
  await go("/signin", { unlock: false });
  const code = await run(`
    [...document.querySelectorAll("[data-show=signup]")][0].click();
    $("#invite").value = ${JSON.stringify(invite)}; $("#passkey-name").value = "Test phone";
    $("#adult").checked = true; $("#consent").checked = true;
    $("#signup-form button[type=submit]").click();
    for (let i = 0; i < 100 && !$("#recovery-code"); i++) await wait(100);
    const code = $("#recovery-code")?.textContent;
    $("#recovery-saved").click(); $("dialog[open] button.primary").click();
    for (let i = 0; i < 100 && !$("dialog.tour[open]"); i++) await wait(100);
    $("dialog.tour[open] .tour-skip").click();
    for (let i = 0; i < 50 && !(await (await fetch("/api/account/settings")).json()).hide_welcome; i++) await wait(100);
    // What's new follows the tour (the basics chunk checks it).
    for (let i = 0; i < 50 && !$("dialog.whats-new[open]"); i++) await wait(100);
    $("#whats-new-ok")?.click(); await calm(300);
    return [code, location.pathname, $("#tie-count") !== null, $("dialog") === null];`);
  if (!isDeepStrictEqual(code.slice(1), ["/", true, true]) || !code[0]) throw new Error(`Couldn't sign up a new account: ${JSON.stringify(code)}`);
  account.currentCode = code[0];
  return code[0];
}

/** Ends a chunk: nothing went wrong in the browser along the way. */
export function checkConsole() {
  check("no errors in the browser console", consoleErrors.splice(0), []);
}

/** Stops Chrome and wrangler, and deletes the throwaway database. */
export async function stop() {
  for (const tab of tabs.values()) tab.ws.close();
  browser?.ws.close();
  // Waits for the app and Chrome to have shut down (up to 10 s, then
  // they're killed) before deleting their folder, which they write to as
  // they go.
  signalChildren("SIGTERM");
  for (let i = 0; i < 50 && signalChildren(0); i++) await sleep(200);
  if (signalChildren(0)) {
    signalChildren("SIGKILL");
    await sleep(300);
  }
  children.length = 0;
  removeWorkDir();
}
