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
await waitFor(`${BASE}/api/ties`, "wrangler dev");

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
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await send("Runtime.enable");
await send("Page.enable");

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
  const dialogButtons = () => [...document.querySelectorAll("dialog button")].map((b) => b.textContent);
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

  console.log("Ties");
  await go("/");
  check("pickers leave out archived items", await run(`
    $("#add-participant").click(); $("#add-plan").click();
    return [[...$("#location_id").options].map((o) => o.text), [...$(".person").options].map((o) => o.text)];`),
    [["No location", "Old flat", "Studio"], ["Choose person", "Me (you)", "Sam"]]);
  check("incomplete person row is caught", await run(`set("#title", "Floor session"); $(".person").selectedIndex = 1; $("#save").click(); await wait(500); return $("#message").textContent;`),
    "Couldn't save: Choose a person and a role for each row, or remove it.");
  check("save a full tie", await run(`
    set("#location_id", optionValue($("#location_id"), "Studio"));
    document.querySelectorAll(".role")[0].value = "rigger";
    $("#add-participant").click();
    const sam = document.querySelectorAll(".person")[1]; sam.value = optionValue(sam, "Sam");
    document.querySelectorAll(".role")[1].value = "model";
    $(".plan").value = optionValue($(".plan"), "Hip harness");
    set("#duration_minutes", "45"); set("#success_rating", "4"); set("#notes", "Smooth transitions");
    $("#save").click(); await wait(1000);
    return [$("#message").textContent, document.querySelectorAll(".picker-row").length, items()[0].replace(/^Floor session \\| [^·]+· /, "")];`),
    ["Saved.", 0, "Studio · 45 min · 4/5 | With: Me (rigger), Sam (model) | Plans: Hip harness (v1) | Smooth transitions"]);

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
