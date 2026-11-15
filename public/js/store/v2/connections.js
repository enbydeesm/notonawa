// Connections (format 2): contacts, records of my own sealed journal, and
// the mailboxes our devices leave each other sealed messages in
// (contacts.js). The same functions as v1/connections.js, so the
// connection screens don't change.

export {
  listConnections, acceptConnection, setConnectionPerson, markConnectionAnswered, deleteConnection, inviteRevoked, connectingShares,
} from "./contacts.js";
import { connectingInvite } from "./contacts.js";

/**
 * Makes a profile invite, offering to connect if ticked.
 * @param {import("../v1/connections.js").ProfileInvite} invite
 * @returns {Promise<{ id: string, key: string }>}
 */
export function profileInvite({ connect, fields, saveShare, ...share }) {
  return connect ? connectingInvite({ ...share, fields, saveShare }) : saveShare({ ...share, connect: false });
}

/**
 * The offer to connect in a share I opened: format 2's is in its sealed
 * snapshot (a format 1 account's offer, the server's, isn't one I can take).
 * @param {{ offer?: string | null, data: any }} opened
 * @returns {any}
 */
export function offerIn({ data }) {
  return readInviteOffer(data);
}
import { readInviteOffer } from "../../contacts/messages.js";
