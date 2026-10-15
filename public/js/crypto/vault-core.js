// What the crypto Worker does, apart from receiving messages (that's
// crypto-worker.js), so it can be tested on its own. It holds the unlocked
// data key, non-extractable, and never hands it out: only wraps of it.
//
// Wrapping the key for a new secret always needs proof: an existing wrap and
// the secret that opens it (a passkey's PRF output, or the recovery code),
// given just now. Being unlocked isn't enough, or a script injected into the
// page could have the key wrapped for a secret it chose, and take it away.
//
// Secrets are wiped from memory (zeroed) once used, where JavaScript allows:
// PRF output arrives as bytes and can be; a recovery code is a string and
// can't.

import { newDataKey, wrapDataKey, unwrapDataKey, recoveryKeyMaterial } from "./keys.js";

/** @typedef {import("./keys.js").Wrap} Wrap */
/**
 * A secret as sent by the page: a passkey's PRF output, or a recovery code
 * (canonical, see readRecoveryCode).
 * @typedef {{ prf: ArrayBuffer } | { code: string }} Secret
 */

export class VaultCore {
  /** @type {CryptoKey | null} the data key, non-extractable */
  #key = null;

  get unlocked() {
    return this.#key !== null;
  }

  /**
   * Makes a new data key, wraps it for the recovery code (and the passkey,
   * if it gave PRF output), and stays unlocked with it.
   * @param {{ userId: string, code: string, prf?: ArrayBuffer | null }} args
   * @returns {Promise<{ recovery: Wrap, passkey: Wrap | null }>}
   */
  async setup({ userId, code, prf = null }) {
    const key = await newDataKey();
    const recoverySecret = recoveryKeyMaterial(code);
    const recovery = await this.#checkedWrap(key, userId, "recovery", recoverySecret);
    /** @type {Wrap | null} */
    let passkey = null;
    if (prf) {
      const secret = /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(prf));
      passkey = await this.#checkedWrap(key, userId, "passkey", secret);
      secret.fill(0);
    }
    this.#key = await unwrapDataKey(recovery, { userId, secret: recoverySecret });
    recoverySecret.fill(0);
    return { recovery, passkey };
  }

  /**
   * Unlocks with a wrap and its secret. Throws WrongSecret if it doesn't open.
   * @param {{ userId: string, wrap: Wrap, secret: Secret }} args
   */
  async unlock({ userId, wrap, secret }) {
    const bytes = secretBytes(secret);
    try {
      this.#key = await unwrapDataKey(wrap, { userId, secret: bytes });
    } finally {
      bytes.fill(0);
    }
  }

  /**
   * Wraps the key for a new secret, given proof (an existing wrap and its
   * secret). Unlocks too, if it wasn't already. Throws WrongSecret if the
   * proof doesn't open.
   * @param {{ userId: string, proof: { wrap: Wrap, secret: Secret }, add: { kind: "passkey" | "recovery", secret: Secret } }} args
   * @returns {Promise<Wrap>}
   */
  async addWrap({ userId, proof, add }) {
    const proofBytes = secretBytes(proof.secret);
    const newBytes = secretBytes(add.secret);
    try {
      const key = await unwrapDataKey(proof.wrap, { userId, secret: proofBytes }, { extractable: true });
      const wrap = await this.#checkedWrap(key, userId, add.kind, newBytes);
      this.#key ??= await unwrapDataKey(proof.wrap, { userId, secret: proofBytes });
      return wrap;
    } finally {
      proofBytes.fill(0);
      newBytes.fill(0);
    }
  }

  /** Forgets the key. */
  lock() {
    this.#key = null;
  }

  /**
   * Wraps the key and unwraps the result once, so a wrap that wouldn't open
   * never reaches the server.
   * @param {CryptoKey} key extractable
   * @param {string} userId
   * @param {"passkey" | "recovery"} kind
   * @param {Uint8Array<ArrayBuffer>} secret
   */
  async #checkedWrap(key, userId, kind, secret) {
    const wrap = await wrapDataKey(key, { userId, kind, secret });
    await unwrapDataKey(wrap, { userId, secret });
    return wrap;
  }
}

/**
 * @param {Secret} secret
 * @returns {Uint8Array<ArrayBuffer>} a copy for the caller to zero (PRF output is the
 *   transferred buffer itself, zeroed through this view)
 */
function secretBytes(secret) {
  if ("prf" in secret) return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(secret.prf));
  return recoveryKeyMaterial(secret.code);
}
