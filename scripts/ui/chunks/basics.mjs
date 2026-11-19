// The walkthrough's basics chunk. Signing up and the app's shell: security headers, icons, sign-up, the welcome tour, moving between views, and the offer to install the app.

import { APP_VERSION, RELEASES } from "../../../public/js/releases.js";
import { BASE, HELP_LINE, account, check, go, newInvite, resetBrowser, run, send, sleep } from "../harness.mjs";

export default async function () {
  await resetBrowser();
  const INVITE = newInvite();
  console.log("Security headers");
  for (const pagePath of ["/", "/plans", "/people", "/locations", "/data", "/manifest.webmanifest"]) {
    const res = await fetch(BASE + pagePath);
    check(`${pagePath}: strict CSP, never cached`, [
      res.headers.get("cache-control"),
      res.headers.get("content-security-policy")?.includes("script-src 'self'; style-src 'self'"),
      res.headers.get("content-security-policy")?.includes("require-trusted-types-for 'script'"),
      res.headers.get("x-frame-options"),
    ], ["no-store", true, true, "DENY"]);
  }
  // The app's code and images hold none of the journal: kept by the
  // browser, the code checked with the server before each use.
  for (const [path, cache] of [["/js/api.js", "no-cache"], ["/js/views/plans.js", "no-cache"], ["/app.css", "no-cache"],
    ["/img/logo-mark-v4.svg", "max-age=604800"], ["/img/favicon-v4.png", "max-age=604800"]]) {
    const res = await fetch(BASE + path);
    check(`${path}: cached (${cache}), with the security headers`, [res.headers.get("cache-control"), res.headers.get("x-frame-options")], [cache, "DENY"]);
  }
  console.log("Logo and icons");
  const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
  // Plain icons, and maskable ones (drawn to fill Android's shapes) in the same sizes.
  check("the manifest names the app and its icons", [manifest.name, manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ""}`)],
    ["nōtonawa", ["192x192", "512x512", "192x192 maskable", "512x512 maskable"]]);
  const page = await (await fetch(BASE + "/")).text();
  const linked = [...page.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)"/g)].map((m) => m[1]);
  check("the page links a tab icon and a home-screen icon", linked.length, 2);
  for (const path of [...linked, ...manifest.icons.map((i) => i.src)]) {
    const res = await fetch(BASE + path);
    check(`${path} is a PNG`, [res.status, res.headers.get("content-type")], [200, "image/png"]);
  }
  for (const path of ["/img/logo-mark-v4.svg", "/img/logo-word-v4.svg"]) {
    const res = await fetch(BASE + path);
    check(`${path} is an SVG, with no script in it`, [res.status, res.headers.get("content-type"), (await res.text()).includes("<script")],
      [200, "image/svg+xml", false]);
  }
  console.log("Signing up");
  await go("/");
  check("signed out, the journal goes to the sign-in page, without the nav, its title centered, the logo's pencil in the accent and its name in dark mode's light text", await run(`
    return [location.pathname, visibleCard(), getComputedStyle($("nav")).display, getComputedStyle($("#view h1")).textAlign, logo("#view h1 .logo")];`),
    ["/signin", "choose", "none", "center", [true, "nōtonawa", ["/img/logo-mark-v4.svg", "/img/logo-word-v4.svg"], ["rgb(254, 199, 98)", "rgb(238, 238, 238)"]]]);
  check("pulling down doesn't reload the page, nor does a dialog's scrolling pull the page under it", await run(`
    const dialog = document.createElement("dialog"); document.body.append(dialog);
    const styles = [getComputedStyle(document.documentElement).overscrollBehaviorY, getComputedStyle(dialog).overscrollBehaviorY];
    dialog.remove(); return styles;`), ["none", "contain"]);
  check("sign-in shows the app's version at the bottom", await run(`
    const v = $("#signin-version"); return [v.textContent, v === $("#view").lastElementChild];`), [`Version ${APP_VERSION}`, true]);
  check("sign-in says who to email for help, on its own centred line", await run(HELP_LINE),
    ["Trouble signing in?\nEmail contact@notonawa.app for assistance.", "mailto:contact@notonawa.app", true, "center"]);
  check("the sign-up form's fields are kept out of form history and spellcheck", await run(`
    [...document.querySelectorAll("[data-show=signup]")][0].click(); return [visibleCard(), leakyFields()];`), ["signup", []]);
  check("sign-up needs 18+ and consent", await run(`
    $("#invite").value = ${JSON.stringify(INVITE)}; $("#passkey-name").value = "Test phone";
    $("#signup-form button[type=submit]").click(); await calm(300);
    return $("#adult").validity.valueMissing;`), true);
  const recoveryCode = await run(`
    $("#adult").checked = true; $("#consent").checked = true;
    $("#signup-form button[type=submit]").click(); await calm(2500);
    return $("#recovery-code")?.textContent;`);
  check("signing up makes a passkey and shows a recovery code once, which must be confirmed", await run(`
    const before = recoveryDialog(); $("#recovery-saved").click();
    return [before[1], $("dialog[open] button.primary").disabled];`), [true, false]);
  check("the recovery code is 32 characters in groups of 4", /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(recoveryCode ?? ""), true);
  account.currentCode = recoveryCode ?? "";
  await run(`$("dialog[open] button.primary").click();`);
  await sleep(1500);
  check("Done goes to the journal, signed in", await run(`return [location.pathname, $("#tie-count") !== null];`), ["/", true]);
  check("the invite can't be used again", await run(`
    const r = await fetch("/api/auth/register/options", { method: "POST", credentials: "omit", headers: { "content-type": "application/json" },
      body: JSON.stringify({ invite: ${JSON.stringify(INVITE)}, adult: true, consent: true }) });
    return [r.status, (await r.json()).error];`), [400, "That invite code doesn't work. It may have been used or expired."]);

  console.log("Welcome tour");
  // In the page: the tour's state, and helpers to drive it.
  const tour = `
    const tourOpen = async () => { for (let i = 0; i < 100 && !$("dialog.tour[open]"); i++) await wait(100); return !!$("dialog.tour[open]"); };
    const tourCard = () => $("dialog.tour[open] .tour-card");
    const seen = async () => (await (await fetch("/api/account/settings")).json()).hide_welcome;
    const showAgain = () => fetch("/api/account/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hide_welcome: false }) });
    const press = async (sel) => { $("dialog.tour[open] " + sel).click(); await calm(300); };
    // What's new, which follows the tour once it's finished or skipped: its releases, closed with OK.
    const news = async () => {
      for (let i = 0; i < 30 && !$("dialog.whats-new[open]"); i++) await wait(100);
      const versions = [...document.querySelectorAll("dialog.whats-new[open] h3")].map((h) => h.textContent);
      $("#whats-new-ok")?.click(); await calm(300);
      return versions.length;
    };
    // Where the ring is, and whether it goes round the element given, a few pixels out, and the pointer's tip under it.
    const ringRound = (sel) => {
      const ring = $(".tour-ring"); if (ring.hasAttribute("hidden")) return "no ring";
      const r = ["x", "y", "width", "height"].map((n) => Number(ring.getAttribute(n)));
      const t = $(sel).getBoundingClientRect();
      const tip = $(".tour-pointer-fill").getAttribute("points").split(" ")[1].split(",").map(Number);
      return [Math.round(t.left - r[0]), Math.round(t.top - r[1]), Math.round(r[0] + r[2] - t.right), Math.round(r[1] + r[3] - t.bottom),
        tip[0] >= r[0] && tip[0] <= r[0] + r[2], tip[1] > r[1] + r[3], Math.round(tourCard().getBoundingClientRect().top - tip[1])];
    };`;
  check("a new account is shown the welcome tour once the journal shows: the logo's pencil in the accent, Start, and Skip tour beside how to replay it", await run(`
    ${tour}
    const open = await tourOpen(); const tc = tourCard(); const mark = $(".tour-mark").getBoundingClientRect();
    const style = getComputedStyle($(".tour-mark"));
    return [open, tc.classList.contains("centered"), tc.querySelector("h2").textContent, [...tc.querySelectorAll("p")].map((p) => p.innerText),
      Math.round(mark.height), style.maskImage.includes("/img/logo-mark-v4.svg"), style.backgroundColor,
      document.activeElement?.textContent, $(".tour-later .tour-skip").textContent, $(".tour-ring").hasAttribute("hidden"), await seen()];`),
    [true, true, "Welcome to nōtonawa", ["Your end-to-end encrypted planner and journal for your rope practice.", "Let's take a quick tour.",
      "You can replay it any time from\nMenu > Tutorial."], 44, true, "rgb(254, 199, 98)", "Start the tour", "Skip tour", true, false]);
  check("Start goes to the first stop: a ring round Ties, its card under the nav with a pointer up to it, and Back, Next and Skip tour", await run(`
    ${tour}
    await press("#tour-start"); const tc = tourCard();
    return [tc.querySelector("h2").textContent, $(".tour-count").textContent, tc.classList.contains("at-nav"), ringRound('nav a[href="/"]'),
      $("progress.tour-progress").value, $("progress.tour-progress").max, [...tc.querySelectorAll("button")].map((b) => b.textContent),
      document.activeElement?.textContent];`),
    ["Ties", "1 of 11", true, [5, 5, 5, 5, true, true, 9], 1, 11, ["Skip tour", "Back", "Next"], "Next"]);
  check("Next goes round the nav: each tab, the poser, + and the menu in turn, the ring on each", await run(`
    ${tour}
    const stops = [];
    for (const sel of ['nav a[href="/plans"]', 'nav a[href="/education"]', 'nav a[href="/people"]', 'nav a[href="/locations"]',
      'nav a[href="/calendar"]', 'nav a[href="/analytics"]', "#nav-poser", "nav .nav-add", "nav .nav-menu"]) {
      await press(".tour-next");
      stops.push([tourCard().querySelector("h2").textContent, $(".tour-count").textContent, ringRound(sel).slice(0, 6).join()]);
    }
    return stops;`),
    [["Plans", "2 of 11"], ["Education", "3 of 11"], ["People", "4 of 11"], ["Locations", "5 of 11"], ["Calendar", "6 of 11"],
      ["Analytics", "7 of 11"], ["Model Poser", "8 of 11"], ["Add a tie", "9 of 11"], ["Menu", "10 of 11"]].map((s) => [...s, "5,5,5,5,true,true"]));
  check("then Account Recovery, in the middle with no ring, its warning in italics, and Finish", await run(`
    ${tour}
    await press(".tour-next"); const tc = tourCard();
    return [tc.querySelector("h2").textContent, $(".tour-count").textContent, tc.classList.contains("centered"), ringRound("nav"),
      $(".tour-pointer").hasAttribute("hidden"), tc.querySelector("em").textContent, tc.querySelectorAll(".tour-body p").length, $(".tour-next").textContent];`),
    ["Account Recovery", "11 of 11", true, "no ring", true, "we cannot restore your data if you lose it", 2, "Finish"]);
  check("Finish shows the wrap-up: our email linked, Done, Back, and the coffee link on its own line, opening a new tab", await run(`
    ${tour}
    await press(".tour-next"); const tc = tourCard(); const coffee = tc.querySelector(".tour-coffee a");
    return [tc.querySelector("h2").textContent, tc.querySelector("a[href^=mailto]").getAttribute("href"), tc.querySelector("s").textContent,
      coffee.getAttribute("href"), coffee.target, coffee.rel, getComputedStyle(coffee).display, document.activeElement?.textContent,
      [...tc.querySelectorAll("button")].map((b) => b.textContent)];`),
    ["That's a wrap!", "mailto:contact@notonawa.app", "obsession", "https://buymeacoffee.com/mx_piggie", "_blank", "noopener noreferrer", "block", "Done",
      ["Done", "Back"]]);
  check("Back goes back a step at a time, from the wrap-up to the welcome", await run(`
    ${tour}
    const headings = [];
    await press(".tour-back"); headings.push(tourCard().querySelector("h2").textContent);
    for (let i = 0; i < 11; i++) { await press(".tour-buttons .tour-back"); headings.push(tourCard().querySelector("h2").textContent); }
    return headings;`),
    ["Account Recovery", "Menu", "Add a tie", "Model Poser", "Analytics", "Calendar", "Locations", "People", "Education", "Plans", "Ties", "Welcome to nōtonawa"]);
  check("Done at the end closes it and remembers it on the account", await run(`
    ${tour}
    await press("#tour-start");
    for (let i = 0; i < 11; i++) await press(".tour-next");
    await press("#tour-done"); await calm(500);
    return [$("dialog.tour") === null, await seen()];`), [true, true]);
  check("…then What's new opens as from the menu, the recent releases newest first, and closing it marks them seen", await run(`
    for (let i = 0; i < 30 && !$("dialog.whats-new[open]"); i++) await wait(100);
    const versions = [...document.querySelectorAll("dialog.whats-new[open] h3")].map((h) => h.textContent);
    $("#whats-new-ok").click(); await calm(500);
    return [versions, $("dialog") === null, (await (await fetch("/api/account/settings")).json()).seen_release];`),
  [RELEASES.slice(0, 10).map((r) => r.version), true, APP_VERSION]);
  await go("/");
  check("…so it isn't shown again after the next unlock, nor What's new", await run(`await calm(800); return [$("dialog.tour") === null, $("dialog.whats-new") === null];`), [true, true]);
  await run(`${tour} await showAgain();`);
  await go("/");
  check("Skip tour, on any card, closes it and remembers that too", await run(`
    ${tour}
    const open = await tourOpen(); await press("#tour-start"); await press(".tour-next"); await press(".tour-skip"); await calm(500);
    return [open, $("dialog.tour") === null, await seen(), await news() > 0, $("dialog") === null];`), [true, true, true, true, true]);
  await run(`${tour} await showAgain();`);
  await go("/");
  const escOpen = await run(`${tour} return await tourOpen();`);
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  check("Esc is Skip tour", [escOpen, ...await run(`${tour} await calm(500); return [$("dialog.tour") === null, await seen(), await news() > 0];`)], [true, true, true, true]);
  await run(`${tour} await showAgain();`);
  await go("/");
  check("closed by the view changing under it, it isn't remembered, so it shows after the next unlock", await run(`
    ${tour}
    const open = await tourOpen(); history.pushState(null, "", "/plans"); window.dispatchEvent(new PopStateEvent("popstate")); await calm(800);
    return [open, location.pathname, $("dialog.tour") === null, await seen()];`), [true, "/plans", true, false]);
  await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
  await go("/");
  check("on a 320px-wide phone, every stop's ring and card stay on screen, the ring round its icon", await run(`
    ${tour}
    const open = await tourOpen(); await press("#tour-start"); const out = [];
    for (let i = 0; i < 10; i++) {
      const sel = [...'nav a[href="/"]|nav a[href="/plans"]|nav a[href="/education"]|nav a[href="/people"]|nav a[href="/locations"]|nav a[href="/calendar"]|nav a[href="/analytics"]|#nav-poser|nav .nav-add|nav .nav-menu'.split("|")][i];
      const ring = ["x", "y", "width", "height"].map((n) => Number($(".tour-ring").getAttribute(n)));
      const t = $(sel).getBoundingClientRect(); const c = tourCard().getBoundingClientRect();
      out.push(ring[0] >= 0 && ring[0] + ring[2] <= 320 && ring[0] <= t.left && ring[0] + ring[2] >= t.right && c.left >= 0 && c.right <= 320 && c.bottom <= 640);
      await press(".tour-next");
    }
    await press(".tour-skip");
    return [open, out];`), [true, Array(10).fill(true)]);
  await send("Emulation.clearDeviceMetricsOverride");
  for (const pagePath of ["/plans", "/people", "/locations"]) {
    await go(pagePath);
    check(`${pagePath}: every field is kept out of form history and spellcheck`, await run(`return leakyFields();`), []);
  }

  console.log("Single-page app");
  await go("/");
  // A marker on window survives only if the page wasn't loaded again.
  const viewState = `return [location.pathname + location.search, document.title, $("#view h1").textContent, window.marker === 1,
    $("nav a[aria-current=page]")?.getAttribute("aria-label") ?? null, document.activeElement === $("#view h1")];`;
  check("a tab changes the view without loading a new page, with its title, tab and focus", await run(`
    window.marker = 1; $("nav a[href='/plans']").click(); await calm(800); ${viewState}`),
    ["/plans", "Plans · nōtonawa", "Plans", true, "Plans", true]);
  check("Back and Forward change the view, still without a page load", await run(`
    history.back(); await calm(800); const back = (() => { ${viewState} })();
    history.forward(); await calm(800); return [back, (() => { ${viewState} })()];`), [
    ["/", "nōtonawa", "nōtonawa", true, "Ties", true],
    ["/plans", "Plans · nōtonawa", "Plans", true, "Plans", true],
  ]);
  check("Back to the Ties list brings back its sort order", await run(`
    $("nav a[href='/']").click(); await calm(800); $("#sort").click(); await settle();
    $("nav a[href='/people']").click(); await calm(800); history.back(); await calm(800);
    return [location.pathname + location.search, $("#sort").getAttribute("aria-pressed"), window.marker === 1];`), ["/?sort=oldest", "true", true]);
  check("Back with a dialog open closes it", await run(`
    $("nav a[href='/']").click(); await calm(800); $("nav a[href='/locations']").click(); await calm(800);
    $(".nav-add").click(); await calm(600); const open = $("dialog[open] #tie-form") !== null;
    history.back(); await calm(800); return [open, $("dialog[open]") === null, location.pathname];`), [true, true, "/"]);
  check("the privacy policy opens in a new tab, leaving the app as it is", await run(`
    await openMenu(); const link = $(".menu-privacy"); const out = [link.target, link.rel]; $("dialog.menu-panel").close(); return out;`),
    ["_blank", "noopener"]);
  await go("/people");
  check("an address loaded directly (a bookmark or refresh) shows its view", await run(`
    return [document.title, $("#view h1").textContent, $("nav a[aria-current=page]")?.getAttribute("aria-label"), $("nav").hidden];`),
    ["People · nōtonawa", "People", "People", false]);
  await go("/nope");
  // "Not found" doesn't need the key, so after loading it the journal is
  // locked, and the ties ask to unlock first.
  check("an unknown address says so, and links back to the ties (to unlock first)", await run(`
    const shown = [document.title, $("#view h1").textContent, $("nav a[aria-current=page]") === null];
    window.marker = 1; $("#view a[href='/']").click(); await calm(800);
    return [...shown, location.pathname, document.title, $("#unlock-choose")?.hidden === false, window.marker === 1];`),
    ["Page not found · nōtonawa", "Page not found", true, "/", "Unlock · nōtonawa", true, true]);

  console.log("Offering to install the app");
  // Chrome hands over its install window by itself, as the manifest makes
  // the app installable. Clicking Install uses a stand-in for it, which
  // records being opened, so no real install window opens here.
  const offerInstall = `
    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.prompted = 0;
    event.prompt = async () => { window.prompted++; };
    event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event); await wait(100);`;
  const offerShown = `const box = $("#install-offer"); return [!box.hidden, box.querySelector("p")?.textContent ?? null,
    [...box.querySelectorAll("button")].map((b) => b.textContent)];`;
  await go("/");
  check("Chrome can install the app, so the journal offers it", await run(`
    for (let i = 0; i < 100 && $("#install-offer").hidden; i++) await wait(100); ${offerShown}`),
    [true, "Install nōtonawa as an app: it opens in a window of its own, with an icon on your home screen or dock.", ["Install", "Not now"]]);
  check("Install opens the browser's install window, once", await run(`
    ${offerInstall} $("#install-offer .install-now").click(); await wait(100);
    return [window.prompted, $("#install-offer").hidden];`), [1, true]);
  check("it isn't over Unlock or sign-in", await run(`
    ${offerInstall} const shown = !$("#install-offer").hidden;
    history.pushState(null, "", "/nope"); dispatchEvent(new PopStateEvent("popstate")); await calm(800);
    return [shown, $("#install-offer").hidden];`), [true, true]);
  await go("/");
  check("Not now hides it on this device, for good", await run(`
    ${offerInstall} $("#install-offer .install-later").click(); await wait(100);
    return [$("#install-offer").hidden, localStorage.getItem("install-dismissed")];`), [true, "1"]);
  await go("/");
  check("…even after the page loads again", await run(`${offerInstall} return $("#install-offer").hidden;`), true);
  await run(`localStorage.removeItem("install-dismissed");`);
}
