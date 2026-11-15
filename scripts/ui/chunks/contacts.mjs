// The walkthrough's contacts chunk (format 2): two accounts connecting for
// real, each in a browser of its own (useTab). Alex invites with Connect
// our accounts; Jude accepts, sharing their profile back; Alex's banner
// says so, and New Person makes Jude's card from it. Both see the
// same safety number; Jude scans Alex's (/verify), and Alex marks theirs
// verified; a changed key warns. Alex changes their profile and Jude
// reviews the update. Alex removes the connection, clearing their About
// from Jude's card, and Jude's side ends quietly. Before that, Jude shares
// more of their profile from Alex's card, which reaches Alex as an update. Format 1 accounts connect
// through the server (the shares chunk's).

import { FORMAT, check, freshAccount, go, loadPage, run, useTab } from "../harness.mjs";

// Checks my mailboxes now, as the app does every couple of minutes (the
// same module the app has loaded), then lets the page redraw.
const CHECK_MAIL = `await (await import("/js/store/v2/contacts.js")).checkMailboxes(); await calm(800);`;

// A safety number's dialog for a person: its status, digits and QR code, closed again.
const SAFETY = (/** @type {string} */ name) => `
  await openPerson(${JSON.stringify(name)}); $("#person-verify").click();
  for (let i = 0; i < 100 && !$("#verify-digits") && !$("#verify-waiting"); i++) await wait(100);
  const shown = [$("#verify-heading").textContent, $("#verify-status").textContent, $("#verify-digits")?.textContent ?? null,
    !!$(".contact-verify .qr-code path.qr-dark"), !$("#verify-mark").hidden];
  $("#verify-close").click(); await calm(200);
  return shown;`;

/** Which named cards show the link icon and the badges, sorted. */
const CARDS = `return [...document.querySelectorAll("#list .item")].map((i) => [i.querySelector(".name-button").textContent,
  !!i.querySelector(".link-icon"), [...i.querySelectorAll(".update-badge, .key-badge")].map((b) => b.textContent)]).sort();`;

