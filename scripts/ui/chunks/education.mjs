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
  check("the nav has Education after Analytics and before +, marked as the current tab", await run(`
    const tabs = [...document.querySelectorAll("nav .nav-tab")].map((a) => a.getAttribute("aria-label"));
    const education = $("nav a[href='/education']");
    return [tabs, education.nextElementSibling.classList.contains("nav-add"), $("nav a[aria-current=page]")?.getAttribute("aria-label"),
      document.title];`),
    [["Ties", "Plans", "People", "Locations", "Calendar", "Analytics", "Education"], true, "Education", "Education · NotoNawa"]);
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
    ["+ | Add a Workshop", "Search workshops", ["Attended", "Taught", "Summary"], "Attended", true, false,
      "Workshops attended | 0 workshops | No workshops yet. Add one with the + above.", []]);

  check("+ opens the form: educators are only people marked Educator, and a ? beside them says how to log one I taught", await run(`
    $("#add-workshop").click(); await wait(800);
    const opened = [$("#workshop-form-heading").textContent, $("#workshop-start_date").value !== "", $("[aria-controls=workshop-self-hint]").hidden,
      $("#workshop-self-hint").hidden, $("label[for=workshop-end_date]").textContent, $("#workshop-attendee_count").placeholder];
    $("[aria-controls=workshop-self-hint]").click(); opened.push($("#workshop-self-hint").textContent);
    $("#workshop-add-educator").click(); await wait(50);
    const educator = lastBox("#workshop-educators"); educator.focus(); await wait(50);
    const offered = pickerList(educator); educator.blur();
    searchIn(educator, "me"); await wait(50); const me = pickerList(educator); educator.blur();
    $("#workshop-add-participant").click(); await wait(50);
    const participant = lastBox("#workshop-participants"); participant.focus(); await wait(50);
    const participants = pickerList(participant).sort(); participant.blur();
    return [opened, offered, me, participants, leakyFields()];`),
    [["Add a workshop", true, false, true, "End date (optional)", "10", "To log a workshop you taught, tick Educator on your own profile in People."], ["Sam"],
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
    set("#workshop-description", "Gote basics"); set("#workshop-notes", "Practise the stem");
    $("#workshop-add-tags").click(); await wait(400);
    $("#tags-search").value = "floor"; $("#tags-add").click(); $("#tags-ok").click(); await wait(200);
    $("#workshop-save").click(); await wait(1500);
    const stored = (await (await fetch("/api/workshops")).json())[0];
    const c = $(".workshop-card");
    return [$("dialog[open]") === null, c.querySelector(".tie-title").textContent, c.querySelector(".tie-date").textContent,
      c.querySelectorAll(".tie-rating .hank.filled").length, [...c.querySelectorAll(".tie-with")].map((l) => l.innerText),
      tagChips(".workshop-card"), $("#workshop-count").textContent,
      [/^e1\\./.test(stored.description), /^e1\\./.test(stored.notes), stored.attendee_count]];`),
    [true, "Intro to floor", "Mar 1, 2026 – Mar 2, 2026", 4, ["Educators: Sam (bottom)", "With: Me (top)"], ["floor"], "1 workshop",
      [true, true, 12]]);
  check("Taught is empty until I'm one of the educators, and says so", await run(`
    $("#tab-taught").click(); await wait(100);
    return [$("#tab-taught").getAttribute("aria-selected"), $("#tab-attended").getAttribute("aria-selected"), flat($("#education-panel"))];`),
    ["true", "false", "Workshops taught | 0 workshops | Workshops with you as one of the educators show here. Tick Educator on your own profile in People first."]);

  // Me marked Educator, as the People form would.
  await run(`
    const me = (await (await fetch("/api/people?archived=false")).json()).find((p) => p.is_self);
    await fetch("/api/people/" + me.id, { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: me.name, is_educator: true }) });`);
  await go("/education");
  check("once Me is an educator, a workshop with me teaching is under Taught, not Attended", await run(`
    $("#add-workshop").click(); await wait(800);
    const hint = $("[aria-controls=workshop-self-hint]").hidden;
    $("#workshop-add-educator").click(); await wait(50);
    await choosePick(lastBox("#workshop-educators"), "Me", "Me (you)");
    document.querySelector("#workshop-educators .role").value = "top";
    set("#workshop-title", "Teaching gote"); set("#workshop-start_date", "2026-05-05"); set("#workshop-attendee_count", "8");
    $("#workshop-save").click(); await wait(1500);
    const attended = titles();
    $("#tab-taught").click(); await wait(100);
    return [hint, attended, titles()];`),
    [true, ["Intro to floor"], ["Teaching gote"]]);
  check("the search narrows every tab: a keyword in the description, and educators", await run(`
    $("#tab-attended").click(); await wait(100);
    await type("#search-q", "GOTE"); const keyword = [titles(), $("#workshop-count").textContent, $("#search-clear").hidden];
    $("#tab-taught").click(); await wait(100); const taughtToo = titles();
    $("#search-clear").click(); await wait(100);
    await pick("#search-educators", "Sam"); const bySam = titles();
    $("#tab-attended").click(); await wait(100); const attendedBySam = titles();
    return [keyword, taughtToo, filterOptions("#search-educators"), bySam, attendedBySam];`),
    [[["Intro to floor"], "Showing 1 of 1 workshop", false], ["Teaching gote"], ["Me", "Sam"], [], ["Intro to floor"]]);
  check("Summary shows a card each for Attended and Taught, following the search", await run(`
    $("#search-clear").click(); await wait(100);
    $("#tab-summary").click(); await wait(100);
    const pairs = (id) => [...document.querySelectorAll("#" + id + " .stat")].map((s) => s.querySelector("dt").textContent + " " + s.querySelector("dd").textContent);
    const all = [pairs("summary-attended"), pairs("summary-taught"), [...document.querySelectorAll("#summary-attended .item-meta")].map((p) => p.textContent)];
    await pick("#search-educators", "Me");
    return [all, flat($("#summary-attended")), pairs("summary-taught")[0]];`),
    [[["Workshops 1", "Days 2", "Educators 1", "Locations 0", "Partners 0", "Avg rating 4"],
      ["Workshops 1", "Days 1", "Attendees 8", "Co-teachers 0", "Locations 0", "Partners 0", "Avg rating –"],
      ["Learned most from: Sam (1)", "Top tags: floor (1)", "First: Intro to floor, Mar 1, 2026"]],
      "Attended | No workshops match the search.", "Workshops 1"]);
  check("a workshop's title opens it to edit; saving changes the card, and Delete removes it", await run(`
    $("#search-clear").click(); await wait(100); $("#tab-attended").click(); await wait(100);
    $(".workshop-card .tie-title").click(); await wait(1200);
    const editing = [$("#workshop-form-heading").textContent, $("#workshop-title").value, $("#workshop-description").value,
      $("#workshop-end_date").value, tagChips("#workshop-tags"), lastBox("#workshop-educators").value, !!$("#workshop-delete")];
    set("#workshop-title", "Intro to floor, day one"); $("#workshop-save").click(); await wait(1500);
    const renamed = titles();
    // Tapping the card, not just its title, opens it too.
    $(".workshop-card .tie-date").click(); await wait(1200);
    // The confirmation opens on top of the form, which has a Delete workshop button too.
    $("#workshop-delete").click(); await wait(300);
    [...[...document.querySelectorAll("dialog[open]")].pop().querySelectorAll("button")].find((b) => b.textContent === "Delete workshop").click();
    await wait(1500);
    return [editing, renamed, flat($("#education-panel"))];`),
    [["Edit workshop", "Intro to floor", "Gote basics", "2026-03-02", ["floor"], "Sam", true], ["Intro to floor, day one"],
      "Workshops attended | 0 workshops | No workshops yet. Add one with the + above."]);
}
