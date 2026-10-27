// The walkthrough's search chunk. The Ties list: paging, sorting and every search filter.

import { check, freshAccount, go, run } from "../harness.mjs";
import { seedJournal, seedTie } from "../seed.mjs";

export default async function () {
  await freshAccount();
  const ids = await seedJournal();
  await seedTie(ids);
  console.log("Ties: searching and paging");
  await run(`
    await post("/api/ties", { title: "Hotel night", tie_type: "suspension", tie_date: "2025-06-01", location_id: ${JSON.stringify(ids.hotel)},
      participants: [{ person_id: ${JSON.stringify(ids.alex)}, role: "bottom" }], tags: ["Futomomo", "Inversion"] });
    for (let day = 1; day <= 21; day++) await post("/api/ties", { title: "Practice " + day, tie_type: "floor", tie_date: "2026-01-" + String(day).padStart(2, "0"), tags: day === 1 ? ["Inversion"] : [] });`);
  await go("/");
  check("20 per page, newest tie date first, with a page control", await run(`
    return [$("#tie-count").textContent, titles().length, titles().slice(0, 3), pagerButtons()];`),
    ["Showing 23 of 23 ties", 20, ["Floor session", "Practice 21", "Practice 20"], ["‹ Prev", "1*", "2", "Next ›"]]);
  const foldState = (rest) => `[$("#search-more").open, $("#search-more summary").textContent.trim(), $("#${rest}").checkVisibility({ contentVisibilityAuto: true })]`;
  check("the filters under the keyword are folded under More options, opened by tapping it", await run(`
    const closed = ${foldState("people-filter")}; $("#search-more summary").click(); await wait(100);
    return [closed, ${foldState("people-filter")}, $("#q").checkVisibility()];`),
    [[false, "More options", false], [true, "More options", true], true]);
  check("every search field is kept out of form history and spellcheck", await run(`
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    const leaky = leakyFields();
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    return leaky;`), []);
  check("page 2 has the rest, and is in the URL", await run(`
    [...document.querySelectorAll("#pager button")].find((b) => b.textContent === "2").click(); await wait(800);
    return [titles(), location.search, pagerButtons()];`),
    [["Practice 2", "Practice 1", "Hotel night"], "?page=2", ["‹ Prev", "1", "2*", "Next ›"]]);
  check("Back returns to page 1", await run(`history.back(); await wait(900); return [titles().length, location.search];`), [20, ""]);
  check("50 per page shows them all, and is in the URL", await run(`
    set("#page-size", "50"); await wait(400); await settle();
    return [titles().length, pagerButtons(), location.search];`), [23, [], "?per_page=50"]);
  check("the sort button puts the oldest first, and back", await run(`
    $("#sort").click(); await wait(400); await settle();
    const oldest = [titles()[0], $("#sort").getAttribute("aria-pressed"), location.search];
    $("#sort").click(); set("#page-size", "20"); await wait(400); await settle();
    return [oldest, titles()[0], location.search];`),
    [["Hotel night", "true", "?per_page=50&sort=oldest"], "Floor session", ""]);
  check("people who don't fit on the line show as '+n'", await run(`
    $("#tie-list").style.width = "190px"; await wait(400);
    const line = document.querySelector(".tie-card .tie-with");
    const narrow = [line.innerText, line.querySelector(".tie-more").title];
    $("#tie-list").style.width = ""; await wait(400);
    return [narrow, line.innerText];`),
    [["With: Me (top) +1", "Sam (bottom)"], "With: Me (top), Sam (bottom)"]);
  check("filters list everyone A–Z, archived in muted text", await run(`
    $("#people-filter summary").click(); $("#locations-filter summary").click(); await wait(200);
    return [filterOptions("#people-filter"), filterOptions("#locations-filter")];`),
    [["Alex (muted)", "Me", "Sam"], ["Back garden", "Garage (muted)", "Hotel (muted)", "Old flat", "Studio"]]);
  check("a filter's search box narrows its list", await run(`
    const box = $("#people-filter input[type=search]"); box.value = "SA"; box.dispatchEvent(new Event("input"));
    const shown = filterOptions("#people-filter"); box.value = "@SA"; box.dispatchEvent(new Event("input"));
    const byAlias = filterOptions("#people-filter"); box.value = ""; box.dispatchEvent(new Event("input"));
    return [shown, byAlias];`), [["Sam (knotsam)"], ["Sam (@sam)"]]);
  check("people filter: ties with all chosen people", await run(`
    await pick("#people-filter", "Me"); await pick("#people-filter", "Sam");
    return [titles(), $("#people-filter summary").textContent, $("#tie-count").textContent, pagerButtons()];`),
    [["Floor session"], "Me, Sam", "Showing 1 of 23 ties", []]);
  check("an archived person can be searched for", await run(`
    await pick("#people-filter", "Me"); await pick("#people-filter", "Sam"); await pick("#people-filter", "Alex");
    return titles();`), ["Hotel night"]);
  check("location filter", await run(`
    await pick("#people-filter", "Alex"); await pick("#locations-filter", "Hotel"); await pick("#locations-filter", "Studio");
    return titles();`), ["Floor session", "Hotel night"]);
  check("date range", await run(`
    await pick("#locations-filter", "Hotel"); await pick("#locations-filter", "Studio");
    set("#from", "2026-01-05"); await wait(500); set("#to", "2026-01-07"); await wait(800);
    return [titles(), $("#to").min];`), [["Practice 7", "Practice 6", "Practice 5"], "2026-01-05"]);
  check("Clear search resets everything", await run(`
    $("#clear").click(); await wait(800);
    return [$("#tie-count").textContent, $("#from").value, $("#people-filter summary").textContent, $("#clear").hidden, location.search];`),
    ["Showing 23 of 23 ties", "", "Anyone", true, ""]);
  check("…and leaves More options open", await run(`return $("#search-more").open;`), true);
  await go("/?from=2026-01-05");
  check("an address with a filter opens More options by itself", await run(`
    return [$("#search-more").open, $("#from").value];`), [true, "2026-01-05"]);
  await go("/");
  check("…and one without starts folded", await run(`
    const closed = $("#search-more").open; $("#search-more summary").click(); await wait(100);
    return [closed, $("#search-more").open];`), [false, true]);
  check("Has Tags opens the tag dialog for picking only: no adding or deleting", await run(`
    $("#tags-choose").click(); await wait(600);
    const box = $("#tags-search"); box.value = "nosuchtag";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); box.dispatchEvent(new Event("input")); await wait(100);
    const unknown = [tagChips("#tags-search"), $("#tags-list").innerText];
    box.value = ""; box.dispatchEvent(new Event("input"));
    return [$("#tags-heading").textContent, !!$("#tags-add"), document.querySelectorAll("#tags-list .tag-x").length, tagBubbles(), unknown, leakyFields()];`),
    ["Choose tags", false, 0, ["Futomomo", "Inversion"], [[], "No matching tags."], []]);
  check("tags filter: OR (the default) lists ties with any chosen tag", await run(`
    for (const name of ["Futomomo", "Inversion"]) [...document.querySelectorAll("#tags-list .tag-toggle")].find((b) => b.textContent === name).click();
    $("#tags-ok").click(); await wait(800);
    return [titles(), tagChips("#tag-filter"), $("#tags-any").getAttribute("aria-pressed"), (location.search.match(/tag_id=/g) || []).length, $("#clear").hidden];`),
    [["Floor session", "Practice 1", "Hotel night"], ["Futomomo", "Inversion"], "true", 2, false]);
  check("tags filter: AND lists only ties with every chosen tag", await run(`
    $("#tags-all").click(); await wait(800);
    return [titles(), $("#tags-all").getAttribute("aria-pressed"), $("#tags-any").getAttribute("aria-pressed"), location.search.includes("tags=all")];`),
    [["Hotel night"], "true", "false", true]);
  check("a chosen tag's × takes it out of the search", await run(`
    [...document.querySelectorAll("#tag-filter .tag")].find((t) => t.textContent.startsWith("Inversion")).querySelector(".tag-x").click(); await wait(800);
    return [titles(), tagChips("#tag-filter")];`), [["Floor session", "Hotel night"], ["Futomomo"]]);
  await go(await run(`return location.pathname + location.search;`));
  check("tags survive a reload, and Clear search resets them to none and OR", await run(`
    const kept = [tagChips("#tag-filter"), $("#tags-all").getAttribute("aria-pressed"), titles()];
    $("#clear").click(); await wait(800);
    return [kept, tagChips("#tag-filter"), $("#tags-any").getAttribute("aria-pressed"), $("#tie-count").textContent, location.search];`),
    [[["Futomomo"], "true", ["Floor session", "Hotel night"]], [], "true", "Showing 23 of 23 ties", ""]);
  check("keyword matches a linked plan's title, and stays out of the URL", await run(`await type("#q", "hip"); return [titles(), location.search];`),
    [["Floor session"], ""]);
  check("the keyword stays out of the URL alongside other filters, and survives paging Back", await run(`
    await type("#q", "practice"); set("#from", "2026-01-01"); await wait(800);
    const onFilter = location.search;
    [...document.querySelectorAll("#pager button")].find((b) => b.textContent === "2").click(); await wait(800);
    const onPage2 = location.search;
    history.back(); await wait(900);
    const back = [location.search, $("#q").value, titles().length];
    $("#clear").click(); await wait(800);
    return [onFilter, onPage2, back];`),
    ["?from=2026-01-01", "?from=2026-01-01&page=2", ["?from=2026-01-01", "practice", 20]]);
  check("no matches says so", await run(`await type("#q", "zzz"); return $("#tie-list").innerText;`), "No ties match this search.");
  await go("/?q=practice+1&page=2");
  check("a keyword in an old URL is ignored and removed from the address", await run(`return [$("#q").value, location.search, titles().length, $("#clear").hidden];`),
    ["", "?page=2", 3, true]);
}
