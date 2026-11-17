// Flows that involve the encryption key: unlocking (with a passkey or the
// recovery code), setting up the first key, and adding a passkey or a new
// recovery code, which wrap the key for a new secret.
//
// Wrapping the key for a new secret always needs proof, given just now:
// the PRF output of a passkey that already unlocks, or the recovery code
// (see crypto/vault-core.js). So adding a passkey or a recovery code first
// asks for a passkey (or the code), even when the journal is unlocked.
//
// After sign-in the PRF output is held here (pending) until the unlock view
// has used it: e.g. to set up the first key, or to wrap the key for this
// passkey once the recovery code has unlocked it.

import { api } from "./api.js";
import { signInWithPasskey, recoverySecret, showRecoveryCode, askRecoveryCode, withReauth } from "./auth-flows.js";
import { createPasskey, prfOutputFor } from "./webauthn.js";
import { newRecoveryCode, readRecoveryCode } from "./recovery.js";
import { fromBase64url } from "./webauthn-json.js";
import * as vault from "./vault.js";

/** @typedef {import("./crypto/keys.js").Wrap} Wrap */
/**
 * What GET /api/keys says.
 * @typedef {{ user_id: string, has_key: boolean, recovery: (Wrap & { current: boolean }) | null, passkey_id: string | null, passkey: Wrap | null }} Keys
 */
/**
 * After sign-in: unlocked, or what the unlock view must do next.
 *   setup: the account has no key yet (made before encryption arrived).
 *   code: unlock with the recovery code; reason "no-prf" (this passkey can't
 *     unlock) or "no-wrap" (it can, once the code has unlocked it).
 * @typedef {{ state: "unlocked" } | { state: "setup" } | { state: "code", reason: "no-prf" | "no-wrap" }} UnlockResult
 */

/** PRF output from the last sign-in, until used. @type {ArrayBuffer | null} */
let pendingPrf = null;
/** What the last sign-in left for the unlock view to do. @type {UnlockResult | null} */
let pendingResult = null;

const getKeys = () => /** @type {Promise<Keys>} */ (api("/api/keys"));

/** @param {string} typed */
function canonicalCode(typed) {
  const code = readRecoveryCode(typed);
  if (!code) throw new Error("That doesn't look like a recovery code. It's 32 letters and numbers.");
  return code;
}

/**
 * Signs in with a passkey and unlocks with it if it can.
 * @returns {Promise<UnlockResult>}
 */
export async function signInAndUnlock() {
  pendingResult = await signInAndTryUnlock();
  return pendingResult;
}

/**
 * What the last sign-in left the unlock view to do (taken once), e.g. after
 * signing in on the sign-in view.
 * @returns {UnlockResult | null}
 */
export function takeSignInResult() {
  const result = pendingResult;
  pendingResult = null;
  return result;
}

/** @returns {Promise<UnlockResult>} */
async function signInAndTryUnlock() {
  const { prfOutput } = await signInWithPasskey();
  pendingPrf = prfOutput;
  const keys = await getKeys();
  if (!keys.has_key) return { state: "setup" };
  if (!prfOutput) return { state: "code", reason: "no-prf" };
  if (!keys.passkey || !keys.recovery) return { state: "code", reason: "no-wrap" };

  pendingPrf = null;
  const proof = { wrap: keys.passkey, secret: { prf: prfOutput } };
  if (keys.recovery.current) {
    await vault.unlock({ userId: keys.user_id, ...proof });
  } else {
    // The operator gave this account a new recovery code, which the key
    // isn't wrapped for. The passkey proves it's you: wrap the key for a new
    // code now, so the old one stops working.
    await replaceRecoveryCodeWith(keys, proof,
      "Your recovery code was replaced, so here's a new one that also unlocks your journal.");
  }
  return { state: "unlocked" };
}

/**
 * Unlocks with the recovery code. If the passkey just used can give PRF
 * output but has no wrap, the key is wrapped for it too, so it unlocks next
 * time. If the code was an older one (the operator replaced it), a new one
 * is made.
 * @param {string} typed the code as typed
 * @throws {vault.WrongSecret}
 */
