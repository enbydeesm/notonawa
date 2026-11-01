// The walkthrough's lock chunk. Locking and unlocking: the passkey, the recovery code, setting up a key, and after the operator's reset.

import { HELP_LINE, account, check, freshAccount, go, run, script, send, sleep, sql } from "../harness.mjs";

export default async function () {
  const recoveryCode = await freshAccount();
  console.log("Locking and unlocking");
  const keysNow = () => run(`const k = await (await fetch("/api/keys")).json();
    return [k.has_key, k.passkey !== null, k.recovery?.current ?? null];`);
  check("signing up made a key, wrapped for the passkey and the recovery code", await keysNow(), [true, true, true]);
  // What the visible view is: its heading, and the Unlock card showing (if any).
  const shown = `return [document.title, $("#view h1").textContent || $("#view h1 .logo")?.getAttribute("aria-label"), getComputedStyle($("nav")).display === "none",
    [...document.querySelectorAll("#view > section.card")].find((c) => !c.hidden)?.id ?? null, $("#tie-count") !== null];`;
  // Watching from the page's very start whether the nav is ever shown
  // while it loads (it's drawn before the view is chosen).
  const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.navShownWhileLoading = false;
    new MutationObserver(() => {
      const nav = document.querySelector("main > nav");
      if (nav && !nav.hidden) window.navShownWhileLoading = true;
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });` });
  await go("/plans", { unlock: false });
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  check("loading a page locks the journal: Unlock shows instead, at the same address, without the nav, not even while it loads", await run(`
    return [location.pathname, ...(() => { ${shown} })(), window.navShownWhileLoading];`),
    ["/plans", "Unlock · NotoNawa", "NotoNawa", true, "unlock-choose", false, false]);
  check("Unlock shows the logo", await run(`return logo("#view h1 .logo");`), [true, "NotoNawa", "/img/logo-dark.avif"]);
  check("Unlock says who to email for help, on its own centred line", await run(HELP_LINE),
    ["Trouble signing in?\nEmail contact@notonawa.app for assistance.", "mailto:contact@notonawa.app", true, "center"]);
  check("unlocking with the passkey shows the page, and sends no PRF output anywhere", await run(`
    const sent = []; const realFetch = window.fetch;
    window.fetch = (url, options) => { sent.push([String(url), options?.body ?? ""]); return realFetch(url, options); };
    $("#unlock-passkey").click(); await wait(2500); window.fetch = realFetch;
    const login = JSON.parse(sent.find(([url]) => url.endsWith("/api/auth/login/verify"))[1]);
    return [location.pathname, document.title, $("#view h1").textContent, login.prf, JSON.stringify(login.response.clientExtensionResults),
      sent.some(([, body]) => body.includes("results"))];`),
    ["/plans", "Plans · NotoNawa", "Plans", true, JSON.stringify({ prf: {} }), false]);
  await go("/", { unlock: false });
  check("the recovery code unlocks too; a wrong one says so", await run(`
    [...document.querySelectorAll("[data-unlock-show=code]")][0].click(); await wait(100);
    $("#unlock-code-input").value = "0000-0000-0000-0000-0000-0000-0000-0000"; $("#unlock-code-form button[type=submit]").click(); await wait(1200);
    const wrong = $("#unlock-code-message").textContent;
    $("#unlock-code-input").value = ${JSON.stringify(account.currentCode)}; $("#unlock-code-form button[type=submit]").click(); await wait(1500);
    return [wrong, $("#tie-count") !== null, leakyFields()];`),
    ["That recovery code doesn't unlock your journal.", true, []]);
  check("nothing is kept in the browser's storage but the theme", await run(`
    return [Object.keys(localStorage).filter((k) => k !== "theme"), sessionStorage.length, (await indexedDB.databases()).length];`),
    [[], 0, 0]);

  // An account from before encryption: no key yet.
  const userId = await run(`return (await (await fetch("/api/keys")).json()).user_id;`);
  sql(`DELETE FROM key_wraps WHERE user_id = '${userId}'`);
  await go("/", { unlock: false });
  check("an account without a key is asked to set one up after the passkey", await run(`
    $("#unlock-passkey").click(); await wait(2500); return [...(() => { ${shown} })()].slice(3);`), ["unlock-setup", false]);
  const setupCode = await run(`
    $("#unlock-setup-go").click(); await wait(2000); const code = $("#recovery-code")?.textContent;
    $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1500); return code;`);
  check("setting up shows a new recovery code, then the journal", [setupCode !== recoveryCode, await run(`return $("#tie-count") !== null;`)], [true, true]);
  check("…and the key is wrapped for both again", await keysNow(), [true, true, true]);
  account.currentCode = setupCode ?? "";

  // The operator gives the account a new recovery code (someone locked out).
  const operatorCode = script("recovery-code.mjs", userId, "--quiet");
  check("after the operator's reset, the recovery wrap no longer matches the code", await keysNow(), [true, true, false]);
  await go("/", { unlock: false });
  const afterReset = await run(`
    $("#unlock-passkey").click(); await wait(3000);
    const shownCode = $("#recovery-code")?.textContent; const intro = $("dialog[open] p")?.textContent;
    $("#recovery-saved").click(); $("dialog[open] button.primary").click(); await wait(1200);
    return [shownCode, intro, $("#tie-count") !== null];`);
  check("unlocking with the passkey then makes a new code, as the old one shouldn't keep working",
    [afterReset[0] !== operatorCode && /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(afterReset[0] ?? ""), afterReset[1], afterReset[2]],
    [true, "Your recovery code was replaced, so here's a new one that also unlocks your journal.", true]);
  check("…and the recovery wrap matches again", await keysNow(), [true, true, true]);
  account.currentCode = afterReset[0] ?? "";

  // A deploy while the page was open: the server's version is faked newer
  // by answering /api/version for it. A mark on the page tells whether it
  // was reloaded (a reload loses it).
  console.log("Reloading after a deploy");
  const fakeNewer = (then) => run(`
    window.oldPage = true; const realFetch = window.fetch;
    window.fetch = (url, options) => String(url).endsWith("/api/version")
      ? Promise.resolve(new Response(JSON.stringify({ version: "9999.01.01.001" }), { headers: { "content-type": "application/json" } }))
      : realFetch(url, options);
    ${then}`);
  const afterwards = async () => { await sleep(2500); return run(`return [window.oldPage === true, location.pathname, $("#unlock-choose") !== null];`); };
  await go("/plans", { unlock: false });
  check("Unlock doesn't reload when the server is on this page's version", await run(`
    window.oldPage = true; document.dispatchEvent(new Event("visibilitychange")); await wait(800);
    return window.oldPage === true;`), true);
  await fakeNewer(`document.dispatchEvent(new Event("visibilitychange"));`);
  check("…but on a newer one, coming back to the page reloads it, still locked at the same address", await afterwards(), [false, "/plans", true]);
  await fakeNewer(`$("#unlock-passkey").click();`);
  check("…and tapping Unlock reloads it rather than unlocking the old version", await afterwards(), [false, "/plans", true]);
  await run(`await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });`);
  await go("/signin", { unlock: false });
  await fakeNewer(`document.dispatchEvent(new Event("visibilitychange"));`);
  check("…and the sign-in page reloads too", await afterwards(), [false, "/signin", false]);
}
