// Encrypted backups: the file format, and which backups are past keeping.
// Pure apart from WebCrypto (in Node and the Workers runtime alike), so the
// tests run it directly.
//
// File: "RJB1" | PBKDF2 iterations (uint32, big-endian) | salt (16 bytes) |
// IV (12 bytes) | AES-256-GCM ciphertext with its tag. The key comes from a
// passphrase with PBKDF2-SHA256. The iteration count is in the header so it
// can be raised later without breaking old backups. "RJB1" is from the
// app's old name (Rope Journal); it stays so old backups still open.

export const RETENTION_DAYS = 7; // matches D1's own rolling history on the Free plan
export const ITERATIONS = 600_000; // OWASP's figure for PBKDF2-SHA256
export const MIN_PASSPHRASE = 12;
const MAX_ITERATIONS = 10_000_000;

const MAGIC = new TextEncoder().encode("RJB1");
const HEADER = MAGIC.length + 4 + 16 + 12;
// rope-journal-…: backups taken before the app was renamed.
const NAME = /^(?:notonawa|rope-journal)-(remote|local)-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.sql\.enc$/;

/**
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @param {number} iterations
 */
async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

/**
 * @param {Uint8Array} plaintext
 * @param {string} passphrase
 * @param {number} [iterations]
 * @returns {Promise<Uint8Array>}
 */
export async function encryptBackup(plaintext, passphrase, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const header = new Uint8Array(HEADER);
  header.set(MAGIC, 0);
  new DataView(header.buffer).setUint32(MAGIC.length, iterations);
  header.set(salt, MAGIC.length + 4);
  header.set(iv, MAGIC.length + 20);
  // The header is authenticated too, so it can't be swapped or edited.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, key, plaintext));
  const out = new Uint8Array(HEADER + ciphertext.length);
  out.set(header, 0);
  out.set(ciphertext, HEADER);
  return out;
}

/**
 * @param {Uint8Array} file
 * @param {string} passphrase
 * @returns {Promise<Uint8Array>}
 */
export async function decryptBackup(file, passphrase) {
  // A copy: Node's file Buffers are views into a shared pool, so reading
  // .buffer directly would start somewhere else entirely.
  file = new Uint8Array(file);
  if (file.length < HEADER + 16 || !MAGIC.every((b, i) => file[i] === b)) {
    throw new Error("This isn't a NotoNawa backup.");
  }
  const header = file.slice(0, HEADER);
  const iterations = new DataView(header.buffer).getUint32(MAGIC.length);
  // A damaged header could otherwise ask for billions of rounds and hang.
  if (iterations < 1 || iterations > MAX_ITERATIONS) throw new Error("Couldn't decrypt: the file is damaged.");
  const salt = header.slice(MAGIC.length + 4, MAGIC.length + 20);
  const iv = header.slice(MAGIC.length + 20, HEADER);
  const key = await deriveKey(passphrase, salt, iterations);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: header }, key, file.slice(HEADER)));
  } catch {
    throw new Error("Couldn't decrypt: wrong passphrase, or the file is damaged.");
  }
}

/**
 * The file name for a backup taken now, e.g.
 * notonawa-remote-20261013T174200Z.sql.enc
 * @param {"remote" | "local"} target
 * @param {number} now
 */
export function backupName(target, now) {
  const stamp = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `notonawa-${target}-${stamp}.sql.enc`;
}

/**
 * Which of these files are backups older than the retention period. Files
 * that aren't backups (by name) are never included.
 * @param {string[]} names
 * @param {number} now
 * @param {number} [days]
 */
export function expiredBackups(names, now, days = RETENTION_DAYS) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return names.filter((name) => {
    const m = name.match(NAME);
    if (!m) return false;
    const [, , y, mo, d, h, mi, s] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) < cutoff;
  });
}
