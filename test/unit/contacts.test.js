// Contacts (format 2): what they send each other (contacts/messages.js),
// read strictly as it comes from another account; the contact record at
// each step (contacts/rules.js): invited, connected, a key that changes,
// verified, removed; and two accounts connecting for real, with their
// identity keys, the acceptance and a message sealed with their pair key,
// ending with the same safety number on both sides.
import { describe, it, expect } from "vitest";
import { acceptanceBody, readAcceptance, messageBody, readMessage } from "../../public/js/contacts/messages.js";
import {
  invitedContact, acceptingContact, contactFromAcceptance, applyMessage, withTheirKey, reserveCounter, isNewCounter, verified,
  isActive, asConnection, keptChoices, updateChoices, needsProfile, waitingShares, MAX_INBOX,
} from "../../public/js/contacts/rules.js";
import { recordProblems } from "../../public/js/records/schema.js";
import { VaultCore } from "../../public/js/crypto/vault-core.js";
import { newRecoveryCode, readRecoveryCode } from "../../public/js/recovery.js";
import { newShareId, newShareKey } from "../../public/js/crypto/share.js";
import { newPairKey } from "../../public/js/crypto/pair.js";
import { toBase64url, fromBase64url } from "../../public/js/crypto/keys.js";
import { safetyNumber } from "../../public/js/crypto/safety-number.js";

const NOW = "2026-11-15T12:00:00Z";
const LATER = "2026-11-16T12:00:00Z";
const chars = (/** @type {number} */ n, /** @type {string} */ c = "a") => c.repeat(n);
const KEY_A = chars(1622, "A");
const KEY_B = chars(1622, "B");
const MAILBOX = { id: chars(22, "m"), token: chars(43, "t") };
/** @type {import("../../public/js/profile-share.js").SharedProfile} */
const PROFILE = { v: 1, name: "Jude", pronouns: "she/her" };

describe("messages", () => {
  const acceptance = { public_key: KEY_A, user_id: "user-a", mailbox: MAILBOX, pair_key: chars(43, "p"), profile: PROFILE };

  it("read an acceptance back as it was sent, and nothing that isn't one", () => {
    expect(readAcceptance(JSON.parse(JSON.stringify(acceptanceBody(acceptance))))).toEqual(acceptance);
    expect(readAcceptance(acceptanceBody({ ...acceptance, profile: null }))).toEqual({ ...acceptance, profile: null });
    for (const bad of [{ ...acceptance, public_key: "short" }, { ...acceptance, mailbox: { id: "x", token: MAILBOX.token } },
      { ...acceptance, pair_key: "nope" }, { ...acceptance, user_id: "has spaces" }]) {
      expect(readAcceptance(acceptanceBody(/** @type {any} */ (bad)))).toBeNull();
    }
    expect(readAcceptance({ ...acceptanceBody(acceptance), v: 2 })).toBeNull();
    expect(readAcceptance({ ...acceptanceBody(acceptance), profile: { v: 1 } })).toBeNull();
  });

  it("read each kind of message, and nothing else", () => {
    const accepted = { type: /** @type {const} */ ("accepted"), public_key: KEY_B, user_id: "user-b", mailbox: MAILBOX };
    expect(readMessage(messageBody(accepted))).toEqual(accepted);
    expect(readMessage(messageBody({ type: "profile", public_key: KEY_B, profile: PROFILE }))).toEqual({ type: "profile", public_key: KEY_B, profile: PROFILE });
    expect(readMessage(messageBody({ type: "removed", clear_about: true }))).toEqual({ type: "removed", clear_about: true });
    expect(readMessage({ v: 1, type: "removed", clear_about: "yes" })).toEqual({ type: "removed", clear_about: false });
    expect(readMessage({ v: 1, type: "share", item: {} })).toBeNull();
    // A tie, plan or workshop sent through the connection: the share's id and its link's key, nothing else.
    const share = { type: /** @type {const} */ ("share"), kind: /** @type {const} */ ("tie"), share_id: chars(22, "s"), link_key: chars(43, "k") };
    expect(readMessage(messageBody(share))).toEqual(share);
    expect(readMessage({ ...messageBody(share), kind: "profile" })).toBeNull();
    expect(readMessage({ ...messageBody(share), link_key: "short" })).toBeNull();
    expect(readMessage({ v: 1, type: "profile", public_key: KEY_B, profile: { name: "No version" } })).toBeNull();
  });
});

