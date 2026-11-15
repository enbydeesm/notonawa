// The walkthrough's account chunk. The Account page, signing in and out, recovery, notices and policy changes, and deleting the account.

import { account, check, freshAccount, go, replaceAuthenticator, run, sleep, sql } from "../harness.mjs";

export default async function () {
  const recoveryCode = await freshAccount();
  // A tie, to see the journal again after signing back in.
  await run(`await store.saveTie(null, { title: "Before signing out", tie_type: "floor", tie_date: "2026-01-01" });`);
  console.log("Account");
  await go("/account");
  check("the account page lists the passkey and this session as grids, with icons to act on them", await run(`
    await openMenu(); const current = $(".nav-account").getAttribute("aria-current"); $("dialog.menu-panel").close();
    const heads = (sel) => [...$(sel).querySelectorAll("th")].map((t) => t.textContent);
    return [current, heads("#passkeys"), [...$("#passkeys").querySelectorAll(".passkey-name")].map((t) => t.textContent),
      heads("#sessions"), [...$("#sessions").querySelectorAll(".session-with")].map((t) => [t.firstChild.textContent, t.querySelector(".badge")?.textContent]),
      [...$("#passkeys").querySelectorAll("button")].map((b) => b.getAttribute("aria-label")), $("#sessions button") === null,
      $("#end-others").hidden, $("#recovery-status").textContent];`),
    ["page", ["Passkey", "Added", "Last used", "Actions"], ["Test phone"], ["Signed in with", "Since", "Last active", "Actions"],
      [["Test phone", "This device"]], ['Rename "Test phone"'], true, true, "You have a recovery code. Making a new one replaces it."]);
  check("rename a passkey with its pencil", await run(`
    $("#passkeys .passkey-rename").click(); await calm(300);
    const leaky = leakyFields(); $("#rename-input").value = "Phone"; $("dialog[open] button[type=submit]").click(); await calm(800);
    return [leaky, [...$("#passkeys").querySelectorAll(".passkey-name")].map((t) => t.textContent)];`), [[], ["Phone"]]);
  check("the recovery email's i button shows and hides its explanation", await run(`
    const button = $("#email-info-button"); const shown = () => [button.getAttribute("aria-expanded"), !$("#email-info").hidden];
    const before = shown(); button.click(); const open = shown(); button.click();
    return [$("#email-form").hidden, $("#email-actions").hidden, before, open, shown()];`),
    [false, true, ["false", false], ["true", true], ["false", false]]);
  check("a recovery email typed differently twice isn't saved", await run(`
    $("#recovery-email").value = "sam@example.com"; $("#recovery-email-again").value = "sam@example.org";
    $("#email-form button[type=submit]").click(); await calm(500);
    return [$("#email-message").textContent, (await (await fetch("/api/account")).json()).has_recovery_email];`),
    ["The two addresses don't match.", false]);
  check("set a recovery email: only 'set' is shown, with Change and Remove", await run(`
    $("#recovery-email-again").value = " Sam@Example.com"; $("#email-form button[type=submit]").click(); await calm(2500);
    return [$("#email-message").textContent, $("#email-form").hidden, $("#email-actions").hidden, $("#recovery-email").value,
      (await (await fetch("/api/account")).json()).has_recovery_email];`),
    ["Saved.", true, false, "", true]);
  check("Change shows the form with Cancel; Remove asks first, then removes it", await run(`
    $("#email-change").click(); const changing = [$("#email-form").hidden, $("#email-cancel").hidden, $("#email-actions").hidden];
    $("#email-cancel").click(); const back = [$("#email-form").hidden, $("#email-actions").hidden];
    $("#email-remove").click(); await calm(300); await clickDialog("Remove"); await calm(800);
    return [changing, back, $("#email-form").hidden, (await (await fetch("/api/account")).json()).has_recovery_email];`),
    [[false, false, true], [true, false], false, false]);
  const newRecovery = await run(`
    $("#new-code").click(); await calm(300); await clickDialog("Make a new code"); await calm(2500);
    const code = $("#recovery-code").textContent; await finishRecoveryDialog(); return code;`);
  check("make a new recovery code, shown once", [/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(newRecovery ?? ""), newRecovery !== recoveryCode], [true, true]);
  account.currentCode = newRecovery ?? "";
  await run(`$("#sign-out").click();`);
  await sleep(1500);
  check("sign out goes to the sign-in page, without the nav, and the journal stays locked", await run(`
    return [location.pathname, $("nav").hidden, document.title, (await fetch("/api/tags")).status];`), ["/signin", true, "Sign in · NotoNawa", 401]);

  console.log("Signing in");
  await go("/signin");
  await run(`$("#sign-in").click();`);
  await sleep(2500);
  check("sign in with the passkey", await run(`return [location.pathname, $("#tie-count").textContent];`), ["/", "Showing 1 of 1"]);
  await run(`await openMenu(); $(".menu-sign-out").click();`);
  await sleep(1500);
  check("Sign Out in the menu signs out too, and locks the journal", await run(`
    return [location.pathname, $("nav").hidden, (await fetch("/api/tags")).status, document.documentElement.dataset.theme];`),
    ["/signin", true, 401, "dark"]);
  await go("/signin");
  await run(`$("#sign-in").click();`);
  await sleep(2500);
  check("…and signing in again works", await run(`return [location.pathname, $("#tie-count").textContent];`), ["/", "Showing 1 of 1"]);

  console.log("Recovery");
  // Lose the phone: its passkey is gone. The new device has a new
  // authenticator, one without PRF: it can sign in but not unlock.
  await replaceAuthenticator({ prf: false });
  await run(`await fetch("/api/auth/logout", { method: "POST" });`);
  await go("/signin");
  check("signing in without a passkey for this site fails gently", await run(`
    $("#sign-in").click(); await calm(2500); return [location.pathname, $("#sign-in-message").className];`), ["/signin", "message error"]);
  check("the replaced recovery code no longer works", await run(`
    [...document.querySelectorAll("[data-show=recover]")][0].click(); $("#code").value = ${JSON.stringify(recoveryCode)};
    $("#recover-form button[type=submit]").click(); await calm(1200); return $("#recover-message").textContent;`),
    "That recovery code didn't work.");
  check("the current one signs in, but only to add a passkey", await run(`
    $("#code").value = ${JSON.stringify((newRecovery ?? "").toLowerCase().replace(/-/g, " "))};
    $("#recover-form button[type=submit]").click(); await calm(1200);
    return [visibleCard(), (await fetch("/api/tags")).status, leakyFields()];`), ["add-passkey", 403, []]);
  const shownAfterRecovery = await run(`
    $("#new-passkey-name").value = "New phone"; $("#add-passkey-form button[type=submit]").click(); await calm(2500);
    const shown = recoveryDialog()[0]; $("#recovery-saved").click(); $("dialog[open] button.primary").click(); return shown;`);
  await sleep(1500);
  check("adding a passkey finishes signing in, unlocked with the code, with a new recovery code", [
    /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(shownAfterRecovery ?? ""),
    ...await run(`return [location.pathname, $("#tie-count").textContent];`),
  ], [true, "/", "Showing 1 of 1"]);
  account.currentCode = shownAfterRecovery ?? "";
  await go("/account", { unlock: false });
  check("a passkey that can't unlock signs in, then asks for the recovery code", await run(`
    $("#unlock-passkey").click(); await calm(2500);
    const why = [$("#unlock-code").hidden, $("#unlock-code-why").textContent];
    $("#unlock-code-input").value = ${JSON.stringify(shownAfterRecovery)}; $("#unlock-code-form button[type=submit]").click(); await calm(1500);
    return [...why, $("#view h1").textContent];`),
    [false, "This passkey can't unlock your journal (its device doesn't support it), so use your recovery code.", "Account"]);
  check("the account page says which passkeys unlock", await run(`
    return [...$("#passkeys").querySelectorAll(".passkey-row")].map((i) => [i.querySelector(".passkey-name").textContent, i.querySelector(".passkey-unlocks").textContent]);`),
    [["Phone", "Unlocks your journal"], ["New phone", "Signs in only: unlock with your recovery code (once, if it can unlock after that)"]]);
  check("the lost phone's passkey can then be removed", await run(`
    const before = [...$("#passkeys").querySelectorAll(".passkey-name")].map((t) => t.textContent);
    const phone = [...$("#passkeys").querySelectorAll(".passkey-row")].find((i) => i.querySelector(".passkey-name").textContent === "Phone");
    phone.querySelector(".passkey-remove").click(); await calm(300);
    await clickDialog("Remove passkey"); await calm(800);
    return [before, [...$("#passkeys").querySelectorAll(".passkey-name")].map((t) => t.textContent)];`),
    [["Phone", "New phone"], ["New phone"]]);

  console.log("Notices and policy changes");
  const myId = await run(`return (await (await fetch("/api/keys")).json()).user_id;`);
  sql(`INSERT INTO notices (id, user_id, message, level, link) VALUES
    ('n-all', NULL, 'Maintenance tonight. It''s short.', 'info', 'privacy'), ('n-me', '${myId}', 'Just for you', 'warning', NULL)`);
  await go("/");
  const noticeTexts = `[...document.querySelectorAll("#notices .notice p")].map((p) => p.textContent)`;
  check("notices show over the journal as text, with a policy link, and stay dismissed", await run(`
    const shown = ${noticeTexts}; const link = $("#notices a")?.getAttribute("href");
    const warnings = document.querySelectorAll("#notices .notice.warning").length;
    $("#notices .notice-dismiss").click(); await calm(500);
    return [shown, link, warnings, ${noticeTexts}];`),
    [["Maintenance tonight. It's short. Read the privacy policy", "Just for you"], "/privacy.html", 1, ["Just for you"]]);
  await go("/plans");
  check("…after a reload too", await run(`return ${noticeTexts};`), ["Just for you"]);

  // The notice for everyone would show in the chunks after this one too.
  sql("DELETE FROM notices WHERE id = 'n-all'");

  sql(`UPDATE users SET terms_version = '2000-01-01T00:00:00Z' WHERE id = '${myId}'`);
  await go("/");
  check("a changed policy must be agreed to; nothing is saved till then, but export still opens", await run(`
    const first = [document.title, $("#consent-go").disabled, $("nav").hidden, $("#notices").hidden];
    const save = await store.saveItem("people", null, { name: "Nope" }).then(() => "saved", () => "refused");
    $("#view a[href='/data']").click(); await calm(1000); const data = document.title;
    history.back(); await calm(1000); const back = document.title;
    $("#consent-agree").click(); const enabled = !$("#consent-go").disabled;
    $("#consent-go").click(); await calm(1500);
    const after = [document.title, $("#tie-count") !== null, (await (await fetch("/api/consent")).json()).needed];
    return [first, save, data, back, enabled, after];`),
    [["Privacy policy update · NotoNawa", true, true, true], "refused", "Your data · NotoNawa", "Privacy policy update · NotoNawa", true,
      ["NotoNawa", true, false]]);

  console.log("Deleting the account");
  await go("/account");
  check("delete warns it can't be undone, on its own line in bold, and needs typing 'delete'", await run(`
    $("#delete-account").click(); await calm(300);
    const before = $("dialog[open] button.danger.solid").disabled; const leaky = leakyFields();
    const warning = $("dialog[open] .warning-line"); const warned = [warning?.textContent, getComputedStyle(warning).fontWeight];
    $("#delete-confirm").value = "delet"; $("#delete-confirm").dispatchEvent(new Event("input"));
    const almost = $("dialog[open] button.danger.solid").disabled;
    $("#delete-confirm").value = "Delete"; $("#delete-confirm").dispatchEvent(new Event("input"));
    return [before, almost, $("dialog[open] button.danger.solid").disabled, leaky, warned];`), [true, true, false, [], ["THIS CAN'T BE UNDONE.", "700"]]);
  check("deleting the account empties it and signs out", await run(`
    $("dialog[open] button.danger.solid").click(); await calm(1500);
    return [$("h1").textContent, (await fetch("/api/tags")).status];`), ["Account deleted", 401]);
  await go("/signin");
}
