// Connections between accounts, on the page: loading mine (their names
// opened), putting one on a Person (one of mine, or a new one), removing
// one, and the link icon a linked Person shows. Used by Shared by me, the
// inviter's banner and People. See considerations.md, "Sharing between
// accounts": "Connecting accounts".

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { open } from "./vault.js";
import { choose } from "./dialog.js";
import { convertConnections } from "./journal-fields.js";
import { REMOVE_ABOUT_NOTE } from "./connection-text.js";
import { listItems, saveItem } from "./store/index.js";

/** @typedef {import("./connection-text.js").Connection} Connection */

/** Sent on window when a connection is put on a Person or removed, so lists showing them redraw. */
export const CONNECTIONS_CHANGED = "notonawa:connections-changed";

const SVG = "http://www.w3.org/2000/svg";

/**
 * My connections, newest first, their names opened (an invite's name, on
 * the side that invited, was sealed as a share's label).
 * @returns {Promise<Connection[]>}
 */
export async function loadConnections() {
  const list = await api("/api/connections");
  return convertConnections(list, (kind, records) => open(kind, records));
}

/** Tells the page a connection changed. */
export function connectionsChanged() {
  window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
}

/**
 * Puts a connection on one of my people, taking it off any other.
 * @param {string} id my side of it
 * @param {string} personId
 */
export async function linkConnection(id, personId) {
  await api(`/api/connections/${id}/person`, { method: "PUT", body: { person_id: personId } });
  connectionsChanged();
}

/**
 * Not now, on the inviter's banner: it stays in Shared by me.
 * @param {string} id
 */
export async function answerLater(id) {
  await api(`/api/connections/${id}/answered`, { method: "POST", body: {} });
}

/**
 * Asks, then removes a connection for both accounts, optionally clearing
 * my About from their card.
 * @param {string} id my side of it
 * @param {string} [name] who it's with, if it's on someone
 * @returns {Promise<boolean>} whether it was removed (false: cancelled)
 */
export async function removeConnection(id, name) {
  const about = h("input", { type: "checkbox", id: "connection-remove-about" });
  const choice = await choose({
    title: name ? `Remove your connection with ${name}?` : "Remove this connection?",
    message: "Your accounts won't be connected any more, for either of you. Your cards for each other stay, just " +
      "unlinked. To connect again, one of you shares a new invite.",
    content: h("div", { className: "remove-connection" },
      h("label", { className: "inline" }, about, " Remove my About from their card"),
      h("p", { className: "hint" }, REMOVE_ABOUT_NOTE)),
    choices: [{ label: "Remove connection", value: "remove", style: "solid-danger" }],
  });
  if (choice !== "remove") return false;
  await api(`/api/connections/${id}?about=${about.checked ? "remove" : "keep"}`, { method: "DELETE" });
  connectionsChanged();
  return true;
}

/**
 * My active people other than me, opened, for choosing who a connection is.
 * @returns {Promise<any[]>}
 */
export async function linkablePeople() {
  return (await listItems("people", false)).filter((p) => !p.is_self);
}

/**
 * Asks which of my people a connection is, or for a new one's name, and
 * puts it there. Resolves with the person's name once it's done, or null
 * if cancelled.
 * @param {string} id my side of the connection
 * @param {{ newPerson?: boolean, suggested?: string | null }} [options] newPerson: ask for a new person's name
 * @returns {Promise<string | null>}
 */
export function chooseConnectionPerson(id, { newPerson = false, suggested = null } = {}) {
  return new Promise((resolve) => {
    /** @type {string | null} */
    let result = null;
    const message = h("p", { className: "message", id: "connect-message" });
    const save = h("button", { type: "submit", className: "primary", id: "connect-save" }, newPerson ? "Add and link" : "Link");
    const name = privateField(h("input", { id: "connect-name", required: true, maxLength: 200, value: suggested ?? "" }));
    const select = h("select", { id: "connect-person" });
    const form = h("form", { onsubmit: submit },
      newPerson
        ? [h("label", { htmlFor: "connect-name" }, "Their name"), name,
          h("p", { className: "hint" }, "Nothing about them came with the connection: add what you know on their card.")]
        : [h("label", { htmlFor: "connect-person" }, "Who is this?"), select],
      save,
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Cancel"),
      message);
    const dialog = h("dialog", { className: "form-dialog", "aria-labelledby": "connect-heading" },
      h("h2", { id: "connect-heading" }, newPerson ? "Add a Person for this connection" : "Add to a Person"),
      form);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });

    /** @type {any[]} */
    let people = [];
    if (!newPerson) {
      save.disabled = true;
      linkablePeople().then((list) => {
        people = list;
        if (people.length === 0) return showMessage(message, "There's no one in your People yet: add a new Person instead.");
        select.append(...people.map((p) => h("option", { value: p.id, selected: !!suggested && p.name.toLowerCase() === suggested.toLowerCase() }, p.name)));
        save.disabled = false;
      }, (err) => showMessage(message, "Couldn't load your People: " + errorMessage(err), true));
    }

    /** @param {SubmitEvent} event */
    async function submit(event) {
      event.preventDefault();
      save.disabled = true;
      showMessage(message, "Saving…");
      try {
        let personId = select.value;
        let personName = people.find((p) => p.id === personId)?.name ?? "";
        if (newPerson) {
          personName = name.value.trim();
          personId = await saveItem("people", null, { name: personName });
        }
        await linkConnection(id, personId);
        result = personName;
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't link it: " + errorMessage(err), true);
        save.disabled = false;
      }
    }

    document.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * The link icon a Person linked to their account shows, in the accent.
 * @param {string | null} [label] what it says to screen readers; null
 *   where the words beside it say it already (it's then hidden from them)
 */
export function linkIcon(label = "Linked to their account") {
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", class: "link-icon",
    fill: "none", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round",
  })) svg.setAttribute(k, v);
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const title = document.createElementNS(SVG, "title");
    title.textContent = label;
    svg.append(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  for (const d of ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
    "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
