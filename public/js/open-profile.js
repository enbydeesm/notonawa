// Adding a shared profile (a profile invite) from /open: as a new person,
// or onto a card I already have for them, choosing what to take.
//
// An invite can also offer to connect our accounts: ticking Connect our
// accounts accepts it once the card is saved, linking that card. If we're
// connected already, the card linked to them is suggested, and whichever
// card I choose is linked. What was shared comes from another account, so
// it's read strictly (profile-share.js) and shown as text.

import { errorMessage } from "./api.js";
import { h, showMessage } from "./dom.js";
import { forget } from "./pending-share.js";
import { readProfile } from "./profile-share.js";
import { newPerson } from "./contact-merge.js";
import { mergeFields } from "./profile-merge.js";
import { akaText } from "./aliases.js";
import { roleName } from "./roles.js";
import { capitalise, today } from "./format.js";
import { linkablePeople, linkConnection, connectionsChanged } from "./connections.js";
import { ACCEPT_DISCLOSURE } from "./connection-text.js";
import { saveItem, acceptConnection, canConnect } from "./store/index.js";

/** @typedef {import("./profile-share.js").SharedProfile} SharedProfile */
/** @typedef {import("./pending-share.js").OpenedShare} OpenedShare */

/**
 * What the screens of adding it share: what was shared, its preview, and
 * whether I've ticked Connect our accounts (kept as I go back and forth).
 * @typedef {{ body: HTMLElement, profile: SharedProfile, preview: HTMLElement, opened: OpenedShare, connect: boolean }} Adding
 */

/**
 * Shows an opened profile invite, and adding it.
 * @param {HTMLElement} body
 * @param {OpenedShare} opened
 */
export function showProfile(body, opened) {
  const profile = readProfile(opened.data);
  if (!profile) {
    body.replaceChildren(h("p", { id: "open-said" }, "This invite couldn't be read. Ask whoever shared it for a new one."));
    return;
  }
  const preview = profileCard(profile);
  if (opened.own) {
    body.replaceChildren(preview,
      h("p", { id: "open-own" }, "This is your own invite. Share its code with someone else to let them add you."));
    return;
  }
  showChoice({ body, profile, preview, opened, connect: false });
}

/**
 * What they shared, as a card.
 * @param {SharedProfile} profile
 * @param {string} [prefix] the ids' start
 */
export function profileCard(profile, prefix = "open") {
  const aka = akaText(profile.aliases ?? []);
  return h("div", { className: "item shared-profile", id: `${prefix}-profile` },
    h("div", { className: "item-title name-title" },
      h("span", { id: `${prefix}-name` }, profile.name),
      profile.pronouns ? h("span", { className: "item-meta" }, profile.pronouns) : null,
      profile.default_role ? h("span", { className: "tag outline role-tag" }, capitalise(roleName(profile.default_role))) : null,
      profile.is_educator ? h("span", { className: "badge" }, "Educator") : null),
    profile.based_in ? h("div", { className: "item-meta" }, `based in ${profile.based_in}`) : null,
    aka ? h("div", { className: "item-meta" }, aka) : null,
    profile.about ? h("p", { className: "item-notes shared-about" }, profile.about) : null);
}

/**
 * Connect our accounts, when the invite offers it: unticked, with what it
 * means. Or, if we're connected already, a note saying so.
 * @param {Adding} adding
 */
function connectChoice(adding) {
  if (adding.opened.connectionId) {
    return h("p", { className: "hint", id: "open-connected" }, "Your accounts are connected: the card you add them to will be linked to theirs.");
  }
  if (!adding.opened.offer || !canConnect()) return null;
  const tick = h("input", { type: "checkbox", id: "open-connect", checked: adding.connect,
    onchange: () => { adding.connect = tick.checked; } });
  return h("div", { className: "open-connect" },
    h("label", { className: "inline" }, tick, " Connect our accounts"),
    h("p", { className: "hint", id: "open-connect-note" }, ACCEPT_DISCLOSURE));
}

/**
 * Add as a new person, or to someone I have (the card already linked to
 * them first, if there is one).
 * @param {Adding} adding
 */
