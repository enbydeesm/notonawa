// Applies the last light/dark mode this device showed (dark if none) before
// the page draws, so it never shows the wrong colors first. Once signed in,
// the account's mode replaces it (settings.js). A plain script loaded in
// <head> (not a module, which would wait for the page), and a file because
// the CSP doesn't allow inline scripts. The key and values match theme.js.
let theme = "dark";
try {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") theme = stored;
} catch {
  // Storage blocked: dark, as for a new account.
}
document.documentElement.dataset.theme = theme;
