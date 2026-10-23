// After each unlock: encrypts any notes still in plain text (written before
// encryption arrived), overwriting the plain text on the server. Usually
// there's nothing to do. Encrypting isn't an edit, so nothing's updated_at
// changes.

import { api } from "./api.js";
import { h } from "./dom.js";
import { seal, forgetSearch } from "./vault.js";
import { batches } from "./import-steps.js";

/** Each table's kind of record (as in crypto/fields.js). @type {Record<string, import("./crypto/fields.js").RecordKind>} */
const KIND_OF = {
  ties: "tie", tie_participants: "participant", people: "person",
  profile_notes: "profileNote", locations: "location", plans: "plan", workshops: "workshop",
  drawings: "drawing",
};
const ROWS_PER_REQUEST = 500;

/** Seals what's left. Shows a short note while it works. */
export async function sealLeftovers() {
  /** @type {Record<string, Record<string, unknown>[]>} */
  const pending = await api("/api/encryption/pending");
  const tables = Object.entries(pending).filter(([table, rows]) => KIND_OF[table] && rows.length);
  if (tables.length === 0) return;

  const note = h("p", { className: "toast", role: "status" }, "Encrypting your notes…");
  document.body.append(note);
  try {
    for (const [table, rows] of tables) {
      for (const batch of batches(rows, ROWS_PER_REQUEST)) {
        await api("/api/encryption/seal", { method: "POST", body: { [table]: await seal(KIND_OF[table], batch) } });
      }
    }
    forgetSearch();
  } finally {
    note.remove();
  }
}
