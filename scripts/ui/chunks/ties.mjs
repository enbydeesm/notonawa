// The walkthrough's ties chunk. Logging a tie: the form, its pickers and tags, and + from another tab.

import { check, freshAccount, go, run, sleep } from "../harness.mjs";
import { seedJournal } from "../seed.mjs";

export default async function () {
  await freshAccount();
  await seedJournal();
  console.log("Ties: logging");
  await go("/");
  check("+ opens the log-a-tie dialog; pickers leave out archived items", await run(`
    $(".nav-add").click(); await calm(600);
    $("#tie-add-participant").click(); $("#tie-add-plan").click();
    const firstPerson = [lastBox("#tie-participants").value, $(".role").value];
    const hiddenAtFirst = $("#tie-location").offsetParent === null;
    $("#tie-location-show").click(); await wait(100);
    // No ties yet, so the newest added (sorted here: both were added the same second).
    const locations = [...document.querySelectorAll("#tie-location-list .combo-option")].map((o) => o.textContent).sort();
    // Its × is small, on the box's top-right corner, and the box fills the row.
    const row = $("#tie-location").closest(".picker-row").getBoundingClientRect(), x = $("#tie-location-remove").getBoundingClientRect();
    const corner = [x.width <= 24, Math.abs(x.right - row.right) < 12, Math.abs(x.top - row.top) < 12,
      Math.abs($("#tie-location").getBoundingClientRect().width - row.width) < 2];
    $("#tie-location-remove").click(); await wait(100);
    const hiddenAgain = [$("#tie-location").offsetParent === null, $("#tie-location-show").hidden];
    return [!!$("dialog[open] #tie-form"), firstPerson, hiddenAtFirst, locations, corner, hiddenAgain, [...$("#tie-tie_type").options].map((o) => o.text),
      document.querySelectorAll(".hank-button.filled").length + "/" + document.querySelectorAll(".hank-button").length,
      leakyFields(), $("#tie-workshop").hidden];`),
    [true, ["Me (you)", ""], true, ["Old flat", "Studio"], [true, true, true, true], [true, false], ["–", "Suspension", "Partial suspension", "Floor", "Hashira"], "0/5", [], true]);
  // Sorted: these were all added within the same second, so "newest" ties.
  check("people and plans pickers list the active ones", await run(`
    const person = lastBox("#tie-participants"), plan = lastBox("#tie-plans");
    person.focus(); await wait(50); const people = pickerList(person).sort(); person.blur();
    plan.focus(); await wait(50); const plans = pickerList(plan).sort(); plan.blur();
    return [people, plans];`),
    [["Me (you)", "Sam"], ["Hip harness", "Hip harness, one-sided"]]);
  check("a person's social name finds them too, shown with it", await run(`
    const person = lastBox("#tie-participants"); searchIn(person, "KNOT"); await wait(50);
    const listed = pickerList(person); person.blur(); return listed;`), ["Sam (knotsam)", "Add to list | Add & archive"]);
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
  check("incomplete person row is caught", await run(`set("#tie-title", "Floor session"); set("#tie-tie_type", "floor"); await choosePick(lastBox("#tie-participants"), "Me", "Me (you)"); $("#tie-save").click(); await calm(500); return [lastBox("#tie-participants").value, $("#tie-message").textContent];`),
    ["Me (you)", "Couldn't save: Choose a person and a role for each row, or remove it."]);
  check("Edit tags opens an empty tag dialog", await run(`
    $("#tie-add-tags").click(); await calm(600);
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
    $("#tags-ok").click(); await calm(300);
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
    [...document.querySelectorAll("#tie-location-list button")].find((b) => b.textContent === "Add & archive").click(); await calm(800);
    const saved = (await store.listItems("locations", "true")).map((l) => l.name);
    return [box.value, $("[name=location_id]").value !== "", $("#tie-location-list").hidden, saved.includes("Garage"), !!$("dialog[open] #tie-form")];`),
    ["Garage", true, true, true, true]);
  check("'Add to list' adds an active location, which the list then offers", await run(`
    const box = $("#tie-location"); box.focus(); box.value = "Back garden"; box.dispatchEvent(new Event("input"));
    [...document.querySelectorAll("#tie-location-list button")].find((b) => b.textContent === "Add to list").click(); await calm(800);
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
  check("only the first person row starts with me; picking someone with a default role sets it, replacing a hand-picked one; someone without one keeps it", await run(`
    $("#tie-add-participant").click(); await wait(50);
    const box = lastBox("#tie-participants"), role = () => document.querySelectorAll(".role")[1];
    const empty = [box.value, role().value];
    await choosePick(box, "Sam", "Sam (knotsam)"); const sam = role().value;
    role().value = "spotter"; await choosePick(box, "Me", "Me (you)"); const me = role().value;
    role().value = "spotter"; await choosePick(box, "Sam", "Sam (knotsam)"); const back = role().value;
    box.blur();
    return [empty, sam, me, back];`),
    [["", ""], "bottom", "spotter", "bottom"]);
  check("save a full tie: the dialog closes and the list shows it", await run(`
    set("#tie-tie_type", "floor");
    document.querySelectorAll(".role")[0].value = "top";
    set("#tie-duration_minutes", "45"); set("#tie-notes", "Smooth transitions");
    set("#tie-album_url", "https://photos.app.goo.gl/floor");
    $("#tie-save").click(); await calm(1000);
    return [!!document.querySelector("dialog"), titles()[0], card(0)];`),
    [false, "Floor session", [true, "Floor tie at Studio", 4, "With: Sam (bottom), Me (top)", ["Floor", "Futomomo"]]]);
  check("the card links to its album, which the server only has sealed", await run(`
    const link = document.querySelector(".tie-card .tie-album a");
    const stored = (await store.findTies({})).ties[0];
    return [link?.textContent, link?.href, link?.target, link?.rel, !(await plainOnServer("photos.app.goo.gl/floor"))];`),
    ["Open album", "https://photos.app.goo.gl/floor", "_blank", "noopener noreferrer", true]);
  check("the card's date has no commas, and the album link follows what's attached, at the left", await run(`
    const c = document.querySelector(".tie-card"), album = c.querySelector(".tie-album").getBoundingClientRect();
    return [c.querySelector(".tie-date").textContent.includes(","), c.querySelector(".tie-visuals").innerText.replace(/\\s+/g, " "),
      album.left - c.querySelector(".tie-photos").getBoundingClientRect().right < 20];`), [false, "1 plan Open album", true]);
  check("the nav stays pinned at the top while the list scrolls under it, and the people filter has no hint under it", await run(`
    const filler = document.createElement("div"); filler.className = "ui-filler"; filler.textContent = "x".repeat(20000);
    $("#view").append(filler); scrollTo(0, 2000); await wait(100);
    const top = $("nav").getBoundingClientRect().top, bg = getComputedStyle($("nav")).backgroundColor;
    filler.remove(); scrollTo(0, 0);
    return [Math.abs(top) < 1, bg === getComputedStyle(document.body).backgroundColor,
      $("#people-filter").nextElementSibling?.classList.contains("hint") ?? false];`), [true, true, false]);
  check("a tie needs a date: the form won't save without one", await run(`
    $(".nav-add").click(); await calm(600); set("#tie-title", "Dateless"); set("#tie-tie_date", "");
    $("#tie-save").click(); await calm(600);
    const stayed = [!!document.querySelector("dialog[open] #tie-form"), $("#tie-tie_date").validity.valueMissing];
    await closeDiscarding("#tie-close"); await calm(300);
    return [stayed, titles()];`), [[true, true], ["Floor session"]]);
  check("a tie needs a type: the form won't save on –", await run(`
    $(".nav-add").click(); await calm(600); set("#tie-title", "Typeless");
    $("#tie-save").click(); await calm(600);
    const stayed = [!!document.querySelector("dialog[open] #tie-form"), $("#tie-tie_type").value, $("#tie-tie_type").validity.valueMissing];
    await closeDiscarding("#tie-close"); await calm(300);
    return [stayed, titles()];`), [[true, "", true], ["Floor session"]]);
  check("✕ asks before throwing away what's typed: Keep editing stays, Discard changes closes without saving", await run(`
    $(".nav-add").click(); await calm(600);
    const top = () => [...document.querySelectorAll("dialog[open]")].pop();
    $("#tie-close").click(); await calm(300);
    const untouched = !document.querySelector("dialog[open]");
    $(".nav-add").click(); await calm(600); set("#tie-title", "Not saved");
    $("#tie-close").click(); await calm(300);
    const asked = [top().querySelector("h2").textContent, [...top().querySelectorAll("button")].map((b) => b.textContent)];
    [...top().querySelectorAll("button")].find((b) => b.textContent === "Keep editing").click(); await calm(300);
    const kept = [!!document.querySelector("dialog[open] #tie-form"), $("#tie-title").value];
    $("#tie-close").click(); await calm(300);
    [...top().querySelectorAll("button")].find((b) => b.textContent === "Discard changes").click(); await calm(600);
    return [untouched, asked, kept, !!document.querySelector("dialog"), titles()];`),
    [true, ["Discard your changes?", ["Discard changes", "Keep editing"]], [true, "Not saved"], false, ["Floor session"]]);

  check("saving the tie created and linked its tags", await run(`return tagsJson();`), ["Floor:1", "Futomomo:1"]);
  check("deleting a tag asks first, saying which ties use it", await run(`
    $(".nav-add").click(); await calm(600); $("#tie-add-tags").click(); await calm(600);
    const before = tagBubbles();
    [...document.querySelectorAll("#tags-list .tag")].find((t) => t.querySelector(".tag-toggle").textContent === "Floor").querySelector(".tag-x").click();
    await calm(300);
    const dialogs = document.querySelectorAll("dialog"); const confirm = dialogs[dialogs.length - 1];
    const asked = [confirm.querySelector("h2").textContent, confirm.querySelector("p").textContent, [...confirm.querySelectorAll("button")].map((b) => b.textContent)];
    [...confirm.querySelectorAll("button")].find((b) => b.textContent === "Confirm").click(); await calm(800);
    return [before, asked, tagBubbles(), await tagsJson()];`),
    [["Floor ×", "Futomomo ×"], ["Delete tag 'Floor'?", "Used on 1 tie; it'll be removed from it.", ["Confirm", "Cancel"]], ["Futomomo ×"], ["Futomomo:1"]]);
  check("closing the tag dialog without OK keeps the tie's tags as they were", await run(`
    document.querySelector("#tags-list .tag-toggle").click();
    $("#tags-search").closest("dialog").close(); await calm(300);
    const kept = tagChips("#tie-tags");
    await closeDiscarding("#tie-close"); await calm(300);
    return [kept, !!document.querySelector("dialog")];`), [[], false]);

  console.log("+ on other tabs");
  await go("/plans");
  await run(`$(".nav-add").click(); await calm(600); set("#tie-title", "Logged from Plans"); set("#tie-tie_type", "floor"); $("#tie-save").click();`);
  await sleep(1500);
  check("saving from another tab goes to the Ties list", await run(`return [location.pathname, titles()[0]];`), ["/", "Logged from Plans"]);
  check("tapping a tie's card, not just its title, opens it", await run(`
    $(".tie-card .tie-date").click(); await calm(1000);
    const opened = [$("#tie-form-heading")?.textContent, $("#tie-title")?.value, getComputedStyle($(".tie-card")).cursor];
    await closeDiscarding("#tie-close"); await calm(300);
    return [opened, !!document.querySelector("dialog[open]")];`), [["Edit tie", "Logged from Plans", "pointer"], false]);

  console.log("Ties: the Add a Tie card");
  check("Ties starts with a small \"Add a Tie\" card, then the search, snug at its top and bottom", await run(`
    const cards = [...document.querySelectorAll("#view > section.card")];
    const search = cards[1].getBoundingClientRect(), label = $("label[for=q]").getBoundingClientRect();
    const more = $("#search-more > summary").getBoundingClientRect();
    return [flat(cards[0]), cards[0].getBoundingClientRect().height < 80, cards[1].getAttribute("aria-label"),
      label.top - search.top <= 16, search.bottom - more.bottom <= 20];`),
    ["+ | Add a Tie", true, "Search ties", true, true]);
  check("its + opens the \"Add a tie\" dialog, and saving lists the new tie", await run(`
    $("#add-tie").click(); await calm(600);
    const heading = $("#tie-form-heading").textContent;
    set("#tie-title", "Added from the card"); set("#tie-tie_type", "floor"); $("#tie-save").click(); await calm(1500);
    return [heading, !!document.querySelector("dialog[open]"), titles()[0]];`),
    ["Add a tie", false, "Added from the card"]);
}
