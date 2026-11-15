// The words for connections between accounts: the disclosures shown before
// connecting, a connection as Your data's Connections lists it, and the inviter's
// banner. Pure, so it's easy to test. See considerations.md, "Sharing
// between accounts": "Connecting accounts".

import { formatDate } from "./format.js";

/**
 * Shown when "Connect our accounts" is ticked on a profile invite. "Keeps no
 * record", not "can't see": while it's happening the server sees one
 * account open the invite and a message arrive soon after, but nothing it
 * stores links the two (format 2's contacts are in each journal, sealed).
 */
export const CONNECT_DISCLOSURE =
  "Profile connections are private. NōtoNawa's server keeps no record that the two accounts are connected.";

/** Shown to whoever opens an invite that offers to connect. */
export const ACCEPT_DISCLOSURE =
  `${CONNECT_DISCLOSURE} Either of you can remove it at any time. If you don't connect, they're still added to your People.`;

/** In the Remove dialog, under "Remove my About from their card". */
export const REMOVE_ABOUT_NOTE =
  "This only clears the About you shared from their card for you. It doesn't delete you from their journal, and " +
  "can't reach copies they've exported or kept elsewhere.";

/**
 * My side of a connection, opened, with the name of the person it's on.
 * @typedef {{ id: string, invited: number | boolean, label: string | null, answered: number | boolean,
 *   created_at: string, person_id: string | null, shared?: import("./profile-share.js").SharedProfile | null }} Connection
 *   shared: format 2's: their profile, shared back on accepting my invite
 */

/**
 * A connection's title in Your data's Connections.
 * @param {string | null} personName the name of the person it's on, if any
 */
export function connectionTitle(personName) {
  return personName ? `Linked to ${personName}` : "Not on any Person";
}

/**
 * What else Connections says about it: how it was made, and when.
 * @param {Connection} connection
 * @param {string} [locale]
 */
export function connectionDetail(connection, locale) {
  const how = connection.invited
    ? connection.label ? `through "${connection.label}"` : "through your profile invite"
    : connection.label ? `shared as "${connection.label}"` : null;
  return [how, formatDate(connection.created_at.slice(0, 10), locale)].filter(Boolean).join(" · ");
}

/**
 * The inviter's banner: someone accepted my invite, connecting our
 * accounts, and maybe shared their profile back.
 * @param {string | null} label my invite's tag
 * @param {string | null} [sharedName] the name on their profile, if they shared it back
 */
export function bannerText(label, sharedName = null) {
  if (sharedName) {
    return `${label ? `Your "${label}" share` : "Your profile invite"} was accepted and ${sharedName} has connected and shared their `
      + "profile. Add them to your People, or to someone you have?";
  }
  const invite = label ? `your invite "${label}"` : "your profile invite";
  return `Someone accepted ${invite}, and your accounts are now connected. Which of your People is it?`;
}

/**
 * A banner for a tie, plan or workshop a connection sent me.
 * @param {string | null} from who it's from: my card's name for them, or the name they shared
 * @param {string} kind tie, plan or workshop
 */
export function sentText(from, kind) {
  const a = kind === "tie" ? "a tie" : kind === "plan" ? "a plan" : "a workshop";
  return `${from ?? "One of your connections"} sent you ${a}.`;
}

/**
 * The connections the inviter still has to answer (put on a Person, or Not now).
 * @param {Connection[]} connections
 */
export function unanswered(connections) {
  return connections.filter((c) => c.invited && !c.answered);
}

/**
 * An import's people whose link to an account can't be kept, in words, or
 * null. Only a connection this account still has can be kept: a file from
 * another account, an old one, or an edited one comes in unlinked.
 * @param {number | undefined} count
 */
export function linksDroppedText(count) {
  if (!count) return null;
  return `${count === 1 ? "1 person" : `${count.toLocaleString()} people`} won't be linked to their account: ` +
    "that connection isn't yours any more.";
}
