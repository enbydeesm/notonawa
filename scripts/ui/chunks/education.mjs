// The walkthrough's education chunk. The Education tab in the nav, adding
// and editing workshops (educators picked only from people marked
// Educator), the Attended, Taught and Summary tabs, and the shared search.

import { check, freshAccount, go, run, send } from "../harness.mjs";
import { seedJournal } from "../seed.mjs";

export default async function () {
  await freshAccount();
  // Sam is an educator; Me isn't yet; Alex is archived.
  await seedJournal();
  console.log("Education");
  await go("/education");

  const navFits = `
    const nav = $("nav"), shown = [...nav.children].filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect());
    // On one row: every item overlaps every other top to bottom (they're centered, and not all the same height).
    const oneRow = Math.max(...shown.map((r) => r.top)) < Math.min(...shown.map((r) => r.bottom));
    return [oneRow, nav.scrollWidth <= nav.clientWidth, shown[shown.length - 1].right <= nav.getBoundingClientRect().right + 1];`;
  check("the nav has Education third, between Plans and People, the poser's button after Analytics before the menu, Education marked as the current tab", await run(`
    const tabs = [...document.querySelectorAll("nav .nav-tab")].map((a) => a.getAttribute("aria-label"));
    const poser = $("#nav-poser");
    return [tabs, poser.tagName, poser.previousElementSibling.getAttribute("href"), !!poser.querySelector(".pose-icon"),
      poser.nextElementSibling.classList.contains("nav-menu"), $("nav a[aria-current=page]")?.getAttribute("aria-label"), document.title];`),
    [["Ties", "Plans", "Education", "People", "Locations", "Calendar", "Analytics", "Poser"], "BUTTON", "/analytics", true, true,
      "Education", "Education · nōtonawa"]);
  check("all of the nav fits on one row at this width", await run(navFits), [true, true, true]);
  for (const width of [375, 320]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: true });
    check(`…and on a ${width}px-wide phone`, await run(`await wait(200); ${navFits}`), [true, true, true]);
  }
  await send("Emulation.clearDeviceMetricsOverride", {});

  check("the view: Add a Workshop first, then the search, then Attended, Taught and Summary with Attended underlined", await run(`
    const cards = [...document.querySelectorAll("#view > section.card")];
    const tabs = [...document.querySelectorAll("[role=tab]")];
    const chosen = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const swatch = document.createElement("span"); swatch.style.color = accent; document.body.append(swatch);
    const accentRgb = getComputedStyle(swatch).color; swatch.remove();
    return [flat(cards[0]), cards[1].getAttribute("aria-label"), tabs.map((t) => t.textContent), chosen.textContent,
      getComputedStyle(chosen).borderBottomColor === accentRgb, getComputedStyle(tabs[1]).borderBottomColor === accentRgb,
      flat($("#education-panel")), leakyFields()];`),
    ["Add a Workshop", "Search workshops", ["Attended", "Taught", "Summary"], "Attended", true, false,
      "Workshops attended | 0 workshops | No workshops yet. Add one with the + above.", []]);

  check("+ opens the form: educators are only people marked Educator, and a ? beside them says how to log one I taught", await run(`
    $("#add-workshop").click(); await calm(800);
    const opened = [$("#workshop-form-heading").textContent, $("#workshop-start_date").value !== "", $("[aria-controls=workshop-self-hint]").hidden,
      $("#workshop-self-hint").hidden, $("label[for=workshop-end_date]").textContent, $("#workshop-attendee_count").placeholder,
      $("label[for=workshop-attendee_count]").textContent, $("label[for=workshop-attendee_count]").title,
      $("#workshop-location").checkVisibility(), !!$("#workshop-location-show"), $("#workshop-cost-label").textContent,
      $("#workshop-cost_currency").value, [...$("#workshop-cost_currency").options].map((o) => o.value).slice(0, 4).join(" "),
      $("#workshop-more-ratings").open, $("#workshop-description").placeholder, $("#workshop-notes").placeholder];
    $("[aria-controls=workshop-self-hint]").click(); opened.push($("#workshop-self-hint").textContent);
    // One educator row is there to start; the ?'s tap area doesn't reach the +'s (each reaches 12px past its edge).
    const start = [document.querySelectorAll("#workshop-educators .person-row").length, lastBox("#workshop-educators").value,
      $("[aria-controls=workshop-self-hint]").getBoundingClientRect().left - 12 - ($("#workshop-add-educator").getBoundingClientRect().right + 12) >= 0];
    const educator = lastBox("#workshop-educators"); educator.focus(); await wait(50);
    const offered = pickerList(educator); educator.blur();
    searchIn(educator, "me"); await wait(50); const me = pickerList(educator); educator.blur();
    $("#workshop-add-participant").click(); await wait(50);
    const participant = lastBox("#workshop-participants"); participant.focus(); await wait(50);
    const participants = pickerList(participant).sort(); participant.blur();
    return [start, opened, offered, me, participants, leakyFields()];`),
    [[1, "", true], ["Add a workshop", true, false, true, "End date (optional)", "10", "Size", "How many attended", true, false, "Paid", "USD", "USD CAD EUR GBP",
      false, "How it was originally described by educator, or summary of what it covered", "Your takeaways, how it went",
      "To log a workshop you taught, tick Educator on your own profile in People."], ["Sam"],
      ["No matches.", '"Me" isn\'t marked as an educator. Tick Educator on them in People to choose them here.'], ["Me (you)", "Sam"], []]);
  check("someone chosen as an educator isn't offered as a participant", await run(`
    // "Sam" also finds their alias knotsam, so they're listed with it.
    await choosePick(lastBox("#workshop-educators"), "Sam", "Sam (knotsam)");
    const participant = lastBox("#workshop-participants"); participant.focus(); await wait(50);
    const listed = pickerList(participant); participant.blur();
    return [listed, document.querySelector("#workshop-educators .role").value];`),
    [["Me (you)"], "bottom"]);
  check("saving an attended workshop lists it under Attended, encrypted on the server", await run(`
    await choosePick(lastBox("#workshop-participants"), "Me", "Me (you)");
    document.querySelectorAll("#workshop-participants .role")[0].value = "top";
    set("#workshop-title", "Intro to floor"); set("#workshop-start_date", "2026-03-01"); set("#workshop-end_date", "2026-03-02");
    set("#workshop-attendee_count", "12"); document.querySelectorAll("#workshop-form .hank-button")[3].click();
    // Difficulty 2; Value 5, under More ratings; a cost in euros.
    document.querySelectorAll("#workshop-form .hank-button")[6].click();
    $("#workshop-more-ratings summary").click(); await wait(50);
    document.querySelectorAll("#workshop-more-ratings .hank-button")[14].click();
    $("#workshop-cost_currency").value = "EUR"; set("#workshop-cost_amount", "180");
    set("#workshop-event_url", "https://example.com/intro"); set("#workshop-album_url", "https://example.com/album");
    // The form's order: Location on its own row, Event link beside Paid, the ratings after the description.
    const order = [...document.querySelectorAll("#workshop-form label")].map((l) => l.textContent)
      .filter((t) => ["Location", "People", "Event link", "Paid", "Workshop description", "How was it?", "Notes"].includes(t));
    const beside = $("#workshop-event_url").closest(".row") === $("#workshop-cost_amount").closest(".row");
    set("#workshop-description", "Gote basics"); set("#workshop-notes", "Practise the stem");
    $("#workshop-add-tags").click(); await calm(400);
    $("#tags-search").value = "floor"; $("#tags-add").click(); $("#tags-ok").click(); await calm(200);
    $("#workshop-save").click(); await calm(1500);
    const stored = (await store.listWorkshops())[0];
    const c = $(".workshop-card");
    return [$("dialog[open]") === null, c.querySelector(".tie-title").textContent, c.querySelector(".tie-date").textContent,
      c.querySelector(".tie-year").textContent, c.querySelectorAll(".hank").length, [...c.querySelectorAll(".tie-with")].map((l) => l.innerText),
      tagChips(".workshop-card"), $("#workshop-count").textContent,
      [...await Promise.all(["Gote basics", "Practise the stem", "EUR 180", "example.com/intro"].map(async (t) => !(await plainOnServer(t)))),
        stored.attendee_count, stored.rating, stored.difficulty, stored.rating_content, stored.rating_value],
      order, beside, c.querySelector(".tie-place").textContent,
      [...c.querySelectorAll(".tie-visuals-start a")].map((a) => [a.textContent, a.getAttribute("href"), a.target]),
      c.querySelector(".tie-visuals-end"),
      // The days and the year sit close, one under the other, level with the title's top.
      c.querySelector(".tie-year").getBoundingClientRect().top - c.querySelector(".tie-date").getBoundingClientRect().bottom < 3 &&
        Math.abs(c.querySelector(".tie-date").getBoundingClientRect().top - c.querySelector(".tie-title").getBoundingClientRect().top) < 6];`),
    [true, "Intro to floor", "Mar 1–2", "2026", 0, ["With: Me (top)"], ["floor"], "1 workshop",
      [true, true, true, true, 12, 4, 2, null, 5],
      ["Location", "People", "Event link", "Paid", "Workshop description", "How was it?", "Notes"], true, "Sam",
      [["Open link", "https://example.com/intro", "_blank"], ["Open album", "https://example.com/album", "_blank"]], null, true]);
  check("Taught is empty until I'm one of the educators, and says so", await run(`
    $("#tab-taught").click(); await wait(100);
    return [$("#tab-taught").getAttribute("aria-selected"), $("#tab-attended").getAttribute("aria-selected"), flat($("#education-panel"))];`),
    ["true", "false", "Workshops taught | 0 workshops | Workshops with you as one of the educators show here. Tick Educator on your own profile in People first."]);

  // Me marked Educator, as the People form would.
  await run(`
    const me = (await store.listItems("people", "false")).find((p) => p.is_self);
    await store.saveItem("people", me.id, { name: me.name, is_educator: true });`);
  await go("/education");
  check("once Me is an educator, a workshop with me teaching is under Taught, not Attended", await run(`
    $("#add-workshop").click(); await calm(800);
    const hint = $("[aria-controls=workshop-self-hint]").hidden;
    const before = $("#workshop-cost-label").textContent;
    await choosePick(lastBox("#workshop-educators"), "Me", "Me (you)");
    const earned = $("#workshop-cost-label").textContent;
    document.querySelector("#workshop-educators .role").value = "top";
    set("#workshop-title", "Teaching gote"); set("#workshop-start_date", "2026-05-05"); set("#workshop-attendee_count", "8");
    $("#workshop-save").click(); await calm(1500);
    const attended = titles();
    $("#tab-taught").click(); await wait(100);
    return [hint, before, earned, attended, titles()];`),
    [true, "Paid", "Earned", ["Intro to floor"], ["Teaching gote"]]);
  check("the search narrows every tab: a keyword in the description, and educators (folded under More options)", await run(`
    $("#tab-attended").click(); await wait(100);
    await type("#search-q", "GOTE"); const keyword = [titles(), $("#workshop-count").textContent, $("#search-clear").hidden];
    $("#tab-taught").click(); await wait(100); const taughtToo = titles();
    $("#search-clear").click(); await wait(100);
    const fold = () => [$("#search-more").open, $("#search-educators").checkVisibility({ contentVisibilityAuto: true })];
    const folded = fold(); $("#search-more summary").click(); await wait(100); const unfolded = fold();
    await pick("#search-educators", "Sam"); const bySam = titles();
    $("#tab-attended").click(); await wait(100); const attendedBySam = titles();
    return [keyword, taughtToo, folded, unfolded, filterOptions("#search-educators"), bySam, attendedBySam];`),
    [[["Intro to floor"], "Showing 1 of 1", false], ["Teaching gote"], [false, false], [true, true], ["Me", "Sam"], [], ["Intro to floor"]]);
  check("Summary shows a card each for Attended and Taught, following the search", await run(`
    $("#search-clear").click(); await wait(100);
    $("#tab-summary").click(); await wait(100);
    const pairs = (id) => [...document.querySelectorAll("#" + id + " .stat")].map((s) => s.querySelector("dt").textContent + " " + s.querySelector("dd").textContent);
    const all = [pairs("summary-attended"), pairs("summary-taught"), [...document.querySelectorAll("#summary-attended .item-meta")].map((p) => p.textContent)];
    await pick("#search-educators", "Me");
    return [all, flat($("#summary-attended")), pairs("summary-taught")[0]];`),
    [[["Workshops 1", "Days 2", "Educators 1", "Total spend €180", "Locations 0", "Partners 0", "Avg rating 4", "Avg per workshop €180"],
      ["Workshops 1", "Days 1", "Attendees 8", "Co-teachers 0", "Locations 0", "Partners 0", "Avg rating –", "Earned –"],
      ["Learned most from: Sam (1)", "Top tags: floor (1)", "First: Intro to floor, Mar 1, 2026"]],
      "Attended | No workshops match the search.", "Workshops 1"]);
  check("a taught workshop's card says who taught it at the location (linking to the event), the attendees bottom right", await run(`
    await store.saveItem("locations", null, { name: "Dojo" });
    $("#search-clear").click(); $("#tab-taught").click(); await wait(100);
    const wcard = () => $(".workshop-card");
    const before = [wcard().querySelector(".tie-place").innerText, wcard().querySelector(".tie-year").innerText,
      wcard().querySelector(".tie-visuals").innerText.replace(/\\n+/g, " | ")];
    wcard().querySelector(".tie-title").click(); await calm(1200);
    $("#workshop-add-educator").click(); await wait(50);
    await choosePick(lastBox("#workshop-educators"), "Sam", "Sam (knotsam)");
    if ($("#workshop-location-show")) { $("#workshop-location-show").click(); await wait(50); }
    await choosePick($("#workshop-location"), "Dojo");
    set("#workshop-event_url", "https://example.com/gote");
    $("#workshop-save").click(); await calm(1500);
    const link = wcard().querySelector(".tie-place a");
    return [before, wcard().querySelector(".tie-place").innerText, link?.getAttribute("href"), link?.target,
      [...wcard().querySelectorAll(".tie-visuals a")].map((a) => a.textContent), wcard().querySelector(".tie-visuals-end").innerText,
      wcard().querySelector(".tie-visuals-end").getBoundingClientRect().right > wcard().getBoundingClientRect().right - 20];`),
    [["Me", "2026", "Attendees: 8"], "Me & Sam at Dojo", "https://example.com/gote", "_blank", [], "Attendees: 8", true]);
  check("a workshop's title opens it to edit; saving changes the card, and Delete removes it", await run(`
    $("#search-clear").click(); await wait(100); $("#tab-attended").click(); await wait(100);
    $(".workshop-card .tie-title").click(); await calm(1200);
    const editing = [$("#workshop-form-heading").textContent, $("#workshop-title").value, $("#workshop-description").value,
      $("#workshop-end_date").value, tagChips("#workshop-tags"), lastBox("#workshop-educators").value, !!$("#workshop-delete"),
      $("#workshop-cost_currency").value + " " + $("#workshop-cost_amount").value, $("#workshop-more-ratings").open,
      ...["#workshop-album_url-open", "#workshop-event_url-open"].map((id) => [$(id).hidden, $(id).textContent, $(id).getAttribute("href"), $(id).target])];
    set("#workshop-title", "Intro to floor, day one"); $("#workshop-save").click(); await calm(1500);
    const renamed = titles();
    // Tapping the card, not just its title, opens it too.
    $(".workshop-card .tie-date").click(); await calm(1200);
    // The confirmation opens on top of the form, which has a Delete workshop button too.
    $("#workshop-delete").click(); await calm(300);
    [...[...document.querySelectorAll("dialog[open]")].pop().querySelectorAll("button")].find((b) => b.textContent === "Delete workshop").click();
    await calm(1500);
    return [editing, renamed, flat($("#education-panel"))];`),
    [["Edit workshop", "Intro to floor", "Gote basics", "2026-03-02", ["floor"], "Sam", true, "EUR 180.00", true,
      [false, "Open Album", "https://example.com/album", "_blank"], [false, "Open Event", "https://example.com/intro", "_blank"]], ["Intro to floor, day one"],
      "Workshops attended | 0 workshops | No workshops yet. Add one with the + above."]);
  check("a workshop's roles add Audit; picking someone without a usual role keeps the role chosen, someone with one sets it", await run(`
    $("#add-workshop").click(); await wait(800);
    $("#workshop-add-participant").click(); await wait(50);
    const roles = [...document.querySelector("#workshop-participants .role").options].map((o) => o.text);
    document.querySelectorAll("#workshop-participants .role")[0].value = "audit";
    await choosePick(lastBox("#workshop-participants"), "Me", "Me (you)");
    const kept = document.querySelectorAll("#workshop-participants .role")[0].value;
    $("#workshop-add-participant").click(); await wait(50);
    document.querySelectorAll("#workshop-participants .role")[1].value = "audit";
    await choosePick(lastBox("#workshop-participants"), "Sam", "Sam (knotsam)");
    const usual = document.querySelectorAll("#workshop-participants .role")[1].value;
    set("#workshop-title", "Audit day"); set("#workshop-start_date", "2026-06-01");
    $("#workshop-save").click(); await wait(1500);
    const stored = (await store.listWorkshops()).find((w) => w.title === "Audit day");
    const full = await store.getWorkshop(stored.id);
    // The educator row it started with, left empty, saved no one.
    return [roles, kept, usual, full.participants.map((p) => [p.person_name, p.role]), full.educators];`),
    [["Choose Role", "Top", "Bottom", "Self tie", "Spotter", "Photographer", "Audit"], "audit", "bottom", [["Me", "audit"], ["Sam", "bottom"]], []]);

  check("a new workshop can't link ties and plans until it's saved", await run(`
    $("#add-workshop").click(); await calm(800);
    const state = [$("#workshop-add-linked").disabled, $("#workshop-linked-hint").textContent];
    $("#workshop-close").click(); await calm(300);
    return state;`),
    [true, "Save the workshop first, then link ties and plans to it."]);
  check("+ under Ties and plans offers ties and plans only; + Tie starts one linked, dated and peopled from the workshop", await run(`
    [...document.querySelectorAll(".workshop-card .tie-title")].find((b) => b.textContent === "Audit day").click(); await calm(1200);
    const before = [$("#workshop-add-linked").disabled, $("#workshop-linked-hint").textContent];
    $("#workshop-add-linked").click(); await calm(800);
    const sheet = [$("#add-to-heading").textContent, [...document.querySelectorAll(".add-to-filters button")].map((b) => b.textContent),
      [...document.querySelectorAll(".add-to-make")].map((b) => b.textContent.replace("+", "").trim())];
    $("#add-to-new-tie").click(); await calm(1500);
    // Me was auditing: no role ties have, so it's left to choose; Sam keeps theirs.
    const form = [$("#tie-form-heading").textContent, $("#tie-workshop-name").textContent, $("#tie-tie_date").value,
      [...document.querySelectorAll("#tie-participants .person-row")].map((r) => r.querySelector("input:not([type=hidden])").value + "|" + r.querySelector(".role").value)];
    document.querySelector("#tie-participants .role").value = "top";
    $("#tie-tie_type").value = "floor"; set("#tie-title", "Audit practice");
    $("#tie-save").click(); await calm(1800);
    const rows = [...document.querySelectorAll("#workshop-linked .linked-row")].map((r) => r.getAttribute("aria-label"));
    return [before, sheet, form, rows, $("#workshop-linked-hint").hidden];`),
    [[false, "None yet. Link a tie at the workshop, or a plan of something you learned there."],
      ["Add to this workshop…", ["All", "Ties", "Plans"], ["Tie", "Plan"]],
      ["Add a tie", "Audit day", "2026-06-01", ["Me (you)|", "Sam|bottom"]],
      ["Tie: Audit practice"], true]);
  check("linking a plan from the list puts it first, marked Linked next time; the tie's form shows the workshop, and × unlinks it", await run(`
    $("#workshop-add-linked").click(); await calm(800);
    const linked = [...document.querySelectorAll(".add-to-row")].filter((r) => r.querySelector(".badge.linked")).map((r) => r.querySelector(".item-title").textContent);
    [...document.querySelectorAll(".add-to-row")].find((r) => r.querySelector(".item-title").textContent === "Hip harness").click(); await calm(1200);
    const rows = [...document.querySelectorAll("#workshop-linked .linked-row")].map((r) => r.getAttribute("aria-label"));
    [...document.querySelectorAll("#workshop-linked .linked-row")][1].click(); await calm(1500);
    const shown = [$("#tie-workshop-name").textContent, $("#tie-workshop").hidden];
    $("#tie-form .workshop-chosen .tag-x").click(); await wait(50);
    const unlinked = [$("#tie-workshop_id").value, $("#tie-workshop").hidden];
    $("#tie-save").click(); await calm(1800);
    const after = [...document.querySelectorAll("#workshop-linked .linked-row")].map((r) => r.getAttribute("aria-label"));
    $("#workshop-close").click(); await calm(300);
    return [linked, rows, shown, unlinked, after];`),
    [["Audit practice"], ["Plan: Hip harness", "Tie: Audit practice"], ["Audit day", false], ["", true], ["Plan: Hip harness"]]);
  check("the workshop's card counts the plan linked to it; the plan's card names the workshop under its type", await run(`
    const counted = [...document.querySelectorAll(".workshop-card")].find((c) => c.querySelector(".tie-title").textContent === "Audit day")
      .querySelector(".tie-photos")?.textContent;
    return counted;`), "1 plan");
  await go("/plans");
  check("…on the third line, after its type, with the Education cap", await run(`
    const c = [...document.querySelectorAll(".plan-card")].find((x) => x.querySelector(".tie-title").innerText === "Hip harness");
    const line = c.querySelector(".plan-workshop");
    return [line?.innerText, !!line?.querySelector("svg.cap-mark"), line && line.getBoundingClientRect().top >= c.querySelector(".tie-place").getBoundingClientRect().bottom - 1];`),
    ["Audit day", true, true]);
}
