// The Photos section of the tie form (and the plan form): thumbnails in a
// grid, each with its caption, and a + to add photos and videos (a ▶ marks
// a video). Tapping one opens the
// viewer: the full size, its caption, moving it earlier or later, and
// deleting it. Photos can also be dragged into order, with a mouse or (after
// holding still a moment, so a swipe still scrolls) a finger; the viewer's
// Move earlier/later buttons stay for keyboards and screen readers.
//
// On something already saved, each change is saved as it's made. On a new
// tie, the photos wait in the form and are uploaded once the tie is saved
// (uploadPending), as they need its id.
//
// Every photo or video is prepared (metadata stripped, shrunk: photo-prep.js,
// video-prep.js) and sealed (in the crypto Worker) before it leaves the
// device, and decrypted ones are only shown from blob: URLs that are revoked
// when the journal locks or the section closes. A video plays in the viewer,
// at a speed chosen there; video-prep.js (and the library it uses) is only
// loaded once a video is chosen.

import { api, errorMessage } from "./api.js";
import { h, showMessage, privateField } from "./dom.js";
import { choose } from "./dialog.js";
import { preparePhoto } from "./photo-prep.js";
import { ACCEPT } from "./photo-fit.js";
import { VIDEO_ACCEPT, isVideo } from "./video-fit.js";
import { openPhoto, sealCaption, openMedia, CantOpen } from "./vault.js";
import { uploadPhoto } from "./photo-upload.js";
import { photoUrl, revoke } from "./photo-urls.js";
import { MAX_CAPTION } from "./crypto/media.js";
import { moveItem } from "./drag-order.js";
import { tileDrag } from "./tile-drag.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./photo-prep.js").PreparedPhoto} PreparedPhoto */
/** @typedef {import("./video-prep.js").PreparedVideo} PreparedVideo */

/**
 * A photo or video in the section: saved (with an id from the server's
 * list) or waiting for its tie to be saved (prepared).
 * @typedef {{
 *   id: string, kind: "photo" | "video", mime: string, caption: string | null, unreadable?: boolean,
 *   thumbUrl?: string, prepared?: PreparedPhoto | PreparedVideo,
 * }} Photo
 */

/** The most photos and videos on one tie or plan (also checked by the server). */
export const MAX_PHOTOS = 30;
/** Of those, videos. */
export const MAX_VIDEOS = 5;
/** The playback speeds offered for a video. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2];

/**
 * Asked when this browser can't encode a video's sound: upload it silent,
 * or leave it out.
 * @param {string} name the file's
 * @returns {Promise<boolean>}
 */
export async function askWithoutSound(name) {
  const choice = await choose({
    title: "Upload without sound?",
    message: `This browser can't encode the sound in ${name}, so it can only be uploaded silent. ` +
      "To keep its sound, add it from the latest Chrome or Safari instead.",
    choices: [{ label: "Upload without sound", value: "silent" }],
  });
  return choice === "silent";
}

