// The format 2 contacts store (store/v2/contacts.js), one account at a time:
// making an invite that offers to connect, accepting one, my devices
// checking my mailboxes (an acceptance becoming a contact, answered;
// messages from a contact applied once, in order; a removal ending it
// quietly, their About taken off my card if they asked), removing one, and
// what the connection screens and People see. The journal is in memory,
// the Worker's sealing is plain JSON here (contacts.test.js seals for real)
// and the server is a fake: its mailboxes, and what's sent to others'.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordProblems } from "../../public/js/records/schema.js";
import { listPeople } from "../../public/js/store/queries/resources.js";
import { toBase64url, fromBase64url } from "../../public/js/crypto/keys.js";

class CantOpen extends Error {}

/** @type {Map<string, any>} */
const journal = new Map();
/** Another device's save, made just before mine is: a function that changes the journal once. */
let racing = /** @type {null | (() => void)} */ (null);
vi.mock("../../public/js/store/v2/journal.js", () => ({
  records: (/** @type {string} */ kind) => [...journal.values()].filter((r) => r.kind === kind && r.body),
  record: (/** @type {string} */ id) => journal.get(id) ?? null,
  save: async (/** @type {any} */ batch) => {
    if (racing) {
      const race = racing;
      racing = null;
      race();
      // As journal.js does: a write with no from that another device beat is dropped.
      batch = { ...batch, writes: (batch.writes ?? []).filter((/** @type {any} */ w) => w.from) };
    }
    for (const w of batch.writes ?? []) {
      expect(recordProblems(w.kind, w.body)).toEqual([]);
      journal.set(w.id, { kind: w.kind, id: w.id, version: 1, body: w.body });
    }
    for (const d of batch.deletes ?? []) journal.delete(d.id);
  },
}));

/** The fake server: my mailboxes, the messages waiting in them, and what I've sent to others'. */
const server = {
  /** @type {Map<string, any>} */ mailboxes: new Map(),
  /** @type {{ id: string, mailbox_id: string, body: string }[]} */ waiting: [],
  /** @type {string[]} */ acked: [],
  /** @type {any[]} */ sent: [],
  /** @type {Set<string>} */ gone: new Set(),
  /** The next GET of my messages fails, as offline. */ offline: false,
  /** Sending fails, as offline. */ down: false,
};
vi.mock("../../public/js/api.js", () => ({
  api: async (/** @type {string} */ path, /** @type {any} */ options = {}) => {
    const method = options.method ?? "GET";
    if (path === "/api/identity") return { public_key: "P".repeat(1622), sealed_seed: "i1.seed" };
    if (path === "/api/keys") return { user_id: "user-me" };
    if (path === "/api/mailboxes" && method === "POST") {
      server.mailboxes.set(options.body.id, options.body);
      return { ok: true };
    }
    if (path.startsWith("/api/mailboxes/") && method === "DELETE") {
      server.mailboxes.delete(decodeURIComponent(path.split("/").pop() ?? ""));
      return { ok: true };
    }
    if (path === "/api/mailboxes/messages") {
      if (server.offline) throw new Error("offline");
      return server.waiting.filter((m) => !server.acked.includes(m.id));
    }
    if (path === "/api/mailboxes/messages/ack") {
      server.acked.push(...options.body.ids);
      return { deleted: options.body.ids.length };
    }
    throw new Error(`unexpected ${method} ${path}`);
  },
}));

