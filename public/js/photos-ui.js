// The Photos section of the tie form (and the plan form): thumbnails in a
// grid, each with its caption, and a + to add photos. Tapping one opens the
// viewer: the full size, its caption, moving it earlier or later, and
// deleting it.
//
// On something already saved, each change is saved as it's made. On a new
// tie, the photos wait in the form and are uploaded once the tie is saved
// (uploadPending), as they need its id.
//
// Every photo is prepared (metadata stripped, shrunk: photo-prep.js) and
// sealed (in the crypto Worker) before it leaves the device, and decrypted
// photos are only shown from blob: URLs that are revoked when the journal
// locks or the section closes.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { preparePhoto } from "./photo-prep.js";
import { ACCEPT } from "./photo-fit.js";
import { openPhoto, sealCaption, openMedia, CantOpen } from "./vault.js";
import { uploadPhoto } from "./photo-upload.js";
import { photoUrl, revoke } from "./photo-urls.js";
import { MAX_CAPTION } from "./crypto/media.js";

/** @typedef {{ tie_id: string } | { plan_id: string }} Item */
/** @typedef {import("./photo-prep.js").PreparedPhoto} PreparedPhoto */

/**
 * A photo in the section: saved (with an id from the server's list) or
 * waiting for its tie to be saved (prepared).
 * @typedef {{
 *   id: string, mime: string, caption: string | null, unreadable?: boolean,
 *   thumbUrl?: string, prepared?: PreparedPhoto,
 * }} Photo
 */

/** The most photos on one tie or plan (also checked by the server). */
export const MAX_PHOTOS = 30;

/**
 * @param {{ item: Item | null, idPrefix: string }} options item: what's
 *   being edited, or null for a new tie (photos wait for uploadPending)
 */
