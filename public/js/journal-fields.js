// Going through a whole journal file (an export, or an import) kind by
// kind, so every encrypted field can be sealed (before importing) or opened
// (before saving an export). Pure: the converting is passed in (the crypto
// Worker's seal or open), so it's easy to test.

/** @typedef {import("./crypto/fields.js").RecordKind} RecordKind */
/** @typedef {(kind: RecordKind, records: any[]) => Promise<any[]>} Convert */

/**
 * The file with every person, profile note, location, plan, tie,
 * participant and workshop converted, and the names of the account's
 * shares and saved poser presets. Other parts are kept as they are.
 * @template {{ people?: any[], locations?: any[], plans?: any[], ties?: any[], workshops?: any[], account?: any }} T
 * @param {T} doc
 * @param {Convert} convert
 * @returns {Promise<T>}
 */
export async function convertJournal(doc, convert) {
  const people = await convertNested(doc.people ?? [], "person", "profile_notes", "profileNote", convert);
  const ties = await convertNested(doc.ties ?? [], "tie", "participants", "participant", convert);
  return {
    ...doc,
    people,
    locations: await convert("location", doc.locations ?? []),
    plans: await convert("plan", doc.plans ?? []),
    ties,
    workshops: await convert("workshop", doc.workshops ?? []),
    ...(doc.account ? { account: await convertAccount(doc.account, convert) } : {}),
  };
}

/**
 * The account's lists with sealed names: its shares and saved presets.
 * @type {readonly [string, RecordKind][]}
 */
const ACCOUNT_LISTS = [["shares", "share"], ["pose_presets", "posePreset"]];

/**
 * @param {any} account
 * @param {Convert} convert
 */
async function convertAccount(account, convert) {
  const out = { ...account };
  for (const [key, kind] of ACCOUNT_LISTS) {
    if (Array.isArray(account[key])) out[key] = await convert(kind, account[key]);
  }
  return out;
}

/**
 * Converts parents, and the children listed on each, in two calls (not one
 * per record), putting the children back where they were.
 * @param {any[]} parents
 * @param {RecordKind} parentKind
 * @param {string} childKey
 * @param {RecordKind} childKind
 * @param {Convert} convert
 */
async function convertNested(parents, parentKind, childKey, childKind, convert) {
  const children = parents.flatMap((p) => (Array.isArray(p?.[childKey]) ? p[childKey] : []));
  const [convertedParents, convertedChildren] = await Promise.all([convert(parentKind, parents), convert(childKind, children)]);
  let at = 0;
  return convertedParents.map((p, i) => {
    if (!Array.isArray(parents[i]?.[childKey])) return p;
    const count = parents[i][childKey].length;
    const mine = convertedChildren.slice(at, at + count);
    at += count;
    return { ...p, [childKey]: mine };
  });
}

/**
 * Takes the "unreadable" marks off opened records (for an export file), and
 * counts the fields that couldn't be opened.
 * @template {{ people?: any[], locations?: any[], plans?: any[], ties?: any[], workshops?: any[], account?: any }} T
 * @param {T} doc opened by convertJournal
 * @returns {{ doc: T, unreadable: number }}
 */
export function withoutUnreadableMarks(doc) {
  let unreadable = 0;
  /** @param {any} record */
  const clean = (record) => {
    if (!record?.unreadable) return record;
    unreadable += record.unreadable.length;
    const { unreadable: _marks, ...rest } = record;
    return rest;
  };
  return {
    doc: {
      ...doc,
      people: (doc.people ?? []).map((p) => clean({ ...p, profile_notes: (p.profile_notes ?? []).map(clean) })),
      locations: (doc.locations ?? []).map(clean),
      plans: (doc.plans ?? []).map(clean),
      ties: (doc.ties ?? []).map((t) => clean({ ...t, participants: (t.participants ?? []).map(clean) })),
      workshops: (doc.workshops ?? []).map(clean),
      ...(doc.account ? {
        account: Object.fromEntries(Object.entries(doc.account).map(([key, value]) =>
          [key, ACCOUNT_LISTS.some(([k]) => k === key) && Array.isArray(value) ? value.map(clean) : value])),
      } : {}),
    },
    unreadable,
  };
}
