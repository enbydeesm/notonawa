// The walkthrough's insights chunk. Calendar and Analytics.

import { check, freshAccount, go, run } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

/**
 * Ties today at three places with coordinates, for the map: two in London
 * about 25 km apart (one pin until zoomed in) and one in Sydney. With the
 * seeded tie at Studio (no coordinates), the map shows 3 of 4 ties.
 */
function seedMapTies() {
  return run(`
    const d = new Date();
    const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    for (const [name, latitude, longitude] of [["Soho dungeon", 51.5136, -0.1365], ["Watford loft", 51.6565, -0.3903], ["Sydney studio", -33.8688, 151.2093]]) {
      const location_id = await post("/api/locations", { name, latitude, longitude });
      if (!location_id || !await post("/api/ties", { tie_type: "floor", tie_date: today, location_id })) throw new Error("Seeding " + name + " failed");
    }`);
}

export default async function () {
  await freshAccount();
  await seedTie(await seedJournal());
  await seedMapTies();
  console.log("Calendar and Analytics");
  await go("/calendar");
  check("Calendar and Analytics are the tabs after Locations, marked when shown", await run(`
    const links = [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("href"));
    return [links.slice(4, 7), $("nav a[aria-current=page]").getAttribute("aria-label")];`),
    [["/locations", "/calendar", "/analytics"], "Calendar"]);
  check("Calendar shows this month: its name, five numbers and every day", await run(`
    await calm(800); const days = document.querySelectorAll(".cal-day").length;
    return [$("#cal-title").textContent.length > 0, document.querySelectorAll("#cal-stats .stat").length, days >= 28 && days <= 31];`),
    [true, 5, true]);
  check("its arrows step back a month and forward again", await run(`
    const now = $("#cal-title").textContent; $("#cal-prev").click(); await calm(600); const before = $("#cal-title").textContent;
    $("#cal-next").click(); await calm(600); return [before !== now, $("#cal-title").textContent === now];`), [true, true]);
  await go("/analytics");
  check("Analytics shows this year's numbers and a bar for each month", await run(`
    await calm(1000);
    return [$("nav a[aria-current=page]").getAttribute("aria-label"), $("#period").value, $("#period-title").textContent === String(new Date().getFullYear()),
      document.querySelectorAll("#insights-stats .stat").length, document.querySelectorAll("#tie-count-chart .bar").length, $("#insights-message").textContent];`),
    ["Analytics", "year", true, 8, 12, ""]);
  check("Month shows a bar for each day, Custom shows its dates", await run(`
    set("#period", "month"); await calm(800); const days = document.querySelectorAll("#tie-count-chart .bar").length;
    set("#period", "custom"); await calm(300); const custom = !$("#custom-dates").hidden;
    set("#period", "year"); await calm(800);
    return [days >= 28 && days <= 31, custom];`), [true, true]);
  check("More filters lists people (not me), locations and tags, kept out of form history and spellcheck", await run(`
    $("#more-filters").click(); await calm(1000);
    const open = !!$("dialog[open].more-filters"); const leaky = leakyFields();
    const people = [...document.querySelectorAll("dialog[open] details")][0].querySelectorAll("label").length;
    const mine = [...document.querySelectorAll("dialog[open] details label")].some((l) => l.textContent === "Me");
    $("#af-cancel").click(); await calm(200);
    return [open, leaky, people > 0, mine, document.querySelector("dialog[open]") === null];`), [true, [], true, false, true]);
  check("…and Insights' own fields are too", await run(`return leakyFields();`), []);
  check("tapping a bar lists its ties, newest first, and the list closes", await run(`
    const bar = document.querySelector("#tie-count-chart .bar-hits button"); const label = bar.getAttribute("aria-label");
    bar.click(); await calm(1000);
    const shown = [$("#tl-heading").textContent, document.querySelectorAll("#tl-list .tie-card").length];
    const count = Number(label.match(/: (\\d+) ties?/)[1]);
    $("#tl-close").click(); await calm(200);
    return [shown[0].endsWith(count === 1 ? "· 1 tie" : "· " + count + " ties"), shown[1] === Math.min(count, 100), document.querySelector("dialog[open]") === null];`),
    [true, true, true]);
  check("the tie count and partners are split by my role, with a key; days are seven yellow bars; locations are rows of bars", await run(`
    const key = [...document.querySelectorAll("#tie-count-chart .chart-key li, #partner-chart .chart-key li")].map((li) => li.textContent);
    const colors = new Set([...document.querySelectorAll("#tie-count-chart .bar rect, #partner-chart rect")].map((r) => r.getAttribute("class")).filter(Boolean));
    const days = [...document.querySelectorAll("#weekday-chart .bar-label")].map((t) => t.textContent);
    const rows = [...document.querySelectorAll("#location-chart .rank-row")].map((r) =>
      [r.querySelector(".rank-name").textContent.length > 0, r.getAttribute("aria-label").endsWith(r.querySelector(".rank-count").textContent + (r.querySelector(".rank-count").textContent === "1" ? " tie" : " ties"))]);
    const typeColors = [...document.querySelectorAll("#type-chart .legend-row .swatch")].map((s) => s.classList[1]);
    return [key.length > 0 && key.every((k) => k.startsWith("As ")), [...colors].every((c) => ["c-yellow", "c-purple", "c-teal"].includes(c)),
      days, rows.length > 0 && rows.every((row) => row[0] && row[1]),
      getComputedStyle($("#weekday-chart .bar:not(.empty) rect")).fill, typeColors.every((c) => ["c-yellow", "c-purple", "c-teal", "c-coral", "c-grey"].includes(c))];`),
    [true, true, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], true, "rgb(254, 199, 98)", true]);
  check("with the role filter on spotter, the role-colored charts are grey", await run(`
    set("#role", "spotter"); await calm(1000);
    const classes = [...document.querySelectorAll("#tie-count-chart .bar:not(.empty) rect, #partner-chart rect")].map((r) => r.getAttribute("class"));
    set("#role", "all"); await calm(1000);
    return classes.every((c) => c === "c-grey");`), true);
  check("so does tapping a partner (if any tie with me as top, bottom or self tie had one), a pie's legend and a location", await run(`
    // Lists the ties behind a row, then closes the list: whether any were shown.
    const opens = async (sel) => { $(sel).click(); await calm(1000); const shown = document.querySelectorAll("#tl-list .tie-card").length > 0; $("#tl-close").click(); await calm(200); return shown; };
    const partner = $("#partner-chart .partner-row") ? await opens("#partner-chart .partner-row")
      : $("#partner-chart .empty")?.textContent === "No partners in this period.";
    return [partner, await opens("#type-chart .legend-row"), await opens("#location-chart .rank-row")];`), [true, true, true]);
  check("the numbers have a card of their own, under the filters, and Locations, Map and Days of the week come in that order", await run(`
    const statsCard = $("#insights-stats").closest(".card");
    const cards = [...document.querySelectorAll("#insights-panel > .card h2")].map((h) => h.textContent);
    return [statsCard.previousElementSibling.classList.contains("insights-filters"), statsCard.children.length,
      [...document.querySelectorAll("#insights-stats .stat dt")].map((dt) => dt.textContent),
      cards.slice(cards.indexOf("Locations"), cards.indexOf("Locations") + 3)];`),
    [true, 1, ["Ties", "Partners", "Locations", "As top", "Time (total)", "Time (avg)", "Avg rating", "As bottom"], ["Locations", "Map", "Days of the week"]]);
  check("the filters stay at the top while the page scrolls", await run(`
    window.scrollTo(0, document.body.scrollHeight); await calm(300);
    const top = $(".insights-filters").getBoundingClientRect().top; const scrolled = window.scrollY > 300;
    window.scrollTo(0, 0); await wait(100);
    return [scrolled, Math.round(top)];`), [true, 0]);
  check("the map loads once scrolled to: a pin for London's two places and one for Sydney, and 3 of the 4 ties", await run(`
    $("#map-card").scrollIntoView();
    for (let i = 0; i < 100 && !document.querySelector(".world-map .map-pin"); i++) await wait(100);
    const pins = [...document.querySelectorAll(".map-pin")].map((p) => p.getAttribute("aria-label"));
    return [$(".map-note").textContent, pins, $("#map-count").hidden, $("#map-count").textContent, $("#map-zoom-in").disabled];`),
    ["Ties (pins) and workshops (teal diamonds) show on the map when their location has coordinates.", ["2 locations: 2 ties", "Sydney studio: 1 tie"], false, "Showing 3 of 4 ties.", false]);
  check("tapping a pin lists its ties", await run(`
    document.querySelector(".map-pin.grouped").dispatchEvent(new MouseEvent("click", { bubbles: true })); await calm(1000);
    const shown = [$("#tl-heading").textContent, document.querySelectorAll("#tl-list .tie-card").length];
    $("#tl-close").click(); await calm(200);
    return shown;`), ["2 locations · 2 ties", 2]);
  check("+ zooms in, the pins come apart close up, and Show all fits them again", await run(`
    const width = () => Number(document.querySelector(".map-land").getAttribute("viewBox").split(" ")[2]);
    const before = width(); $("#map-zoom-in").click(); await calm(200); const closer = width();
    let steps = 0; while (!$("#map-zoom-in").disabled && steps++ < 20) { $("#map-zoom-in").click(); await wait(50); }
    await calm(200); const apart = document.querySelectorAll(".map-pin").length;
    $("#map-fit").click(); await calm(200);
    return [Math.round(before / closer), apart, width() === before, document.querySelectorAll(".map-pin").length];`), [2, 3, true, 2]);

  check("with no workshops, Analytics has no Workshops or Practised most card", await run(`
    return [$("#workshops-card").hidden, $("#practised-card").hidden];`), [true, true]);

  // A workshop today at Sydney studio, with a cost (sealed); a plan learned
  // there, tied today (a follow-up); and a tie at the workshop itself.
  await run(`
    const d = new Date();
    const today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const sydney = (await (await fetch("/api/locations?archived=false")).json()).find((l) => l.name === "Sydney studio").id;
    const { sealOne } = await import("/js/vault.js");
    const body = await sealOne("workshop", { title: "Rope intensive", start_date: today, location_id: sydney, cost: "USD 120.00" });
    const workshop = await post("/api/workshops", body);
    const plan = await post("/api/plans", { title: "Intensive harness", workshop_id: workshop });
    await post("/api/ties", { tie_type: "floor", tie_date: today, plan_ids: [plan] });
    await post("/api/ties", { tie_type: "floor", tie_date: today, workshop_id: workshop });`);
  await go("/analytics");
  check("the Workshops card: attended and taught, days, spend in its currency, earned, and the follow-up ties' share", await run(`
    await calm(1500);
    const pairs = [...document.querySelectorAll("#workshop-stats .stat")].map((s) => s.querySelector("dt").textContent + " " + s.querySelector("dd").textContent);
    return [$("#workshops-card").hidden, pairs];`),
    [false, ["Attended 1", "Taught 0", "Days 1", "Spend $120", "Earned –", "Follow-up ties 117%"]]);
  check("Practised most ranks it by its follow-up ties, which a tap lists; Tie count has a cap over its month", await run(`
    const rows = [...document.querySelectorAll("#practised-chart .rank-row")].map((r) => r.getAttribute("aria-label"));
    $("#practised-chart .rank-row").click(); await calm(1000);
    const listed = document.querySelectorAll("#tl-list .tie-card").length;
    $("#tl-close").click(); await calm(200);
    const marks = [...document.querySelectorAll("#tie-count-chart .bar-mark")].map((m) => m.getAttribute("aria-label").replace(/^.*: /, ""));
    $("#tie-count-chart .bar-mark").click(); await calm(500);
    const opened = [...document.querySelectorAll(".workshop-list-dialog .item-title")].map((t) => t.textContent);
    $(".workshop-list-dialog .dialog-cancel").click(); await calm(200);
    return [$("#practised-card").hidden, rows, listed, marks, opened];`),
    [false, ["Rope intensive: 1 tie"], 1, ["1 workshop"], ["Rope intensive"]]);
  check("the map shows the workshop as a teal diamond at Sydney studio", await run(`
    $("#map-card").scrollIntoView();
    for (let i = 0; i < 100 && !document.querySelector(".world-map .map-workshop"); i++) await wait(100);
    return [...document.querySelectorAll(".map-workshop")].map((p) => p.getAttribute("aria-label"));`),
    ["Sydney studio: 1 workshop"]);
}
