// The crypto Worker: a separate, walled-off part of the browser that holds
// the unlocked data key, so the page itself never has it. Started by
// vault.js; locking ends it (worker.terminate()), which drops the key and
// everything else it held.
//
// Messages are { id, op, args }; each gets { id, result } or { id, error },
// where error is "wrong-secret" when a secret didn't unlock, or a message.
// Step 5 adds operations on whole records (decrypt a tie's notes for
// display, search), never a general "decrypt this".

import { VaultCore } from "./crypto/vault-core.js";
import { WrongSecret } from "./crypto/keys.js";

const vault = new VaultCore();

/** @type {Record<string, (args: any) => Promise<unknown>>} */
const OPERATIONS = {
  setup: (args) => vault.setup(args),
  unlock: async (args) => { await vault.unlock(args); return null; },
  addWrap: (args) => vault.addWrap(args),
  status: async () => ({ unlocked: vault.unlocked }),
};

self.addEventListener("message", async (event) => {
  const { id, op, args } = event.data ?? {};
  const operation = OPERATIONS[op];
  try {
    if (!operation) throw new Error(`Unknown operation: ${op}`);
    self.postMessage({ id, result: await operation(args) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof WrongSecret ? "wrong-secret" : String(err instanceof Error ? err.message : err) });
  }
});
