// UI smoke test: clicks through every page in headless Chrome against a
// throwaway local database, and checks what's on screen.
//
//   npm run test:ui
//
// Needs Google Chrome installed (set CHROME_PATH if it's not in the default
// macOS location). No npm packages: it drives Chrome over the DevTools
// protocol directly. Your real local database (.wrangler/state) isn't touched.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
const migrate = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "rope-journal", "--local", "--persist-to", dbDir], { encoding: "utf8" });
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
children.push(spawn("npx", [
  "wrangler", "dev", "--persist-to", dbDir, "--port", String(PORT),
  "--var", `ORIGIN:${BASE}`, "--var", "RP_ID:localhost",
], { stdio: "ignore" }));
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
const addAuthenticator = async () => (await send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true,
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
  const visibleCard = () => [...document.querySelectorAll("main > section.card")].find((c) => !c.hidden)?.id;
  const recoveryDialog = () => [$("#recovery-code")?.textContent ?? null, $("dialog[open] button.primary")?.disabled ?? null];
  const finishRecoveryDialog = async () => { $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1200); };
  const openMenu = async () => { $(".nav-menu").click(); await wait(300); };
  const clickDialog = async (label) => { [...document.querySelectorAll("dialog button")].find((b) => b.textContent === label).click(); await wait(800); };
`;

async function run(code) {
  const res = await send("Runtime.evaluate", {
    expression: `(async () => { ${PAGE_HELPERS} ${code} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description);
  return res.result?.result?.value;
}