async function showChoice(adding) {
  const { body, profile, preview } = adding;
  const message = h("p", { className: "message", id: "open-message" });
  const addNew = h("button", {
    type: "button", className: "primary", id: "open-add-new",
    onclick: async () => {
      addNew.disabled = true;
      showMessage(message, "Adding…");
      try {
        const id = await saveItem("people", null, newPerson(profile, today()));
        done(adding, profile.name, await connectTo(adding, id));
      } catch (err) {
        showMessage(message, "Couldn't add them: " + errorMessage(err), true);
        addNew.disabled = false;
      }
    },
  }, "Add as a new person");
  const addExisting = h("button", {
    type: "button", id: "open-add-existing",
    onclick: () => pickPerson(adding),
  }, "Add to someone in my People");
  body.replaceChildren(...[
    h("p", { className: "hint" }, "Shared with you:"),
    preview,
    h("p", { className: "hint", id: "open-once" }, "Add it before you leave: the link may not work again."),
    connectChoice(adding),
    addNew, addExisting, message].filter((el) => el !== null));

  // Connected already: the card linked to them is the likely one.
  if (!adding.opened.connectionId) return;
  try {
    const linked = (await linkablePeople()).find((p) => p.connection_id === adding.opened.connectionId);
    if (!linked || !body.contains(addNew)) return;
    addNew.classList.remove("primary");
    addNew.before(h("button", {
      type: "button", className: "primary", id: "open-add-linked", onclick: () => showMerge(adding, linked),
    }, `Add to ${linked.name}, linked to their account`));
  } catch {
    // The other buttons still work.
  }
}

/**
 * Choosing which of my people this is.
 * @param {Adding} adding
 */
async function pickPerson(adding) {
  const { body, profile, preview } = adding;
  const message = h("p", { className: "message", id: "open-message" });
  let people;
  try {
    people = await linkablePeople();
  } catch (err) {
    body.append(message);
    return showMessage(message, "Couldn't load your People: " + errorMessage(err), true);
  }
  if (people.length === 0) {
    body.replaceChildren(preview, h("p", { id: "open-no-people" }, "There's no one in your People yet."),
      h("button", { type: "button", onclick: () => showChoice(adding) }, "Back"));
    return;
  }
  const linked = adding.opened.connectionId;
  const select = h("select", { id: "open-person" },
    people.map((p) => h("option", {
      value: p.id,
      selected: linked ? p.connection_id === linked : p.name.toLowerCase() === profile.name.toLowerCase(),
    }, p.name)));
  body.replaceChildren(preview,
    h("label", { htmlFor: "open-person" }, "Who is this?"),
    select,
    h("div", { className: "button-row" },
      h("button", { type: "button", className: "primary", id: "open-next",
        onclick: () => {
          const person = people.find((p) => p.id === select.value);
          if (person) showMerge(adding, person);
        } }, "Next"),
      h("button", { type: "button", onclick: () => showChoice(adding) }, "Back")),
    message);
}

/**
 * Field by field: theirs or mine. Then saving the card.
 * @param {Adding} adding
 * @param {any} person mine, opened
 */
function showMerge(adding, person) {
  const { body, preview } = adding;
  const message = h("p", { className: "message", id: "open-message" });
  const merge = mergeFields({ root: body, person, profile: adding.profile, prefix: "open" });
  const save = h("button", {
    type: "submit", className: "primary", id: "open-save",
    onclick: async (/** @type {Event} */ event) => {
      event.preventDefault();
      save.disabled = true;
      showMessage(message, "Saving…");
      try {
        const record = merge.record();
        await saveItem("people", person.id, record);
        done(adding, record.name, await connectTo(adding, person.id));
      } catch (err) {
        showMessage(message, "Couldn't save: " + errorMessage(err), true);
        save.disabled = false;
      }
    },
  }, `Save to ${person.name}`);
  body.replaceChildren(preview,
    h("h2", {}, `Adding to ${person.name}`),
    ...merge.elements,
    h("div", { className: "button-row" }, save,
      h("button", { type: "button", onclick: () => pickPerson(adding) }, "Back")),
    message);
}

/**
 * Once the card is saved: links it to their account, if I ticked Connect
 * our accounts (accepting the offer) or we're connected already. The card
 * is saved either way, so a failure here is only said.
 * @param {Adding} adding
 * @param {string} personId
 * @returns {Promise<"linked" | "not linked" | string>} what happened, or why it couldn't connect
 */
async function connectTo(adding, personId) {
  const { opened, profile } = adding;
  try {
    if (opened.connectionId) {
      await linkConnection(opened.connectionId, personId);
      return "linked";
    }
    if (!opened.offer || !adding.connect) return "not linked";
    await acceptConnection({ offer: opened.offer, personId, name: profile.name, shareId: opened.id, linkKey: opened.key });
    connectionsChanged();
    return "linked";
  } catch (err) {
    return errorMessage(err);
  }
}

/**
 * Added: the share's done with.
 * @param {Adding} adding
 * @param {string} name
 * @param {string} connected what connectTo said
 */
function done(adding, name, connected) {
  forget();
  const note = connected === "linked" ? h("p", { id: "open-linked" }, "Their card is linked to their account.")
    : connected === "not linked" ? null
    : h("p", { className: "message error", id: "open-link-failed" }, `They're added, but your accounts couldn't be connected: ${connected}`);
  adding.body.replaceChildren(...[h("p", { id: "open-done" }, `${name} is in your People.`), note,
    h("a", { href: "/people", id: "open-to-people" }, "Go to People")].filter((el) => el !== null));
}
