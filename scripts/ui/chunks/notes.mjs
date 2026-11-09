// The walkthrough's notes chunk. Encrypted notes: searched on the device, stored sealed, older plain text sealed at unlock.

import { check, freshAccount, go, run, sleep, sql } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

export default async function () {
  await freshAccount();
  await seedTie(await seedJournal());
  console.log("Encrypted notes");
  await go("/");
  check("a keyword finds words only in the notes, searched on the device", await run(`
    await type("#q", "SMOOTH transitions"); const found = titles(); $("#clear").click(); await calm(800); return found;`),
    ["Floor session"]);
  check("capitals don't matter in any language: Ö finds ö", await run(`
    $(".nav-add").click(); await calm(600); set("#tie-title", "Knot test"); set("#tie-tie_type", "floor"); set("#tie-notes", "  Öse knot, tied twice  ");
    $("#tie-save").click(); await calm(1200);
    await type("#q", "öse"); const lower = titles(); await type("#q", "ÖSE KNOT"); const upper = titles();
    $("#clear").click(); await calm(800); return [lower, upper];`),
    [["Knot test"], ["Knot test"]]);
  check("the server only ever has notes encrypted; the page shows them opened", await run(`
    const index = await (await fetch("/api/ties/search-index")).json();
    const people = await (await fetch("/api/people?archived=all")).json();
    const plans = await (await fetch("/api/plans?archived=all")).json();
    const stored = [...index.map((t) => t.notes), ...people.map((p) => p.notes), ...plans.flatMap((p) => [p.description, p.notes])]
      .filter((v) => v !== null);
    const knot = index.find((t) => t.title === "Knot test");
    [...document.querySelectorAll(".tie-title")].find((b) => b.textContent === "Knot test").click(); await calm(1000);
    const shown = $("#tie-notes").value;
    return [stored.length > 0, stored.every((v) => /^e1\\./.test(v)), knot.notes.includes("knot"), shown];`),
    [true, true, false, "Öse knot, tied twice"]);
  check("…and the test tie is deleted again", await run(`
    // The confirmation's "Delete tie" (opened last), not the form's own.
    $("#tie-delete").click(); await calm(300);
    [...document.querySelectorAll("dialog[open] button")].filter((b) => b.textContent === "Delete tie").pop().click(); await calm(1000);
    return [titles().includes("Knot test"), $("#tie-count").textContent];`), [false, "Showing 1 of 1"]);

  // Notes written before encryption: plain text in the database.
  sql("UPDATE people SET notes = 'Written before encryption' WHERE name = 'Sam'");
  await go("/people");
  await sleep(1500);
  check("notes in plain text are encrypted at the next unlock, and still show", await run(`
    const sam = (await (await fetch("/api/people?archived=all")).json()).find((p) => p.name === "Sam");
    const pending = await (await fetch("/api/encryption/pending")).json();
    await openPerson("Sam"); const notes = $("#person-notes").value; $("[data-cancel-edit]").click(); await calm(200);
    return [/^e1\\./.test(sam.notes), Object.values(pending).every((rows) => rows.length === 0),
      notes === "Written before encryption", document.querySelector(".toast") === null];`),
    [true, true, true, true]);
}
