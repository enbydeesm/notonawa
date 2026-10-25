// The walkthrough's shares chunk: one account makes profile invites (Share
// my profile, the code, Shared by me, Show code, Revoke), and a second opens
// them (/open): as a new person, merged into a card it has, after signing in,
// and links that have ended or are damaged.

import { check, freshAccount, go, loadPage, run, sleep } from "../harness.mjs";

// Makes an invite from my own profile's dialog and returns its link (the
// path from /open on), and what the dialogs showed.
const MAKE_INVITE = (/** @type {Record<string, string>} */ choices) => `
  await openPerson("Me"); $("#person-share").click();
  for (let i = 0; i < 30 && !$("#share-profile-name"); i++) await wait(100);
  set("#share-profile-name", "Jude");
  ${Object.entries(choices).map(([sel, v]) => `set(${JSON.stringify(sel)}, ${JSON.stringify(v)});`).join(" ")}
  $("#share-profile-make").click();
  for (let i = 0; i < 50 && !$("#share-code-link"); i++) await wait(100);
  const link = $("#share-code-link")?.value ?? "";
  const qr = $(".share-code .qr-code");
  const shown = [!!qr, !!qr?.querySelector("path.qr-dark")?.getAttribute("d"), leakyFields()];
  $("#share-code-done").click(); await wait(200);
  $("[data-cancel-edit]").click(); await wait(200);
  return [link.slice(link.indexOf("/open")), shown];`;

// Opens a share's link in a fresh load of the page. Going from /open to
// /open#… would only change the "#…", which doesn't load the page again.
async function openLink(/** @type {string} */ link) {
  await loadPage("/signin");
  await go(link);
}

