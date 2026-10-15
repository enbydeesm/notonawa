// A sealed (encrypted) field as the browser sends it: the right shape
// (see src/parse.js encryptedText), with the label inside so tests can tell
// values apart. The server can't open it either way; only the browser can.

/** @param {string} label */
export function sealed(label) {
  const body = btoa(label.padEnd(17, "_")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `e1.AAAAAAAAAAAAAAAA.${body}`;
}
