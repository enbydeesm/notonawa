// UI smoke test: clicks through every page in headless Chrome against a
// throwaway local database, and checks what's on screen.
//
//   npm run test:ui
//
// Needs Google Chrome installed (set CHROME_PATH if it's not in the default
// macOS location). No npm packages: it drives Chrome over the DevTools
// protocol directly. Your real local database (.wrangler/state) isn't touched.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
children.push(spawn("npx", ["wrangler", "dev", "--persist-to", dbDir, "--port", String(PORT)], { stdio: "ignore" }));
await waitFor(`${BASE}/api/tags`, "wrangler dev");

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
await send("Log.enable");

// Helpers available inside the page for each step.
const PAGE_HELPERS = `
  const $ = (s) => document.querySelector(s);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = (sel, v) => { const el = $(sel); if (el.type === "checkbox") el.checked = v; else el.value = v; el.dispatchEvent(new Event("change")); };
  const optionValue = (select, text) => [...select.options].find((o) => o.text === text).value;
  const submit = async () => { $("form button[type=submit]").click(); await wait(700); };
  const flat = (el) => el.innerText.replace(/\\n+/g, " | ");
  const items = () => [...document.querySelectorAll(".item")].map(flat);
  const titles = () => [...document.querySelectorAll(".item-title")].map((t) => t.innerText);
  const clickIn = async (title, label) => {
    const item = [...document.querySelectorAll(".item")].find((i) => i.querySelector(".item-title").innerText === title);
    [...item.querySelectorAll("button")].find((b) => b.textContent === label).click();
    await wait(500);
  };
  const type = async (sel, v) => { const el = $(sel); el.value = v; el.dispatchEvent(new Event("input")); await wait(900); };
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
  for (const pagePath of ["/", "/plans", "/people", "/locations", "/js/api.js"]) {
    const res = await fetch(BASE + pagePath);
    check(`${pagePath}: strict CSP, never cached`, [
      res.headers.get("cache-control"),
      res.headers.get("content-security-policy")?.includes("script-src 'self'; style-src 'self'"),
      res.headers.get("content-security-policy")?.includes("require-trusted-types-for 'script'"),
      res.headers.get("x-frame-options"),
    ], ["no-store", true, true, "DENY"]);
  }
  for (const pagePath of ["/plans", "/people", "/locations"]) {
    await go(pagePath);
    check(`${pagePath}: every field is kept out of form history and spellcheck`, await run(`return leakyFields();`), []);
  }

  console.log("People");
  await go("/people");
  check("nav marks the current page", await run(`return [...document.querySelectorAll("nav a")].map((a) => a.textContent + (a.getAttribute("aria-current") ? "*" : ""));`),
    ["Ties", "Plans", "People*", "Locations"]);
  check("add people", await run(`
    set("#name", "Me"); set("[name=is_self]", true); await submit();
    set("#name", "Sam"); set("#pronouns", "they/them"); await submit();
    set("#name", "Alex"); await submit();
    return titles();`), ["MeYou", "Alex", "Sam"]);
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
    return [!!$("dialog[open] #tie-form"), [...$("#tie-location_id").options].map((o) => o.text), [...$(".person").options].map((o) => o.text), leakyFields()];`),
    [true, ["No location", "Old flat", "Studio"], ["Choose person", "Me (you)", "Sam"], []]);
  check("incomplete person row is caught", await run(`set("#tie-title", "Floor session"); $(".person").selectedIndex = 1; $("#tie-save").click(); await wait(500); return $("#tie-message").textContent;`),
    "Couldn't save: Choose a person and a role for each row, or remove it.");
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
  check("save a full tie: the dialog closes and the list shows it", await run(`
    set("#tie-location_id", optionValue($("#tie-location_id"), "Studio"));
    document.querySelectorAll(".role")[0].value = "rigger";
    $("#tie-add-participant").click();
    const sam = document.querySelectorAll(".person")[1]; sam.value = optionValue(sam, "Sam");
    document.querySelectorAll(".role")[1].value = "model";
    $(".plan").value = optionValue($(".plan"), "Hip harness");
    set("#tie-duration_minutes", "45"); set("#tie-success_rating", "4"); set("#tie-notes", "Smooth transitions");
    $("#tie-save").click(); await wait(1000);
    return [!!document.querySelector("dialog"), items()[0].replace(/^Floor session \\| [^·]+· /, "")];`),
    [false, "Studio · 45 min · 4/5 | With: Me (rigger), Sam (model) | Plans: Hip harness (v1) | Smooth transitions"]);
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
    await post("/api/ties", { title: "Hotel night", tie_date: "2025-06-01", location_id: hotel, participants: [{ person_id: alex, role: "model" }] });
    for (let day = 1; day <= 21; day++) await post("/api/ties", { title: "Practice " + day, tie_date: "2026-01-" + String(day).padStart(2, "0") });`);
  await go("/");
  check("20 per page, newest tie date first, with a page control", await run(`
    return [$("#tie-count").textContent, titles().length, titles().slice(0, 3), pagerButtons()];`),
    ["23 ties", 20, ["Floor session", "Practice 21", "Practice 20"], ["‹ Prev", "1*", "2", "Next ›"]]);
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
  check("filters list everyone A–Z, archived in muted text", await run(`
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    return [filterOptions("#people-filter"), filterOptions("#locations-filter")];`),
    [["Alex (muted)", "Me", "Sam"], ["Hotel (muted)", "Old flat", "Studio"]]);
  check("a filter's search box narrows its list", await run(`
    const box = $("#people-filter input[type=search]"); box.value = "SA"; box.dispatchEvent(new Event("input"));
    const shown = filterOptions("#people-filter"); box.value = ""; box.dispatchEvent(new Event("input"));
    return shown;`), ["Sam"]);
  check("people filter: ties with all chosen people", await run(`
    await pick("#people-filter", "Me"); await pick("#people-filter", "Sam");
    return [titles(), $("#people-filter summary").textContent, $("#tie-count").textContent, pagerButtons()];`),
    [["Floor session"], "Me, Sam", "1 tie", []]);
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
    ["23 ties", "", "Anyone", true, ""]);
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
    [["Archive instead", "Delete permanently", "Cancel"], ["Old flat"]]);
  await go("/people");
  check("delete a person", await run(`await clickIn("Sam", "Delete"); await clickDialog("Delete permanently"); return titles();`), ["MeYou"]);
  await go("/");
  check("tie shows what was deleted", await run(`return items()[0].replace(/^Floor session \\| [^·]+· /, "");`),
    "(location deleted) · 45 min · 4/5 | With: (person deleted) (model), Me (rigger) | Plans: (plan deleted) | Smooth transitions");

  console.log("+ on other tabs");
  await go("/plans");
  await run(`$(".nav-add").click(); await wait(600); set("#tie-title", "Logged from Plans"); $("#tie-save").click();`);
  await sleep(1500);
  check("saving from another tab goes to the Ties list", await run(`return [location.pathname, titles()[0]];`), ["/", "Logged from Plans"]);

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
