// The walkthrough's shares chunk: one account makes profile invites (Share
// my profile, the code, Shared by me, Show code, Revoke), and a second opens
// them (/open): as a new person, merged into a card it has, after signing in,
// and links that have ended or are damaged. Then connecting accounts: an
// invite offering it, accepted by the second account (the link icon,
// Connections in Shared by me, Remove link), and the inviter's banner,
// seeded in the database (a chunk can't sign back in to its first account).

import { randomUUID } from "node:crypto";
import { check, freshAccount, go, loadPage, run, sleep, sql } from "../harness.mjs";

// Makes an invite from my own profile's dialog and returns its link (the
// path from /open on), and what the dialogs showed.
const MAKE_INVITE = (/** @type {Record<string, string | boolean>} */ choices, name = "Jude") => `
  await openPerson("Me"); $("#person-share").click();
  for (let i = 0; i < 30 && !$("#share-profile-name"); i++) await wait(100);
  set("#share-profile-name", ${JSON.stringify(name)});
  ${Object.entries(choices).map(([sel, v]) => `set(${JSON.stringify(sel)}, ${JSON.stringify(v)});`).join(" ")}
  $("#share-profile-make").click();
  for (let i = 0; i < 50 && !$("#share-code-link"); i++) await wait(100);
  const link = $("#share-code-link")?.value ?? "";
  const qr = $(".share-code .qr-code");
  const shown = [!!qr, !!qr?.querySelector("path.qr-dark")?.getAttribute("d"), leakyFields()];
  $("#share-code-done").click(); await calm(200);
  $("[data-cancel-edit]").click(); await calm(200);
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
  check("my own profile has a Share my profile icon on the title's row, left of ✕, and no one else's does", await run(`
    $("#add-person").click(); await calm(300); set("#person-name", "Robin"); await submit();
    await openPerson("Robin"); const onRobin = !$("#person-share"); $("[data-cancel-edit]").click(); await calm(200);
    await openPerson("Me"); const onMe = !$("#person-share");
    // On the title's row, just left of ✕.
    const box = (el) => el.getBoundingClientRect();
    const mid = (r) => (r.top + r.bottom) / 2;
    const share = box($("#person-share")), close = box($("#person-close"));
    const placed = [Math.abs(mid(share) - mid(box($("#person-form-heading")))) < 6, share.right <= close.left];
    set("#person-pronouns", "they/them"); set("#person-default_role", "top"); set("#person-based_in", "Seattle, WA"); set("#person-about", "Rigger, mostly floor");
    set("#person-notes", "My private note"); $("#person-add-alias").click();
    const row = $(".alias-row"); row.querySelector("select").value = "instagram"; row.querySelector("input").value = "@jude";
    await submit();
    return [onRobin, onMe, placed];`), [true, false, [true, true]]);
  check("the dialog asks for the name to share (empty while mine is Me), ticks what's on my profile, and lasts a day for one person", await run(`
    await openPerson("Me"); $("#person-share").click(); await calm(300);
    const fields = [...document.querySelectorAll(".share-field")].map((l) => [l.innerText, l.querySelector("input").checked]);
    const state = [$("#share-profile-name").value, $("#share-profile-name").required, fields, $("#share-profile-expires").value,
      $("#share-profile-uses").value, $("#share-profile-warning").hidden, document.body.innerText.includes("My private note"), leakyFields(),
      $("#share-profile-intro").hidden, !!$("#share-profile-heading").parentElement.querySelector("[aria-controls=share-profile-intro]")];
    set("#share-profile-expires", "never"); set("#share-profile-uses", "any");
    const warned = [$("#share-profile-warning").hidden, $("#share-profile-warning").textContent.startsWith("Anyone who ever sees")];
    $("#share-profile-cancel").click(); await calm(200); $("[data-cancel-edit]").click(); await calm(200);
    return [state, warned];`),
  [["", true, [["Pronouns: they/them", true], ["Usual role: Top", true], ["Instagram: @jude", true], ["Based in: Seattle, WA", true],
    ["Educator: No", true], ["About me: Your shareable notes about yourself. Your private notes are never shared.", true]],
  "1d", "one", true, false, [], true, true], [false, true]]);

  check("Connect our accounts is unticked; ticked, it says what it means, and warns more about a code for anyone, for good", await run(`
    await openPerson("Me"); $("#person-share").click(); await calm(300);
    const box = $("#share-profile-connect");
    const before = [box.checked, $("#share-profile-connect-note").hidden,
      // At the top, above the name to share, in bold.
      !!(box.compareDocumentPosition($("#share-profile-name")) & Node.DOCUMENT_POSITION_FOLLOWING),
      getComputedStyle(box.closest("label").querySelector("strong")).fontWeight >= 600];
    set("#share-profile-connect", true);
    const note = $("#share-profile-connect-note");
    const after = [note.hidden, note.textContent.startsWith("Connecting your accounts lets NotoNawa's server see")];
    set("#share-profile-expires", "never"); set("#share-profile-uses", "any");
    const warned = $("#share-profile-warning").textContent.includes("connect to your account");
    $("#share-profile-cancel").click(); await calm(200); $("[data-cancel-edit]").click(); await calm(200);
    return [before, after, warned];`), [[false, true, true, true], [false, true], true]);

  check("the invite tag is required; it, the profile name and connecting each have a ? that shows more, and hides it again", await run(`
    await openPerson("Me"); $("#person-share").click(); await calm(300);
    const required = $("#share-profile-label").required;
    const labels = [...document.querySelectorAll(".share-profile .label-row label")].map((l) => l.textContent);
    set("#share-profile-connect", true);
    const tips = [];
    for (const id of ["share-profile-name-info", "share-profile-label-info", "share-profile-connect-more"]) {
      const button = document.querySelector('[aria-controls="' + id + '"]'), text = document.getElementById(id);
      const before = text.hidden; button.click(); const open = [text.hidden, text.textContent.slice(0, 30)]; button.click();
      tips.push([button.textContent, before, open, text.hidden]);
    }
    const short = $("#share-profile-connect-note .connect-disclosure").textContent;
    $("#share-profile-cancel").click(); await calm(200); $("[data-cancel-edit]").click(); await calm(200);
    return [required, labels, tips, short];`),
  [true, ["Profile name", "Invite tag"], [
    ["?", true, [false, "The suggested name for your pr"], true],
    ["?", true, [false, "Provides context for you in Yo"], true],
    ["?", true, [false, "It still can't read anything i"], true]],
  "Connecting your accounts lets NotoNawa's server see that the two accounts know each other. ?"]);
  const [once, onceShown] = await run(MAKE_INVITE({ "#share-profile-label": "First" }));
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
    const again = $("#share-code-link").value; $("#share-code-done").click(); await calm(200);
    return [list, again.slice(again.indexOf("/open"))];`),
  [[["Oops", "Profile · ends in 24 hours · not opened yet"], ["Class", "Profile · until you revoke it · not opened yet"],
    ["First", "Profile · ends in 24 hours · not opened yet"]], forAnyone]);
  check("revoking asks first, then takes it off the list", await run(`
    [...document.querySelectorAll(".share-item")].find((i) => i.innerText.startsWith("Oops")).querySelector(".share-revoke").click();
    await calm(300); const asked = $("dialog[open] h2").textContent; await clickDialog("Revoke");
    return [asked, [...document.querySelectorAll(".share-item .item-title")].map((t) => t.textContent)];`),
  ['Revoke "Oops"?', ["Class", "First"]]);

  await go("/people");
  const [connecting] = await run(MAKE_INVITE({ "#share-profile-connect": true, "#share-profile-label": "Munch" }, "Jude C"));
  await go("/data");
  check("Shared by me says which invite connects accounts, and there are no connections yet", await run(`
    for (let i = 0; i < 30 && !$(".share-item"); i++) await wait(100);
    for (let i = 0; i < 30 && $("#connections .empty")?.textContent === "Loading…"; i++) await wait(100);
    const munch = [...document.querySelectorAll(".share-item")].find((i) => i.innerText.startsWith("Munch"));
    const others = [...document.querySelectorAll(".share-item")].filter((i) => i !== munch).map((i) => !!i.querySelector(".share-connects"));
    return [munch?.querySelector(".share-connects")?.textContent, others, $("#connections .empty")?.textContent];`),
  ["Connects accounts", [false, false], "No connections. You can offer one when you share your profile, from your own card in People."]);

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
    $("#open-to-people").click(); await calm(1200);
    await openPerson("Jude");
    const fields = [$("#person-pronouns").value, $("#person-based_in").value, $("#person-about-label").textContent,
      $("#person-about-hint").textContent.startsWith("Shared by them on "), $("#person-about").readOnly,
      $("#person-about").value, $("#person-notes").value];
    $("[data-cancel-edit]").click(); await calm(200);
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
    set("#open-person", optionValue($("#open-person"), "Jude B")); $("#open-next").click(); await calm(200);
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

  // Connecting accounts.
  await openLink(connecting);
  check("an invite offering to connect asks, unticked, saying what connecting means", await run(`
    for (let i = 0; i < 50 && !$("#open-connect"); i++) await wait(100);
    return [$("#open-connect").checked, $("#open-connect-note").textContent.startsWith("Connecting lets NotoNawa's server see")];`),
  [false, true]);
  check("ticked, adding them links their card to their account", await run(`
    set("#open-connect", true); $("#open-add-new").click();
    for (let i = 0; i < 50 && !$("#open-done"); i++) await wait(100);
    return [$("#open-done").textContent, $("#open-linked")?.textContent];`),
  ["Jude C is in your People.", "Their card is linked to their account."]);
  await go("/people");
  /** Whether each named card shows the link icon. */
  const ICONS = `return [...document.querySelectorAll(".name-button")].map((b) => [b.textContent, !!b.closest(".item").querySelector(".link-icon")]).sort();`;
  check("a linked card shows the link icon, and its dialog says so, with Remove link", await run(`
    const icons = (() => { ${ICONS} })();
    await openPerson("Jude C");
    const flag = $("#person-linked");
    const shown = [flag.hidden, flag.innerText.includes("Linked to their account"), $("#person-unlink").textContent];
    $("[data-cancel-edit]").click(); await calm(200);
    await openPerson("Me"); const onMe = $("#person-linked").hidden; $("[data-cancel-edit]").click(); await calm(200);
    return [icons, shown, onMe];`),
  [[["Jude C", true], ["Jude", false], ["Jude", false], ["Me", false]], [false, true, "Remove link"], true]);

  // The inviter's side, seeded: two of my invites someone accepted.
  const myId = await run(`return (await (await fetch("/api/keys")).json()).user_id;`);
  const labels = await run(`
    const { sealOne } = await import("/js/vault.js");
    await post("/api/people", await sealOne("person", { name: "Sky" }));
    return [(await sealOne("share", { label: "Class QR" })).label, (await sealOne("share", { label: "Munch 2" })).label];`);
  for (const label of labels) {
    const peer = randomUUID();
    sql(`INSERT INTO users (id, email) VALUES ('${peer}', '${peer}')`);
    sql(`INSERT INTO connections (id, owner_id, peer_id, invited, label, answered) VALUES
      ('${randomUUID()}', '${myId}', '${peer}', 1, '${label}', 0), ('${randomUUID()}', '${peer}', '${myId}', 0, NULL, 1)`);
  }
  await go("/people");
  check("someone accepting my invite brings a banner asking which of my People it is", await run(`
    for (let i = 0; i < 50 && !$(".connection-notice"); i++) await wait(100);
    return [...document.querySelectorAll(".connection-notice")].map((n) => [n.querySelector("p").textContent.split(",")[0],
      [...n.querySelectorAll("button")].map((b) => b.textContent)]);`),
  [['Someone accepted your invite "Munch 2"', ["Add to a Person", "New Person", "Not now"]],
    ['Someone accepted your invite "Class QR"', ["Add to a Person", "New Person", "Not now"]]]);
  check("New Person asks their name, adds them linked, and the banner goes", await run(`
    const banner = () => [...document.querySelectorAll(".connection-notice")].find((n) => n.innerText.includes("Class QR"));
    banner().querySelector(".connection-new").click();
    for (let i = 0; i < 30 && !$("#connect-name"); i++) await wait(100);
    set("#connect-name", "Pat"); $("#connect-save").click();
    for (let i = 0; i < 50 && banner(); i++) await wait(100);
    for (let i = 0; i < 50 && ![...document.querySelectorAll(".name-button")].some((b) => b.textContent === "Pat"); i++) await wait(100);
    const icons = (() => { ${ICONS} })();
    return [!!banner(), document.querySelectorAll(".connection-notice").length, icons.find(([name]) => name === "Pat")];`),
  [false, 1, ["Pat", true]]);
  check("Not now puts it away; it waits in Connections as on no one, through which invite", await run(`
    $(".connection-later").click(); await calm(300);
    return [document.querySelectorAll(".connection-notice").length, $("#connection-banners").hidden];`), [0, true]);
  await go("/data");
  check("Connections lists each, with who it's on and how it was made", await run(`
    for (let i = 0; i < 50 && !$(".connection-item"); i++) await wait(100);
    return [...document.querySelectorAll(".connection-item")].map((i) => [i.querySelector(".item-title").textContent,
      i.querySelector(".item-meta").textContent.split(" · ")[0], [...i.querySelectorAll("button")].map((b) => b.textContent)]);`),
  [["Not on any Person", 'through "Munch 2"', ["Add to Person", "Remove"]], ["Linked to Pat", 'through "Class QR"', ["Remove"]],
    ["Linked to Jude C", 'shared as "Jude C"', ["Remove"]]]);
  check("Add to Person links it to the one chosen", await run(`
    $(".connection-add").click(); for (let i = 0; i < 50 && !$("#connect-person option"); i++) await wait(100);
    set("#connect-person", optionValue($("#connect-person"), "Sky")); $("#connect-save").click();
    for (let i = 0; i < 50 && ![...document.querySelectorAll(".connection-item .item-title")].some((t) => t.textContent === "Linked to Sky"); i++) await wait(100);
    return [...document.querySelectorAll(".connection-item .item-title")].map((t) => t.textContent);`),
  ["Linked to Sky", "Linked to Pat", "Linked to Jude C"]);
  await go("/people");
  check("Remove link asks, offering to clear my About from their card, then unlinks it", await run(`
    await openPerson("Jude C"); $("#person-unlink").click(); await calm(300);
    const asked = [[...document.querySelectorAll("dialog[open]")].pop().querySelector("h2").textContent, !!$("#connection-remove-about"), $("#connection-remove-about").checked,
      $(".remove-connection .hint").textContent.startsWith("This only clears the About you shared")];
    set("#connection-remove-about", true); await clickDialog("Remove connection");
    for (let i = 0; i < 50 && $("#person-dialog").open; i++) await wait(100);
    await calm(500);
    const icons = (() => { ${ICONS} })();
    return [asked, icons.find(([name]) => name === "Jude C")];`),
  [["Remove your connection with Jude C?", true, false, true], ["Jude C", false]]);

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
