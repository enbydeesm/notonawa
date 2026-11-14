// The store: every read and write of journal data goes through here, never
// api() directly (a unit test checks). Today it's v1, the API as it is; the
// encrypted version, v2, over a sealed cache on the device, comes in beside
// it later, chosen by the account's format, so the pages don't change.
//
// What its functions take and give is the pages' view of the journal:
// plain text in, opened rows out. Sealing, opening and searching notes for
// a keyword happen inside.

export { findTies, getTie, saveTie, deleteTie, recentOnTies } from "./v1/ties.js";
