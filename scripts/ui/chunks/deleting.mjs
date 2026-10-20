// The walkthrough's deleting chunk. Deleting plans, locations, people and ties, and how ties show what was deleted.

import { check, freshAccount, go, run } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

export default async function () {
  await freshAccount();
  await seedTie(await seedJournal());
  console.log("Deleting");
  await go("/plans");
  check("plan delete dialog has the three options", await run(`await clickIn("Hip harness", "Delete"); return dialogButtons();`),
    ["Remove from linked ties too", "Just delete the plan", "Cancel"]);
  check("cancel keeps the plan", await run(`await clickDialog("Cancel"); return [!!document.querySelector("dialog[open]"), titles().length];`), [false, 2]);
  check("'Just delete the plan'", await run(`await clickIn("Hip harness", "Delete"); await clickDialog("Just delete the plan"); return titles();`), ["Hip harness, one-sided"]);
  await go("/locations");
  check("location delete, from its dialog, offers archiving instead", await run(`
    await openItem("Studio"); [...document.querySelectorAll("#location-dialog button")].find((b) => b.textContent === "Delete").click(); await wait(300);
    const b = dialogButtons().slice(-3); await clickDialog("Delete permanently"); return [b, $("#location-dialog").open, personNames()];`),
    [["Archive instead", "Delete permanently", "Cancel"], false, ["Back garden", "Old flat"]]);
  await go("/people");
  check("delete a person from their dialog", await run(`
    await openPerson("Sam"); [...document.querySelectorAll("#person-dialog button")].find((b) => b.textContent === "Delete").click(); await wait(300);
    const b = dialogButtons().slice(-3); await clickDialog("Delete permanently"); return [b, $("#person-dialog").open, personNames()];`),
    [["Archive instead", "Delete permanently", "Cancel"], false, ["Me"]]);
  await go("/");
  check("tie shows what was deleted", await run(`return card(0);`),
    [true, "Floor at (location deleted)", 4, "With: (person deleted) (bottom), Me (top)", ["Futomomo"]]);
  check("tapping a title opens the tie to edit, deleted links shown as kept", await run(`
    $(".tie-title").click(); await wait(1000);
    const d = $("dialog[open]");
    const kept = (sel) => [...d.querySelectorAll(sel + " .kept-deleted")].map((r) => r.innerText.replace(/\\s*✕$/, ""));
    return [$("#tie-form-heading").textContent, $("#tie-title").value, $("#tie-tie_type").value, $("#tie-duration_minutes").value,
      $("#tie-notes").value, $("#tie-location-deleted").hidden, kept("#tie-participants"),
      [...d.querySelectorAll("#tie-participants .person-row [role=combobox]")].map((b) => b.value),
      kept("#tie-plans"), tagChips("#tie-tags"), d.querySelectorAll(".hank-button.filled").length,
      [...d.querySelectorAll("button")].filter((b) => ["Save tie", "Cancel", "Delete tie"].includes(b.textContent)).map((b) => b.textContent), leakyFields()];`),
    ["Edit tie", "Floor session", "floor", "45", "Smooth transitions", false, ["(person deleted) (bottom)"], ["Me"], ["(plan deleted)"], ["Futomomo"], 4,
      ["Save tie", "Cancel", "Delete tie"], []]);
  check("saving an edit updates the tie, keeping the deleted links left in", await run(`
    set("#tie-title", "Floor session, edited"); $("#tie-save").click(); await wait(600); await settle();
    return [!!document.querySelector("dialog"), titles()[0], card(0)];`),
    [false, "Floor session, edited", [true, "Floor at (location deleted)", 4, "With: (person deleted) (bottom), Me (top)", ["Futomomo"]]]);
  check("removing deleted links in the edit form drops them", await run(`
    $(".tie-title").click(); await wait(1000);
    $("#tie-participants .kept-deleted button").click(); $("#tie-location-deleted button").click();
    $("#tie-save").click(); await wait(600); await settle();
    return card(0);`), [true, "Floor", 4, "With: Me (top)", ["Futomomo"]]);
  await run(`await post("/api/ties", { title: "Throwaway", tie_type: "floor", tie_date: "2030-01-01" });`);
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
}