describe("the contact record", () => {
  const invite = invitedContact({ shareId: "share-1", linkKey: chars(43, "k"), label: "Munch", once: true, introMailbox: MAILBOX.id, fields: { name: "Jude", pronouns: true }, sentProfile: PROFILE, now: NOW });
  const acceptance = { public_key: KEY_B, user_id: "user-b", mailbox: MAILBOX, pair_key: chars(43, "p"), profile: PROFILE };
  const mine = contactFromAcceptance({ invite, acceptance, myMailbox: chars(22, "y"), now: NOW });

  it("is within its kind's rules at every step", () => {
    const accepting = acceptingContact({ theirKey: KEY_A, personId: "p1", name: "Jude", myMailbox: chars(22, "z"), pairKey: chars(43, "p"),
      fields: {}, now: NOW });
    for (const body of [invite, mine, accepting, applyMessage(mine, { type: "removed", clear_about: false }, LATER).body]) {
      expect(recordProblems("contact", body)).toEqual([]);
    }
  });

  it("from an acceptance: connected, on no one until I choose, their profile waiting", () => {
    expect(mine).toMatchObject({ state: "active", invited: true, answered: false, their_key: KEY_B, their_user: "user-b",
      their_mailbox: MAILBOX, sent: 0, received: 0, pending_profile: PROFILE, fields: { name: "Jude", pronouns: true } });
    expect(mine).not.toHaveProperty("person_id");
    expect(isActive(mine)).toBe(true);
  });

  it("takes their mailbox from accepted, keeps a profile update waiting, and ends silently when removed", () => {
    const accepting = acceptingContact({ theirKey: KEY_A, personId: "p1", name: "Jude", myMailbox: chars(22, "z"), pairKey: chars(43, "p"),
      fields: {}, now: NOW });
    const connected = applyMessage(accepting, { type: "accepted", public_key: KEY_A, user_id: "user-a", mailbox: MAILBOX }, LATER).body;
    expect(connected).toMatchObject({ their_user: "user-a", their_mailbox: MAILBOX, key_changed: false });
    expect(applyMessage(connected, { type: "profile", public_key: KEY_A, profile: PROFILE }, LATER).body.pending_profile).toEqual(PROFILE);
    expect(applyMessage(connected, { type: "removed", clear_about: true }, LATER)).toMatchObject({ body: { state: "removed" }, clearAbout: true });
  });

  it("a key that changes clears the verified mark and says so, until verified again", () => {
    const checked = verified(mine, LATER);
    expect(withTheirKey(checked, KEY_B)).toMatchObject({ verified: true, key_changed: false });
    const changed = applyMessage(checked, { type: "profile", public_key: KEY_A, profile: PROFILE }, LATER).body;
    expect(changed).toMatchObject({ their_key: KEY_A, verified: false, key_changed: true });
    expect(verified(changed, LATER)).toMatchObject({ verified: true, key_changed: false });
  });

  it("reserves each counter before sending, and takes only new ones from them", () => {
    const first = reserveCounter(mine);
    const second = reserveCounter(first.body);
    expect([first.counter, second.counter, second.body.sent]).toEqual([1, 2, 2]);
    expect([isNewCounter({ received: 3 }, 4), isNewCounter({ received: 3 }, 3), isNewCounter({}, 1)]).toEqual([true, false, true]);
  });

  it("keeps ties, plans and workshops sent to me until opened, for 30 days, one entry each", () => {
    const share = { type: /** @type {const} */ ("share"), kind: /** @type {const} */ ("plan"), share_id: chars(22, "s"), link_key: chars(43, "k") };
    const once = applyMessage(mine, share, NOW).body;
    const twice = applyMessage(once, share, NOW).body;
    expect(twice.inbox).toEqual([{ kind: "plan", share_id: share.share_id, link_key: share.link_key, received_at: NOW }]);
    expect(recordProblems("contact", twice)).toEqual([]);
    expect(waitingShares(twice, new Date("2026-12-14T11:00:00Z")).length).toBe(1);
    expect(waitingShares(twice, new Date("2026-12-15T13:00:00Z"))).toEqual([]);
    let full = mine;
    for (let i = 0; i < MAX_INBOX + 5; i++) full = applyMessage(full, { ...share, share_id: `share-${String(i).padStart(16, "0")}` }, NOW).body;
    expect([full.inbox.length, full.inbox[0].share_id]).toEqual([MAX_INBOX, `share-${"5".padStart(16, "0")}`]);
  });

  it("keeps what an invite shared, aliases as themselves, and sends an update only when it differs", () => {
    /** @type {import("../../public/js/aliases.js").Alias[]} */
    const aliases = [{ platform: "instagram", alias: "@jude" }, { platform: "fetlife", alias: "Jude" }];
    const choices = { name: "Jude", pronouns: true, default_role: false, aliases: [1], based_in: false, is_educator: false, about: true };
    const kept = keptChoices(choices, aliases);
    expect(kept.aliases).toEqual([{ platform: "fetlife", alias: "Jude" }]);
    // Reordered, the same one is still shared; renamed or removed, it isn't.
    expect(updateChoices(kept, [{ platform: /** @type {const} */ ("x"), alias: "@j" }, ...aliases]).aliases).toEqual([2]);
    expect(updateChoices(kept, [{ platform: /** @type {const} */ ("fetlife"), alias: "Jude K" }]).aliases).toEqual([]);
    expect(updateChoices(kept, aliases)).toMatchObject({ name: "Jude", pronouns: true, about: true, based_in: false });
    expect(mine.sent_profile).toEqual(PROFILE);
    expect([needsProfile(mine, PROFILE), needsProfile(mine, { ...PROFILE, pronouns: "they/them" })]).toEqual([false, true]);
    expect(needsProfile({ ...mine, fields: {} }, { ...PROFILE, pronouns: "they/them" })).toBe(false);
    expect(needsProfile({ ...mine, state: "removed" }, { ...PROFILE, pronouns: "they/them" })).toBe(false);
  });

  it("shows as a connection on the screens format 1 has", () => {
    // Their profile, shared back on accepting, for the banner to offer until it's answered.
    expect(asConnection({ id: "c1", body: mine })).toEqual({
      id: "c1", person_id: null, invited: true, answered: false, label: "Munch", created_at: NOW, shared: PROFILE });
    expect(asConnection({ id: "c1", body: { ...mine, answered: true } }).shared).toBeNull();
    const accepting = acceptingContact({ theirKey: KEY_A, personId: "p1", name: "Jude", myMailbox: chars(22, "z"), pairKey: chars(43, "p"),
      fields: {}, now: NOW });
    expect(asConnection({ id: "c2", body: accepting })).toMatchObject({ person_id: "p1", invited: false, answered: true, label: "Jude", shared: null });
    // Sharing back on accepting: what I shared, kept, so my later changes go to them too.
    const sharing = acceptingContact({ theirKey: KEY_A, personId: "p1", name: "Jude", myMailbox: chars(22, "z"), pairKey: chars(43, "p"),
      fields: { name: "Alex", pronouns: true }, sentProfile: PROFILE, now: NOW });
    expect(sharing).toMatchObject({ fields: { name: "Alex", pronouns: true }, sent_profile: PROFILE });
    expect(recordProblems("contact", sharing)).toEqual([]);
  });
});