export default async function () {
  console.log("Contacts between two accounts");
  if (FORMAT === 1) {
    console.log("  (format 2 accounts only: format 1's connections are the shares chunk's)");
    return;
  }

  // Alex: an invite offering to connect, sharing their pronouns and About.
  await freshAccount();
  await go("/people");
  const link = await run(`
    await openPerson("Me"); set("#person-pronouns", "they/them"); set("#person-about", "Rigger, mostly floor"); await submit();
    await openPerson("Me"); $("#person-share").click();
    for (let i = 0; i < 30 && !$("#share-profile-name"); i++) await wait(100);
    set("#share-profile-name", "Alex"); set("#share-profile-connect", true); set("#share-profile-label", "Munch");
    $("#share-profile-make").click();
    for (let i = 0; i < 50 && !$("#share-code-link"); i++) await wait(100);
    const link = $("#share-code-link").value;
    $("#share-code-done").click(); await calm(200); $("[data-cancel-edit]").click(); await calm(200);
    return link.slice(link.indexOf("/open"));`);

  // Jude, in a browser of their own, accepts it and shares back.
  await useTab("jude");
  await freshAccount();
  await go("/people");
  await run(`await openPerson("Me"); set("#person-pronouns", "she/her"); set("#person-based_in", "York"); await submit();`);
  await loadPage("/signin");
  await go(link);
  check("Jude opens the invite, ticks Connect our accounts, adds Alex, and is asked to share back, with the same choices", await run(`
    for (let i = 0; i < 50 && !$("#open-connect"); i++) await wait(100);
    set("#open-connect", true); $("#open-add-new").click();
    for (let i = 0; i < 100 && !$("#share-back-name"); i++) await wait(100);
    return [$("#share-back-heading").textContent, [...document.querySelectorAll(".share-back .share-field")].map((l) => l.innerText),
      $("#share-back-share").textContent, $("#share-back-skip").textContent, leakyFields()];`),
  ["Share your profile back with Alex?", ["Pronouns: she/her", "Based in: York", "Educator: No"], "Share and connect",
    "Connect without sharing", []]);
  check("…sharing their name and pronouns (not where they're based) connects, and says it's on its way", await run(`
    set("#share-back-name", "Jude"); set("#share-back-based_in", false); $("#share-back-share").click();
    for (let i = 0; i < 100 && !$("#open-done"); i++) await wait(100);
    return [$("#open-done").textContent, $("#open-linked")?.textContent, await plainOnServer("she/her")];`),
  ["Alex is in your People.", "Their card is linked to their account, and your profile is on its way to them.", false]);
  await go("/people");
  check("…Alex's card has the link icon and their About; the safety number waits for Alex's account to answer", [
    await run(CARDS),
    await run(`await openPerson("Alex"); const about = $("#person-about").value; $("[data-cancel-edit]").click(); await calm(200);
      ${SAFETY("Alex").replace("return shown;", "return [about, shown[2], !!$('#verify-waiting') || shown[2] === null];")}`),
  ], [[["Alex", true, []], ["Me", false, []]], ["Rigger, mostly floor", null, true]]);

  // Alex's device finds the acceptance.
  await useTab("main");
  await go("/people");
  check("Alex's device finds the acceptance: the banner says Jude connected and shared their profile", await run(`
    ${CHECK_MAIL}
    for (let i = 0; i < 50 && !$(".connection-notice"); i++) await wait(100);
    return [...document.querySelectorAll(".connection-notice")].map((n) => [n.querySelector("p").textContent,
      [...n.querySelectorAll("button")].map((b) => b.textContent)]);`),
  [['Your "Munch" share was accepted and Jude has connected and shared their profile. Add them to your People, or to someone you have?',
    ["Add to a Person", "New Person", "Not now"]]]);
  check("New Person suggests their name and makes the card from what they shared, linked; the banner goes", await run(`
    $(".connection-new").click(); for (let i = 0; i < 30 && !$("#connect-name"); i++) await wait(100);
    const suggested = $("#connect-name").value; $("#connect-save").click();
    for (let i = 0; i < 50 && $(".connection-notice"); i++) await wait(100);
    for (let i = 0; i < 50 && !personNames().includes("Jude"); i++) await wait(100);
    await calm(300);
    await openPerson("Jude"); const onCard = [$("#person-pronouns").value, $("#person-based_in").value, $("#person-update-badge").hidden];
    $("[data-cancel-edit]").click(); await calm(200);
    return [suggested, onCard, (() => { ${CARDS} })()];`), ["Jude", ["she/her", "", true], [["Jude", true, []], ["Me", false, []]]]);
  const alexSees = await run(SAFETY("Jude"));
  check("Alex sees Jude's safety number: 12 blocks of 5 digits and a QR code, not verified yet", [
    alexSees[0], alexSees[1], /^(\d{5}){12}$/.test(alexSees[2] ?? ""), alexSees[3], alexSees[4]],
  ["Verify Jude", "Not verified yet.", true, true, true]);

  // Jude's device gets Alex's answer, and their number is the same.
  await useTab("jude");
  await go("/people");
  await run(CHECK_MAIL);
  const judeSees = await run(SAFETY("Alex"));
  check("Jude's device gets Alex's answer: the same safety number on both phones", judeSees[2], alexSees[2]);
  await go(`/verify#${"1".repeat(60)}`);
  check("scanning a number that isn't ours warns, and takes it out of the address", await run(`
    for (let i = 0; i < 100 && $("#verify-said")?.textContent === "Checking…"; i++) await wait(100);
    return [location.hash, $("#verify-said").className, $("#verify-said").textContent.startsWith("This safety number doesn't match")];`),
  ["", "warning-note", true]);
  // From /verify, a new # alone wouldn't load the page again.
  await loadPage("/signin");
  await go(`/verify#${alexSees[2]}`);
  const verifiedSaid = await run(`
    for (let i = 0; i < 100 && $("#verify-said")?.textContent === "Checking…"; i++) await wait(100);
    return [location.hash, $("#verify-said").textContent];`);
  await go("/people");
  check("scanning Alex's code verifies Alex, and their card says so", [verifiedSaid, await run(`
    await openPerson("Alex"); const flag = $("#person-verify-label").textContent; $("[data-cancel-edit]").click(); await calm(200);
    return flag;`)],
  [["", "Verified: your account and Alex's are connected with no one in between. Their card now says so."], "Verified"]);

  // Alex marks Jude verified, having compared the numbers; then a changed key warns.
  await useTab("main");
  await go("/people");
  check("Alex marks Jude verified once the numbers match", await run(`
    await openPerson("Jude"); $("#person-verify").click();
    for (let i = 0; i < 100 && !$("#verify-digits"); i++) await wait(100);
    $("#verify-mark").click(); for (let i = 0; i < 50 && $(".contact-verify"); i++) await wait(100); await calm(500);
    await openPerson("Jude"); const flag = $("#person-verify-label").textContent; $("[data-cancel-edit]").click(); await calm(200);
    return flag;`), "Verified");
  // A key changes only when their account starts over, which a walkthrough
  // can't do: the mark is seeded here (the message bringing a new key is
  // unit-tested in store-contacts.test.js).
  await run(`
    const { records, save } = await import("/js/store/v2/journal.js");
    const c = records("contact").find((r) => r.body.state === "active");
    await save({ writes: [{ kind: "contact", id: c.id, from: c.body, body: { ...c.body, key_changed: true, verified: false } }] });`);
  await go("/people");
  check("a changed key marks the card, warns in its dialog, and the safety number asks to check again", [
    await run(CARDS),
    await run(`await openPerson("Jude"); const shown = [$("#person-key-changed").hidden, $("#person-verify-label").textContent];
      $("[data-cancel-edit]").click(); await calm(200); return shown;`),
    (await run(SAFETY("Jude")))[1].startsWith("Their account's key has changed"),
  ], [[["Jude", true, ["Key changed"]], ["Me", false, []]], [false, "Safety Number"], true]);

  // Alex changes their profile: Jude reviews the update.
  await run(`await openPerson("Me"); set("#person-pronouns", "she/her"); set("#person-notes", "Only mine"); await submit();
    await (await import("/js/store/v2/contacts.js")).sendProfileUpdates();`);
  await useTab("jude");
  await go("/people");
  check("Jude's card of Alex says there's updated info, and reviewing it takes the new pronouns", await run(`
    ${CHECK_MAIL}
    const before = (() => { ${CARDS} })();
    await openPerson("Alex"); $("#person-update-badge").click(); await calm(400);
    const asked = [...document.querySelectorAll(".profile-update .merge-field legend")].map((l) => l.textContent);
    $("#update-save").click(); for (let i = 0; i < 50 && $(".profile-update"); i++) await wait(100); await calm(500);
    await openPerson("Alex"); const pronouns = $("#person-pronouns").value; $("[data-cancel-edit]").click(); await calm(200);
    return [before, asked, pronouns, (() => { ${CARDS} })(), await plainOnServer("she/her")];`),
  [[["Alex", true, ["Updates available"]], ["Me", false, []]], ["Pronouns"], "she/her", [["Alex", true, []], ["Me", false, []]], false]);
  check("from Alex's card, Jude shares their profile again, now with where they're based", await run(`
    await openPerson("Alex"); $("#person-share-with").click();
    for (let i = 0; i < 30 && !$("#share-back-name"); i++) await wait(100);
    const asked = [$("#share-back-heading").textContent, $("#share-back-share").textContent, $("#share-back-skip").textContent];
    set("#share-back-name", "Jude"); $("#share-back-share").click();
    for (let i = 0; i < 50 && $(".share-back"); i++) await wait(100); await calm(300);
    $("[data-cancel-edit]").click(); await calm(200);
    return asked;`), ["Share my profile with Alex", "Share", "Cancel"]);

  // Alex removes the connection, clearing their About from Jude's card.
  await useTab("main");
  await go("/people");
  check("Alex gets it as an update: reviewing it adds where Jude's based", await run(`
    ${CHECK_MAIL}
    await openPerson("Jude"); const badge = $("#person-update-badge").hidden; $("#person-update-badge").click(); await calm(400);
    const asked = [...document.querySelectorAll(".profile-update .merge-field legend")].map((l) => l.textContent);
    $("#update-save").click(); for (let i = 0; i < 50 && $(".profile-update"); i++) await wait(100); await calm(500);
    await openPerson("Jude"); const basedIn = $("#person-based_in").value; $("[data-cancel-edit]").click(); await calm(200);
    return [badge, asked, basedIn];`), [false, ["Based in"], "York"]);
  check("Alex removes the connection, asking to clear their About from Jude's card", await run(`
    await openPerson("Jude"); $("#person-unlink").click(); await calm(300);
    set("#connection-remove-about", true); await clickDialog("Remove connection");
    for (let i = 0; i < 50 && $("#person-dialog").open; i++) await wait(100); await calm(500);
    ${CARDS}`), [["Jude", false, []], ["Me", false, []]]);
  await useTab("jude");
  await go("/people");
  check("on Jude's side it ends quietly: no banner or notice, the link and Alex's About gone, the rest kept", await run(`
    ${CHECK_MAIL}
    const cards = (() => { ${CARDS} })();
    await openPerson("Alex");
    const onCard = [$("#person-linked").hidden, $("#person-about").value, $("#person-pronouns").value];
    $("[data-cancel-edit]").click(); await calm(200);
    return [cards, onCard, document.querySelectorAll(".connection-notice, .notice").length];`),
  [[["Alex", false, []], ["Me", false, []]], [true, "", "she/her"], 0]);
  await useTab("main");
}
