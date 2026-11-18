// The walkthrough's settings chunk. The ☰ menu, Bug and feedback, What's new, and Settings: light/dark mode and role names.

import { APP_VERSION, RELEASES } from "../../../public/js/releases.js";
import { check, freshAccount, go, run, script, send } from "../harness.mjs";

export default async function () {
  await freshAccount();
  console.log("Menu and Settings");
  const deviceMode = (value) => send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
  // Background colour, data-theme, the mode kept on this device, and the account's.
  const themeState = `return [getComputedStyle(document.body).backgroundColor, document.documentElement.dataset.theme ?? null,
    localStorage.getItem("theme"), (await (await fetch("/api/account/settings")).json()).theme];`;
  const openSettings = `if (!$("dialog.menu-panel[open]")) await openMenu(); $(".menu-settings").click(); await calm(500);`;
  const settingsState = `return [$("dialog.menu-panel") === null, $("#settings-title")?.textContent ?? null,
    $("#settings-dark")?.getAttribute("aria-checked") ?? null,
    [...document.querySelectorAll(".settings-form label")].map((l) => l.textContent),
    [$("#settings-top")?.value, $("#settings-top")?.placeholder, $("#settings-bottom")?.value, $("#settings-bottom")?.placeholder]];`;
  const menuGone = `await calm(300); return $("dialog") === null;`;
  // Real key presses and taps (not events made by the page), as the browser
  // handles Esc and the backdrop itself.
  const key = async (type) => send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const tap = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const LIGHT_BG = "rgb(250, 248, 245)";
  const DARK_BG = "rgb(22, 21, 20)";
  // The device's own setting no longer matters: a light device starts dark.
  await deviceMode("light");
  await go("/");
  check("the menu button sits in the corner, after the +", await run(`
    const nav = [...document.querySelector("nav").children];
    return [nav.slice(-2).map((el) => el.className), document.querySelectorAll(".nav-menu svg line").length, $("dialog") === null];`),
    [["nav-add", "nav-icon nav-menu"], 3, true]);
  check("once unlocked, the logo and the other views' code load ahead, before the menu or a view is opened", await run(`
    const ready = () => ["/img/logo-mark.svg", "/img/logo-word.svg"].every((f) => fetched(f) || loadedImage(f)) && ["plans", "people", "locations", "calendar", "analytics", "education", "account", "data"]
      .every((v) => fetched("/js/views/" + v + ".js"));
    for (let i = 0; i < 50 && !ready(); i++) await wait(100);
    return [ready(), fetched("/js/views/open.js"), $("dialog.menu-panel") === null];`), [true, false, true]);
  check("the menu opens with the logo, Settings (a gear), Account, Your data, Bug and feedback, What's new, Privacy Policy and Sign Out", await run(`
    await openMenu();
    // Install app is there only when this Chrome offers installing (checked below).
    return [$(".menu-title .logo").getAttribute("aria-label"), [...document.querySelectorAll(".menu-item:not(.menu-install)")].map((el) => [el.tagName, el.textContent, el.querySelector("svg") !== null]),
      $(".menu-settings svg circle") !== null, $(".nav-account").getAttribute("href"), $(".menu-privacy").getAttribute("href")];`),
    ["NotoNawa", [["BUTTON", "Settings", true], ["A", "Account", true], ["A", "Your data", true], ["BUTTON", "Tutorial", true], ["BUTTON", "Bug and feedback", true], ["BUTTON", "What's new", true],
      ["A", "Privacy Policy", true], ["BUTTON", "Sign Out", true]],
      true, "/account", "/privacy"]);
  check("Tutorial, Bug and feedback, What's new, Privacy Policy, Sign Out and the version sit at the bottom of the panel", await run(`
    const box = (sel) => $(sel).getBoundingClientRect();
    const panel = box(".menu-inner"), tutorial = box(".menu-tutorial"), feedback = box(".menu-feedback"), news = box(".menu-whats-new"),
      privacy = box(".menu-privacy"), out = box(".menu-sign-out"), version = box(".app-version");
    return [Math.round(panel.bottom - version.bottom), version.top > out.bottom, Math.round(out.top - privacy.bottom), Math.round(privacy.top - news.bottom),
      Math.round(news.top - feedback.bottom), Math.round(feedback.top - tutorial.bottom), tutorial.top - box(".nav-data").bottom > 100,
      $(".menu-inner .app-version").textContent];`),
    [16, true, 0, 0, 0, 0, true, `Version ${APP_VERSION}`]);
  check("once the browser can install it, Install app is first in the bottom group, even after Not now, and opens the browser's install window", await run(`
    $("dialog.menu-panel").close(); await calm(200);
    localStorage.setItem("install-dismissed", "1");
    // What Chrome and Edge hand over when the app can be installed.
    const event = new Event("beforeinstallprompt", { cancelable: true });
    let prompted = false;
    event.prompt = async () => { prompted = true; }; event.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(event);
    await openMenu();
    const box = (sel) => $(sel).getBoundingClientRect();
    const shown = [$(".menu-install")?.textContent, !!$(".menu-install svg rect"),
      $(".menu-install").nextElementSibling === $(".menu-tutorial"), Math.round(box(".menu-tutorial").top - box(".menu-install").bottom),
      box(".menu-install").top - box(".nav-data").bottom > 50];
    $(".menu-install").click(); await calm(300);
    const done = [prompted, $("dialog.menu-panel") === null];
    localStorage.removeItem("install-dismissed");
    await openMenu();
    return [shown, done];`), [["Install app", true, true, 0, true], [true, true]]);
    check("Tutorial's icon is a lightbulb with a question mark, and it opens the welcome tour from its start in place of the menu", await run(`
    const icon = $(".menu-tutorial svg");
    const parts = [icon.querySelectorAll("path").length, icon.querySelectorAll("circle").length];
    $(".menu-tutorial").click(); await calm(400);
    const opened = [$("dialog.menu-panel") === null, !!$("dialog.tour[open]"), $("dialog.tour[open] h2")?.textContent];
    $("dialog.tour[open] .tour-skip").click(); await calm(300);
    const closed = $("dialog[open]") === null;
    await openMenu();
    return [parts, opened, closed];`), [[3, 1], [true, true, "Welcome to NōtoNawa"], true]);
  check("Bug and feedback's icon is a speech bubble with a small bug at its bottom left", await run(`
    const icon = $(".menu-feedback svg"); const bug = icon.querySelector("ellipse");
    return [icon.querySelectorAll("path").length, Number(bug.getAttribute("cx")) < 12 && Number(bug.getAttribute("cy")) > 12];`), [2, true]);
  check("Bug and feedback opens its form in place of the menu: a warning, a blank kind to choose, the message, an email link", await run(`
    $(".menu-feedback").click(); await calm(400);
    const d = $("dialog.feedback[open]");
    return [$("dialog.menu-panel") === null, d.querySelector("h2").textContent, d.querySelector(".warning-note").textContent.startsWith("Please don't include journal details"),
      [...$("#feedback-kind").options].map((o) => o.text), $("#feedback-kind").value, $("#feedback-kind").required, $("#feedback-message").maxLength,
      $("#feedback-mailto").getAttribute("href"), dialogButtons(), leakyFields()];`),
    [true, "Bug and feedback", true, ["", "Bug", "Idea"], "", true, 2000,
      "mailto:contact@notonawa.app?subject=" + encodeURIComponent(`NotoNawa feedback (version ${APP_VERSION})`), ["Submit", "Cancel"], []]);
  check("it can't be sent without choosing bug or idea", await run(`
    $("#feedback-message").value = "x"; $("#feedback-submit").click(); await calm(300);
    return [$("#feedback-kind").validity.valueMissing, $("#feedback-status").textContent];`), [true, ""]);
  check("sent, it says thank you; the message is saved with the app's version", await run(`
    set("#feedback-kind", "bug"); $("#feedback-message").value = "Smoke test report"; $("#feedback-message").dispatchEvent(new Event("input"));
    const count = $("#feedback-count").textContent;
    $("#feedback-submit").click(); await calm(800);
    const thanks = [$("dialog.feedback h2").textContent, $("#feedback-thanks").textContent];
    $("#feedback-done").click(); await calm(300);
    return [count, thanks, $("dialog") === null];`), ["17 / 2000", ["Thank you!", "We got your message."], true]);
  check("…which scripts/feedback.mjs lists", script("feedback.mjs").includes(`bug  from ${await run(`return (await (await fetch("/api/keys")).json()).user_id;`)}  (version ${APP_VERSION})\n  Smoke test report`), true);
  check("Cancel closes it", await run(`
    await openMenu(); $(".menu-feedback").click(); await calm(300); $("#feedback-cancel").click(); await calm(300); return $("dialog") === null;`), true);
  check("What's new shows the release notes, newest first, with intros and sub-bullets, in place of the menu", await run(`
    await openMenu(); $(".menu-whats-new").click(); await calm(400);
    const d = $("dialog.whats-new[open]");
    const shown = [$("dialog.menu-panel") === null, d.querySelector("h2").textContent, [...d.querySelectorAll("h3")].map((h) => h.textContent),
      d.querySelectorAll(".release")[0].querySelectorAll(":scope > ul > li").length,
      d.querySelectorAll(".release")[0].querySelectorAll(".release-intro").length, d.querySelectorAll(".release")[0].querySelectorAll("li li").length];
    $("#whats-new-ok").click(); await calm(300);
    return [...shown, $("dialog") === null];`),
    [true, "What's new", RELEASES.slice(0, 10).map((r) => r.version), RELEASES[0].notes.length, RELEASES[0].intro?.length ?? 0,
      RELEASES[0].notes.reduce((n, note) => n + (typeof note === "string" ? 0 : note.sub.length), 0), true]);
  check("from the menu, What's new opens at the top, the newest, and its ✕ closes it", await run(`
    await openMenu(); $(".menu-whats-new").click(); await calm(400);
    const d = $("dialog.whats-new[open]"), top = d.scrollTop, scrolls = d.scrollHeight > d.clientHeight;
    $("#whats-new-close").click(); await calm(300);
    return [top, scrolls, $("dialog") === null];`), [0, true, true]);
  await run(`await openMenu();`);
  check("the panel is on the right, full height", await run(`
    const r = $("dialog.menu-panel").getBoundingClientRect();
    return [Math.round(r.right) === innerWidth, Math.round(r.top), Math.round(r.height) === innerHeight, r.left > 0];`), [true, 0, true, true]);
  check("the logo is at the top of the menu", await run(`
    return [...logo(".menu-title .logo"), $(".menu-inner").firstElementChild === $(".menu-title")];`), [true, "NotoNawa", ["/img/logo-mark.svg", "/img/logo-word.svg"], ["rgb(254, 199, 98)", "rgb(238, 238, 238)"], true]);
  await key("keyDown"); await key("keyUp");
  check("Esc closes the menu", await run(menuGone), true);
  await run(`await openMenu();`);
  await tap("mousePressed", 5, 300); await tap("mouseReleased", 5, 300);
  check("tapping beside the panel closes it", await run(menuGone), true);
  check("a new account has seen this version's notes, so nothing pops up", await run(`
    return [(await (await fetch("/api/account/settings")).json()).seen_release, $("dialog.whats-new") === null];`), [APP_VERSION, true]);
  // As if the app was updated since I last saw its notes.
  await run(`await fetch("/api/account/settings", { method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ seen_release: "2000.01.01.001" }) });`);
  await go("/");
  check("after an update, unlocking shows one dialog with every release since, newest first; closing it marks them seen", await run(`
    for (let i = 0; i < 20 && !$("dialog.whats-new[open]"); i++) await wait(100);
    const versions = [...document.querySelectorAll("dialog.whats-new[open] h3")].map((h) => h.textContent);
    $("#whats-new-ok").click(); await calm(600);
    return [versions, $("dialog") === null, (await (await fetch("/api/account/settings")).json()).seen_release];`),
    [RELEASES.slice(0, 10).map((r) => r.version), true, APP_VERSION]);
  await go("/");
  check("…and not again", await run(`await calm(500); return $("dialog.whats-new") === null;`), true);
  check("a new account is dark, on a light device too, and saved as dark", await run(themeState), [DARK_BG, "dark", "dark", "dark"]);
  check("Settings replaces the menu with its dialog: the dark mode switch, then the role names, empty with muted defaults",
    await run(`${openSettings} ${settingsState}`),
    [true, "Settings", "true", ["Dark mode", "Person tying is called:", "Person being tied is called:"], ["", "top", "", "bottom"]]);
  check("the switch changes the mode at once, and saves it to the account", await run(`
    $("#settings-dark").click(); await calm(800);
    return [$("#settings-dark").getAttribute("aria-checked"), ...(await (async () => { ${themeState} })())];`),
    ["false", LIGHT_BG, "light", "light", "light"]);
  check("Cancel closes the dialog, keeping the mode", await run(`
    $(".settings-dialog .dialog-cancel").click(); await calm(300); ${themeState}`), [LIGHT_BG, "light", "light", "light"]);
  check("in light mode the menu's logo is all in light mode's dark text", await run(`
    await openMenu(); const shown = logo(".menu-title .logo");
    $("dialog.menu-panel").close(); await calm(300); return shown;`),
    [true, "NotoNawa", ["/img/logo-mark.svg", "/img/logo-word.svg"], ["rgb(34, 34, 34)", "rgb(34, 34, 34)"]]);
  await run(`localStorage.removeItem("theme");`);
  await go("/plans");
  check("another device (nothing kept in the browser) gets the account's mode once unlocked", await run(themeState),
    [LIGHT_BG, "light", "light", "light"]);
  check("two roles can't have the same name", await run(`
    ${openSettings} $("#settings-top").value = "Rope"; $("#settings-bottom").value = "rope"; $("#settings-save").click(); await calm(800);
    return [$("#settings-message").textContent, $(".settings-dialog") !== null];`),
    ["Couldn't save: Give the two roles different names.", true]);
  check("saved role names are used everywhere at once: the tie form, People, Analytics", await run(`
    $("#settings-top").value = " rigger "; $("#settings-bottom").value = "Rope bunny"; $("#settings-save").click(); await calm(1200);
    const saved = [$(".settings-dialog") === null, await store.getSettings()];
    // Saving redraws the view, which closes any dialog: wait for it to finish
    // before opening the tie form, then for the form's first role box.
    await calm(1500);
    $(".nav-add").click(); await calm(600);
    // A person row (with its role box) appears once one is added.
    $("#tie-add-participant").click();
    for (let i = 0; i < 50 && !document.querySelector("dialog[open] .role"); i++) await wait(100);
    const tieRoles = [...(document.querySelector("dialog[open] .role")?.options ?? [])].map((o) => o.textContent);
    await closeDiscarding("#tie-close"); await calm(300);
    return [saved, tieRoles];`),
    [[true, { top_label: "rigger", bottom_label: "Rope bunny", theme: "light", seen_release: APP_VERSION, hide_welcome: true, default_shape: null }],
      ["Choose Role", "Rigger", "Rope bunny", "Self tie", "Spotter", "Photographer"]]);
  await go("/analytics");
  check("…the Analytics role filter and numbers", await run(`
    return [[...$("#role").options].map((o) => o.text), [...document.querySelectorAll("#insights-stats dt")].map((d) => d.textContent).filter((t) => t.startsWith("As"))];`),
    [["All roles", "As rigger", "As Rope bunny", "As self tie", "As spotter", "As photographer"], ["As rigger", "As Rope bunny"]]);
  check("blank names go back to top and bottom", await run(`
    ${openSettings} $("#settings-top").value = ""; $("#settings-bottom").value = ""; $("#settings-save").click(); await calm(1200);
    return [await store.getSettings(), [...$("#role").options].map((o) => o.text).slice(1, 3)];`),
    [{ top_label: null, bottom_label: null, theme: "light", seen_release: APP_VERSION, hide_welcome: true, default_shape: null }, ["As top", "As bottom"]]);
  // Back to dark, the default.
  await run(`${openSettings} $("#settings-dark").click(); await calm(800); $(".settings-dialog .dialog-cancel").click(); await calm(300);`);
  check("…and back to dark", await run(themeState), [DARK_BG, "dark", "dark", "dark"]);
  check("…with the logo's pencil in the accent and its name in light text in the menu", await run(`
    await openMenu(); const shown = logo(".menu-title .logo");
    $("dialog.menu-panel").close(); await calm(300); return shown;`),
    [true, "NotoNawa", ["/img/logo-mark.svg", "/img/logo-word.svg"], ["rgb(254, 199, 98)", "rgb(238, 238, 238)"]]);
}
