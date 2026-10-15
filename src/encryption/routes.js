// Routes for encrypting notes written before encryption arrived. After each
// unlock the browser asks what's still plain text, seals it, and sends it
// back, which overwrites the plain text.

import { BadInput, json, noContent, readJson } from "../http.js";
import { encryptedText } from "../parse.js";
import { ENCRYPTED_COLUMNS } from "./config.js";
import { plainRows, sealRows } from "./db.js";

/** @typedef {import("../auth/user.js").User} User */

const MAX_ROWS = 500;

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleEncryption(request, env, user, url) {
  // GET /api/encryption/pending -> { ties: [{ id, notes }], people: [...],
  //   ... }: my rows with plain text left in an encrypted field
  if (url.pathname === "/api/encryption/pending" && request.method === "GET") {
    return json(await plainRows(env.DB, user.id));
  }

  // POST /api/encryption/seal  body { ties: [{ id, notes }], ... } -> saves
  //   the sealed values over plain text (up to 500 rows a request). Fields
  //   that are no longer plain are left as they are. updated_at isn't
  //   changed: this isn't an edit.
  if (url.pathname === "/api/encryption/seal" && request.method === "POST") {
    await sealRows(env.DB, user.id, parseSealed(await readJson(request)));
    return noContent();
  }

  return null;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Record<string, Record<string, unknown>[]>}
 */
export function parseSealed(body) {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const rows = {};
  let count = 0;
  for (const [table, list] of Object.entries(body)) {
    const columns = ENCRYPTED_COLUMNS[table];
    if (!columns || !Array.isArray(list)) throw new BadInput("Couldn't save the encrypted notes.");
    count += list.length;
    rows[table] = list.map((row) => {
      if (!row || typeof row.id !== "string") throw new BadInput("Couldn't save the encrypted notes.");
      /** @type {Record<string, unknown>} */
      const out = { id: row.id };
      // A plain value can't be sent back as it is: every field must be
      // sealed (or empty).
      for (const column of columns) out[column] = encryptedText(row[column]);
      return out;
    });
  }
  if (count > MAX_ROWS) throw new BadInput(`Send up to ${MAX_ROWS} rows at a time.`);
  return rows;
}
