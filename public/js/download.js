// Saving a file the page made (an export) to the user's device.

/**
 * @param {string} name file name, e.g. rope-journal-2026-10-13.json
 * @param {string} text
 * @param {string} type e.g. application/json
 */
export function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download, then let go of the
  // copy (it holds the whole journal).
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