export async function unlockWithCode(typed) {
  const code = canonicalCode(typed);
  const keys = await getKeys();
  if (!keys.recovery) throw new Error("Your journal doesn't have an encryption key yet.");
  const proof = { wrap: keys.recovery, secret: { code } };
  const prf = pendingPrf;
  if (prf && keys.passkey_id && !keys.passkey) {
    pendingPrf = null;
    const wrap = await vault.addWrap({ userId: keys.user_id, proof, add: { kind: "passkey", secret: { prf } } });
    // Not essential: if it can't be saved, the code is asked for next time.
    await api(`/api/keys/passkeys/${encodeURIComponent(keys.passkey_id)}`, { method: "PUT", body: { wrap } }).catch(() => {});
  } else {
    await vault.unlock({ userId: keys.user_id, ...proof });
  }
  if (!keys.recovery.current) {
    await replaceRecoveryCodeWith(keys, { wrap: keys.recovery, secret: { code } },
      "That was an older recovery code. Here's a new one, which replaces both.");
  }
}

/**
 * Whether the recovery wrap was made with an older code than the one that
 * signs in (the operator replaced it): then the current code can't unlock.
 */
export async function recoveryCodeWasReplaced() {
  const keys = await getKeys();
  return keys.recovery !== null && !keys.recovery.current;
}

/**
 * Makes the account's first key (for an account from before encryption), or
 * with replace a new one in place of one that can't be unlocked any more.
 * Wrapped for a new recovery code, shown once, and the passkey just used if
 * it gave PRF output. Leaves the journal unlocked.
 * @param {{ replace?: boolean }} [options]
 */
export async function setUpKey({ replace = false } = {}) {
  if (replace) {
    // Starting again needs a recent sign-in; it's also this passkey's chance
    // to give PRF output for the new key.
    const { prfOutput } = await signInWithPasskey();
    pendingPrf = prfOutput;
  }
  const keys = await getKeys();
  const code = newRecoveryCode();
  const prf = pendingPrf;
  pendingPrf = null;
  const wraps = await vault.setup({ userId: keys.user_id, code: canonicalCode(code), prf });
  try {
    await api("/api/keys/setup", {
      method: "POST",
      body: { recovery_secret: await recoverySecret(code), recovery_wrap: wraps.recovery, passkey_wrap: wraps.passkey, replace },
    });
  } catch (err) {
    vault.lock();
    throw err;
  }
  await showRecoveryCode(code, {
    intro: "Your journal now has an encryption key. This recovery code unlocks it, and replaces any code you had.",
  });
}

/**
 * Proof for wrapping the key again: a passkey use checked by the server
 * (which also makes the session fresh), and its PRF output; or, if that
 * passkey can't unlock, the recovery code.
 * @returns {Promise<{ keys: Keys, proof: { wrap: Wrap, secret: import("./crypto/vault-core.js").Secret } }>}
 */
export async function proveIt() {
  const { prfOutput } = await signInWithPasskey();
  const keys = await getKeys();
  if (prfOutput && keys.passkey) return { keys, proof: { wrap: keys.passkey, secret: { prf: prfOutput } } };
  if (!keys.recovery) throw new Error("Your journal doesn't have an encryption key yet.");
  const typed = await askRecoveryCode({
    title: "Your recovery code, please",
    message: "That passkey can't unlock your journal, so confirm with your recovery code.",
  });
  if (typed === null) throw new Error("Cancelled.");
  return { keys, proof: { wrap: keys.recovery, secret: { code: canonicalCode(typed) } } };
}

/**
 * Adds a passkey on this device to the signed-in account, with the key
 * wrapped for it if it can give PRF output.
 * @param {string} name
 */
export async function addPasskey(name) {
  const { keys, proof } = await proveIt();
  const options = await api("/api/auth/register/options", { method: "POST", body: {} });
  const made = await createPasskey(options);
  const prf = made.prfOutput ?? await prfOutputFor(made.credentialId).catch(() => null);
  const wrap = prf ? await vault.addWrap({ userId: keys.user_id, proof, add: { kind: "passkey", secret: { prf } } }) : null;
  await api("/api/auth/register/verify", {
    method: "POST", body: { response: made.response, name, prf_capable: prf ? true : made.prfCapable, passkey_wrap: wrap },
  });
}