// Sealing as JSON: what was sealed, bound to what it was bound to.
const enc = (/** @type {any} */ v) => toBase64url(new TextEncoder().encode(JSON.stringify(v)));
const dec = (/** @type {string} */ s) => JSON.parse(new TextDecoder().decode(fromBase64url(s)));
vi.mock("../../public/js/vault.js", () => ({
  CantOpen,
  onWipe: () => {},
  openIdentity: async () => {},
  sealAcceptance: async (/** @type {any} */ a) => fromBase64url(enc({ to: a.inviterPublicKey, share: a.shareId, link: a.linkKey,
    payload: a.payload })).slice().buffer,
  openAcceptance: async (/** @type {any} */ a) => {
    let sealed;
    try { sealed = dec(toBase64url(new Uint8Array(a.sealed))); } catch { throw new CantOpen(); }
    if (sealed.share !== a.shareId || sealed.link !== a.linkKey) throw new CantOpen();
    return sealed.payload;
  },
  sealMessage: async (/** @type {any} */ m) => enc({ key: m.pairKey, box: m.mailboxId, counter: m.counter, payload: m.payload }),
  openMessage: async (/** @type {any} */ m) => {
    let sealed;
    try { sealed = dec(m.sealed); } catch { throw new CantOpen(); }
    if (sealed.key !== m.pairKey || sealed.box !== m.mailboxId) throw new CantOpen();
    return { counter: sealed.counter, payload: sealed.payload };
  },
  recordIds: async (/** @type {any} */ r) => ({
    converted: r.converted.map((/** @type {any} */ c) => `contact-${c.oldId}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64)),
  }),
}));

/** @type {Event[]} */
const events = [];
vi.stubGlobal("window", { dispatchEvent: (/** @type {Event} */ e) => events.push(e) });
vi.stubGlobal("fetch", async (/** @type {string} */ url, /** @type {any} */ init) => {
  if (server.down) throw new TypeError("Failed to fetch");
  const id = decodeURIComponent(url.split("/")[3]);
  server.sent.push({ url, id, credentials: init.credentials, ...JSON.parse(/** @type {string} */ (init.body)) });
  return new Response("{}", { status: server.gone.has(id) ? 404 : 200 });
});

// By a path in a variable: it loads page modules the Node type check can't follow.
const CONTACTS = "../../public/js/store/v2/contacts.js";
/** @type {Record<string, (...args: any[]) => Promise<any>> & { connectingShares: () => Set<string> }} */
const contacts = await import(CONTACTS);
const CONNECTIONS = "../../public/js/store/v2/connections.js";
/** @type {Record<string, (...args: any[]) => any>} */
const connections = await import(CONNECTIONS);

const THEIR_KEY = "T".repeat(1622);
const THEIR_BOX = { id: "theirmailbox0000000000", token: "t".repeat(43) };
const PAIR = "p".repeat(43);
const NOW = "2026-11-14T12:00:00Z";
/** @param {string} kind @param {string} id @param {Record<string, any>} body */
const put = (kind, id, body) => journal.set(id, { kind, id, version: 1, body });
const contactsNow = () => [...journal.values()].filter((r) => r.kind === "contact");

beforeEach(() => {
  journal.clear();
  Object.assign(server, { waiting: [], acked: [], sent: [], offline: false, down: false });
  server.mailboxes.clear();
  server.gone.clear();
  events.length = 0;
  racing = null;
});

/** An invite of mine, made through the store, and its share's id and key. */
async function makeInvite({ uses = "one" } = {}) {
  /** @type {any[]} */
  const shares = [];
  const saved = await contacts.connectingInvite({
    kind: "profile", data: { v: 1, name: "Alex" }, label: "Munch", expires: "7d", uses, fields: { name: "Alex", pronouns: true },
    saveShare: async (/** @type {any} */ share) => { shares.push(share); return { id: "share-0000000000000001", key: "L".repeat(43) }; },
  });
  return { saved, share: shares[0], invite: contactsNow()[0] };
}

/** Their acceptance of my invite, waiting in its intro mailbox. */
function theirAcceptance(/** @type {any} */ invite, { pairKey = PAIR, id = "msg-1" } = {}) {
  const payload = { v: 1, public_key: THEIR_KEY, user_id: "user-them", mailbox: THEIR_BOX, pair_key: pairKey, profile: null };
  const sealed = { to: "P".repeat(1622), share: invite.body.share_id, link: invite.body.link_key, payload };
  server.waiting.push({ id, mailbox_id: invite.body.intro_mailbox, body: enc(sealed) });
}

/** A message from a contact, in my mailbox for them. */
function fromThem(/** @type {any} */ contact, /** @type {number} */ counter, /** @type {any} */ payload, id = `m${counter}`) {
  server.waiting.push({ id, mailbox_id: contact.body.my_mailbox,
    body: enc({ key: contact.body.pair_key, box: contact.body.my_mailbox, counter, payload: { v: 1, ...payload } }) });
}

describe("an invite that offers to connect", () => {
  it("has an intro mailbox lasting as the invite does, my key and its address in the snapshot, and a record to know it by", async () => {
    const { saved, share, invite } = await makeInvite();
    const [intro] = [...server.mailboxes.values()];
    expect(intro).toMatchObject({ kind: "intro", expires: "7d" });
    expect(share.data.connect).toEqual({ v: 1, public_key: "P".repeat(1622), mailbox: { id: intro.id, token: intro.token } });
    expect(share.data.name).toBe("Alex");
    expect(invite.body).toMatchObject({ state: "invited", share_id: saved.id, link_key: saved.key, label: "Munch", once: true,
      intro_mailbox: intro.id, fields: { name: "Alex", pronouns: true } });
    expect([...contacts.connectingShares()]).toEqual([saved.id]);
  });

  it("leaves no mailbox behind if the share can't be made", async () => {
    await expect(contacts.connectingInvite({ kind: "profile", data: {}, label: "", expires: "1d", uses: "any", fields: {},
      saveShare: async () => { throw new Error("Too many shares"); } })).rejects.toThrow("Too many shares");
    expect([server.mailboxes.size, contactsNow().length]).toEqual([0, 0]);
  });

  it("isn't made for an invite that doesn't offer to connect: just the share, as always", async () => {
    /** @type {any[]} */
    const shares = [];
    await connections.profileInvite({ kind: "profile", data: { v: 1, name: "Alex" }, label: "", expires: "1d", uses: "one", connect: false,
      fields: { name: "Alex" }, saveShare: async (/** @type {any} */ share) => { shares.push(share); return { id: "s", key: "k" }; } });
    expect(shares).toEqual([{ kind: "profile", data: { v: 1, name: "Alex" }, label: "", expires: "1d", uses: "one", connect: false }]);
    expect([server.mailboxes.size, contactsNow().length]).toEqual([0, 0]);
  });

  it("is found in the snapshot when opened, and only there: a format 1 account's offer can't be taken", () => {
    const offer = { v: 1, public_key: THEIR_KEY, mailbox: THEIR_BOX };
    expect(connections.offerIn({ offer: null, data: { v: 1, name: "Alex", connect: offer } })).toEqual({ public_key: THEIR_KEY, mailbox: THEIR_BOX });
    expect(connections.offerIn({ offer: "a-format-1-token", data: { v: 1, name: "Alex" } })).toBeNull();
    expect(connections.offerIn({ offer: null, data: { v: 1, name: "Alex", connect: { ...offer, mailbox: { id: "short" } } } })).toBeNull();
  });

  it("revoked: its intro mailbox and record go", async () => {
    const { saved } = await makeInvite({ uses: "any" });
    await contacts.inviteRevoked(saved.id);
    expect([server.mailboxes.size, contactsNow().length]).toEqual([0, 0]);
  });
});

describe("accepting someone's invite", () => {
  const offer = { public_key: THEIR_KEY, mailbox: THEIR_BOX };

  it("makes my mailbox for them and leaves the acceptance in theirs, without my cookie; the contact goes on the person, off any other", async () => {
    put("contact", "old-contact-000001", { state: "active", person_id: "person-0000000001", created_at: NOW, updated_at: NOW });
    await contacts.acceptConnection({ offer, personId: "person-0000000001", name: "Jude", shareId: "share-000000000009", linkKey: "K".repeat(43) });
    const [box] = [...server.mailboxes.values()];
    expect(box.kind).toBe("contact");
    const [sent] = server.sent;
    expect([sent.id, sent.token, sent.credentials]).toEqual([THEIR_BOX.id, THEIR_BOX.token, "omit"]);
    const sealed = dec(sent.body);
    expect(sealed).toMatchObject({ to: THEIR_KEY, share: "share-000000000009", link: "K".repeat(43) });
    expect(sealed.payload).toMatchObject({ v: 1, public_key: "P".repeat(1622), user_id: "user-me", mailbox: { id: box.id, token: box.token } });
    const mine = contactsNow().find((c) => c.id !== "old-contact-000001");
    expect(mine?.body).toMatchObject({ state: "active", invited: false, person_id: "person-0000000001", name: "Jude", their_key: THEIR_KEY,
      my_mailbox: box.id, pair_key: sealed.payload.pair_key, sent: 0, received: 0 });
    expect(journal.get("old-contact-000001").body).not.toHaveProperty("person_id");
    expect(events.map((e) => e.type)).toEqual(["notonawa:connections-changed"]);
  });

  it("says so if the invite no longer offers to connect, saving nothing and leaving no mailbox", async () => {
    server.gone.add(THEIR_BOX.id);
    await expect(contacts.acceptConnection({ offer, personId: "person-0000000001", name: "Jude", shareId: "s".repeat(16), linkKey: "K".repeat(43) }))
      .rejects.toThrow(/no longer offers to connect/);
    expect([server.mailboxes.size, contactsNow().length]).toEqual([0, 0]);
  });
});

describe("checking my mailboxes", () => {
  it("turns an acceptance into a contact on no one, answers accepted, and ends a one-person invite", async () => {
    const { invite } = await makeInvite();
    theirAcceptance(invite);
    expect(await contacts.checkMailboxes()).toBe(1);
    const contact = contactsNow().find((c) => c.body.state === "active");
    expect(contact?.body).toMatchObject({ invited: true, answered: false, label: "Munch", their_key: THEIR_KEY, their_user: "user-them",
      their_mailbox: THEIR_BOX, pair_key: PAIR, sent: 1, fields: { name: "Alex", pronouns: true } });
    expect(contact?.body).not.toHaveProperty("person_id");
    const answer = dec(server.sent[0].body);
    expect([server.sent[0].id, answer.counter, answer.payload.type, answer.payload.mailbox.id])
      .toEqual([THEIR_BOX.id, 1, "accepted", contact?.body.my_mailbox]);
    // The invite's done: its record and intro mailbox gone, the message acknowledged.
    expect(contactsNow().map((c) => c.body.state)).toEqual(["active"]);
    expect([...server.mailboxes.values()].map((m) => m.kind)).toEqual(["contact"]);
    expect(server.acked).toEqual(["msg-1"]);
    expect(events.map((e) => e.type)).toEqual(["notonawa:connections-changed"]);
    expect(await contacts.listConnections()).toEqual([{ id: contact?.id, person_id: null, invited: true, answered: false, label: "Munch",
      created_at: expect.any(String) }]);
  });

  it("keeps an invite for anyone open, and makes one contact of an acceptance two devices both see", async () => {
    const { invite } = await makeInvite({ uses: "any" });
    theirAcceptance(invite, { id: "msg-1" });
    theirAcceptance(invite, { id: "msg-2" });
    expect(await contacts.checkMailboxes()).toBe(1);
    expect(contactsNow().map((c) => c.body.state).sort()).toEqual(["active", "invited"]);
    expect(server.acked).toEqual(["msg-1", "msg-2"]);
    expect(server.sent.length).toBe(1);
  });

  it("drops an acceptance that isn't for this invite's link", async () => {
    const { invite } = await makeInvite();
    theirAcceptance({ body: { ...invite.body, link_key: "X".repeat(43) } });
    expect(await contacts.checkMailboxes()).toBe(0);
    expect([contactsNow().length, server.acked, server.sent.length]).toEqual([1, ["msg-1"], 0]);
  });

  /** A contact of mine, connected, on a person with their About. */
  function connected() {
    put("person", "person-0000000001", { name: "Jude", about: "Hi!", about_shared_on: "2026-11-01", notes: "Mine", created_at: NOW, updated_at: NOW });
    put("contact", "contact-0000000001", { state: "active", invited: false, answered: true, person_id: "person-0000000001", name: "Jude",
      their_key: THEIR_KEY, my_mailbox: "mymailbox0000000000000", pair_key: PAIR, sent: 0, received: 0, created_at: NOW, updated_at: NOW });
    return journal.get("contact-0000000001");
  }

  it("applies their accepted once, in order, and drops a replay or one from someone else", async () => {
    const contact = connected();
    fromThem(contact, 1, { type: "accepted", public_key: THEIR_KEY, user_id: "user-them", mailbox: THEIR_BOX });
    fromThem(contact, 1, { type: "removed", clear_about: true }, "replay");
    server.waiting.push({ id: "forged", mailbox_id: contact.body.my_mailbox, body: enc({ key: "q".repeat(43), box: contact.body.my_mailbox,
      counter: 2, payload: { v: 1, type: "removed", clear_about: true } }) });
    expect(await contacts.checkMailboxes()).toBe(1);
    expect(journal.get(contact.id).body).toMatchObject({ state: "active", their_user: "user-them", their_mailbox: THEIR_BOX, received: 1 });
    expect(server.acked).toEqual(["m1", "replay", "forged"]);
    expect(journal.get("person-0000000001").body.about).toBe("Hi!");
  });

  it("ends the contact quietly when they remove me, taking their About off my card if they asked, and my notes stay", async () => {
    const contact = connected();
    fromThem(contact, 1, { type: "removed", clear_about: true });
    expect(await contacts.checkMailboxes()).toBe(1);
    expect(journal.get(contact.id).body.state).toBe("removed");
    expect(journal.get("person-0000000001").body).toEqual(expect.not.objectContaining({ about: expect.anything() }));
    expect(journal.get("person-0000000001").body).toMatchObject({ name: "Jude", notes: "Mine" });
    expect(journal.get("person-0000000001").body).not.toHaveProperty("about_shared_on");
    expect(server.sent).toEqual([]);
    expect(await contacts.listConnections()).toEqual([]);
  });

  it("keeps messages for the next check when it can't get them, and does nothing with none", async () => {
    server.offline = true;
    await expect(contacts.checkMailboxes()).rejects.toThrow("offline");
    server.offline = false;
    expect(await contacts.checkMailboxes()).toBe(0);
    expect(events).toEqual([]);
  });
});

describe("removing a contact", () => {
  it("tells them with the next counter, saved first, ends it and deletes my mailbox; nothing said if they can't be reached", async () => {
    server.mailboxes.set("mymailbox0000000000000", { kind: "contact" });
    put("contact", "contact-0000000001", { state: "active", person_id: "person-0000000001", their_key: THEIR_KEY, their_mailbox: THEIR_BOX,
      my_mailbox: "mymailbox0000000000000", pair_key: PAIR, sent: 4, received: 2, created_at: NOW, updated_at: NOW });
    server.gone.add(THEIR_BOX.id);
    await contacts.deleteConnection("contact-0000000001", "remove");
    const told = dec(server.sent[0].body);
    expect([told.counter, told.payload]).toEqual([5, { v: 1, type: "removed", clear_about: true }]);
    expect(journal.get("contact-0000000001").body).toMatchObject({ state: "removed", sent: 5 });
    expect(server.mailboxes.size).toBe(0);
  });

  it("takes the next counter again if another of my devices used it first", async () => {
    put("contact", "contact-0000000001", { state: "active", their_key: THEIR_KEY, their_mailbox: THEIR_BOX, pair_key: PAIR, sent: 4,
      created_at: NOW, updated_at: NOW });
    racing = () => put("contact", "contact-0000000001", { ...journal.get("contact-0000000001").body, sent: 5 });
    await contacts.deleteConnection("contact-0000000001", "keep");
    expect(dec(server.sent[0].body).counter).toBe(6);
  });
});

describe("profile updates", () => {
  const SENT = { v: 1, name: "Alex", pronouns: "they/them", aliases: [{ platform: "instagram", alias: "@alex" }] };
  /** Me, and a contact I shared my name and pronouns with (the invite's profile what they last got). */
  function setUp(/** @type {Record<string, any>} */ me = {}) {
    put("person", "me-00000000000001", { name: "Me", is_self: true, pronouns: "they/them", based_in: "Leeds",
      aliases: [{ platform: "instagram", alias: "@alex" }], created_at: NOW, updated_at: NOW, ...me });
    server.mailboxes.set("mymailbox0000000000000", { kind: "contact" });
    put("contact", "contact-0000000001", { state: "active", invited: true, answered: true, person_id: "person-0000000001", their_key: THEIR_KEY,
      their_mailbox: THEIR_BOX, my_mailbox: "mymailbox0000000000000", pair_key: PAIR, sent: 1, received: 0, created_at: NOW, updated_at: NOW,
      fields: { name: "Alex", pronouns: true, default_role: false, based_in: false, is_educator: false, about: false,
        aliases: [{ platform: "instagram", alias: "@alex" }] }, sent_profile: SENT });
  }

  it("go to each contact, the fields shared with them, in the profile slot, only when they've changed", async () => {
    setUp();
    expect(await contacts.sendProfileUpdates()).toBe(0);
    put("person", "me-00000000000001", { ...journal.get("me-00000000000001").body, pronouns: "she/her", based_in: "York" });
    expect(await contacts.sendProfileUpdates()).toBe(1);
    const [update] = server.sent;
    const sealed = dec(update.body);
    const profile = { v: 1, name: "Alex", pronouns: "she/her", aliases: [{ platform: "instagram", alias: "@alex" }] };
    expect([update.id, update.slot, update.credentials, sealed.counter]).toEqual([THEIR_BOX.id, "profile", "omit", 2]);
    expect(sealed.payload).toEqual({ v: 1, type: "profile", public_key: "P".repeat(1622), profile });
    expect(journal.get("contact-0000000001").body).toMatchObject({ sent: 2, sent_profile: profile });
    expect(await contacts.sendProfileUpdates()).toBe(0);
  });

  it("go to no one I shared nothing with (I accepted their invite), and none without Me", async () => {
    setUp({ pronouns: "she/her" });
    put("contact", "contact-0000000001", { ...journal.get("contact-0000000001").body, fields: {} });
    expect(await contacts.sendProfileUpdates()).toBe(0);
    journal.delete("me-00000000000001");
    expect(await contacts.sendProfileUpdates()).toBe(0);
  });

  it("offline, wait for the next try; to a mailbox that's gone, end the contact quietly", async () => {
    setUp({ pronouns: "she/her" });
    server.down = true;
    expect(await contacts.sendProfileUpdates()).toBe(0);
    expect(journal.get("contact-0000000001").body.sent_profile).toEqual(SENT);
    server.down = false;
    expect(await contacts.sendProfileUpdates()).toBe(1);
    put("person", "me-00000000000001", { ...journal.get("me-00000000000001").body, pronouns: "he/him" });
    server.gone.add(THEIR_BOX.id);
    expect(await contacts.sendProfileUpdates()).toBe(0);
    expect([journal.get("contact-0000000001").body.state, server.mailboxes.size]).toEqual(["removed", 0]);
  });

  it("from them waits on the contact until I review it, then stops waiting", async () => {
    setUp();
    const contact = journal.get("contact-0000000001");
    const theirs = { v: 1, name: "Jude", pronouns: "she/her" };
    fromThem(contact, 1, { type: "profile", public_key: THEIR_KEY, profile: theirs });
    expect(await contacts.checkMailboxes()).toBe(1);
    expect(connections.pendingProfile("person-0000000001")).toEqual({ contactId: contact.id, profile: theirs });
    expect([...connections.peopleWithUpdates()]).toEqual(["person-0000000001"]);
    await connections.profileUpdateDone(contact.id);
    expect([connections.pendingProfile("person-0000000001"), connections.peopleWithUpdates().size]).toEqual([null, 0]);
    expect(journal.get(contact.id).body).toMatchObject({ state: "active", received: 1 });
  });
});

describe("People", () => {
  it("shows the link icon on the person a live contact is on", () => {
    const people = [{ kind: "person", id: "p1", body: { name: "Jude" } }, { kind: "person", id: "p2", body: { name: "Sam" } }];
    const rows = listPeople(people, "all", [
      { kind: "contact", id: "c1", body: { state: "active", person_id: "p1" } },
      { kind: "contact", id: "c2", body: { state: "removed", person_id: "p2" } },
    ]);
    expect(rows.map((r) => [r.name, r.connection_id])).toEqual([["Jude", "c1"], ["Sam", null]]);
  });
});
