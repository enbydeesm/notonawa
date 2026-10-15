// The crypto Worker: a separate, walled-off part of the browser that holds
// the unlocked data key, so the page itself never has it. Started by
// vault.js; locking ends it (worker.terminate()), which drops the key and
// everything else it held.
//
// Messages are { id, op, args }; each gets { id, result } or { id, error },
// where error is "wrong-secret" when a secret didn't unlock, or a message.
// Its operations work on whole records of a known kind (seal or open a
// tie's notes, search the ties, seal a photo or open one of mine by id),
// never a general "decrypt this".

import { VaultCore } from "./crypto/vault-core.js";
import { WrongSecret } from "./crypto/keys.js";
import { TooLong, CantOpen } from "./crypto/fields.js";

// The ties' search index, fetched here (with the session cookie, as the
// page's requests are) so the notes in it are only ever opened in here.
async function loadIndex() {
  const res = await fetch("/api/ties/search-index", { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't search. Reload the page and try again.");
  return res.json();
}

// A sealed part of a photo, fetched here too, so the page asks only by id.
/**
 * @param {string} mediaId
 * @param {"thumb" | "full"} part
 */
async function loadPart(mediaId, part) {
  const res = await fetch(`/api/media/${encodeURIComponent(mediaId)}/${part}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't load the photo. Reload the page and try again.");
  return res.arrayBuffer();
}

const vault = new VaultCore(loadIndex, loadPart);

/** @type {Record<string, (args: any) => Promise<unknown>>} */
const OPERATIONS = {
  setup: (args) => vault.setup(args),
  unlock: async (args) => { await vault.unlock(args); return null; },
  addWrap: (args) => vault.addWrap(args),
  status: async () => ({ unlocked: vault.unlocked }),
  seal: (args) => vault.seal(args),
  open: (args) => vault.open(args),
  searchTies: (args) => vault.searchTies(args),
  forgetSearch: async () => { vault.forgetSearch(); return null; },
  sealPhoto: (args) => vault.sealPhoto(args),
  openPhoto: (args) => vault.openPhoto(args),
  sealCaption: (args) => vault.sealCaption(args),
  openMedia: (args) => vault.openMedia(args),
};

// Results whose buffers are handed over to the page rather than copied
// (photos can be megabytes).
/** @param {unknown} result @returns {Transferable[]} */
function buffersOut(result) {
  if (result instanceof ArrayBuffer) return [result];
  const body = /** @type {any} */ (result)?.body;
  return body instanceof ArrayBuffer ? [body] : [];
}

self.addEventListener("message", async (event) => {
  const { id, op, args } = event.data ?? {};
  const operation = OPERATIONS[op];
  try {
    if (!operation) throw new Error(`Unknown operation: ${op}`);
    const result = await operation(args);
    self.postMessage({ id, result }, { transfer: buffersOut(result) });
  } catch (err) {
    const error = err instanceof WrongSecret ? "wrong-secret"
      : err instanceof TooLong ? "too-long"
      : err instanceof CantOpen ? "cant-open"
      : String(err instanceof Error ? err.message : err);
    self.postMessage({ id, error });
  }
});
