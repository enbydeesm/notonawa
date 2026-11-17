// The walkthrough's link chunk: signing in on a new device with one that's
// signed in (src/link/, link-flows.js). The new device ("laptop", a browser
// of its own with its own passkey device) shows a code; the signed-in one
// opens it. Picking the wrong number cancels it; the right one, with the
// passkey, approves it, and the laptop adds a passkey, opens the journal
// (notes and all), and unlocks with its own passkey after a reload. A link
// whose key hash doesn't match the server's key is refused.

import { check, freshAccount, go, loadPage, resetBrowser, run, sql, useTab } from "../harness.mjs";

// The new device's sign-in page: Sign in with another device, and what it shows.
const START = `
  for (let i = 0; i < 50 && !$("#link-start"); i++) await wait(100);
  $("#link-start").click();
  for (let i = 0; i < 50 && $("#link-wait").hidden; i++) await wait(100);
  return [$("#link-address").value, $("#link-number").textContent, !!$("#link-code .qr-code path.qr-dark"),
    $("#link-status").textContent];`;

/** @param {string} link the whole link: its path and fragment */
const pathOf = (link) => link.slice(link.indexOf("/link#"));

// Another code opened while already on /link: only the "#…" changes, so
// the page doesn't load again (app.js's hashchange redraws the view).
const OPEN_AGAIN = (/** @type {string} */ path) => `
  location.assign(${JSON.stringify(path)}); await calm(1500);
  for (let i = 0; i < 50 && (location.hash || $("#link-said")?.textContent === "Checking…"); i++) await wait(100);`;

export default async function () {
  console.log("Signing in on a new device");
  await freshAccount();
  await run(`await store.saveItem("people", null, { name: "Lou", notes: "Met at the munch" });`);

  // The laptop starts; the phone (main) picks the wrong number.
  await useTab("laptop");
  await resetBrowser();
  await loadPage("/signin");
  const first = await run(START);
  check("the new device shows a QR code, a 2-digit number and the link, and waits", [
    /^http:\/\/localhost:\d+\/link#[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(first[0]), /^\d\d$/.test(first[1]), first[2], first[3],
  ], [true, true, true, "Waiting for your other device… This code works for 5 minutes."]);

  await useTab("main");
  await go(pathOf(first[0]));
  check("the signed-in device warns, and asks which of three numbers the new device shows", await run(`
    const numbers = [...document.querySelectorAll(".link-number-choice")].map((b) => b.dataset.number);
    return [location.pathname, location.hash, $("#link-body .warning-note").textContent.startsWith("A new device is asking"),
      $("#link-ask").textContent, numbers.length, numbers.includes(${JSON.stringify(first[1])})];`),
  ["/link", "", true, "Which number does the new device show?", 3, true]);
  check("…the wrong number cancels it", await run(`
    [...document.querySelectorAll(".link-number-choice")].find((b) => b.dataset.number !== ${JSON.stringify(first[1])}).click();
    for (let i = 0; i < 50 && !$("#link-said"); i++) await wait(100);
    return $("#link-said").textContent.startsWith("That isn't the number");`), true);

  await useTab("laptop");
  check("…and the new device hears it has ended", await run(`
    for (let i = 0; i < 80 && !$("#link-status").classList.contains("error"); i++) await wait(100);
    return $("#link-status").textContent;`), "This sign-in request has ended. Start again on the new device.");

  // Again, with the right number.
  const second = await run(`$("#link-back").click(); await calm(200); ${START}`);
  await useTab("main");
  check("the right number and the passkey approve it", await run(`${OPEN_AGAIN(pathOf(second[0]))}
    $(".link-number-choice[data-number='${second[1]}']").click();
    for (let i = 0; i < 100 && !$("#link-said"); i++) await wait(100);
    return $("#link-said")?.textContent;`), "Approved. Carry on on the new device: it will ask you to add a passkey there.");

  await useTab("laptop");
  check("the new device is asked to add a passkey, and is then in the journal", await run(`
    for (let i = 0; i < 80 && $("#link-passkey").hidden; i++) await wait(100);
    const asked = !$("#link-passkey").hidden;
    set("#link-passkey-name", "Laptop"); $("#link-passkey-form button[type=submit]").click();
    for (let i = 0; i < 100 && location.pathname !== "/"; i++) await wait(100);
    await calm(800);
    return [asked, location.pathname, $("#tie-count") !== null, $("dialog[open]") === null];`), [true, "/", true, true]);
  await go("/people");
  check("…its own passkey unlocks it after a reload, and the notes open", await run(`
    await openPerson("Lou"); const notes = $("#person-notes").value; $("[data-cancel-edit]").click(); await calm(200);
    const { passkeys } = await (await fetch("/api/account")).json();
    return [notes, passkeys.map((p) => p.name).sort()];`), ["Met at the munch", ["Laptop", "Test phone"]]);

  // A link whose key hash isn't the key the server has: refused, and declined.
  await useTab("main");
  const id = await run(`
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(1216)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    const res = await fetch("/api/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ public_key: key }) });
    return (await res.json()).id;`);
  check("a code that doesn't match the server's key is refused", await run(`${OPEN_AGAIN(`/link#${id}.${"A".repeat(43)}`)}
    return $("#link-said")?.textContent;`),
    "This code doesn't match what the server sent, so it can't be approved safely. Don't approve it.");
  check("…and nothing is left waiting on the server", sql("SELECT count(*) AS n FROM link_requests")[0].n, 0);
}
