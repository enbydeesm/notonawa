// UI smoke test: clicks through every page in headless Chrome against a
// throwaway local database, and checks what's on screen.
//
//   npm run test:ui
//
// Needs Google Chrome installed (set CHROME_PATH if it's not in the default
// macOS location). No npm packages: it drives Chrome over the DevTools
// protocol directly. Your real local database (.wrangler/state) isn't touched.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8799;
const DEBUG_PORT = 9333;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const workDir = mkdtempSync(path.join(tmpdir(), "rope-ui-"));
const children = [];
let failures = 0;

function cleanup() {
  for (const child of children) child.kill();
  rmSync(workDir, { recursive: true, force: true });
}

function check(label, actual, expected) {
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

const dbDir = path.join(workDir, "state");
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "notonawa", "--local", "--persist-to", dbDir], { encoding: "utf8" });
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr);
  cleanup();
  process.exit(1);
}
// Sign-up needs an invite.
const invite = spawnSync("node", ["scripts/invite.mjs", "--persist-to", dbDir, "--quiet"], { encoding: "utf8" });
if (invite.status !== 0) {
  console.error(invite.stdout, invite.stderr);
  cleanup();
  process.exit(1);
}
const INVITE = invite.stdout.trim();

// The app's own wrangler.jsonc, with a higher sign-in rate limit: every page
// load here locks the journal and unlocking signs in, so this walkthrough
// signs in far more often a minute than a person would (the limit itself is
// tested in test/api/auth.test.js). Paths are made absolute, as the copy
// lives in the work folder. Only whole-line comments are stripped (the file
// has URLs with // in them).
const projectDir = path.resolve(import.meta.dirname, "..");
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
const configPath = path.join(workDir, "wrangler.json");
writeFileSync(configPath, JSON.stringify(config, null, 2));

children.push(spawn("npx", [
  "wrangler", "dev", "--config", configPath, "--persist-to", dbDir, "--port", String(PORT),
  "--var", `ORIGIN:${BASE}`, "--var", "RP_ID:localhost",
], { stdio: "ignore", cwd: projectDir }));
await waitFor(`${BASE}/`, "wrangler dev");

// --- start Chrome and connect ------------------------------------------------

children.push(spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, "--window-size=420,1400",
  "--no-first-run", `--user-data-dir=${path.join(workDir, "chrome")}`, "about:blank",
], { stdio: "ignore" }));
const targets = await (await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json`, "Chrome")).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve));

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  }
  // The browser's own messages, e.g. a script or style blocked by the CSP.
  // Network ones are left out: some steps get a 400 on purpose.
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error" && msg.params.entry.source !== "network") {
    consoleErrors.push(msg.params.entry.text);
  }
  // An alert() blocks the page (and so the step waiting on it): note it as
  // an error and dismiss it.
  if (msg.method === "Page.javascriptDialogOpening") {
    consoleErrors.push(`${msg.params.type}: ${msg.params.message}`);
    ws.send(JSON.stringify({ id: nextId++, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");
// Headless Chrome isn't a focused window, so focus and blur events wouldn't
// fire (the tie form's location picker opens and settles on them).
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
await send("Log.enable");

// A virtual passkey, like a phone's: discoverable, verifies the user, and can
// derive encryption keys (PRF). Chrome answers passkey requests with it.
await send("WebAuthn.enable", { enableUI: false });
// prf: false is a device that can sign in but not unlock (no PRF).
const addAuthenticator = async ({ prf = true } = {}) => (await send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf,
  },
})).result.authenticatorId;
let authenticatorId = await addAuthenticator();

// Helpers available inside the page for each step.
const PAGE_HELPERS = `
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = (sel, v) => { const el = $(sel); if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change")); };
  const optionValue = (select, text) => [...select.options].find((o) => o.text === text).value;
  // The tie form's search pickers: what one lists, and picking from one.
  const pickerList = (box) => [...document.querySelectorAll("#" + box.id + "-list li")].map((li) => li.innerText.replace(/\\n+/g, " | "));
  const searchIn = (box, text) => { box.focus(); box.value = text; box.dispatchEvent(new Event("input")); };
  const choosePick = async (box, text, shown = text) => {
    searchIn(box, text); await wait(50);
    [...document.querySelectorAll("#" + box.id + "-list .combo-option")].find((o) => o.textContent === shown).click(); await wait(50);
  };
  const lastBox = (rows) => [...document.querySelectorAll(rows + " [role=combobox]")].pop();
  const submit = async () => { $("form button[type=submit]").click(); await wait(700); };
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
  const clickIn = async (title, label) => {
    const item = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").innerText === title);
    [...item.querySelectorAll("button")].find((b) => b.textContent === label).click();
    await wait(500);
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
  const type = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event("input")); await wait(400); await settle(); };
  const post = async (path, body) => (await (await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()).id;
  const filterOptions = (sel) => [...document.querySelectorAll(sel + " label")].map((l) => l.textContent + (l.classList.contains("archived") ? " (muted)" : ""));
  const pick = async (sel, name) => {
    const box = [...document.querySelectorAll(sel + " label")].find((l) => l.textContent === name).querySelector("input");
    box.click(); await wait(800);
  };
  const pagerButtons = () => [...document.querySelectorAll("#pager button")].map((b) => b.textContent + (b.getAttribute("aria-current") ? "*" : ""));
  const dialogButtons = () => [...document.querySelectorAll("dialog button")].map((b) => b.textContent);
  const tagBubbles = () => [...document.querySelectorAll("#tags-list .tag")].map((t) =>
    t.querySelector(".tag-toggle").textContent + (t.classList.contains("selected") ? "*" : "") + (t.querySelector(".tag-x") ? " ×" : ""));
  const tagChips = (sel) => [...document.querySelectorAll(sel + " .tag")].map((t) => t.firstChild.textContent);
  const tagsJson = async () => (await (await fetch("/api/tags")).json()).map((t) => t.name + ":" + t.tie_count);
  // Fields that could leak what's typed into form history or spellcheck.
  const leakyFields = () => [...document.querySelectorAll("input:not([type=checkbox]), textarea")]
    .filter((f) => f.getAttribute("autocomplete") !== "off" || f.getAttribute("spellcheck") !== "false")
    .map((f) => f.id || f.name || f.getAttribute("aria-label") || f.type);
  const visibleCard = () => [...document.querySelectorAll("#view > section.card")].find((c) => !c.hidden)?.id;
  const recoveryDialog = () => [$("#recovery-code")?.textContent ?? null, $("dialog[open] button.primary")?.disabled ?? null];
  const finishRecoveryDialog = async () => { $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1200); };
  const openMenu = async () => { $(".nav-menu").click(); await wait(300); };
  // Whether the logo image in sel has loaded, and its alt text.
  const logo = (sel) => { const img = $(sel); return [img?.complete === true && img.naturalWidth > 0, img?.alt ?? null]; };
  const clickDialog = async (label) => { [...document.querySelectorAll("dialog button")].find((b) => b.textContent === label).click(); await wait(800); };
`;

// A step that hasn't finished after this long is stuck: fail with what the
// page shows, rather than wait forever.
const STEP_TIMEOUT_MS = 60_000;

async function run(code) {
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
// replaces it).
let currentCode = "";

// Loads a page. Loading locks the journal (the key is only in memory), so
// unless told not to, this unlocks it again: with the passkey, or the
// recovery code if the passkey can't unlock.
async function go(pagePath, { unlock = true } = {}) {
  await loadPage(pagePath);
  await sleep(1200);
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
        usedCode = true; $("#unlock-code-input").value = ${JSON.stringify(currentCode)}; $("#unlock-code-form button[type=submit]").click();
      }
      await wait(100);
    }
    return "stuck: " + JSON.stringify([document.title, location.pathname,
      [...document.querySelectorAll("#view > section.card")].filter((c) => !c.hidden).map((c) => c.id),
      [...document.querySelectorAll("#view .message")].map((m) => m.textContent).filter(Boolean),
      [...document.querySelectorAll("dialog[open]")].map((d) => d.innerText.slice(0, 120))]);`);
  if (state !== "done") throw new Error(`Couldn't unlock to show ${pagePath}: ${state}`);
  await sleep(600);
}