async function go(pagePath) {
  await send("Page.navigate", { url: BASE + pagePath });
  await sleep(1200);
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
  console.log("Signing up");
  await go("/");
  check("signed out, the journal goes to the sign-in page", await run(`return [location.pathname, visibleCard()];`), ["/signin", "choose"]);
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
  check("the menu opens with the title, Light / Dark Mode (a half-filled sun), Account, Your data and Privacy Policy", await run(`
    await openMenu();
    return [$(".menu-title").textContent, [...document.querySelectorAll(".menu-item")].map((el) => [el.tagName, el.textContent, el.querySelector("svg") !== null]),
      $(".menu-theme svg path").getAttribute("fill"), document.querySelectorAll(".menu-theme svg line").length,
      $(".nav-account").getAttribute("href"), $(".menu-privacy").getAttribute("href")];`),
    ["Rope Journal", [["BUTTON", "Light / Dark Mode", true], ["A", "Account", true], ["A", "Your data", true], ["A", "Privacy Policy", true]], "currentColor", 8, "/account", "/privacy"]);
  check("Privacy Policy sits at the bottom of the panel", await run(`
    const panel = $(".menu-inner").getBoundingClientRect(), row = $(".menu-privacy").getBoundingClientRect();
    return [Math.round(panel.bottom - row.bottom), row.top - $(".nav-data").getBoundingClientRect().bottom > 100];`), [16, true]);
  check("the panel is on the right, full height", await run(`
    const r = $("dialog.menu-panel").getBoundingClientRect();
    return [Math.round(r.right) === innerWidth, Math.round(r.top), Math.round(r.height) === innerHeight, r.left > 0];`), [true, 0, true, true]);
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

  console.log("People");
  await go("/people");
  check("nav marks the current page", await run(`return [...document.querySelectorAll("nav a:not(.nav-icon)")].map((a) => a.textContent + (a.getAttribute("aria-current") ? "*" : ""));`),
    ["Ties", "Plans", "People*", "Locations"]);
  check("a new journal starts with 'Me'; add people, one with a default role", await run(`
    const first = titles();
    const roles = [...$("#default_role").options].map((o) => o.text);
    set("#name", "Sam"); set("#pronouns", "they/them"); set("#default_role", "model"); await submit();
    set("#name", "Alex"); await submit();
    return [first, roles, items().find((i) => i.startsWith("Sam |")).split(" | ")[1], titles()];`),
    [["MeYou"], ["None", "Rigger", "Top", "Model", "Bottom", "Spotter", "Photographer"], "they/them · usually model", ["MeYou", "Alex", "Sam"]]);
  check("second 'this is me' is refused", await run(`set("#name", "Me 2"); set("[name=is_self]", true); await submit(); return $(".message").textContent;`),
    "Couldn't save: You already have a profile marked as you.");
  check("edit fills the form", await run(`set("[name=is_self]", false); set("#name", ""); await clickIn("Sam", "Edit");
    const state = [$("h2").textContent, $("#name").value, $("form button[type=submit]").textContent, $("[data-cancel-edit]").hidden];
    set("#notes", "Prefers floor work"); await submit(); return state;`), ["Edit", "Sam", "Save changes", false]);
  check("archive hides from the list", await run(`await clickIn("Alex", "Archive"); return titles();`), ["MeYou", "Sam"]);
  check("archived list offers Restore", await run(`set("#show-archived", true); await wait(600); return items();`), ["Alex | Restore | Delete"]);

  console.log("Locations");
  await go("/locations");
  check("add locations (one archived now)", await run(`
    set("#name", "Studio"); set("#hard_points", "Two rated points"); set("#maps_url", "https://maps.app.goo.gl/abc"); await submit();
    set("#name", "Hotel"); set("[name=archive_now]", true); await submit();
    set("#name", "Old flat"); await submit();
    return [titles(), [...document.querySelectorAll("#list a")].map((a) => a.href)];`),
    [["Old flat", "Studio"], ["https://maps.app.goo.gl/abc"]]);
  check("'Archive now' is hidden while editing", await run(`await clickIn("Studio", "Edit"); const hidden = $("[data-add-only]").hidden; $("[data-cancel-edit]").click(); return hidden;`), true);
  check("one-off is in the archived list", await run(`set("#show-archived", true); await wait(600); return titles();`), ["Hotel"]);

  console.log("Plans");
  await go("/plans");
  check("add plans with a variation", await run(`
    set("#title", "Hip harness"); set("#stage", "ready"); set("#est_difficulty", "3"); await submit();
    set("#title", "Hip harness, one-sided"); set("#variation_of", optionValue($("#variation_of"), "Hip harness")); await submit();
    return items().find((i) => i.startsWith("Hip harness, one-sided"));`),
    "Hip harness, one-sided | Idea · v1 · variation of Hip harness | Edit | Archive | Delete");
  check("a plan can't pick itself as its parent", await run(`await clickIn("Hip harness", "Edit"); const o = [...$("#variation_of").options].map((o) => o.text); $("[data-cancel-edit]").click(); return o;`),
    ["Not a variation", "Hip harness, one-sided"]);

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
  const newRecovery = await run(`
    $("#new-code").click(); await wait(300); await clickDialog("Make a new code"); await wait(600);
    const code = $("#recovery-code").textContent; await finishRecoveryDialog(); return code;`);
  check("make a new recovery code, shown once", [/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(newRecovery ?? ""), newRecovery !== recoveryCode], [true, true]);
  await run(`$("#sign-out").click();`);
  await sleep(1500);
  check("sign out goes to the sign-in page, and the journal stays locked", await run(`
    return [location.pathname, (await fetch("/api/tags")).status];`), ["/signin", 401]);

  console.log("Signing in");
  await go("/signin");
  await run(`$("#sign-in").click();`);
  await sleep(2500);
  check("sign in with the passkey", await run(`return [location.pathname, $("#tie-count").textContent];`), ["/", "Showing 24 of 24 ties"]);

  console.log("Recovery");
  // Lose the phone: its passkey is gone, a new device has a new authenticator.
  await send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  authenticatorId = await addAuthenticator();
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
  check("adding a passkey finishes signing in, with a new recovery code", [
    /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(shownAfterRecovery ?? ""),
    ...await run(`return [location.pathname, $("#tie-count").textContent];`),
  ], [true, "/", "Showing 24 of 24 ties"]);
  await go("/account");
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
  check("…as a dated JSON file", exported.length === 1 && /^rope-journal-\d{4}-\d\d-\d\d\.json$/.test(exported[0]), true);
  const exportText = exported.length ? readFileSync(path.join(downloads, exported[0]), "utf8") : "{}";
  const exportDoc = JSON.parse(exportText);
  check("the file has every tie, and the people", [exportDoc.format, exportDoc.ties?.length, exportDoc.people?.map((p) => p.name).sort()],
    ["rope-journal-export", 24, ["Alex", "Me"]]);
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
    const res = await (await fetch("/api/ties/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: "Imported" }) })).json();
    return [msg, $("#import-go").hidden, res.ties.map((t) => [t.title, t.location_name, t.participants.map((p) => p.person_name + ":" + p.role).sort()])];`),
    ["Imported 2 ties.", true, [["Imported two", "Beach", []], ["Imported one", place, ["Alex:model", "Robin:rigger"]]]]);
  check("a CSV with mistakes lists them by row, and saves nothing", await chooseFile("bad.csv", "text/csv", "date,title\n12/10/2026,x\n"),
    [[], null, 'Fix these in the file, then choose it again:\nRow 2: Write the date as year-month-day, like 2026-10-12 (not "12/10/2026").']);
  check("importing the export into the same journal has nothing to add", (await chooseFile(exported[0] ?? "x.json", "application/json", exportText)).slice(1),
    [null, "Everything in this file is already in your journal."]);
  check("a file that isn't an export is refused", (await chooseFile("notes.json", "application/json", '{"hello":1}'))[2],
    "This isn't a Rope Journal export.");

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