export function photoSection({ item, idPrefix }) {
  /** @type {Photo[]} */
  let photos = [];
  let busy = 0;

  const status = h("p", { className: "message", id: `${idPrefix}-photos-message`, "aria-live": "polite" });
  const grid = h("div", { className: "photo-grid", id: `${idPrefix}-photos` });
  const input = privateField(h("input", { type: "file", accept: ACCEPT, multiple: true, hidden: true, id: `${idPrefix}-photo-input`, onchange: addChosen }));
  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-add-photos`,
    "aria-label": "Add photos", title: "Add photos", onclick: () => input.click(),
  }, "+");
  const element = h("div", { className: "photo-section" },
    h("div", { className: "label-row" }, h("label", {}, "Photos"), addButton),
    input,
    grid,
    // A new tie or plan's photos wait for the form to be saved; when
    // editing, they're uploaded as they're added.
    h("p", { className: "hint" }, item
      ? "Photos can be arranged and captioned to describe a sequence."
      : "Photos can be arranged and captioned to describe a sequence. They are uploaded when you save this form."),
    status);

  /** @param {string} text @param {boolean} [isError] */
  const say = (text, isError = false) => showMessage(status, text, isError);

  async function load() {
    if (!item) return;
    say("Loading photos…");
    try {
      /** @type {{ id: string, mime: string, caption: string | null }[]} */
      const listed = await api(`/api/media?${new URLSearchParams(item)}`);
      const opened = await openMedia(listed);
      photos = opened.map((p) => ({ id: p.id, mime: p.mime, caption: p.caption, unreadable: !!p.unreadable }));
      draw();
      say("");
      await Promise.all(photos.map(loadThumb));
    } catch (err) {
      say("Couldn't load the photos: " + errorMessage(err), true);
    }
  }

  /** @param {Photo} photo */
  async function loadThumb(photo) {
    try {
      const bytes = await openPhoto(photo.id, "thumb");
      setThumb(photo, photoUrl(bytes, photo.mime));
    } catch (err) {
      if (err instanceof CantOpen) {
        photo.unreadable = true;
        draw();
      } else {
        say("Couldn't load a photo: " + errorMessage(err), true);
      }
    }
  }

  /** @param {Photo} photo @param {string} url */
  function setThumb(photo, url) {
    if (photo.thumbUrl) revoke(photo.thumbUrl);
    photo.thumbUrl = url;
    draw();
  }

  function draw() {
    grid.replaceChildren(...photos.map((photo, i) => {
      const label = `Photo ${i + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ""}`;
      return h("figure", { className: "photo-tile" },
        h("button", { type: "button", className: "photo-thumb", "aria-label": label, onclick: () => view(photo) },
          photo.thumbUrl ? h("img", { src: photo.thumbUrl, alt: "" })
            : h("span", { className: "photo-placeholder" }, photo.unreadable ? "Can't decrypt" : "…")),
        photo.caption ? h("figcaption", {}, photo.caption) : null);
    }));
    addButton.disabled = photos.length >= MAX_PHOTOS;
  }

  async function addChosen() {
    const files = [...(input.files ?? [])];
    input.value = "";
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) say(`There can be at most ${MAX_PHOTOS} photos, so only ${room} more can be added.`, true);
    const problems = [];
    busy++;
    for (const [i, file] of files.slice(0, Math.max(0, room)).entries()) {
      say(`Preparing photo ${i + 1} of ${Math.min(files.length, room)}…`);
      try {
        const prepared = await preparePhoto(file);
        if (item) await upload(item, { id: crypto.randomUUID(), mime: prepared.mime, caption: null, prepared });
        else {
          const photo = { id: crypto.randomUUID(), mime: prepared.mime, caption: null, prepared };
          photos.push(photo);
          setThumb(photo, photoUrl(prepared.thumb.slice(0), prepared.mime));
        }
      } catch (err) {
        problems.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
    busy--;
    if (problems.length) say(problems.join(" "), true);
    else if (files.length <= room) say("");
  }

  /**
   * Seals a prepared photo and uploads it, last on the item, then its
   * caption if it has one. Adds it to the grid (or updates it there).
   * @param {Item} target
   * @param {Photo} photo with prepared
   */
  async function upload(target, photo) {
    const prepared = /** @type {PreparedPhoto} */ (photo.prepared);
    // The thumbnail is shown from a copy: uploading hands the buffers over
    // to the crypto Worker, emptying them here.
    const thumbCopy = prepared.thumb.slice(0);
    await uploadPhoto({ item: target, prepared, caption: photo.caption, id: photo.id });
    delete photo.prepared;
    if (!photos.includes(photo)) photos.push(photo);
    setThumb(photo, photoUrl(thumbCopy, prepared.mime));
  }

  /**
   * After a new tie is saved: uploads the photos waiting for it, in order.
   * Ones that fail stay waiting, so saving again tries them again.
   * @param {Item} target
   * @returns {Promise<string | null>} what went wrong, or null
   */
  async function uploadPending(target) {
    item = target;
    const waiting = photos.filter((p) => p.prepared);
    for (const [i, photo] of waiting.entries()) {
      say(`Uploading photo ${i + 1} of ${waiting.length}…`);
      try {
        await upload(target, photo);
      } catch (err) {
        say("", false);
        return errorMessage(err);
      }
    }
    say("");
    return null;
  }

  /** @param {Photo} photo */
  function view(photo) {
    const index = () => photos.indexOf(photo);
    const message = h("p", { className: "message", id: `${idPrefix}-viewer-message` });
    const image = h("img", { className: "photo-full", alt: photo.caption ?? "" });
    const captionInput = privateField(h("input", {
      id: `${idPrefix}-photo-caption`, maxLength: MAX_CAPTION, value: photo.caption ?? "", placeholder: "e.g. Front, or the second wrap",
    }));
    const earlier = h("button", { type: "button", id: `${idPrefix}-photo-earlier`, onclick: () => move(-1) }, "Move earlier");
    const later = h("button", { type: "button", id: `${idPrefix}-photo-later`, onclick: () => move(1) }, "Move later");
    const position = h("p", { className: "hint" });
    /** @type {string | null} */
    let fullUrl = null;

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": "Photo" },
      image,
      position,
      h("label", { htmlFor: `${idPrefix}-photo-caption` }, "Caption"),
      captionInput,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "button", id: `${idPrefix}-photo-save-caption`, onclick: saveCaption }, "Save caption"),
        earlier, later),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Close"),
      h("button", { type: "button", className: "danger dialog-delete", id: `${idPrefix}-photo-delete`, onclick: remove }, "Delete photo"),
      message);
    dialog.addEventListener("close", () => {
      if (fullUrl) revoke(fullUrl);
      dialog.remove();
    });

    function showPosition() {
      position.textContent = `Photo ${index() + 1} of ${photos.length}`;
      earlier.disabled = index() <= 0;
      later.disabled = index() >= photos.length - 1;
    }

    async function showFull() {
      if (photo.prepared) {
        fullUrl = photoUrl(photo.prepared.full.slice(0), photo.mime);
        image.src = fullUrl;
        return;
      }
      image.src = photo.thumbUrl ?? "";
      try {
        fullUrl = photoUrl(await openPhoto(photo.id, "full"), photo.mime);
        image.src = fullUrl;
      } catch (err) {
        showMessage(message, err instanceof CantOpen ? "This photo can't be decrypted." : "Couldn't load the photo: " + errorMessage(err), true);
      }
    }

    async function saveCaption() {
      const text = captionInput.value.trim();
      try {
        if (!photo.prepared) {
          showMessage(message, "Saving…");
          await api(`/api/media/${photo.id}`, { method: "PATCH", body: { caption: await sealCaption(photo.id, text) } });
        }
        photo.caption = text || null;
        image.alt = text;
        draw();
        showMessage(message, "Caption saved.");
      } catch (err) {
        showMessage(message, "Couldn't save the caption: " + errorMessage(err), true);
      }
    }

    /** @param {number} step -1 earlier, 1 later */
    async function move(step) {
      const from = index();
      const to = from + step;
      if (to < 0 || to >= photos.length) return;
      const order = [...photos];
      [order[from], order[to]] = [order[to], order[from]];
      try {
        // Waiting photos (a new tie) are only in this form until it's saved.
        const saved = order.filter((p) => !p.prepared);
        if (item && saved.length === order.length) {
          await api("/api/media/order", { method: "PUT", body: { ...item, ids: saved.map((p) => p.id) } });
        }
        photos = order;
        draw();
        showPosition();
        showMessage(message, "");
      } catch (err) {
        showMessage(message, "Couldn't move it: " + errorMessage(err), true);
      }
    }

    async function remove() {
      const choice = await choose({
        title: "Delete this photo?",
        message: "It'll be gone for good.",
        choices: [{ label: "Delete photo", value: "delete", style: "solid-danger" }],
      });
      if (choice !== "delete") return;
      try {
        if (!photo.prepared) await api(`/api/media/${photo.id}`, { method: "DELETE" });
        photos = photos.filter((p) => p !== photo);
        if (photo.thumbUrl) revoke(photo.thumbUrl);
        draw();
        dialog.close();
      } catch (err) {
        showMessage(message, "Couldn't delete: " + errorMessage(err), true);
      }
    }

    document.body.append(dialog);
    dialog.showModal();
    showPosition();
    showFull();
  }

  /** Revokes everything this section showed (when its form closes). */
  function close() {
    for (const photo of photos) if (photo.thumbUrl) revoke(photo.thumbUrl);
    photos = [];
  }

  load();
  return {
    element,
    uploadPending,
    close,
    /** Whether photos are still being prepared or uploaded. */
    get busy() { return busy > 0; },
    /** Whether any photos are waiting for the tie to be saved. */
    get waiting() { return photos.some((p) => p.prepared); },
  };
}