// Loads a page and waits until the new page has finished loading, rather
// than guessing: a step started while the old page is being replaced can be
// left waiting for an answer that never comes. The old page is marked
// first, so the new one is told apart even if the app then moves on to
// another address (e.g. signed out, / goes to /signin). Each look is a
// plain, short evaluation, given up after 2 seconds if the page is
// mid-change.
async function loadPage(pagePath) {
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
function script(name, ...args) {
  const done = spawnSync("node", [`scripts/${name}`, ...args, "--persist-to", dbDir], { encoding: "utf8" });
  if (done.status !== 0) throw new Error(`${name} failed: ${done.stdout} ${done.stderr}`);
  return done.stdout.trim();
}

// --- the walkthrough -----------------------------------------------------------

try {
  console.log("Security headers");
  for (const pagePath of ["/", "/plans", "/people", "/locations", "/data", "/js/api.js"]) {
    const res = await fetch(BASE + pagePath);
    check(`${pagePath}: strict CSP, never cached`, [
      res.headers.get("cache-control"),
      res.headers.get("content-security-policy")?.includes("script-src 'self'; style-src 'self'"),
      res.headers.get("content-security-policy")?.includes("require-trusted-types-for 'script'"),
      res.headers.get("x-frame-options"),
    ], ["no-store", true, true, "DENY"]);
  }
  console.log("Logo and icons");
  const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
  check("the manifest names the app and its icons", [manifest.name, manifest.icons.map((i) => i.sizes)], ["NotoNawa", ["192x192", "512x512"]]);
  const page = await (await fetch(BASE + "/")).text();
  const linked = [...page.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)"/g)].map((m) => m[1]);
  check("the page links a tab icon and a home-screen icon", linked.length, 2);
  for (const path of [...linked, ...manifest.icons.map((i) => i.src), "/img/logo.png"]) {
    const res = await fetch(BASE + path);
    check(`${path} is a PNG`, [res.status, res.headers.get("content-type")], [200, "image/png"]);
  }
  console.log("Signing up");
  await go("/");
  check("signed out, the journal goes to the sign-in page, without the nav, its title centered", await run(`
    return [location.pathname, visibleCard(), getComputedStyle($("nav")).display, getComputedStyle($("#view h1")).textAlign, logo("#view h1 img")];`),
    ["/signin", "choose", "none", "center", [true, "NotoNawa"]]);
  check("the sign-up form's fields are kept out of form history and spellcheck", await run(`
    [...document.querySelectorAll("[data-show=signup]")][0].click(); return [visibleCard(), leakyFields()];`), ["signup", []]);
  check("sign-up needs 18+ and consent", await run(`
    $("#invite").value = ${JSON.stringify(INVITE)}; $("#passkey-name").value = "Test phone";
    $("#signup-form button[type=submit]").click(); await wait(300);
    return $("#adult").validity.valueMissing;`), true);
  const recoveryCode = await run(`
    $("#adult").checked = true; $("#consent").checked = true;
    $("#signup-form button[type=submit]").click(); await wait(2500);
    return $("#recovery-code")?.textContent;`);
  check("signing up makes a passkey and shows a recovery code once, which must be confirmed", await run(`
    const before = recoveryDialog(); $("#recovery-saved").click();
    return [before[1], $("dialog[open] button.primary").disabled];`), [true, false]);
  check("the recovery code is 32 characters in groups of 4", /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(recoveryCode ?? ""), true);
  currentCode = recoveryCode ?? "";
  await run(`$("dialog[open] button.primary").click();`);
  await sleep(1500);
  check("Done goes to the journal, signed in", await run(`return [location.pathname, $("#tie-count") !== null];`), ["/", true]);
  check("the invite can't be used again", await run(`
    const r = await fetch("/api/auth/register/options", { method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: ${JSON.stringify(INVITE)}, adult: true, consent: true }) });
    return [r.status, (await r.json()).error];`), [400, "That invite code doesn't work. It may have been used or expired."]);
  for (const pagePath of ["/plans", "/people", "/locations"]) {
    await go(pagePath);
    check(`${pagePath}: every field is kept out of form history and spellcheck`, await run(`return leakyFields();`), []);
  }

  console.log("Locking and unlocking");
  const keysNow = () => run(`const k = await (await fetch("/api/keys")).json();
    return [k.has_key, k.passkey !== null, k.recovery?.current ?? null];`);
  check("signing up made a key, wrapped for the passkey and the recovery code", await keysNow(), [true, true, true]);
  // What the visible view is: its heading, and the Unlock card showing (if any).
  const shown = `return [document.title, $("#view h1").textContent || $("#view h1 img")?.alt, getComputedStyle($("nav")).display === "none",
    [...document.querySelectorAll("#view > section.card")].find((c) => !c.hidden)?.id ?? null, $("#tie-count") !== null];`;
  await go("/plans", { unlock: false });
  check("loading a page locks the journal: Unlock shows instead, at the same address, without the nav", await run(`
    return [location.pathname, ...(() => { ${shown} })()];`),
    ["/plans", "Unlock · NotoNawa", "NotoNawa", true, "unlock-choose", false]);
  check("Unlock shows the logo", await run(`return logo("#view h1 img");`), [true, "NotoNawa"]);
  check("unlocking with the passkey shows the page, and sends no PRF output anywhere", await run(`
    const sent = []; const realFetch = window.fetch;
    window.fetch = (url, options) => { sent.push([String(url), options?.body ?? ""]); return realFetch(url, options); };
    $("#unlock-passkey").click(); await wait(2500); window.fetch = realFetch;
    const login = JSON.parse(sent.find(([url]) => url.endsWith("/api/auth/login/verify"))[1]);
    return [location.pathname, document.title, $("#view h1").textContent, login.prf, JSON.stringify(login.response.clientExtensionResults),
      sent.some(([, body]) => body.includes("results"))];`),
    ["/plans", "Plans · NotoNawa", "Plans", true, JSON.stringify({ prf: {} }), false]);
  await go("/", { unlock: false });
  check("the recovery code unlocks too; a wrong one says so", await run(`
    [...document.querySelectorAll("[data-unlock-show=code]")][0].click(); await wait(100);
    $("#unlock-code-input").value = "0000-0000-0000-0000-0000-0000-0000-0000"; $("#unlock-code-form button[type=submit]").click(); await wait(1200);
    const wrong = $("#unlock-code-message").textContent;
    $("#unlock-code-input").value = ${JSON.stringify(currentCode)}; $("#unlock-code-form button[type=submit]").click(); await wait(1500);
    return [wrong, $("#tie-count") !== null, leakyFields()];`),
    ["That recovery code doesn't unlock your journal.", true, []]);
  check("nothing is kept in the browser's storage but the theme", await run(`
    return [Object.keys(localStorage).filter((k) => k !== "theme"), sessionStorage.length, (await indexedDB.databases()).length];`),
    [[], 0, 0]);

  // An account from before encryption: no key yet.
  const userId = await run(`return (await (await fetch("/api/keys")).json()).user_id;`);
  spawnSync("npx", ["wrangler", "d1", "execute", "notonawa", "--local", "--persist-to", dbDir,
    "--command", `DELETE FROM key_wraps WHERE user_id = '${userId}'`], { encoding: "utf8" });
  await go("/", { unlock: false });
  check("an account without a key is asked to set one up after the passkey", await run(`
    $("#unlock-passkey").click(); await wait(2500); return [...(() => { ${shown} })()].slice(3);`), ["unlock-setup", false]);
  const setupCode = await run(`
    $("#unlock-setup-go").click(); await wait(2000); const code = $("#recovery-code")?.textContent;
    $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1500); return code;`);
  check("setting up shows a new recovery code, then the journal", [setupCode !== recoveryCode, await run(`return $("#tie-count") !== null;`)], [true, true]);
  check("…and the key is wrapped for both again", await keysNow(), [true, true, true]);
  currentCode = setupCode ?? "";

  // The operator gives the account a new recovery code (someone locked out).
  const operatorCode = script("recovery-code.mjs", userId, "--quiet");
  check("after the operator's reset, the recovery wrap no longer matches the code", await keysNow(), [true, true, false]);
  await go("/", { unlock: false });
  const afterReset = await run(`
    $("#unlock-passkey").click(); await wait(3000);
    const shownCode = $("#recovery-code")?.textContent; const intro = $("dialog[open] p")?.textContent;
    $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1200);
    return [shownCode, intro, $("#tie-count") !== null];`);
  check("unlocking with the passkey then makes a new code, as the old one shouldn't keep working",
    [afterReset[0] !== operatorCode && /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(afterReset[0] ?? ""), afterReset[1], afterReset[2]],
    [true, "Your recovery code was replaced, so here's a new one that also unlocks your journal.", true]);
  check("…and the recovery wrap matches again", await keysNow(), [true, true, true]);
  currentCode = afterReset[0] ?? "";

  console.log("Light and dark mode");
  const deviceMode = (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  // Background colour, the menu row's tooltip, data-theme and the saved choice.
  // Opens the menu first if it's closed.
  const menuOpen = `if (!$("dialog.menu-panel[open]")) await openMenu();`;
  const themeState = `${menuOpen}
    return [getComputedStyle(document.body).backgroundColor, $(".menu-theme").title,
    document.documentElement.dataset.theme ?? null, localStorage.getItem("theme")];`;
  const toggleTheme = `${menuOpen} $(".menu-theme").click(); await wait(100);`;
  const menuGone = `await wait(300); return $("dialog") === null;`;
  // Real key presses and taps (not events made by the page), as the browser
  // handles Esc and the backdrop itself.
  const key = async (type) => send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const tap = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const LIGHT_BG = "rgb(250, 248, 245)";
  const DARK_BG = "rgb(22, 21, 20)";
  await deviceMode("light");
  await go("/");
  check("the menu button sits in the corner, after the +", await run(`
    const nav = [...document.querySelector("nav").children];
    return [nav.slice(-2).map((el) => el.className), document.querySelectorAll(".nav-menu svg line").length, $("dialog") === null];`),
    [["nav-add", "nav-icon nav-menu"], 3, true]);
  check("the menu opens with the logo, Light / Dark Mode (a half-filled sun), Account, Your data and Privacy Policy", await run(`
    await openMenu();
    return [$(".menu-title img").alt, [...document.querySelectorAll(".menu-item")].map((el) => [el.tagName, el.textContent, el.querySelector("svg") !== null]),
      $(".menu-theme svg path").getAttribute("fill"), document.querySelectorAll(".menu-theme svg line").length,
      $(".nav-account").getAttribute("href"), $(".menu-privacy").getAttribute("href")];`),
    ["NotoNawa", [["BUTTON", "Light / Dark Mode", true], ["A", "Account", true], ["A", "Your data", true], ["A", "Privacy Policy", true]], "currentColor", 8, "/account", "/privacy"]);
  check("Privacy Policy sits at the bottom of the panel", await run(`
    const panel = $(".menu-inner").getBoundingClientRect(), row = $(".menu-privacy").getBoundingClientRect();
    return [Math.round(panel.bottom - row.bottom), row.top - $(".nav-data").getBoundingClientRect().bottom > 100];`), [16, true]);
  check("the panel is on the right, full height", await run(`
    const r = $("dialog.menu-panel").getBoundingClientRect();
    return [Math.round(r.right) === innerWidth, Math.round(r.top), Math.round(r.height) === innerHeight, r.left > 0];`), [true, 0, true, true]);
  check("the logo is at the top of the menu", await run(`
    return [...logo(".menu-title img"), $(".menu-inner").firstElementChild === $(".menu-title")];`), [true, "NotoNawa", true]);
  await key("keyDown"); await key("keyUp");
  check("Esc closes the menu", await run(menuGone), true);
  await run(`await openMenu();`);
  await tap("mousePressed", 5, 300); await tap("mouseReleased", 5, 300);
  check("tapping beside the panel closes it", await run(menuGone), true);
  check("a light device starts light", await run(themeState), [LIGHT_BG, "Switch to dark mode", null, null]);
  check("tapping switches to dark and remembers it", await run(`${toggleTheme} ${themeState}`),
    [DARK_BG, "Switch to light mode", "dark", "dark"]);
  check("the menu stays open", await run(`return $("dialog.menu-panel[open]") !== null;`), true);
  await go("/plans");
  check("the choice carries over to other pages", await run(themeState), [DARK_BG, "Switch to light mode", "dark", "dark"]);
  check("tapping back to the device's mode forgets the choice", await run(`${toggleTheme} ${themeState}`),
    [LIGHT_BG, "Switch to dark mode", null, null]);
  await deviceMode("dark");
  await go("/");
  check("a dark device starts dark", await run(themeState), [DARK_BG, "Switch to light mode", null, null]);
  check("light can be picked on a dark device", await run(`${toggleTheme} ${themeState}`),
    [LIGHT_BG, "Switch to dark mode", "light", "light"]);
  await go("/people");
  check("and carries over too", await run(themeState), [LIGHT_BG, "Switch to dark mode", "light", "light"]);
  check("the tooltip follows the device changing while the menu is open", await run(`${toggleTheme} return $(".menu-theme").title;`),
    "Switch to light mode");
  await deviceMode("light");
  check("…to light", await run(`await wait(100); ${themeState}`), [LIGHT_BG, "Switch to dark mode", null, null]);

  console.log("Single-page app");
  await go("/");
  // A marker on window survives only if the page wasn't loaded again.
  const viewState = `return [location.pathname + location.search, document.title, $("#view h1").textContent, window.marker === 1,
    $("nav a[aria-current=page]")?.getAttribute("aria-label") ?? null, document.activeElement === $("#view h1")];`;
  check("a tab changes the view without loading a new page, with its title, tab and focus", await run(`
    window.marker = 1; $("nav a[href='/plans']").click(); await wait(800); ${viewState}`),
    ["/plans", "Plans · NotoNawa", "Plans", true, "Plans", true]);
  check("Back and Forward change the view, still without a page load", await run(`
    history.back(); await wait(800); const back = (() => { ${viewState} })();
    history.forward(); await wait(800); return [back, (() => { ${viewState} })()];`), [
    ["/", "NotoNawa", "NotoNawa", true, "Ties", true],
    ["/plans", "Plans · NotoNawa", "Plans", true, "Plans", true],
  ]);
  check("Back to the Ties list brings back its sort order", await run(`
    $("nav a[href='/']").click(); await wait(800); $("#sort").click(); await settle();
    $("nav a[href='/people']").click(); await wait(800); history.back(); await wait(800);
    return [location.pathname + location.search, $("#sort").getAttribute("aria-pressed"), window.marker === 1];`), ["/?sort=oldest", "true", true]);
  check("Back with a dialog open closes it", await run(`
    $("nav a[href='/']").click(); await wait(800); $("nav a[href='/locations']").click(); await wait(800);
    $(".nav-add").click(); await wait(600); const open = $("dialog[open] #tie-form") !== null;
    history.back(); await wait(800); return [open, $("dialog[open]") === null, location.pathname];`), [true, true, "/"]);
  check("the privacy policy opens in a new tab, leaving the app as it is", await run(`
    await openMenu(); const link = $(".menu-privacy"); const out = [link.target, link.rel]; $("dialog.menu-panel").close(); return out;`),
    ["_blank", "noopener"]);
  await go("/people");
  check("an address loaded directly (a bookmark or refresh) shows its view", await run(`
    return [document.title, $("#view h1").textContent, $("nav a[aria-current=page]")?.getAttribute("aria-label"), $("nav").hidden];`),
    ["People · NotoNawa", "People", "People", false]);
  await go("/nope");
  // "Not found" doesn't need the key, so after loading it the journal is
  // locked, and the ties ask to unlock first.
  check("an unknown address says so, and links back to the ties (to unlock first)", await run(`
    const shown = [document.title, $("#view h1").textContent, $("nav a[aria-current=page]") === null];
    window.marker = 1; $("#view a[href='/']").click(); await wait(800);
    return [...shown, location.pathname, document.title, $("#unlock-choose")?.hidden === false, window.marker === 1];`),
    ["Page not found · NotoNawa", "Page not found", true, "/", "Unlock · NotoNawa", true, true]);

  console.log("People");
  await go("/people");
  check("nav marks the current page", await run(`return [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("aria-label") + (a.getAttribute("aria-current") ? "*" : ""));`),
    ["Ties", "Plans", "People*", "Locations", "Calendar", "Analytics"]);
  check("the tabs are icons, all on one row with + and ☰ at the right", await run(`
    const tabs = [...document.querySelectorAll("nav a.nav-tab")]; const add = $(".nav-add"), menu = $(".nav-menu");
    const top = (el) => { const r = el.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 4); };
    return [tabs.every((a) => a.querySelector("svg") && a.textContent.trim() === "" && a.title === a.getAttribute("aria-label")),
      new Set([...tabs, add, menu].map(top)).size, menu.getBoundingClientRect().right > $("nav").getBoundingClientRect().right - 4];`),
    [true, 1, true]);
  check("a new journal starts with 'Me'; add people, one with a default role", await run(`
    const first = titles();
    const roles = [...$("#default_role").options].map((o) => o.text);
    set("#name", "Sam"); set("#pronouns", "they/them"); set("#default_role", "model"); await submit();
    set("#name", "Alex"); await submit();
    return [first, roles, items().find((i) => i.startsWith("Sam |")).split(" | ")[1], titles()];`),
    [["MeYou"], ["None", "Rigger", "Top", "Model", "Bottom", "Spotter", "Photographer"], "they/them · usually model", ["MeYou", "Alex", "Sam"]]);
  check("'This is me' shows only on my own profile, ticked and greyed out, which can't be archived or deleted", await run(`
    const onAdd = $("#self-flag").hidden;
    await clickIn("Sam", "Edit"); const onSam = $("#self-flag").hidden;
    await clickIn("MeYou", "Edit"); const box = $("[name=is_self]");
    const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const onMe = [$("#self-flag").hidden, box.checked, box.disabled, Math.abs(mid($("#self-flag")) - mid($("label[for=name]"))) < 3];
    $("[data-cancel-edit]").click(); await wait(200);
    const meRow = items().find((i) => i.startsWith("MeYou"));
    const res = await fetch("/api/people?archived=false"); const me = (await res.json()).find((p) => p.is_self);
    const refused = [(await fetch("/api/people/" + me.id, { method: "DELETE" })).status, (await fetch("/api/people/" + me.id + "/archive", { method: "POST" })).status];
    return [onAdd, onSam, onMe, meRow, refused, $("#self-flag").hidden];`),
    [true, true, [false, true, true, true], "MeYou | Edit", [400, 400], true]);
  check("edit fills the form", await run(`set("#name", ""); await clickIn("Sam", "Edit");
    const state = [$("h2").textContent, $("#name").value, $("form button[type=submit]").textContent, $("[data-cancel-edit]").hidden];
    set("#notes", "Prefers floor work"); await submit(); return state;`), ["Edit", "Sam", "Save changes", false]);
  check("people: a search box and sorts by name or date added (newest first to start), with me always on top", await run(`
    const box = $(".list-search"); const sort = (k) => $(".sort-button[data-sort=" + k + "]");
    const label = (k) => sort(k).getAttribute("aria-label");
    const search = async (q) => { box.value = q; box.dispatchEvent(new Event("input")); await wait(50); return titles(); };
    const start = [titles(), label("created"), label("name")];
    sort("name").click(); await wait(50); const az = [titles(), label("name")];
    sort("name").click(); await wait(50); const za = [titles(), label("name")];
    sort("created").click(); await wait(50); const back = label("created");
    const found = await search("SA"); const none = [await search("zz"), $("#list .empty")?.textContent];
    await search("");
    return [start, az, za, back, found, none, box.closest(".card").querySelector("#list") !== null, leakyFields()];`),
    [[["MeYou", "Alex", "Sam"], "Sorted newest first", "Sort by name"], [["MeYou", "Alex", "Sam"], "Sorted A to Z"],
      [["MeYou", "Sam", "Alex"], "Sorted Z to A"], "Sorted newest first", ["Sam"], [[], "No matches."], true, []]);
  check("archive hides from the list", await run(`await clickIn("Alex", "Archive"); return titles();`), ["MeYou", "Sam"]);
  check("archived list offers Restore", await run(`set("#show-archived", true); await wait(600); return items();`), ["Alex | Restore | Delete"]);

  console.log("Locations");
  await go("/locations");
  check("add locations (one archived now)", await run(`
    set("#name", "Studio"); set("#maps_url", "https://maps.app.goo.gl/abc"); await submit();
    set("#name", "Hotel"); set("[name=archive_now]", true); await submit();
    set("#name", "Old flat"); await submit();
    return [titles(), [...document.querySelectorAll("#list a")].map((a) => a.href)];`),
    [["Old flat", "Studio"], ["https://maps.app.goo.gl/abc"]]);
  check("a Maps link fills in editable coordinates", await run(`
    const link = $("#maps_url"); link.value = "https://www.google.com/maps/place/Studio/@51.5,-0.12,17z/data=!4m2!3m1!8m2!3d51.51!4d-0.13";
    link.dispatchEvent(new Event("input")); await wait(1200);
    const filled = [$("#latitude").value, $("#longitude").value, $("#maps-hint").textContent];
    $("form").reset(); return [filled, $("#latitude").value, $("#maps-hint").textContent];`),
    [["51.51", "-0.13", "Coordinates filled in from the link."], "", "Paste a link to fill in the latitude and longitude."]);
  check("'Archive now' is hidden while editing", await run(`await clickIn("Studio", "Edit"); const hidden = $("[data-add-only]").hidden; $("[data-cancel-edit]").click(); return hidden;`), true);
  check("one-off is in the archived list", await run(`set("#show-archived", true); await wait(600); return titles();`), ["Hotel"]);
  await go("/locations");
  check("'Default on new ties' sits on the Name row, at the right, and isn't offered when archiving now", await run(`
    const flag = $("#default-flag"); const mid = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const placed = [Math.abs(mid(flag) - mid($("label[for=name]"))) < 3, flag.getBoundingClientRect().right > $("#name").getBoundingClientRect().right - 4];
    set("#is_default", true); set("[name=archive_now]", true); const archiving = [flag.hidden, $("#is_default").checked];
    set("[name=archive_now]", false); const back = flag.hidden;
    return [placed, archiving, back];`), [[true, true], [true, false], false]);
  check("one location is the default: ticking another asks to replace it, and Cancel unticks it", await run(`
    const dialogButton = (text) => [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === text);
    await clickIn("Studio", "Edit"); $("#is_default").click(); await wait(400); const noPrompt = $("dialog[open]") === null; await submit();
    await clickIn("Old flat", "Edit"); $("#is_default").click(); await wait(400);
    const prompt = $("dialog[open] h2")?.textContent; dialogButton("Cancel").click(); await wait(200);
    const cancelled = $("#is_default").checked;
    $("#is_default").click(); await wait(400); dialogButton("Replace").click(); await wait(200);
    const kept = $("#is_default").checked; await submit();
    const stored = (await (await fetch("/api/locations?archived=false")).json()).filter((l) => l.is_default).map((l) => l.name);
    return [noPrompt, prompt, cancelled, kept, titles(), stored];`),
    [true, "Replace Studio as your default location?", false, true, ["Old flatDefault", "Studio"], ["Old flat"]]);
  check("locations: search and sort too", await run(`
    const box = $(".list-search"); box.value = "stu"; box.dispatchEvent(new Event("input")); await wait(50); const found = titles();
    box.value = ""; box.dispatchEvent(new Event("input")); $(".sort-button[data-sort=name]").click(); await wait(50);
    return [found, titles()];`), [["Studio"], ["Old flatDefault", "Studio"]]);
  check("a new tie starts at the default location; then it's unset again", await run(`
    $(".nav-add").click(); await wait(1200);
    const start = [$("#tie-location").offsetParent !== null, $("#tie-location").value, $("#tie-location-show").hidden];
    $("dialog[open] .dialog-cancel").click(); await wait(300);
    await clickIn("Old flatDefault", "Edit"); $("#is_default").click(); await submit();
    return [start, titles()];`), [[true, "Old flat", true], ["Old flat", "Studio"]]);

  console.log("Plans");
  await go("/plans");
  check("add plans with a variation", await run(`
    const types = [...$("#plan_type").options].map((o) => o.text);
    set("#title", "Hip harness"); set("#plan_type", "harness"); set("#est_difficulty", "3"); await submit();
    set("#title", "Hip harness, one-sided"); set("#variation_of", optionValue($("#variation_of"), "Hip harness")); await submit();
    return [types, $("#stage"), items().find((i) => i.startsWith("Hip harness |")), items().find((i) => i.startsWith("Hip harness, one-sided"))];`),
    [["Idea", "Harness", "Sequence"], null, "Hip harness | Harness · difficulty 3/5 · v1 | Edit | Archive | Delete",
      "Hip harness, one-sided | Idea · v1 · variation of Hip harness | Edit | Archive | Delete"]);
  check("the photo note says what photos are for, and when a new plan's are uploaded", await run(`
    const fresh = $("[data-photos] .hint").textContent;
    await clickIn("Hip harness", "Edit"); const editing = $("[data-photos] .hint").textContent; $("[data-cancel-edit]").click(); await wait(200);
    return [fresh, editing];`),
    ["Photos can be arranged and captioned to describe a sequence. They are uploaded when you save this form.",
      "Photos can be arranged and captioned to describe a sequence."]);
  check("a plan can't pick itself as its parent", await run(`await clickIn("Hip harness", "Edit"); const o = [...$("#variation_of").options].map((o) => o.text); $("[data-cancel-edit]").click(); return o;`),
    ["N/A", "Hip harness, one-sided"]);

  console.log("Ties: logging");
  await go("/");
  check("+ opens the log-a-tie dialog; pickers leave out archived items", await run(`
    $(".nav-add").click(); await wait(600);
    $("#tie-add-participant").click(); $("#tie-add-plan").click();
    const firstPerson = [lastBox("#tie-participants").value, $(".role").value];
    const hiddenAtFirst = $("#tie-location").offsetParent === null;
    $("#tie-location-show").click(); await wait(100);
    // No ties yet, so the newest added (sorted here: both were added the same second).
    const locations = [...document.querySelectorAll("#tie-location-list .combo-option")].map((o) => o.textContent).sort();
    $("#tie-location-remove").click(); await wait(100);
    const hiddenAgain = [$("#tie-location").offsetParent === null, $("#tie-location-show").hidden];
    return [!!$("dialog[open] #tie-form"), firstPerson, hiddenAtFirst, locations, hiddenAgain, [...$("#tie-tie_type").options].map((o) => o.text),
      document.querySelectorAll(".hank-button.filled").length + "/" + document.querySelectorAll(".hank-button").length,
      leakyFields()];`),
    [true, ["Me (you)", ""], true, ["Old flat", "Studio"], [true, false], ["Not set", "Suspension", "Partial suspension", "Floor"], "0/5", []]);
  // Sorted: these were all added within the same second, so "newest" ties.
  check("people and plans pickers list the active ones", await run(`
    const person = lastBox("#tie-participants"), plan = lastBox("#tie-plans");
    person.focus(); await wait(50); const people = pickerList(person).sort(); person.blur();
    plan.focus(); await wait(50); const plans = pickerList(plan).sort(); plan.blur();
    return [people, plans];`),
    [["Me (you)", "Sam"], ["Hip harness", "Hip harness, one-sided"]]);
  check("typing an archived person's name points to restoring them, not adding another", await run(`
    const person = lastBox("#tie-participants"); searchIn(person, "ALEX"); await wait(50);
    const listed = pickerList(person); person.blur(); return [listed, person.value];`),
    [["No matches.", '"Alex" is archived. Restore it from the People page to use it again.'], "Me (you)"]);
  check("a plan chosen in one row isn't offered in another", await run(`
    await choosePick(lastBox("#tie-plans"), "Hip harness");
    $("#tie-add-plan").click(); await wait(50);
    const second = lastBox("#tie-plans"); const listed = pickerList(second);
    second.closest(".picker-row").querySelector("button[aria-label=Remove]").click();
    return [listed, document.querySelectorAll("#tie-plans .picker-row").length];`),
    [["Hip harness, one-sided"], 1]);
  check("incomplete person row is caught", await run(`set("#tie-title", "Floor session"); await choosePick(lastBox("#tie-participants"), "Me", "Me (you)"); $("#tie-save").click(); await wait(500); return [lastBox("#tie-participants").value, $("#tie-message").textContent];`),
    ["Me (you)", "Couldn't save: Choose a person and a role for each row, or remove it."]);
  check("Edit tags opens an empty tag dialog", await run(`
    $("#tie-add-tags").click(); await wait(600);
    return [$("#tie-add-tags").getAttribute("aria-label"), $("#tags-heading").textContent, ["autocapitalize", "autocorrect", "spellcheck"].map((a) => $("#tags-search").getAttribute(a)), !!$("dialog[open] #tags-search"), $("#tags-list").innerText, $("#tags-search").placeholder, leakyFields()];`),
    ["Edit tags", "Edit tags", ["none", "off", "false"], true, "No tags yet. Type one and press +.", "search tags", []]);
  check("+ and Enter add tags; a different-capitals name picks the same tag", await run(`
    const box = $("#tags-search");
    box.value = "Futomomo"; $("#tags-add").click();
    box.value = "Floor"; box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    box.value = "futomomo"; $("#tags-add").click();
    return [tagChips(".tag-search"), tagBubbles(), box.value];`),
    [["Futomomo", "Floor"], ["Floor*", "Futomomo*"], ""]);
  check("a chip's × deselects it, and it can be deleted again; OK shows the tags by the button", await run(`
    document.querySelector(".tag-search .tag-x").click();
    const after = [tagChips(".tag-search"), tagBubbles()];
    [...document.querySelectorAll("#tags-list .tag-toggle")].find((b) => b.textContent === "Futomomo").click();
    $("#tags-ok").click(); await wait(300);
    return [after, tagChips("#tie-tags"), !!$("dialog[open] #tags-search")];`),
    [[["Floor"], ["Floor*", "Futomomo ×"]], ["Floor", "Futomomo"], false]);
  check("typing searches locations, offering to add a name that isn't one of them", await run(`
    $("#tie-location-show").click(); await wait(100);
    const box = $("#tie-location");
    const typeIn = (v) => { box.value = v; box.dispatchEvent(new Event("input")); };
    const listed = () => [...document.querySelectorAll("#tie-location-list li")].map((li) => li.innerText.replace(/\\n+/g, " | "));
    typeIn("STU"); const partial = listed();
    typeIn("studio"); const exact = listed();
    typeIn("Garage"); const none = listed();
    box.blur(); const afterBlur = box.value;
    return [partial, exact, none, afterBlur, leakyFields()];`),
    [["Studio", "Add to list | Add & archive"], ["Studio"], ["No matches.", "Add to list | Add & archive"], "", []]);
  check("'Add & archive' adds the typed name, archived, and picks it", await run(`
    const box = $("#tie-location"); box.focus(); box.value = "Garage"; box.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#tie-location-list button")].find((b) => b.textContent === "Add & archive").click(); await wait(800);
    const saved = (await (await fetch("/api/locations?archived=true")).json()).map((l) => l.name);
    return [box.value, $("[name=location_id]").value !== "", $("#tie-location-list").hidden, saved.includes("Garage"), !!$("dialog[open] #tie-form")];`),
    ["Garage", true, true, true, true]);
  check("'Add to list' adds an active location, which the list then offers", await run(`
    const box = $("#tie-location"); box.focus(); box.value = "Back garden"; box.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#tie-location-list button")].find((b) => b.textContent === "Add to list").click(); await wait(800);
    const picked = box.value;
    box.focus(); box.value = "back"; box.dispatchEvent(new Event("input"));
    const listed = [...document.querySelectorAll("#tie-location-list .combo-option")].map((li) => li.innerText);
    box.blur();
    return [picked, listed];`),
    ["Back garden", ["Back garden"]]);
  check("arrow keys and Enter pick a location without saving the tie", await run(`
    const box = $("#tie-location"); box.focus(); box.value = "stud"; box.dispatchEvent(new Event("input"));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
    const picked = [box.value, $("#tie-location-list").hidden, !!$("dialog[open] #tie-form")];
    box.blur(); return picked;`), ["Studio", true, true]);
  check("tapping a hank fills up to it; tapping the chosen one clears it", await run(`
    const hanks = document.querySelectorAll(".hank-button"); const value = () => $("[name=success_rating]").value;
    hanks[1].click(); const two = value(); hanks[1].click(); const cleared = value(); hanks[3].click();
    return [two, cleared, value(), [...hanks].map((b) => b.classList.contains("filled") ? "x" : "o").join("")];`),
    ["2", "", "4", "xxxxo"]);
  check("only the first person row starts with me; picking someone sets their default role, replacing a hand-picked one", await run(`
    $("#tie-add-participant").click(); await wait(50);
    const box = lastBox("#tie-participants"), role = () => document.querySelectorAll(".role")[1];
    const empty = [box.value, role().value];
    await choosePick(box, "Sam"); const sam = role().value;
    role().value = "spotter"; await choosePick(box, "Me", "Me (you)"); const me = role().value;
    role().value = "spotter"; await choosePick(box, "Sam"); const back = role().value;
    box.blur();
    return [empty, sam, me, back];`),
    [["", ""], "model", "", "model"]);
  check("save a full tie: the dialog closes and the list shows it", await run(`
    set("#tie-tie_type", "floor");
    document.querySelectorAll(".role")[0].value = "rigger";
    set("#tie-duration_minutes", "45"); set("#tie-notes", "Smooth transitions");
    $("#tie-save").click(); await wait(1000);
    return [!!document.querySelector("dialog"), titles()[0], card(0)];`),
    [false, "Floor session", [true, "Floor at Studio", 4, "With: Me (rigger), Sam (model)", ["Floor", "Futomomo"]]]);
  check("a tie needs a date: the form won't save without one", await run(`
    $(".nav-add").click(); await wait(600); set("#tie-title", "Dateless"); set("#tie-tie_date", "");
    $("#tie-save").click(); await wait(600);
    const stayed = [!!document.querySelector("dialog[open] #tie-form"), $("#tie-tie_date").validity.valueMissing];
    $("#tie-form .dialog-cancel").click(); await wait(600);
    return [stayed, titles()];`), [[true, true], ["Floor session"]]);
  check("Cancel closes the dialog without saving", await run(`
    $(".nav-add").click(); await wait(600); set("#tie-title", "Not saved");
    [...document.querySelectorAll("dialog button")].find((b) => b.textContent === "Cancel").click(); await wait(600);
    return [!!document.querySelector("dialog"), titles()];`), [false, ["Floor session"]]);

  check("saving the tie created and linked its tags", await run(`return tagsJson();`), ["Floor:1", "Futomomo:1"]);
  check("deleting a tag asks first, saying which ties use it", await run(`
    $(".nav-add").click(); await wait(600); $("#tie-add-tags").click(); await wait(600);
    const before = tagBubbles();
    [...document.querySelectorAll("#tags-list .tag")].find((t) => t.querySelector(".tag-toggle").textContent === "Floor").querySelector(".tag-x").click();
    await wait(300);
    const dialogs = document.querySelectorAll("dialog"); const confirm = dialogs[dialogs.length - 1];
    const asked = [confirm.querySelector("h2").textContent, confirm.querySelector("p").textContent, [...confirm.querySelectorAll("button")].map((b) => b.textContent)];
    [...confirm.querySelectorAll("button")].find((b) => b.textContent === "Confirm").click(); await wait(800);
    return [before, asked, tagBubbles(), await tagsJson()];`),
    [["Floor ×", "Futomomo ×"], ["Delete tag 'Floor'?", "Used on 1 tie; it'll be removed from it.", ["Confirm", "Cancel"]], ["Futomomo ×"], ["Futomomo:1"]]);
  check("closing the tag dialog without OK keeps the tie's tags as they were", await run(`
    document.querySelector("#tags-list .tag-toggle").click();
    $("#tags-search").closest("dialog").close(); await wait(300);
    const kept = tagChips("#tie-tags");
    $("#tie-form .dialog-cancel").click(); await wait(600);
    return [kept, !!document.querySelector("dialog")];`), [[], false]);

  console.log("Ties: searching and paging");
  await run(`
    const all = async (type) => (await (await fetch("/api/" + type + "?archived=all")).json());
    const alex = (await all("people")).find((p) => p.name === "Alex").id;
    const hotel = (await all("locations")).find((l) => l.name === "Hotel").id;
    await post("/api/ties", { title: "Hotel night", tie_date: "2025-06-01", location_id: hotel, participants: [{ person_id: alex, role: "model" }], tags: ["Futomomo", "Inversion"] });
    for (let day = 1; day <= 21; day++) await post("/api/ties", { title: "Practice " + day, tie_date: "2026-01-" + String(day).padStart(2, "0"), tags: day === 1 ? ["Inversion"] : [] });`);
  await go("/");
  check("20 per page, newest tie date first, with a page control", await run(`
    return [$("#tie-count").textContent, titles().length, titles().slice(0, 3), pagerButtons()];`),
    ["Showing 23 of 23 ties", 20, ["Floor session", "Practice 21", "Practice 20"], ["‹ Prev", "1*", "2", "Next ›"]]);
  check("every search field is kept out of form history and spellcheck", await run(`
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    const leaky = leakyFields();
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    return leaky;`), []);
  check("page 2 has the rest, and is in the URL", await run(`
    [...document.querySelectorAll("#pager button")].find((b) => b.textContent === "2").click(); await wait(800);
    return [titles(), location.search, pagerButtons()];`),
    [["Practice 2", "Practice 1", "Hotel night"], "?page=2", ["‹ Prev", "1", "2*", "Next ›"]]);
  check("Back returns to page 1", await run(`history.back(); await wait(900); return [titles().length, location.search];`), [20, ""]);
  check("50 per page shows them all, and is in the URL", await run(`
    set("#page-size", "50"); await wait(400); await settle();
    return [titles().length, pagerButtons(), location.search];`), [23, [], "?per_page=50"]);
  check("the sort button puts the oldest first, and back", await run(`
    $("#sort").click(); await wait(400); await settle();
    const oldest = [titles()[0], $("#sort").getAttribute("aria-pressed"), location.search];
    $("#sort").click(); set("#page-size", "20"); await wait(400); await settle();
    return [oldest, titles()[0], location.search];`),
    [["Hotel night", "true", "?per_page=50&sort=oldest"], "Floor session", ""]);
  check("people who don't fit on the line show as '+n'", await run(`
    $("#tie-list").style.width = "190px"; await wait(400);
    const line = document.querySelector(".tie-card .tie-with");
    const narrow = [line.innerText, line.querySelector(".tie-more").title];
    $("#tie-list").style.width = ""; await wait(400);
    return [narrow, line.innerText];`),
    [["With: Me (rigger) +1", "Sam (model)"], "With: Me (rigger), Sam (model)"]);
  check("filters list everyone A–Z, archived in muted text", await run(`
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    return [filterOptions("#people-filter"), filterOptions("#locations-filter")];`),
    [["Alex (muted)", "Me", "Sam"], ["Back garden", "Garage (muted)", "Hotel (muted)", "Old flat", "Studio"]]);
  check("a filter's search box narrows its list", await run(`
    const box = $("#people-filter input[type=search]"); box.value = "SA"; box.dispatchEvent(new Event("input"));
    const shown = filterOptions("#people-filter"); box.value = ""; box.dispatchEvent(new Event("input"));
    return shown;`), ["Sam"]);
  check("people filter: ties with all chosen people", await run(`
    await pick("#people-filter", "Me"); await pick("#people-filter", "Sam");
    return [titles(), $("#people-filter summary").textContent, $("#tie-count").textContent, pagerButtons()];`),
    [["Floor session"], "Me, Sam", "Showing 1 of 23 ties", []]);
  check("an archived person can be searched for", await run(`
    await pick("#people-filter", "Me"); await pick("#people-filter", "Sam"); await pick("#people-filter", "Alex");
    return titles();`), ["Hotel night"]);
  check("location filter", await run(`
    await pick("#people-filter", "Alex"); await pick("#locations-filter", "Hotel"); await pick("#locations-filter", "Studio");
    return titles();`), ["Floor session", "Hotel night"]);
  check("date range", await run(`
    await pick("#locations-filter", "Hotel"); await pick("#locations-filter", "Studio");
    set("#from", "2026-01-05"); await wait(500); set("#to", "2026-01-07"); await wait(800);
    return [titles(), $("#to").min];`), [["Practice 7", "Practice 6", "Practice 5"], "2026-01-05"]);
  check("Clear search resets everything", await run(`
    $("#clear").click(); await wait(800);
    return [$("#tie-count").textContent, $("#from").value, $("#people-filter summary").textContent, $("#clear").hidden, location.search];`),
    ["Showing 23 of 23 ties", "", "Anyone", true, ""]);
  check("Has Tags opens the tag dialog for picking only: no adding or deleting", await run(`
    $("#tags-choose").click(); await wait(600);
    const box = $("#tags-search"); box.value = "nosuchtag";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); box.dispatchEvent(new Event("input")); await wait(100);
    const unknown = [tagChips("#tags-search"), $("#tags-list").innerText];
    box.value = ""; box.dispatchEvent(new Event("input"));
    return [$("#tags-heading").textContent, !!$("#tags-add"), document.querySelectorAll("#tags-list .tag-x").length, tagBubbles(), unknown, leakyFields()];`),
    ["Choose tags", false, 0, ["Futomomo", "Inversion"], [[], "No matching tags."], []]);
  check("tags filter: OR (the default) lists ties with any chosen tag", await run(`
    for (const name of ["Futomomo", "Inversion"]) [...document.querySelectorAll("#tags-list .tag-toggle")].find((b) => b.textContent === name).click();
    $("#tags-ok").click(); await wait(800);
    return [titles(), tagChips("#tag-filter"), $("#tags-any").getAttribute("aria-pressed"), (location.search.match(/tag_id=/g) || []).length, $("#clear").hidden];`),
    [["Floor session", "Practice 1", "Hotel night"], ["Futomomo", "Inversion"], "true", 2, false]);
  check("tags filter: AND lists only ties with every chosen tag", await run(`
    $("#tags-all").click(); await wait(800);
    return [titles(), $("#tags-all").getAttribute("aria-pressed"), $("#tags-any").getAttribute("aria-pressed"), location.search.includes("tags=all")];`),
    [["Hotel night"], "true", "false", true]);
  check("a chosen tag's × takes it out of the search", await run(`
    [...document.querySelectorAll("#tag-filter .tag")].find((t) => t.textContent.startsWith("Inversion")).querySelector(".tag-x").click(); await wait(800);
    return [titles(), tagChips("#tag-filter")];`), [["Floor session", "Hotel night"], ["Futomomo"]]);
  await go(await run(`return location.pathname + location.search;`));
  check("tags survive a reload, and Clear search resets them to none and OR", await run(`
    const kept = [tagChips("#tag-filter"), $("#tags-all").getAttribute("aria-pressed"), titles()];
    $("#clear").click(); await wait(800);
    return [kept, tagChips("#tag-filter"), $("#tags-any").getAttribute("aria-pressed"), $("#tie-count").textContent, location.search];`),
    [[["Futomomo"], "true", ["Floor session", "Hotel night"]], [], "true", "Showing 23 of 23 ties", ""]);
  check("keyword matches a linked plan's title, and stays out of the URL", await run(`await type("#q", "hip"); return [titles(), location.search];`),
    [["Floor session"], ""]);
  check("the keyword stays out of the URL alongside other filters, and survives paging Back", await run(`
    await type("#q", "practice"); set("#from", "2026-01-01"); await wait(800);
    const onFilter = location.search;
    [...document.querySelectorAll("#pager button")].find((b) => b.textContent === "2").click(); await wait(800);
    const onPage2 = location.search;
    history.back(); await wait(900);
    const back = [location.search, $("#q").value, titles().length];
    $("#clear").click(); await wait(800);
    return [onFilter, onPage2, back];`),
    ["?from=2026-01-01", "?from=2026-01-01&page=2", ["?from=2026-01-01", "practice", 20]]);
  check("no matches says so", await run(`await type("#q", "zzz"); return $("#tie-list").innerText;`), "No ties match this search.");
  await go("/?q=practice+1&page=2");
  check("a keyword in an old URL is ignored and removed from the address", await run(`return [$("#q").value, location.search, titles().length, $("#clear").hidden];`),
    ["", "?page=2", 3, true]);

  console.log("Encrypted notes");
  await go("/");
  check("a keyword finds words only in the notes, searched on the device", await run(`
    await type("#q", "SMOOTH transitions"); const found = titles(); $("#clear").click(); await wait(800); return found;`),
    ["Floor session"]);
  check("capitals don't matter in any language: Ö finds ö", await run(`
    $(".nav-add").click(); await wait(600); set("#tie-title", "Knot test"); set("#tie-notes", "  Öse knot, tied twice  ");
    $("#tie-save").click(); await wait(1200);
    await type("#q", "öse"); const lower = titles(); await type("#q", "ÖSE KNOT"); const upper = titles();
    $("#clear").click(); await wait(800); return [lower, upper];`),
    [["Knot test"], ["Knot test"]]);
  check("the server only ever has notes encrypted; the page shows them opened", await run(`
    const index = await (await fetch("/api/ties/search-index")).json();
    const people = await (await fetch("/api/people?archived=all")).json();
    const plans = await (await fetch("/api/plans?archived=all")).json();
    const stored = [...index.map((t) => t.notes), ...people.map((p) => p.notes), ...plans.flatMap((p) => [p.description, p.notes])]
      .filter((v) => v !== null);
    const knot = index.find((t) => t.title === "Knot test");
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Knot test").click(); await wait(1000);
    const shown = $("#tie-notes").value;
    return [stored.length > 0, stored.every((v) => /^e1\\./.test(v)), knot.notes.includes("knot"), shown];`),
    [true, true, false, "Öse knot, tied twice"]);
  check("…and the test tie is deleted again", await run(`
    // The confirmation's "Delete tie" (opened last), not the form's own.
    $("#tie-delete").click(); await wait(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await wait(1000);
    return [titles().includes("Knot test"), $("#tie-count").textContent];`), [false, "Showing 23 of 23 ties"]);

  // Notes written before encryption: plain text in the database.
  spawnSync("npx", ["wrangler", "d1", "execute", "notonawa", "--local", "--persist-to", dbDir,
    "--command", "UPDATE people SET notes = 'Written before encryption' WHERE name = 'Sam'"], { encoding: "utf8" });
  await go("/people");
  await sleep(1500);
  check("notes in plain text are encrypted at the next unlock, and still show", await run(`
    const sam = (await (await fetch("/api/people?archived=all")).json()).find((p) => p.name === "Sam");
    const pending = await (await fetch("/api/encryption/pending")).json();
    return [/^e1\\./.test(sam.notes), Object.values(pending).every((rows) => rows.length === 0),
      items().some((i) => i.includes("Written before encryption")), document.querySelector(".toast") === null];`),
    [true, true, true, true]);

  console.log("Photos");
  await go("/");
  // A JPEG with metadata written into it, as a camera would (an Exif
  // segment holding a made-up GPS note), as if picked in the file dialog.
  // prefix: the form's ("tie" or "plan").
  const pickPhoto = (prefix, width, height, name) => run(`
    const canvas = document.createElement("canvas"); canvas.width = ${width}; canvas.height = ${height};
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#c33"; ctx.fillRect(0, 0, ${width}, ${height});
    ctx.fillStyle = "#33c"; ctx.fillRect(0, 0, ${width} / 2, ${height} / 2);
    const jpeg = new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9))).arrayBuffer());
    const note = new TextEncoder().encode("Exif\\0\\0SECRET-GPS-48.8584N");
    const app1 = new Uint8Array([0xff, 0xe1, 0, note.length + 2, ...note]);
    const file = new File([jpeg.slice(0, 2), app1, jpeg.slice(2)], ${JSON.stringify(name)}, { type: "image/jpeg" });
    const dt = new DataTransfer(); dt.items.add(file);
    $("#${prefix}-photo-input").files = dt.files; $("#${prefix}-photo-input").dispatchEvent(new Event("change"));
    // Until it's prepared (and uploaded, on a saved tie): up to 10 seconds.
    await wait(300);
    for (let i = 0; i < 100 && /Preparing|Uploading/.test($("#${prefix}-photos-message").textContent); i++) await wait(100);
    await wait(500);
    return [new TextDecoder().decode(await file.arrayBuffer()).includes("SECRET-GPS"),
      document.querySelectorAll("#${prefix}-photos .photo-tile img").length, $("#${prefix}-photos-message").textContent];`);
  await run(`$(".nav-add").click(); await wait(600); set("#tie-title", "Photo test");`);
  check("a new tie's photo is prepared and waits for the tie to be saved",
    await pickPhoto("tie", 3000, 1000, "camera.jpg"), [true, 1, ""]);
  check("…and is uploaded when it's saved, counted on the card", await run(`
    $("#tie-save").click(); await wait(2500); await settle();
    const c = [...document.querySelectorAll(".tie-card")].find((x) => x.querySelector(".tie-title").innerText === "Photo test");
    return [!!document.querySelector("dialog"), c?.querySelector(".tie-photos")?.innerText ?? null];`), [false, "1 photo"]);
  check("the server only has it encrypted", await run(`
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    const sealed = new Uint8Array(await (await fetch("/api/media/" + photo.id + "/full")).arrayBuffer());
    const text = new TextDecoder("latin1").decode(sealed);
    return [photo.mime, sealed[0] === 0xff && sealed[1] === 0xd8, text.includes("SECRET-GPS"), text.includes("Exif"), text.includes("WEBP")];`),
    ["image/webp", false, false, false, false]);
  check("opened on the device: shrunk, with no metadata left", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await wait(1500);
    $("#tie-photos .photo-thumb").click(); await wait(1500);
    const img = $("dialog[open] .photo-full");
    // The bytes shown, read through the app (the CSP's connect-src keeps
    // fetch off blob: URLs).
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    const bytes = new Uint8Array(await (await import("/js/vault.js")).openPhoto(photo.id, "full"));
    const text = new TextDecoder("latin1").decode(bytes);
    return [img.src.startsWith("blob:"), img.naturalWidth, img.naturalHeight, text.startsWith("RIFF") && text.slice(8, 12) === "WEBP",
      text.includes("SECRET-GPS"), text.includes("Exif"), bytes.length < 500 * 1024, $("#tie-photo-earlier").disabled, leakyFields()];`),
    [true, 2048, 683, true, false, false, true, true, []]);
  check("a caption is saved encrypted and shown under the thumbnail", await run(`
    set("#tie-photo-caption", "  Front view  "); $("#tie-photo-save-caption").click(); await wait(1000);
    const shown = $("#tie-photos figcaption")?.textContent;
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel").click(); await wait(300);
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    return [shown, /^e1\\./.test(photo.caption), photo.caption.includes("Front")];`), ["Front view", true, false]);
  check("on a saved tie, a photo uploads straight away",
    (await pickPhoto("tie", 400, 600, "second.jpg")).slice(1), [2, ""]);
  check("…moved earlier, the new order is saved", await run(`
    document.querySelectorAll("#tie-photos .photo-thumb")[1].click(); await wait(1200);
    $("#tie-photo-earlier").click(); await wait(800);
    const shown = [...document.querySelectorAll("#tie-photos .photo-tile")].map((t) => t.querySelector("figcaption")?.textContent ?? "");
    [...document.querySelectorAll("dialog[open]")].pop().querySelector(".dialog-cancel").click(); await wait(300);
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const listed = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    return [shown, listed.map((p) => p.caption === null)];`), [["", "Front view"], [true, false]]);
  check("locking revokes the photos shown", await run(`
    const src = $("#tie-photos .photo-thumb img").src;
    const loads = (url) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(true); i.onerror = () => resolve(false); i.src = url; });
    const before = await loads(src);
    (await import("/js/vault.js")).lock(); await wait(500);
    return [before, await loads(src), [...document.querySelectorAll("img")].some((i) => i.src.startsWith("blob:"))];`), [true, false, false]);
  await go("/");
  check("deleting a photo asks first, then removes it", await run(`
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Photo test").click(); await wait(1500);
    $("#tie-photos .photo-thumb").click(); await wait(1200);
    $("#tie-photo-delete").click(); await wait(300);
    const asked = [...document.querySelectorAll("dialog")].pop().querySelector("h2").textContent;
    [...[...document.querySelectorAll("dialog")].pop().querySelectorAll("button")].find((b) => b.textContent === "Delete photo").click(); await wait(1000);
    return [asked, document.querySelectorAll("#tie-photos .photo-tile").length];`), ["Delete this photo?", 1]);
  check("…and deleting the tie deletes the rest", await run(`
    const tie = (await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json())
      .ties.find((t) => t.title === "Photo test");
    const [photo] = await (await fetch("/api/media?tie_id=" + tie.id)).json();
    $("#tie-delete").click(); await wait(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await wait(1000);
    return [(await fetch("/api/media/" + photo.id + "/thumb")).status, $("#tie-count").textContent];`), [404, "Showing 23 of 23 ties"]);

  await go("/plans");
  await run(`set("#title", "Photo plan");`);
  check("a new plan's photo waits for the plan to be saved", await pickPhoto("plan", 800, 600, "plan.jpg"), [true, 1, ""]);
  check("…is uploaded when it's saved, and counted in the list", await run(`
    await submit(); await wait(2000);
    return [$("#form > .message").textContent, items().find((i) => i.startsWith("Photo plan"))?.includes("1 photo") ?? false];`),
    ["Saved.", true]);
  check("editing the plan shows its photo", await run(`
    await clickIn("Photo plan", "Edit"); await wait(1500);
    const shown = document.querySelectorAll("#plan-photos .photo-tile img").length;
    const plan = (await (await fetch("/api/plans?archived=false")).json()).find((p) => p.title === "Photo plan");
    const [photo] = await (await fetch("/api/media?plan_id=" + plan.id)).json();
    const res = await fetch("/api/plans/" + plan.id + "?linked_ties=keep", { method: "DELETE" });
    return [shown, photo.mime, res.status, (await fetch("/api/media/" + photo.id + "/thumb")).status];`),
    [1, "image/webp", 204, 404]);

  console.log("Deleting");
  await go("/plans");
  check("plan delete dialog has the three options", await run(`await clickIn("Hip harness", "Delete"); return dialogButtons();`),
    ["Remove from linked ties too", "Just delete the plan", "Cancel"]);
  check("cancel keeps the plan", await run(`await clickDialog("Cancel"); return [!!document.querySelector("dialog"), titles().length];`), [false, 2]);
  check("'Just delete the plan'", await run(`await clickIn("Hip harness", "Delete"); await clickDialog("Just delete the plan"); return titles();`), ["Hip harness, one-sided"]);
  await go("/locations");
  check("location delete offers archiving instead", await run(`await clickIn("Studio", "Delete"); const b = dialogButtons(); await clickDialog("Delete permanently"); return [b, titles()];`),
    [["Archive instead", "Delete permanently", "Cancel"], ["Back garden", "Old flat"]]);
  await go("/people");
  check("delete a person", await run(`await clickIn("Sam", "Delete"); await clickDialog("Delete permanently"); return titles();`), ["MeYou"]);
  await go("/");
  check("tie shows what was deleted", await run(`return card(0);`),
    [true, "Floor at (location deleted)", 4, "With: (person deleted) (model), Me (rigger)", ["Futomomo"]]);
  check("tapping a title opens the tie to edit, deleted links shown as kept", await run(`
    $(".tie-title").click(); await wait(1000);
    const d = $("dialog[open]");
    const kept = (sel) => [...d.querySelectorAll(sel + " .kept-deleted")].map((r) => r.innerText.replace(/\\s*✕$/, ""));
    return [$("#tie-form-heading").textContent, $("#tie-title").value, $("#tie-tie_type").value, $("#tie-duration_minutes").value,
      $("#tie-notes").value, $("#tie-location-deleted").hidden, kept("#tie-participants"),
      [...d.querySelectorAll("#tie-participants .person-row [role=combobox]")].map((b) => b.value),
      kept("#tie-plans"), tagChips("#tie-tags"), d.querySelectorAll(".hank-button.filled").length,
      [...d.querySelectorAll("button")].filter((b) => ["Save tie", "Cancel", "Delete tie"].includes(b.textContent)).map((b) => b.textContent), leakyFields()];`),
    ["Edit tie", "Floor session", "floor", "45", "Smooth transitions", false, ["(person deleted) (model)"], ["Me"], ["(plan deleted)"], ["Futomomo"], 4,
      ["Save tie", "Cancel", "Delete tie"], []]);
  check("saving an edit updates the tie, keeping the deleted links left in", await run(`
    set("#tie-title", "Floor session, edited"); $("#tie-save").click(); await wait(600); await settle();
    return [!!document.querySelector("dialog"), titles()[0], card(0)];`),
    [false, "Floor session, edited", [true, "Floor at (location deleted)", 4, "With: (person deleted) (model), Me (rigger)", ["Futomomo"]]]);
  check("removing deleted links in the edit form drops them", await run(`
    $(".tie-title").click(); await wait(1000);
    $("#tie-participants .kept-deleted button").click(); $("#tie-location-deleted button").click();
    $("#tie-save").click(); await wait(600); await settle();
    return card(0);`), [true, "Floor", 4, "With: Me (rigger)", ["Futomomo"]]);
  await run(`await post("/api/ties", { title: "Throwaway", tie_date: "2030-01-01" });`);
  await go("/");
  check("Delete tie asks first; Cancel keeps it, Delete tie deletes it", await run(`
    const confirmDialog = () => { const all = document.querySelectorAll("dialog"); return all[all.length - 1]; };
    const press = (label) => [...confirmDialog().querySelectorAll("button")].find((b) => b.textContent === label).click();
    [...document.querySelectorAll(".tie-title")].find((t) => t.innerText === "Throwaway").click(); await wait(1000);
    $("#tie-delete").click(); await wait(300);
    const asked = [confirmDialog().querySelector("h2").textContent, [...confirmDialog().querySelectorAll("button")].map((b) => b.textContent)];
    press("Cancel"); await wait(300);
    const kept = [!!$("dialog[open] #tie-form"), titles().includes("Throwaway")];
    $("#tie-delete").click(); await wait(300); press("Delete tie"); await wait(600); await settle();
    return [asked, kept, !!document.querySelector("dialog"), titles().includes("Throwaway")];`),
    [["Delete this tie?", ["Delete tie", "Cancel"]], [true, true], false, false]);

  console.log("+ on other tabs");
  await go("/plans");
  await run(`$(".nav-add").click(); await wait(600); set("#tie-title", "Logged from Plans"); $("#tie-save").click();`);
  await sleep(1500);
  check("saving from another tab goes to the Ties list", await run(`return [location.pathname, titles()[0]];`), ["/", "Logged from Plans"]);

  console.log("Account");
  await go("/account");
  check("the account page lists the passkey and this session", await run(`
    await openMenu(); const current = $(".nav-account").getAttribute("aria-current"); $("dialog.menu-panel").close();
    return [current, [...$("#passkeys").querySelectorAll(".item-title")].map((t) => t.textContent),
      [...$("#sessions").querySelectorAll(".item-title")].map((t) => [t.firstChild.textContent, t.querySelector(".badge")?.textContent]),
      [...$("#passkeys").querySelectorAll("button")].map((b) => b.textContent), $("#end-others").hidden, $("#recovery-status").textContent];`),
    ["page", ["Test phone"], [["Signed in with Test phone", "This device"]], ["Rename"], true, "You have a recovery code. Making a new one replaces it."]);
  check("rename a passkey", await run(`
    [...$("#passkeys").querySelectorAll("button")].find((b) => b.textContent === "Rename").click(); await wait(300);
    const leaky = leakyFields(); $("#rename-input").value = "Phone"; $("dialog[open] button[type=submit]").click(); await wait(800);
    return [leaky, [...$("#passkeys").querySelectorAll(".item-title")].map((t) => t.textContent)];`), [[], ["Phone"]]);
  check("the recovery email's i button shows and hides its explanation", await run(`
    const button = $("#email-info-button"); const shown = () => [button.getAttribute("aria-expanded"), !$("#email-info").hidden];
    const before = shown(); button.click(); const open = shown(); button.click();
    return [$("#email-form").hidden, $("#email-actions").hidden, before, open, shown()];`),
    [false, true, ["false", false], ["true", true], ["false", false]]);
  check("a recovery email typed differently twice isn't saved", await run(`
    $("#recovery-email").value = "sam@example.com"; $("#recovery-email-again").value = "sam@example.org";
    $("#email-form button[type=submit]").click(); await wait(500);
    return [$("#email-message").textContent, (await (await fetch("/api/account")).json()).has_recovery_email];`),
    ["The two addresses don't match.", false]);
  check("set a recovery email: only 'set' is shown, with Change and Remove", await run(`
    $("#recovery-email-again").value = " Sam@Example.com"; $("#email-form button[type=submit]").click(); await wait(2500);
    return [$("#email-message").textContent, $("#email-form").hidden, $("#email-actions").hidden, $("#recovery-email").value,
      (await (await fetch("/api/account")).json()).has_recovery_email];`),
    ["Saved.", true, false, "", true]);
  check("Change shows the form with Cancel; Remove asks first, then removes it", await run(`
    $("#email-change").click(); const changing = [$("#email-form").hidden, $("#email-cancel").hidden, $("#email-actions").hidden];
    $("#email-cancel").click(); const back = [$("#email-form").hidden, $("#email-actions").hidden];
    $("#email-remove").click(); await wait(300); await clickDialog("Remove"); await wait(800);
    return [changing, back, $("#email-form").hidden, (await (await fetch("/api/account")).json()).has_recovery_email];`),
    [[false, false, true], [true, false], false, false]);
  const newRecovery = await run(`
    $("#new-code").click(); await wait(300); await clickDialog("Make a new code"); await wait(2500);
    const code = $("#recovery-code").textContent; await finishRecoveryDialog(); return code;`);
  check("make a new recovery code, shown once", [/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(newRecovery ?? ""), newRecovery !== recoveryCode], [true, true]);
  currentCode = newRecovery ?? "";
  await run(`$("#sign-out").click();`);
  await sleep(1500);
  check("sign out goes to the sign-in page, without the nav, and the journal stays locked", await run(`
    return [location.pathname, $("nav").hidden, document.title, (await fetch("/api/tags")).status];`), ["/signin", true, "Sign in · NotoNawa", 401]);

  console.log("Signing in");
  await go("/signin");
  await run(`$("#sign-in").click();`);
  await sleep(2500);
  check("sign in with the passkey", await run(`return [location.pathname, $("#tie-count").textContent];`), ["/", "Showing 24 of 24 ties"]);

  console.log("Recovery");
  // Lose the phone: its passkey is gone. The new device has a new
  // authenticator, one without PRF: it can sign in but not unlock.
  await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  authenticatorId = await addAuthenticator({ prf: false });
  await run(`await fetch("/api/auth/logout", { method: "POST" });`);
  await go("/signin");
  check("signing in without a passkey for this site fails gently", await run(`
    $("#sign-in").click(); await wait(2500); return [location.pathname, $("#sign-in-message").className];`), ["/signin", "message error"]);
  check("the replaced recovery code no longer works", await run(`
    [...document.querySelectorAll("[data-show=recover]")][0].click(); $("#code").value = ${JSON.stringify(recoveryCode)};
    $("#recover-form button[type=submit]").click(); await wait(1200); return $("#recover-message").textContent;`),
    "That recovery code didn't work.");
  check("the current one signs in, but only to add a passkey", await run(`
    $("#code").value = ${JSON.stringify((newRecovery ?? "").toLowerCase().replace(/-/g, " "))};
    $("#recover-form button[type=submit]").click(); await wait(1200);
    return [visibleCard(), (await fetch("/api/tags")).status, leakyFields()];`), ["add-passkey", 403, []]);
  const shownAfterRecovery = await run(`
    $("#new-passkey-name").value = "New phone"; $("#add-passkey-form button[type=submit]").click(); await wait(2500);
    const shown = recoveryDialog()[0]; $("#recovery-saved").click(); $("dialog[open] button.primary").click(); return shown;`);
  await sleep(1500);
  check("adding a passkey finishes signing in, unlocked with the code, with a new recovery code", [
    /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(shownAfterRecovery ?? ""),
    ...await run(`return [location.pathname, $("#tie-count").textContent];`),
  ], [true, "/", "Showing 24 of 24 ties"]);
  currentCode = shownAfterRecovery ?? "";
  await go("/account", { unlock: false });
  check("a passkey that can't unlock signs in, then asks for the recovery code", await run(`
    $("#unlock-passkey").click(); await wait(2500);
    const why = [$("#unlock-code").hidden, $("#unlock-code-why").textContent];
    $("#unlock-code-input").value = ${JSON.stringify(shownAfterRecovery)}; $("#unlock-code-form button[type=submit]").click(); await wait(1500);
    return [...why, $("#view h1").textContent];`),
    [false, "This passkey can't unlock your journal (its device doesn't support it), so use your recovery code.", "Account"]);
  check("the account page says which passkeys unlock", await run(`
    return [...$("#passkeys").querySelectorAll(".item")].map((i) => [i.querySelector(".item-title").textContent, i.querySelectorAll(".item-meta")[1].textContent]);`),
    [["Phone", "Unlocks your journal"], ["New phone", "Signs in only: unlock with your recovery code (once, if it can unlock after that)"]]);
  check("the lost phone's passkey can then be removed", await run(`
    const before = [...$("#passkeys").querySelectorAll(".item-title")].map((t) => t.textContent);
    const phone = [...$("#passkeys").querySelectorAll(".item")].find((i) => i.querySelector(".item-title").textContent === "Phone");
    [...phone.querySelectorAll("button")].find((b) => b.textContent === "Remove").click(); await wait(300);
    await clickDialog("Remove passkey"); await wait(800);
    return [before, [...$("#passkeys").querySelectorAll(".item-title")].map((t) => t.textContent)];`),
    [["Phone", "New phone"], ["New phone"]]);

  console.log("Your data");
  const downloads = path.join(workDir, "downloads");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  await go("/data");
  check("the data page is in the menu, and its fields are kept out of form history", await run(`
    await openMenu(); const current = $(".nav-data").getAttribute("aria-current"); $("dialog.menu-panel").close();
    return [current, leakyFields()];`), ["page", []]);
  check("export downloads the whole journal", await run(`
    $("#export").click(); await wait(1500); return $("#export-message").textContent;`), "Downloaded.");
  await sleep(500);
  const exported = readdirSync(downloads);
  check("…as a dated JSON file", exported.length === 1 && /^notonawa-\d{4}-\d\d-\d\d\.json$/.test(exported[0]), true);
  const exportText = exported.length ? readFileSync(path.join(downloads, exported[0]), "utf8") : "{}";
  const exportDoc = JSON.parse(exportText);
  check("the file has every tie, and the people", [exportDoc.format, exportDoc.ties?.length, exportDoc.people?.map((p) => p.name).sort()],
    ["notonawa-export", 24, ["Alex", "Me"]]);
  check("…with the notes decrypted on the device, nothing left encrypted",
    // "Floor session" was renamed when editing was checked.
    [exportDoc.ties?.find((t) => t.title?.startsWith("Floor session"))?.notes ?? null, exportText.includes('"e1.')],
    ["Smooth transitions", false]);
  // A location the journal already has, for the CSV to match.
  const place = exportDoc.locations?.[0]?.name ?? "";
  // Picks a file in the import box, as if chosen in the file dialog.
  const chooseFile = (name, type, text) => run(`
    const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: ${JSON.stringify(type)} }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await wait(1500);
    return [[...document.querySelectorAll("#import-preview .item")].map(flat), $("#import-go").hidden ? null : $("#import-go").textContent,
      $("#import-message").textContent];`);
  const csv = `date,title,people,location,tags\n2026-11-01,Imported one,alex (model); Robin (rigger),${place},imported\n2026-11-02,Imported two,,Beach,\n`;
  check("a CSV shows what will happen before anything is saved", await chooseFile("ties.csv", "text/csv", csv), [[
    "Ties | 2 to add",
    "People | 1 new: Robin | 1 already in your journal: alex",
    `Locations | 1 new: Beach | 1 already in your journal: ${place}`,
    "Tags | 1 new: imported",
  ], "Import 2 ties", ""]);
  check("importing it adds the ties", await run(`
    $("#import-go").click(); await wait(2000); const msg = $("#import-message").textContent;
    const res = await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ page_size: 100 }) })).json();
    return [msg, $("#import-go").hidden, res.ties.filter((t) => t.title?.startsWith("Imported"))
      .map((t) => [t.title, t.location_name, t.participants.map((p) => p.person_name + ":" + p.role).sort()])];`),
    ["Imported 2 ties.", true, [["Imported two", "Beach", []], ["Imported one", place, ["Alex:model", "Robin:rigger"]]]]);
  check("a CSV with mistakes lists them by row, and saves nothing", await chooseFile("bad.csv", "text/csv", "date,title\n12/10/2026,x\n"),
    [[], null, 'Fix these in the file, then choose it again:\nRow 2: Write the date as year-month-day, like 2026-10-12 (not "12/10/2026").']);
  check("importing the export into the same journal has nothing to add", (await chooseFile(exported[0] ?? "x.json", "application/json", exportText)).slice(1),
    [null, "Everything in this file is already in your journal."]);
  check("a file that isn't an export is refused", (await chooseFile("notes.json", "application/json", '{"hello":1}'))[2],
    "This isn't a NotoNawa export.");

  // With photos, the export is a zip that imports back.
  const photoTie = await run(`
    const id = await post("/api/ties", { title: "Zip test", tie_date: "2026-11-05" });
    const canvas = document.createElement("canvas"); canvas.width = 300; canvas.height = 200;
    canvas.getContext("2d").fillRect(0, 0, 150, 100);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    const prepared = await (await import("/js/photo-prep.js")).preparePhoto(new File([blob], "x.jpg", { type: "image/jpeg" }));
    await (await import("/js/photo-upload.js")).uploadPhoto({ item: { tie_id: id }, prepared, caption: "Zip caption" });
    return id;`);
  const zipDownloads = path.join(workDir, "downloads-zip");
  await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: zipDownloads });
  check("with photos, export downloads a zip", await run(`
    $("#export").click(); for (let i = 0; i < 50 && !/Downloaded|Couldn't/.test($("#export-message").textContent); i++) await wait(100);
    return $("#export-message").textContent;`), "Downloaded.");
  await sleep(800);
  const zipped = readdirSync(zipDownloads);
  const { readZip } = await import("../public/js/zip.js");
  const zipBytes = zipped.length ? readFileSync(path.join(zipDownloads, zipped[0])) : Buffer.alloc(0);
  const zipFiles = zipped.length ? await readZip(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.length)) : new Map();
  const zipDoc = JSON.parse(new TextDecoder().decode(zipFiles.get("notonawa.json") ?? new TextEncoder().encode("{}")));
  const zipPhoto = zipDoc.ties?.find((t) => t.title === "Zip test")?.photos?.[0];
  const photoBytes = zipPhoto ? zipFiles.get(zipPhoto.file) : null;
  check("…holding the journal and the photo, decrypted, with its caption", [
    /^notonawa-\d{4}-\d\d-\d\d\.zip$/.test(zipped[0] ?? ""), zipPhoto?.caption, zipPhoto?.file?.startsWith("photos/"),
    photoBytes ? new TextDecoder("latin1").decode(photoBytes.subarray(0, 12)).replace(/^RIFF.{4}/s, "RIFF") : null,
  ], [true, "Zip caption", true, "RIFFWEBP"]);
  // The photo is deleted, then the zip imported: it comes back on the tie.
  await run(`const [m] = await (await fetch("/api/media?tie_id=${photoTie}")).json(); await fetch("/api/media/" + m.id, { method: "DELETE" });`);
  const chooseZip = () => run(`
    const bytes = Uint8Array.from(atob(${JSON.stringify(zipBytes.toString("base64"))}), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], ${JSON.stringify(zipped[0] ?? "x.zip")}, { type: "application/zip" }));
    $("#import-file").files = dt.files; $("#import-file").dispatchEvent(new Event("change")); await wait(2000);
    return [[...document.querySelectorAll("#import-preview .item")].map(flat).filter((t) => t.startsWith("Photos")), $("#import-go").hidden ? null : $("#import-go").textContent];`);
  check("importing the zip previews its photos", await chooseZip(),
    [["Photos | 1 in the file (added to ties and plans that don't already have photos)"], "Import"]);
  check("…and puts the photo back on its tie, with its caption", await run(`
    $("#import-go").click(); for (let i = 0; i < 80 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    const listed = await (await fetch("/api/media?tie_id=${photoTie}")).json();
    const opened = await (await import("/js/vault.js")).openMedia(listed);
    return [$("#import-message").textContent, opened.map((p) => p.caption)];`),
    ["Imported 0 ties. Skipped 27 ties already in your journal. Added 1 photo.", ["Zip caption"]]);
  check("importing it again doesn't add the photo twice", (await chooseZip(), await run(`
    $("#import-go").click(); for (let i = 0; i < 80 && !/Imported|Couldn't/.test($("#import-message").textContent); i++) await wait(100);
    return [$("#import-message").textContent, (await (await fetch("/api/media?tie_id=${photoTie}")).json()).length];`)),
    ["Imported 0 ties. Skipped 27 ties already in your journal. Skipped 1 photo on ties or plans that already have photos.", 1]);

  console.log("Calendar and Analytics");
  await go("/calendar");
  check("Calendar and Analytics are the tabs after Locations, marked when shown", await run(`
    const links = [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("href"));
    return [links.slice(-3), $("nav a[aria-current=page]").getAttribute("aria-label")];`),
    [["/locations", "/calendar", "/analytics"], "Calendar"]);
  check("Calendar shows this month: its name, five numbers and every day", await run(`
    await wait(800); const days = document.querySelectorAll(".cal-day").length;
    return [$("#cal-title").textContent.length > 0, document.querySelectorAll("#cal-stats .stat").length, days >= 28 && days <= 31];`),
    [true, 5, true]);
  check("its arrows step back a month and forward again", await run(`
    const now = $("#cal-title").textContent; $("#cal-prev").click(); await wait(600); const before = $("#cal-title").textContent;
    $("#cal-next").click(); await wait(600); return [before !== now, $("#cal-title").textContent === now];`), [true, true]);
  await go("/analytics");
  check("Analytics shows this year's numbers and a bar for each month", await run(`
    await wait(1000);
    return [$("nav a[aria-current=page]").getAttribute("aria-label"), $("#period").value, $("#period-title").textContent === String(new Date().getFullYear()),
      document.querySelectorAll("#insights-stats .stat").length, document.querySelectorAll("#tie-count-chart .bar").length, $("#insights-message").textContent];`),
    ["Analytics", "year", true, 8, 12, ""]);
  check("Month shows a bar for each day, Custom shows its dates", await run(`
    set("#period", "month"); await wait(800); const days = document.querySelectorAll("#tie-count-chart .bar").length;
    set("#period", "custom"); await wait(300); const custom = !$("#custom-dates").hidden;
    set("#period", "year"); await wait(800);
    return [days >= 28 && days <= 31, custom];`), [true, true]);
  check("More filters lists people (not me), locations and tags, kept out of form history and spellcheck", await run(`
    $("#more-filters").click(); await wait(1000);
    const open = !!$("dialog[open].more-filters"); const leaky = leakyFields();
    const people = [...document.querySelectorAll("dialog[open] details")][0].querySelectorAll("label").length;
    const mine = [...document.querySelectorAll("dialog[open] details label")].some((l) => l.textContent === "Me");
    $("#af-cancel").click(); await wait(200);
    return [open, leaky, people > 0, mine, document.querySelector("dialog[open]") === null];`), [true, [], true, false, true]);
  check("…and Insights' own fields are too", await run(`return leakyFields();`), []);
  check("tapping a bar lists its ties, newest first, and the list closes", await run(`
    const bar = document.querySelector("#tie-count-chart .bar-hits button"); const label = bar.getAttribute("aria-label");
    bar.click(); await wait(1000);
    const shown = [$("#tl-heading").textContent, document.querySelectorAll("#tl-list .tie-card").length];
    const count = Number(label.match(/(\\d+) ties?$/)[1]);
    $("#tl-close").click(); await wait(200);
    return [shown[0].endsWith(count === 1 ? "· 1 tie" : "· " + count + " ties"), shown[1] === Math.min(count, 100), document.querySelector("dialog[open]") === null];`),
    [true, true, true]);
  check("so does tapping a partner and a pie's legend", await run(`
    $("#partner-chart .partner-row").click(); await wait(1000); const partner = document.querySelectorAll("#tl-list .tie-card").length > 0; $("#tl-close").click(); await wait(200);
    $("#type-chart .legend-row").click(); await wait(1000); const type = document.querySelectorAll("#tl-list .tie-card").length > 0; $("#tl-close").click(); await wait(200);
    return [partner, type];`), [true, true]);

  console.log("Deleting the account");
  await go("/account");
  check("delete needs typing 'delete'", await run(`
    $("#delete-account").click(); await wait(300);
    const before = $("dialog[open] button.danger.solid").disabled; const leaky = leakyFields();
    $("#delete-confirm").value = "delet"; $("#delete-confirm").dispatchEvent(new Event("input"));
    const almost = $("dialog[open] button.danger.solid").disabled;
    $("#delete-confirm").value = "Delete"; $("#delete-confirm").dispatchEvent(new Event("input"));
    return [before, almost, $("dialog[open] button.danger.solid").disabled, leaky];`), [true, true, false, []]);
  check("deleting the account empties it and signs out", await run(`
    $("dialog[open] button.danger.solid").click(); await wait(1500);
    return [$("h1").textContent, (await fetch("/api/tags")).status];`), ["Account deleted", 401]);
  await go("/signin");
  check("its passkey no longer signs in", await run(`
    $("#sign-in").click(); await wait(2500); return [location.pathname, $("#sign-in-message").className];`), ["/signin", "message error"]);

  check("no errors in the browser console", consoleErrors, []);
} catch (err) {
  failures++;
  console.error(err);
} finally {
  ws.close();
  cleanup();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll UI checks passed");
process.exit(failures ? 1 : 0);