describe("two accounts connecting", () => {
  it("accept an invite, answer, and end with the same safety number on both sides", async () => {
    const code = () => /** @type {string} */ (readRecoveryCode(newRecoveryCode()));
    const inviter = new VaultCore();
    await inviter.setup({ userId: "user-a", code: code() });
    const inviterKey = await inviter.makeIdentity();
    const accepter = new VaultCore();
    await accepter.setup({ userId: "user-b", code: code() });
    const accepterKey = await accepter.makeIdentity();

    // The invite: my key and my intro mailbox, in the share's sealed snapshot.
    const shareId = newShareId();
    const linkKey = toBase64url(newShareKey());
    // The accepter's side: their mailbox for me, a new pair key, sealed to my key.
    const pairKey = newPairKey();
    const acceptance = { public_key: accepterKey.publicKey, user_id: "user-b", mailbox: { id: chars(22, "b"), token: chars(43, "k") },
      pair_key: pairKey, profile: PROFILE };
    const sealed = await accepter.sealAcceptance({ inviterPublicKey: inviterKey.publicKey, shareId, linkKey, payload: acceptanceBody(acceptance) });
    const theirs = accepting();
    function accepting() {
      return acceptingContact({ theirKey: inviterKey.publicKey, personId: "p1", name: "Alex", myMailbox: acceptance.mailbox.id, pairKey, fields: {},
        now: NOW });
    }

    // My side: open it, make the contact, answer "accepted" into their mailbox.
    const opened = readAcceptance(await inviter.openAcceptance({ shareId, linkKey, sealed }));
    expect(opened).toEqual(acceptance);
    const invite = invitedContact({ shareId, linkKey, label: null, once: false, introMailbox: chars(22, "i"), fields: {}, sentProfile: PROFILE, now: NOW });
    let mine = contactFromAcceptance({ invite, acceptance: /** @type {any} */ (opened), myMailbox: chars(22, "a"), now: NOW });
    const reserved = reserveCounter(mine);
    mine = reserved.body;
    const answer = await inviter.sealMessage({ pairKey: mine.pair_key, mailboxId: mine.their_mailbox.id, counter: reserved.counter,
      payload: messageBody({ type: "accepted", public_key: inviterKey.publicKey, user_id: "user-a", mailbox: { id: mine.my_mailbox, token: chars(43, "w") } }) });

    // Their side: open it with the pair key, apply it.
    const got = await accepter.openMessage({ pairKey, mailboxId: acceptance.mailbox.id, sealed: answer });
    expect(isNewCounter(theirs, got.counter)).toBe(true);
    const message = readMessage(got.payload);
    const connected = applyMessage(theirs, /** @type {any} */ (message), LATER).body;
    expect(connected).toMatchObject({ their_user: "user-a", their_mailbox: { id: mine.my_mailbox }, key_changed: false });

    // Both see the same 60 digits.
    const number = async (/** @type {string} */ myKey, /** @type {string} */ myId, /** @type {any} */ body) =>
      safetyNumber({ publicKey: fromBase64url(myKey), id: myId }, { publicKey: fromBase64url(body.their_key), id: body.their_user });
    const onMine = await number(inviterKey.publicKey, "user-a", mine);
    expect(onMine).toMatch(/^\d{60}$/);
    expect(await number(accepterKey.publicKey, "user-b", connected)).toBe(onMine);

    // Someone without the pair key can't send as them.
    const forged = await inviter.sealMessage({ pairKey: newPairKey(), mailboxId: acceptance.mailbox.id, counter: 9,
      payload: messageBody({ type: "removed", clear_about: true }) });
    await expect(accepter.openMessage({ pairKey, mailboxId: acceptance.mailbox.id, sealed: forged })).rejects.toThrow();
  });
});
