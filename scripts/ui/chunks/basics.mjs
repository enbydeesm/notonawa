// The walkthrough's basics chunk. Signing up and the app's shell: security headers, icons, sign-up, the welcome, moving between views, and the offer to install the app.

import { APP_VERSION } from "../../../public/js/releases.js";
import { BASE, HELP_LINE, account, check, go, newInvite, resetBrowser, run, sleep, sql } from "../harness.mjs";

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
    ["/img/logo-dark.avif", "max-age=604800"], ["/img/favicon.png", "max-age=604800"]]) {
    const res = await fetch(BASE + path);
    check(`${path}: cached (${cache}), with the security headers`, [res.headers.get("cache-control"), res.headers.get("x-frame-options")], [cache, "DENY"]);
  }
  console.log("Logo and icons");
  const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
  // Plain icons, and maskable ones (drawn to fill Android's shapes) in the same sizes.
  check("the manifest names the app and its icons", [manifest.name, manifest.icons.map((i) => `${i.sizes}${i.purpose ? ` ${i.purpose}` : ""}`)],
    ["NotoNawa", ["192x192", "512x512", "192x192 maskable", "512x512 maskable"]]);
  const page = await (await fetch(BASE + "/")).text();
  const linked = [...page.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)"/g)].map((m) => m[1]);
  check("the page links a tab icon and a home-screen icon", linked.length, 2);
  for (const path of [...linked, ...manifest.icons.map((i) => i.src)]) {
    const res = await fetch(BASE + path);
    check(`${path} is a PNG`, [res.status, res.headers.get("content-type")], [200, "image/png"]);
  }
  for (const path of ["/img/logo-light.avif", "/img/logo-dark.avif", "/img/bamboo-logo-light.avif", "/img/bamboo-logo-dark.avif"]) {
    const res = await fetch(BASE + path);
    check(`${path} is an AVIF`, [res.status, res.headers.get("content-type")], [200, "image/avif"]);
  }
  console.log("Signing up");
  await go("/");
  check("signed out, the journal goes to the sign-in page, without the nav, its title centered", await run(`
    return [location.pathname, visibleCard(), getComputedStyle($("nav")).display, getComputedStyle($("#view h1")).textAlign, logo("#view h1 .logo")];`),
    ["/signin", "choose", "none", "center", [true, "NotoNawa", "/img/logo-dark.avif"]]);
  check("…and only the mode's logo is downloaded, not the light one too, nor the menu's", await run(`
    return [fetched("/img/logo-light.avif"), fetched("/img/bamboo-logo-dark.avif")];`), [false, false]);
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
    $("#signup-form button[type=submit]").click(); await wait(300);
    return $("#adult").validity.valueMissing;`), true);
  const recoveryCode = await run(`
    $("#adult").checked = true; $("#consent").checked = true;
    $("#signup-form button[type=submit]").click(); await wait(2500);
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

  console.log("Welcome");
  const welcomeShown = `for (let i = 0; i < 30 && !$("dialog.welcome[open]"); i++) await wait(100); return !!$("dialog.welcome[open]");`;
  const hideWelcome = async () => (await run(`return (await (await fetch("/api/account/settings")).json()).hide_welcome;`));
  check("a new account is welcomed once the journal shows: WELCOME.md, with its email linked", await run(`
    ${welcomeShown.replace("return", "const open =")}
    const d = $("dialog.welcome[open]");
    return [open, d.querySelector("h2").textContent, d.querySelectorAll("li").length, d.querySelectorAll("li strong").length > 0,
      d.querySelector("a[href^=mailto]")?.getAttribute("href"), $("#welcome-hide").checked, $("#welcome-ok").textContent];`),
    [true, "Welcome to NōtoNawa, your secure tie planning and tracking journal.", 10, true, "mailto:contact@notonawa.app", false, "OK"]);
  check("OK without the box ticked closes it, and it stays on", await run(`
    $("#welcome-ok").click(); await wait(500); return [$("dialog") === null, (await (await fetch("/api/account/settings")).json()).hide_welcome];`),
    [true, false]);
  await go("/");
  check("so it's shown again after the next unlock; ticking \"Don't show this again\" saves that on the account", await run(`
    ${welcomeShown.replace("return", "const open =")}
    $("#welcome-hide").click(); $("#welcome-ok").click(); await wait(800);
    return [open, $("dialog") === null, (await (await fetch("/api/account/settings")).json()).hide_welcome];`),
    [true, true, true]);
  await go("/");
  check("…and not again", await run(`await wait(800); return $("dialog.welcome") === null;`), true);
  check("an account from before the welcome sees it too", [await hideWelcome(), sql("SELECT dflt_value FROM pragma_table_info('users') WHERE name = 'hide_welcome'")[0].dflt_value], [true, "0"]);
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
    window.marker = 1; $("nav a[href='/plans']").click(); await wait(800); ${viewState}`),
    ["/plans", "Plans · NotoNawa", "Plans", true, "Plans", true]);
  check("Back and Forward change the view, still without a page load", await run(`
    history.back(); await wait(800); const back = (() => { ${viewState} })();
    history.forward(); await wait(800); return [back, (() => { ${viewState} })()];`), [
    ["/", "NotoNawa", "NotoNawa", true, "Ties", true],
    ["/plans", "Plans · NotoNawa", "Plans", true, "Plans", true],
  ]);
  check("Back to the Ties list brings back its sort order", await run(`
    $("nav a[href='/']").click(); await wait(800); $("#sort").click(); await settle();
    $("nav a[href='/people']").click(); await wait(800); history.back(); await wait(800);
    return [location.pathname + location.search, $("#sort").getAttribute("aria-pressed"), window.marker === 1];`), ["/?sort=oldest", "true", true]);
  check("Back with a dialog open closes it", await run(`
    $("nav a[href='/']").click(); await wait(800); $("nav a[href='/locations']").click(); await wait(800);
    $(".nav-add").click(); await wait(600); const open = $("dialog[open] #tie-form") !== null;
    history.back(); await wait(800); return [open, $("dialog[open]") === null, location.pathname];`), [true, true, "/"]);
  check("the privacy policy opens in a new tab, leaving the app as it is", await run(`
    await openMenu(); const link = $(".menu-privacy"); const out = [link.target, link.rel]; $("dialog.menu-panel").close(); return out;`),
    ["_blank", "noopener"]);
  await go("/people");
  check("an address loaded directly (a bookmark or refresh) shows its view", await run(`
    return [document.title, $("#view h1").textContent, $("nav a[aria-current=page]")?.getAttribute("aria-label"), $("nav").hidden];`),
    ["People · NotoNawa", "People", "People", false]);
  await go("/nope");
  // "Not found" doesn't need the key, so after loading it the journal is
  // locked, and the ties ask to unlock first.
  check("an unknown address says so, and links back to the ties (to unlock first)", await run(`
    const shown = [document.title, $("#view h1").textContent, $("nav a[aria-current=page]") === null];
    window.marker = 1; $("#view a[href='/']").click(); await wait(800);
    return [...shown, location.pathname, document.title, $("#unlock-choose")?.hidden === false, window.marker === 1];`),
    ["Page not found · NotoNawa", "Page not found", true, "/", "Unlock · NotoNawa", true, true]);

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
    [true, "Install NōtoNawa as an app: it opens in a window of its own, with an icon on your home screen or dock.", ["Install", "Not now"]]);
  check("Install opens the browser's install window, once", await run(`
    ${offerInstall} $("#install-offer .install-now").click(); await wait(100);
    return [window.prompted, $("#install-offer").hidden];`), [1, true]);
  check("it isn't over Unlock or sign-in", await run(`
    ${offerInstall} const shown = !$("#install-offer").hidden;
    history.pushState(null, "", "/nope"); dispatchEvent(new PopStateEvent("popstate")); await wait(800);
    return [shown, $("#install-offer").hidden];`), [true, true]);
  await go("/");
  check("Not now hides it on this device, for good", await run(`
    ${offerInstall} $("#install-offer .install-later").click(); await wait(100);
    return [$("#install-offer").hidden, localStorage.getItem("install-dismissed")];`), [true, "1"]);
  await go("/");
  check("…even after the page loads again", await run(`${offerInstall} return $("#install-offer").hidden;`), true);
  await run(`localStorage.removeItem("install-dismissed");`);
}