export default async function () {
  await freshAccount();
  console.log("Shares");
  await go("/people");
  check("my own profile has Share my profile, centered on the title's row, and no one else's does", await run(`
    $("#add-person").click(); await wait(300); set("#person-name", "Robin"); await submit();
    await openPerson("Robin"); const onRobin = $("#person-share").hidden; $("[data-cancel-edit]").click(); await wait(200);
    await openPerson("Me"); const onMe = $("#person-share").hidden;
    // On the title's row, in the middle of the dialog.
    const box = (el) => el.getBoundingClientRect();
    const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const [x, y] = mid(box($("#person-share"))), [dx] = mid(box($("#person-dialog"))), [, hy] = mid(box($("#person-form-heading")));
    const placed = [Math.abs(x - dx) < 3, Math.abs(y - hy) < 6];
    set("#person-pronouns", "they/them"); set("#person-default_role", "top"); set("#person-based_in", "Seattle, WA"); set("#person-about", "Rigger, mostly floor");
    set("#person-notes", "My private note"); $("#person-add-alias").click();
    const row = $(".alias-row"); row.querySelector("select").value = "instagram"; row.querySelector("input").value = "@jude";
    await submit();
    return [onRobin, onMe, placed];`), [true, false, [true, true]]);
  check("the dialog asks for the name to share (empty while mine is Me), ticks what's on my profile, and lasts a day for one person", await run(`
    await openPerson("Me"); $("#person-share").click(); await wait(300);
    const fields = [...document.querySelectorAll(".share-field")].map((l) => [l.innerText, l.querySelector("input").checked]);
    const state = [$("#share-profile-name").value, $("#share-profile-name").required, fields, $("#share-profile-expires").value,
      $("#share-profile-uses").value, $("#share-profile-warning").hidden, document.body.innerText.includes("My private note"), leakyFields()];
    set("#share-profile-expires", "never"); set("#share-profile-uses", "any");
    const warned = [$("#share-profile-warning").hidden, $("#share-profile-warning").textContent.startsWith("Anyone who ever sees")];
    $("#share-profile-cancel").click(); await wait(200); $("[data-cancel-edit]").click(); await wait(200);
    return [state, warned];`),
  [["", true, [["Pronouns: they/them", true], ["Usual role: Top", true], ["Instagram: @jude", true], ["Based in: Seattle, WA", true],
    ["About me: Rigger, mostly floor", true]], "1d", "one", true, false, []], [false, true]]);

  const [once, onceShown] = await run(MAKE_INVITE({}));
  check("making an invite shows its QR code and link, with the key after #", [onceShown, /^\/open#[\w-]{22}\.[\w-]{43}$/.test(once)],
    [[true, true, []], true]);
  const [forAnyone] = await run(MAKE_INVITE({ "#share-profile-expires": "never", "#share-profile-uses": "any", "#share-profile-label": "Class" }));
  const [revoked] = await run(MAKE_INVITE({ "#share-profile-label": "Oops" }));
  await go("/data");
  check("Shared by me lists them, newest first, and shows a code again", await run(`
    for (let i = 0; i < 30 && !$(".share-item"); i++) await wait(100);
    const list = [...document.querySelectorAll(".share-item")].map((i) => [i.querySelector(".item-title").textContent, i.querySelector(".item-meta").textContent]);
    [...document.querySelectorAll(".share-item")].find((i) => i.innerText.startsWith("Class")).querySelector(".share-show").click();
    for (let i = 0; i < 30 && !$("#share-code-link"); i++) await wait(100);
    const again = $("#share-code-link").value; $("#share-code-done").click(); await wait(200);
    return [list, again.slice(again.indexOf("/open"))];`),
  [[["Oops", "Profile · ends in 24 hours · not opened yet"], ["Class", "Profile · until you revoke it · not opened yet"],
    ["Profile invite", "Profile · ends in 24 hours · not opened yet"]], forAnyone]);
  check("revoking asks first, then takes it off the list", await run(`
    [...document.querySelectorAll(".share-item")].find((i) => i.innerText.startsWith("Oops")).querySelector(".share-revoke").click();
    await wait(300); const asked = $("dialog[open] h2").textContent; await clickDialog("Revoke");
    return [asked, [...document.querySelectorAll(".share-item .item-title")].map((t) => t.textContent)];`),
  ['Revoke "Oops"?', ["Class", "Profile invite"]]);

  // Someone else opens them.
  await freshAccount();
  await openLink(once);
  check("opening the link shows what was shared (never the private notes), with the key gone from the address", await run(`
    for (let i = 0; i < 50 && !$("#open-profile"); i++) await wait(100);
    return [location.pathname + location.hash, flat($("#open-profile")), document.body.innerText.includes("My private note"),
      [...document.querySelectorAll("#open-body button")].map((b) => b.textContent)];`),
  ["/open", "Jude | they/them | Top | based in Seattle, WA | aka instagram: @jude | Rigger, mostly floor", false,
    ["Add as a new person", "Add to someone in my People"]]);
  check("Add as a new person puts them in People, About read-only as theirs", await run(`
    $("#open-add-new").click(); for (let i = 0; i < 50 && !$("#open-done"); i++) await wait(100);
    const said = $("#open-done").textContent;
    $("#open-to-people").click(); await wait(1200);
    await openPerson("Jude");
    const fields = [$("#person-pronouns").value, $("#person-based_in").value, $("#person-about-label").textContent,
      $("#person-about-hint").textContent.startsWith("Shared by them on "), $("#person-about").readOnly,
      $("#person-about").value, $("#person-notes").value];
    $("[data-cancel-edit]").click(); await wait(200);
    return [said, fields];`),
  ["Jude is in your People.", ["they/them", "Seattle, WA", "About them", true, true, "Rigger, mostly floor", ""]]);
  await openLink(once);
  check("a one-person invite doesn't open twice, nor a revoked one", [
    await run(`for (let i = 0; i < 50 && !$("#open-said"); i++) await wait(100); return $("#open-said").textContent;`),
    await (async () => { await openLink(revoked); return run(`for (let i = 0; i < 50 && !$("#open-said"); i++) await wait(100); return $("#open-said").textContent;`); })(),
  ], ["This share has ended or doesn't exist. Ask whoever shared it for a new one.",
    "This share has ended or doesn't exist. Ask whoever shared it for a new one."]);

  await run(`
    const { sealOne } = await import("/js/vault.js");
    await post("/api/people", await sealOne("person", { name: "Jude B", pronouns: "she/her", notes: "Met at a jam" }));`);
  await openLink(forAnyone);
  check("adding to someone I have asks field by field, and keeps my notes", await run(`
    for (let i = 0; i < 50 && !$("#open-add-existing"); i++) await wait(100);
    $("#open-add-existing").click(); for (let i = 0; i < 50 && !$("#open-person"); i++) await wait(100);
    set("#open-person", optionValue($("#open-person"), "Jude B")); $("#open-next").click(); await wait(200);
    const asked = [...document.querySelectorAll(".merge-field")].map((f) => [f.querySelector("legend").textContent,
      [...f.querySelectorAll("label")].map((l) => l.textContent + (l.querySelector("input").checked ? "*" : ""))]);
    document.querySelector('input[name="open-name"][value="theirs"]').click();
    $("#open-save").click(); for (let i = 0; i < 50 && !$("#open-done"); i++) await wait(100);
    const people = await (await fetch("/api/people?archived=false")).json();
    const { open } = await import("/js/vault.js");
    const merged = (await open("person", people)).find((p) => p.pronouns === "they/them" && p.notes === "Met at a jam");
    return [asked, $("#open-done")?.textContent, merged ? [merged.name, merged.based_in, merged.about, JSON.parse(merged.aliases)] : null];`),
  [[["Name", ["Use theirs: Jude", "Keep yours: Jude B*"]], ["Pronouns", ["Use theirs: they/them*", "Keep yours: she/her"]],
    ["Usual role", ["Use theirs: Top*", "Keep yours (empty)"]],
    ["Based in", ["Use theirs: Seattle, WA*", "Keep yours (empty)"]],
    ["Social & scene names", ["Add their 1 new one to yours*", "Replace yours with theirs", "Keep yours only"]]],
  "Jude is in your People.", ["Jude", "Seattle, WA", "Rigger, mostly floor", [{ platform: "instagram", alias: "@jude" }]]]);

  // Signed out: the link survives signing in.
  await run(`await fetch("/api/auth/logout", { method: "POST" });`);
  await loadPage("/signin");
  await loadPage(forAnyone);
  await sleep(1200);
  check("signed out, the link goes to Sign in, then back to the share", await run(`
    const atSignIn = location.pathname; $("#sign-in").click();
    for (let i = 0; i < 100 && !$("#open-profile"); i++) await wait(100);
    return [atSignIn, location.pathname + location.hash, $("#open-name")?.textContent];`), ["/signin", "/open", "Jude"]);

  await openLink("/open#not-a-share-link");
  check("a damaged link says so, and is taken out of the address", await run(`
    for (let i = 0; i < 50 && !$("#open-said"); i++) await wait(100);
    return [location.pathname + location.hash, $("#open-said").textContent];`),
  ["/open", "This link is damaged or incomplete. Ask whoever shared it to send it again."]);
}
