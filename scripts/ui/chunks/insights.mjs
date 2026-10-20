// The walkthrough's insights chunk. Calendar and Analytics.

import { check, freshAccount, go, run } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

export default async function () {
  await freshAccount();
  await seedTie(await seedJournal());
  console.log("Calendar and Analytics");
  await go("/calendar");
  check("Calendar and Analytics are the tabs after Locations, marked when shown", await run(`
    const links = [...document.querySelectorAll("nav a.nav-tab")].map((a) => a.getAttribute("href"));
    return [links.slice(-3), $("nav a[aria-current=page]").getAttribute("aria-label")];`),
    [["/locations", "/calendar", "/analytics"], "Calendar"]);
  check("Calendar shows this month: its name, five numbers and every day", await run(`
    await wait(800); const days = document.querySelectorAll(".cal-day").length;
    return [$("#cal-title").textContent.length > 0, document.querySelectorAll("#cal-stats .stat").length, days >= 28 && days <= 31];`),
    [true, 5, true]);
  check("its arrows step back a month and forward again", await run(`
    const now = $("#cal-title").textContent; $("#cal-prev").click(); await wait(600); const before = $("#cal-title").textContent;
    $("#cal-next").click(); await wait(600); return [before !== now, $("#cal-title").textContent === now];`), [true, true]);
  await go("/analytics");
  check("Analytics shows this year's numbers and a bar for each month", await run(`
    await wait(1000);
    return [$("nav a[aria-current=page]").getAttribute("aria-label"), $("#period").value, $("#period-title").textContent === String(new Date().getFullYear()),
      document.querySelectorAll("#insights-stats .stat").length, document.querySelectorAll("#tie-count-chart .bar").length, $("#insights-message").textContent];`),
    ["Analytics", "year", true, 8, 12, ""]);
  check("Month shows a bar for each day, Custom shows its dates", await run(`
    set("#period", "month"); await wait(800); const days = document.querySelectorAll("#tie-count-chart .bar").length;
    set("#period", "custom"); await wait(300); const custom = !$("#custom-dates").hidden;
    set("#period", "year"); await wait(800);
    return [days >= 28 && days <= 31, custom];`), [true, true]);
  check("More filters lists people (not me), locations and tags, kept out of form history and spellcheck", await run(`
    $("#more-filters").click(); await wait(1000);
    const open = !!$("dialog[open].more-filters"); const leaky = leakyFields();
    const people = [...document.querySelectorAll("dialog[open] details")][0].querySelectorAll("label").length;
    const mine = [...document.querySelectorAll("dialog[open] details label")].some((l) => l.textContent === "Me");
    $("#af-cancel").click(); await wait(200);
    return [open, leaky, people > 0, mine, document.querySelector("dialog[open]") === null];`), [true, [], true, false, true]);
  check("…and Insights' own fields are too", await run(`return leakyFields();`), []);
  check("tapping a bar lists its ties, newest first, and the list closes", await run(`
    const bar = document.querySelector("#tie-count-chart .bar-hits button"); const label = bar.getAttribute("aria-label");
    bar.click(); await wait(1000);
    const shown = [$("#tl-heading").textContent, document.querySelectorAll("#tl-list .tie-card").length];
    const count = Number(label.match(/: (\\d+) ties?/)[1]);
    $("#tl-close").click(); await wait(200);
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
    set("#role", "spotter"); await wait(1000);
    const classes = [...document.querySelectorAll("#tie-count-chart .bar:not(.empty) rect, #partner-chart rect")].map((r) => r.getAttribute("class"));
    set("#role", "all"); await wait(1000);
    return classes.every((c) => c === "c-grey");`), true);
  check("so does tapping a partner (if any tie with me as top, bottom or self tie had one), a pie's legend and a location", await run(`
    // Lists the ties behind a row, then closes the list: whether any were shown.
    const opens = async (sel) => { $(sel).click(); await wait(1000); const shown = document.querySelectorAll("#tl-list .tie-card").length > 0; $("#tl-close").click(); await wait(200); return shown; };
    const partner = $("#partner-chart .partner-row") ? await opens("#partner-chart .partner-row")
      : $("#partner-chart .empty")?.textContent === "No partners in this period.";
    return [partner, await opens("#type-chart .legend-row"), await opens("#location-chart .rank-row")];`), [true, true, true]);
}
