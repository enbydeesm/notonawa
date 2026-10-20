// Links typed into the journal (a tie's or plan's photo album). Pure, so
// it's easy to test. An album link is encrypted, so the server can't check
// it: the page checks it before sealing it, and again before making one
// clickable.

/** What the album fields' pattern attribute accepts (the browser checks it first). */
export const WEB_LINK_PATTERN = "\\s*https?://\\S+\\s*";

/**
 * A web link (http or https) as typed, trimmed; null if it's empty.
 * Throws if it's something else (e.g. a javascript: link, or plain words).
 * @param {unknown} value
 * @returns {string | null}
 */
export function webLinkOrNull(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  if (!isWebLink(text)) throw new Error("The album link should be a web address, starting with https://");
  return text;
}

/**
 * Whether text is a web link we're willing to make clickable.
 * @param {unknown} text
 */
export function isWebLink(text) {
  if (typeof text !== "string" || !/^https?:\/\/\S+$/i.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