/** @param {Photo} photo */
const noun = (photo) => (photo.kind === "video" ? "Video" : "Photo");
/** A thumbnail's type: a photo's own, or JPEG for a video's (video-prep.js). @param {Photo} photo */
const thumbType = (photo) => (photo.kind === "video" ? "image/jpeg" : photo.mime);

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
  const drag = tileDrag(grid, {
    count: () => photos.length,
    onDrop: async (from, to) => {
      try {
        await saveOrder(moveItem(photos, from, to));
        say("");
      } catch (err) {
        say("Couldn't move it: " + errorMessage(err), true);
      }
    },
  });
  const input = privateField(h("input", {
    type: "file", accept: `${ACCEPT},${VIDEO_ACCEPT}`, multiple: true, hidden: true, id: `${idPrefix}-photo-input`, onchange: addChosen,
  }));
  const addButton = h("button", {
    type: "button", className: "label-add", id: `${idPrefix}-add-photos`,
    "aria-label": "Add photos or videos", title: "Add photos or videos", onclick: () => input.click(),
  }, "+");
  const element = h("div", { className: "photo-section" },
    h("div", { className: "label-row" }, h("label", {}, "Photos and videos"), addButton),
    input,
    grid,
    // A new tie or plan's photos wait for the form to be saved; when
    // editing, they're uploaded as they're added.
    h("p", { className: "hint" }, item
      ? "Drag photos into order and caption them to describe a sequence."
      : "Drag photos into order and caption them to describe a sequence. They are uploaded when you save this form."),
    status);

  /** @param {string} text @param {boolean} [isError] */
  const say = (text, isError = false) => showMessage(status, text, isError);

  async function load() {
    if (!item) return;
    say("Loading photos…");
    try {
      /** @type {{ id: string, kind: "photo" | "video", mime: string, caption: string | null }[]} */
      const listed = await api(`/api/media?${new URLSearchParams(item)}`);
      const opened = await openMedia(listed);
      photos = opened.map((p) => ({ id: p.id, kind: p.kind, mime: p.mime, caption: p.caption, unreadable: !!p.unreadable }));
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
      const bytes = await openPhoto(photo.id, "thumb", photo.kind);
      setThumb(photo, photoUrl(bytes, thumbType(photo)));
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
      const label = `${noun(photo)} ${i + 1} of ${photos.length}${photo.caption ? `: ${photo.caption}` : ""}`;
      return h("figure", { className: "photo-tile" },
        h("button", { type: "button", className: "photo-thumb", "aria-label": label, onclick: () => view(photo) },
          photo.thumbUrl ? h("img", { src: photo.thumbUrl, alt: "" })
            : h("span", { className: "photo-placeholder" }, photo.unreadable ? "Can't decrypt" : "…"),
          photo.kind === "video" ? h("span", { className: "video-badge", "aria-hidden": "true" }, "▶") : null),
        photo.caption ? h("figcaption", {}, photo.caption) : null);
    }));
    addButton.disabled = photos.length >= MAX_PHOTOS;
  }

  /**
   * Puts the photos in this order, saving it if they're all saved. Waiting
   * photos (a new tie) are only in this form until it's saved.
   * @param {Photo[]} order
   */
  async function saveOrder(order) {
    const saved = order.filter((p) => !p.prepared);
    if (item && saved.length === order.length) {
      await api("/api/media/order", { method: "PUT", body: { ...item, ids: saved.map((p) => p.id) } });
    }
    photos = order;
    draw();
  }

  async function addChosen() {
    const files = [...(input.files ?? [])];
    input.value = "";
    await addFiles(files);
  }

  /**
   * Prepares and adds photos and videos (chosen, or made on the page, like
   * a picture of a pose): uploaded now if the item is saved, otherwise
   * waiting for it.
   * @param {File[]} files
   * @returns {Promise<string[]>} what went wrong with any of them
   */
  async function addFiles(files) {
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) say(`There can be at most ${MAX_PHOTOS} photos and videos, so only ${room} more can be added.`, true);
    const problems = [];
    busy++;
    const chosen = files.slice(0, Math.max(0, room));
    for (const [i, file] of chosen.entries()) {
      const counted = `${i + 1} of ${chosen.length}`;
      try {
        /** @type {PreparedPhoto | PreparedVideo} */
        let prepared;
        /** @type {Photo["kind"]} */
        let kind = "photo";
        if (isVideo(file)) {
          kind = "video";
          if (photos.filter((p) => p.kind === "video").length >= MAX_VIDEOS) {
            throw new Error(`There can be at most ${MAX_VIDEOS} videos on a tie or plan.`);
          }
          say(`Preparing video ${counted}…`);
          const { prepareVideo } = await import("./video-prep.js");
          prepared = await prepareVideo(file, {
            onProgress: (fraction) => say(`Preparing video ${counted}… ${Math.round(fraction * 100)}%`),
            withoutSound: () => askWithoutSound(file.name),
          });
        } else {
          say(`Preparing photo ${counted}…`);
          prepared = await preparePhoto(file);
        }
        /** @type {Photo} */
        const photo = { id: crypto.randomUUID(), kind, mime: prepared.mime, caption: null, prepared };
        if (item) {
          say(`Uploading ${kind} ${counted}…`);
          await upload(item, photo);
        } else {
          photos.push(photo);
          setThumb(photo, photoUrl(prepared.thumb.slice(0), thumbType(photo)));
        }
      } catch (err) {
        problems.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
    busy--;
    if (problems.length) say(problems.join(" "), true);
    else if (files.length <= room) say("");
    if (files.length > room) problems.push("There's no room for more photos.");
    return problems;
  }

  /**
   * Seals a prepared photo or video and uploads it, last on the item, then
   * its caption if it has one. Adds it to the grid (or updates it there).
   * @param {Item} target
   * @param {Photo} photo with prepared
   */
  async function upload(target, photo) {
    const prepared = /** @type {PreparedPhoto | PreparedVideo} */ (photo.prepared);
    // The thumbnail is shown from a copy: uploading hands the buffers over
    // to the crypto Worker, emptying them here.
    const thumbCopy = prepared.thumb.slice(0);
    await uploadPhoto({ item: target, prepared, caption: photo.caption, id: photo.id });
    delete photo.prepared;
    if (!photos.includes(photo)) photos.push(photo);
    setThumb(photo, photoUrl(thumbCopy, thumbType(photo)));
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
      say(`Uploading ${photo.kind} ${i + 1} of ${waiting.length}…`);
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
    const isVideoShown = photo.kind === "video";
    const image = isVideoShown
      ? h("video", { className: "photo-full", id: `${idPrefix}-video`, controls: true, playsInline: true, preload: "metadata", poster: photo.thumbUrl })
      : h("img", { className: "photo-full", alt: photo.caption ?? "" });
    // The speed is kept on the element's default too, as loading the
    // video resets the rate to it.
    const speedButtons = SPEEDS.map((speed) => h("button", {
      type: "button", className: "speed", "aria-pressed": String(speed === 1), onclick: () => setSpeed(speed),
    }, `${speed}×`));
    const speeds = isVideoShown
      ? h("div", { className: "speeds", role: "group", "aria-label": "Playback speed", id: `${idPrefix}-video-speeds` },
        h("span", { className: "hint" }, "Speed"), speedButtons)
      : null;
    /** @param {number} speed */
    function setSpeed(speed) {
      const video = /** @type {HTMLVideoElement} */ (image);
      video.defaultPlaybackRate = speed;
      video.playbackRate = speed;
      for (const [i, button] of speedButtons.entries()) button.setAttribute("aria-pressed", String(SPEEDS[i] === speed));
    }
    const captionInput = privateField(h("input", {
      id: `${idPrefix}-photo-caption`, maxLength: MAX_CAPTION, value: photo.caption ?? "", placeholder: "e.g. Front, or the second wrap",
    }));
    const earlier = h("button", { type: "button", id: `${idPrefix}-photo-earlier`, onclick: () => move(-1) }, "Move earlier");
    const later = h("button", { type: "button", id: `${idPrefix}-photo-later`, onclick: () => move(1) }, "Move later");
    const position = h("p", { className: "hint" });
    /** @type {string | null} */
    let fullUrl = null;

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": noun(photo) },
      image,
      speeds,
      position,
      h("label", { htmlFor: `${idPrefix}-photo-caption` }, "Caption"),
      captionInput,
      h("div", { className: "dialog-buttons" },
        h("button", { type: "button", id: `${idPrefix}-photo-save-caption`, onclick: saveCaption }, "Save caption"),
        earlier, later),
      h("button", { type: "button", className: "dialog-cancel", onclick: () => dialog.close() }, "Close"),
      h("button", { type: "button", className: "danger dialog-delete", id: `${idPrefix}-photo-delete`, onclick: remove }, `Delete ${photo.kind}`),
      message);
    dialog.addEventListener("close", () => {
      if (image instanceof HTMLVideoElement) image.pause();
      if (fullUrl) revoke(fullUrl);
      dialog.remove();
    });

    function showPosition() {
      position.textContent = `${noun(photo)} ${index() + 1} of ${photos.length}`;
      earlier.disabled = index() <= 0;
      later.disabled = index() >= photos.length - 1;
    }

    async function showFull() {
      if (photo.prepared) {
        fullUrl = photoUrl(photo.prepared.full.slice(0), photo.mime);
        image.src = fullUrl;
        return;
      }
      // A video shows its thumbnail as its poster until it's loaded.
      if (!isVideoShown) image.src = photo.thumbUrl ?? "";
      else showMessage(message, "Loading the video…");
      try {
        fullUrl = photoUrl(await openPhoto(photo.id, "full", photo.kind), photo.mime);
        image.src = fullUrl;
        showMessage(message, "");
      } catch (err) {
        showMessage(message, err instanceof CantOpen
          ? `This ${photo.kind} can't be decrypted.` : `Couldn't load the ${photo.kind}: ` + errorMessage(err), true);
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
        if (image instanceof HTMLImageElement) image.alt = text;
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
      try {
        await saveOrder(moveItem(photos, from, to));
        showPosition();
        showMessage(message, "");
      } catch (err) {
        showMessage(message, "Couldn't move it: " + errorMessage(err), true);
      }
    }

    async function remove() {
      const choice = await choose({
        title: `Delete this ${photo.kind}?`,
        message: "It'll be gone for good.",
        choices: [{ label: `Delete ${photo.kind}`, value: "delete", style: "solid-danger" }],
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
    drag.stop();
    for (const photo of photos) if (photo.thumbUrl) revoke(photo.thumbUrl);
    photos = [];
  }

  load();
  return {
    element,
    uploadPending,
    addFiles,
    close,
    /** Whether photos are still being prepared or uploaded. */
    get busy() { return busy > 0; },
    /** Whether any photos are waiting for the tie to be saved. */
    get waiting() { return photos.some((p) => p.prepared); },
  };
}