/** Makes a new recovery code (with the key wrapped for it), and shows it once. */
export async function replaceRecoveryCode() {
  const { keys, proof } = await proveIt();
  await replaceRecoveryCodeWith(keys, proof);
}

/**
 * @param {Keys} keys
 * @param {{ wrap: Wrap, secret: import("./crypto/vault-core.js").Secret }} proof
 * @param {string} [intro]
 */
async function replaceRecoveryCodeWith(keys, proof, intro) {
  const code = newRecoveryCode();
  const wrap = await vault.addWrap({ userId: keys.user_id, proof, add: { kind: "recovery", secret: { code: canonicalCode(code) } } });
  const body = { recovery_secret: await recoverySecret(code), recovery_wrap: wrap };
  // The wrap is made already; only saving it may need a recent sign-in.
  await withReauth(() => api("/api/account/recovery-code", { method: "PUT", body }));
  await showRecoveryCode(code, { intro });
}

/**
 * Creates an account: a passkey, and the account's key wrapped for a new
 * recovery code (shown once) and for the passkey. Leaves it unlocked.
 * @param {{ invite: string, adult: boolean, consent: boolean, name: string }} details
 */
export async function signUp({ invite, adult, consent, name }) {
  // The code is made here and never sent: only a secret derived from it.
  const code = newRecoveryCode();
  const options = await api("/api/auth/register/options", { method: "POST", body: { invite, adult, consent } });
  // The new account's id, which the key's wraps are bound to.
  const userId = new TextDecoder().decode(fromBase64url(options.user.id));
  const made = await createPasskey(options);
  const prf = made.prfOutput ?? await prfOutputFor(made.credentialId).catch(() => null);
  const wraps = await vault.setup({ userId, code: canonicalCode(code), prf });
  try {
    await api("/api/auth/register/verify", {
      method: "POST",
      body: {
        response: made.response, name, prf_capable: prf ? true : made.prfCapable,
        recovery_secret: await recoverySecret(code), recovery_wrap: wraps.recovery, passkey_wrap: wraps.passkey,
      },
    });
  } catch (err) {
    vault.lock();
    throw err;
  }
  await showRecoveryCode(code);
}

/**
 * Finishes signing in with a recovery code (already accepted by the
 * server): adds a passkey on this device, unlocks with the code, wraps the
 * key for the new passkey, and replaces the code (shown once). If the code
 * can't unlock (the operator replaced it), signing in still finishes and the
 * unlock view explains what's possible.
 * @param {string} typed the recovery code that signed in
 * @param {string} name for the new passkey
 */
export async function finishRecovery(typed, name) {
  const code = canonicalCode(typed);
  const keys = await getKeys();
  const options = await api("/api/auth/register/options", { method: "POST", body: {} });
  const made = await createPasskey(options);
  const prf = made.prfOutput ?? await prfOutputFor(made.credentialId).catch(() => null);
  const proof = keys.recovery ? { wrap: keys.recovery, secret: { code } } : null;

  /** @type {Wrap | null} */
  let wrap = null;
  let unlocked = false;
  if (proof) {
    try {
      if (prf) wrap = await vault.addWrap({ userId: keys.user_id, proof, add: { kind: "passkey", secret: { prf } } });
      else await vault.unlock({ userId: keys.user_id, ...proof });
      unlocked = true;
    } catch (err) {
      if (!(err instanceof vault.WrongSecret)) throw err;
    }
  }
  await api("/api/auth/register/verify", {
    method: "POST", body: { response: made.response, name, prf_capable: prf ? true : made.prfCapable, passkey_wrap: wrap },
  });

  if (!keys.has_key) {
    // From before encryption: set the key up now, which also replaces the code.
    pendingPrf = prf;
    await setUpKey();
  } else if (unlocked && proof) {
    await replaceRecoveryCodeWith(keys, proof, "You signed in with your recovery code, so here's a new one.");
  }
  // Otherwise the code signs in but can't unlock: it stays, and the unlock
  // view offers an older code or a new key.
}

/** Forgets what's held since sign-in (when the user gives up on unlocking). */
export function forgetPending() {
  pendingPrf = null;
  pendingResult = null;
}
