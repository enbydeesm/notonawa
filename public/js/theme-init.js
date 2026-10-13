// Applies a saved light/dark choice before the page draws, so it never shows
// the wrong colors first. A plain script loaded in <head> (not a module, which
// would wait for the page), and a file because the CSP doesn't allow inline
// scripts. The key and values match theme.js.
try {
  const choice = localStorage.getItem("theme");
  if (choice === "light" || choice === "dark") document.documentElement.dataset.theme = choice;
} catch {
  // Storage blocked: follow the device.
}
