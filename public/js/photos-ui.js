// Photos and videos in a form's Visuals section (visuals-ui.js, which holds
// the grid and the order): choosing and adding them (a ▶ marks a video),
// their thumbnails, and the viewer: the full size, a video's speeds, its
// caption, moving it earlier or later, and deleting it.
//
// On something already saved, each one is uploaded as it's added. On a new
// tie, plan or workshop, they wait in the form and are uploaded once it's
// saved (savePending), as they need its id.
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
import { openPhoto, sealCaption, openMedia, copyMedia, CantOpen } from "./vault.js";
import { uploadPhoto, uploadSealed } from "./photo-upload.js";
import { photoUrl, revoke } from "./photo-urls.js";
import { viewerParts } from "./visual-viewer.js";
import { iconButton } from "./dialog-icons.js";
import { chooseCopyTarget } from "./drawing-copy.js";

/** @typedef {{ tie_id: string } | { plan_id: string } | { workshop_id: string }} Item */
/** @typedef {import("./photo-prep.js").PreparedPhoto} PreparedPhoto */
/** @typedef {import("./video-prep.js").PreparedVideo} PreparedVideo */

/**
 * A photo or video in the section: saved (with an id from the server's
 * list) or waiting for its tie to be saved (prepared).
 * @typedef {{
 *   id: string, kind: "photo" | "video", mime: string, caption: string | null, unreadable?: boolean,
 *   thumbUrl?: string, prepared?: PreparedPhoto | PreparedVideo, position?: number, created_at?: string,
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
 * Photos and videos, for the Visuals section.
 * @param {import("./visuals-ui.js").VisualContext} ctx
 */
export function photoKind(ctx) {
  const { idPrefix } = ctx;
  /** Every photo and video, in the order added (the section has their order). @type {Photo[]} */
  let photos = [];

  const input = privateField(h("input", {
    type: "file", accept: `${ACCEPT},${VIDEO_ACCEPT}`, multiple: true, hidden: true, id: `${idPrefix}-photo-input`, onchange: addChosen,
  }));

  /**
   * @param {import("./visuals-ui.js").Item} item
   * @returns {Promise<Photo[]>}
   */
  async function load(item) {
    /** @type {{ id: string, kind: "photo" | "video", mime: string, caption: string | null, position: number, created_at: string }[]} */
    const listed = await api(`/api/media?${new URLSearchParams(item)}`);
    const opened = await openMedia(listed);
    const loaded = opened.map((p, i) => /** @type {Photo} */ ({
      id: p.id, kind: p.kind, mime: p.mime, caption: p.caption, unreadable: !!p.unreadable,
      position: listed[i].position, created_at: listed[i].created_at,
    }));
    photos = loaded;
    Promise.all(loaded.map(loadThumb));
    return loaded;
  }

  /** @param {Photo} photo */
  async function loadThumb(photo) {
    try {
      const bytes = await openPhoto(photo.id, "thumb", photo.kind);
      if (ctx.closed()) return;
      setThumb(photo, photoUrl(bytes, thumbType(photo)));
    } catch (err) {
      if (err instanceof CantOpen) {
        photo.unreadable = true;
        ctx.draw();
      } else {
        ctx.say("Couldn't load a photo: " + errorMessage(err), true);
      }
    }
  }

  /** @param {Photo} photo @param {string} url */
  function setThumb(photo, url) {
    if (photo.thumbUrl) revoke(photo.thumbUrl);
    photo.thumbUrl = url;
    ctx.draw();
  }

  /** @param {Photo} photo */
  const look = (photo) => ({
    icon: photo.kind,
    noun: noun(photo),
    thumb: photo.thumbUrl ? h("img", { src: photo.thumbUrl, alt: "" })
      : h("span", { className: "photo-placeholder" }, photo.unreadable ? "Can't decrypt" : "…"),
    caption: photo.caption,
    unreadable: false,
  });

  async function addChosen() {
    const files = [...(input.files ?? [])];
    input.value = "";
    await addFiles(files);
  }

  /**
   * Prepares and adds photos and videos (chosen, or made on the page, like
   * a picture of a pose): uploaded now if the item is saved, otherwise
   * waiting for it. Each goes last.
   * @param {File[]} files
   * @returns {Promise<string[]>} what went wrong with any of them
   */
  function addFiles(files) {
    return ctx.busy(async () => {
      const room = MAX_PHOTOS - photos.length;
      if (files.length > room) ctx.say(`There can be at most ${MAX_PHOTOS} photos and videos, so only ${room} more can be added.`, true);
      const problems = [];
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
              throw new Error(`There can be at most ${MAX_VIDEOS} videos on a tie, plan or workshop.`);
            }
            ctx.say(`Preparing video ${counted}…`);
            const { prepareVideo } = await import("./video-prep.js");
            prepared = await prepareVideo(file, {
              onProgress: (fraction) => ctx.say(`Preparing video ${counted}… ${Math.round(fraction * 100)}%`),
              withoutSound: () => askWithoutSound(file.name),
            });
          } else {
            ctx.say(`Preparing photo ${counted}…`);
            prepared = await preparePhoto(file);
          }
          /** @type {Photo} */
          const photo = { id: crypto.randomUUID(), kind, mime: prepared.mime, caption: null, prepared };
          const item = ctx.item();
          if (item) {
            ctx.say(`Uploading ${kind} ${counted}…`);
            await upload(item, photo);
          } else {
            photos.push(photo);
            ctx.append("media", photo);
            setThumb(photo, photoUrl(prepared.thumb.slice(0), thumbType(photo)));
          }
        } catch (err) {
          problems.push(`${file.name}: ${errorMessage(err)}`);
        }
      }
      if (problems.length) ctx.say(problems.join(" "), true);
      else if (files.length <= room) ctx.say("");
      if (files.length > room) problems.push("There's no room for more photos.");
      return problems;
    });
  }

  /**
   * Seals a prepared photo or video and uploads it, last on the item, then
   * its caption if it has one. Adds it to the section (or updates it there).
   * @param {import("./visuals-ui.js").Item} target
   * @param {Photo} photo with prepared
   */
  async function upload(target, photo) {
    const prepared = /** @type {PreparedPhoto | PreparedVideo} */ (photo.prepared);
    // The thumbnail is shown from a copy: uploading hands the buffers over
    // to the crypto Worker, emptying them here.
    const thumbCopy = prepared.thumb.slice(0);
    await uploadPhoto({ item: target, prepared, caption: photo.caption, id: photo.id });
    delete photo.prepared;
    if (!photos.includes(photo)) {
      photos.push(photo);
      ctx.append("media", photo);
    }
    setThumb(photo, photoUrl(thumbCopy, thumbType(photo)));
  }

  /** @param {Photo} photo */
  function view(photo) {
    const message = h("p", { className: "message", id: `${idPrefix}-viewer-message`, "aria-live": "polite" });
    /** @param {string} text @param {boolean} [isError] */
    const tell = (text, isError = false) => showMessage(message, text, isError);
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
    const parts = viewerParts({
      id: `${idPrefix}-photo`, noun: noun(photo), caption: photo.caption,
      nav: ctx.nav(photo), tell,
      save: async (text) => {
        if (!photo.prepared) {
          await api(`/api/media/${photo.id}`, { method: "PATCH", body: { caption: await sealCaption(photo.id, text ?? "") } });
        }
        photo.caption = text;
        if (image instanceof HTMLImageElement) image.alt = text ?? "";
        ctx.draw();
      },
    });
    /** @type {string | null} */
    let fullUrl = null;

    const dialog = h("dialog", { className: "form-dialog photo-viewer", "aria-label": noun(photo) },
      parts.head(() => dialog.close()),
      image,
      speeds,
      parts.captionBox,
      // No edit or duplicate: Copy to… keeps the place it has on the others.
      parts.toolbar({
        copy: iconButton("copy", { id: `${idPrefix}-photo-copy`, label: "Copy to…", onclick: copy }),
        remove: iconButton("delete", { id: `${idPrefix}-photo-delete`, label: `Delete ${photo.kind}`, onclick: remove }),
      }),
      message);
    parts.attach(dialog);
    dialog.addEventListener("close", () => {
      if (image instanceof HTMLVideoElement) image.pause();
      if (fullUrl) revoke(fullUrl);
      dialog.remove();
    });

    async function showFull() {
      if (photo.prepared) {
        fullUrl = photoUrl(photo.prepared.full.slice(0), photo.mime);
        image.src = fullUrl;
        return;
      }
      // A video shows its thumbnail as its poster until it's loaded.
      if (!isVideoShown) image.src = photo.thumbUrl ?? "";
      else tell("Loading the video…");
      try {
        const url = photoUrl(await openPhoto(photo.id, "full", photo.kind), photo.mime);
        if (!dialog.open) {
          revoke(url);
          return;
        }
        fullUrl = url;
        image.src = fullUrl;
        tell("");
      } catch (err) {
        tell(err instanceof CantOpen
          ? `This ${photo.kind} can't be decrypted.` : `Couldn't load the ${photo.kind}: ` + errorMessage(err), true);
      }
    }

    // A copy is a new file (each is sealed bound to its own id), counted in
    // the 1 GB like any other: one already saved is opened and sealed again
    // in the crypto Worker; one waiting for this form's save, sealed afresh.
    async function copy() {
      const target = await chooseCopyTarget({ exclude: ctx.item(), noun: photo.kind });
      if (!target) return;
      try {
        tell("Copying…");
        const id = crypto.randomUUID();
        if (photo.prepared) {
          const { thumb, full } = photo.prepared;
          await uploadPhoto({ item: target.item, id, caption: photo.caption, prepared: { ...photo.prepared, thumb: thumb.slice(0), full: full.slice(0) } });
        } else {
          const sealed = await copyMedia({ mediaId: photo.id, newId: id, kind: photo.kind });
          await uploadSealed({ item: target.item, id, kind: photo.kind, mime: photo.mime, caption: photo.caption, ...sealed });
        }
        tell(`Copied to "${target.title}".`);
      } catch (err) {
        tell(err instanceof CantOpen ? `This ${photo.kind} can't be decrypted, so it can't be copied.` : "Couldn't copy it: " + errorMessage(err), true);
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
        forget(photo);
        ctx.remove(photo);
        dialog.close();
      } catch (err) {
        tell("Couldn't delete: " + errorMessage(err), true);
      }
    }

    parts.show(dialog);
    showFull();
  }

  /** @param {Photo} photo */
  function forget(photo) {
    if (photo.thumbUrl) revoke(photo.thumbUrl);
    delete photo.thumbUrl;
  }

  return {
    extra: input,
    load,
    look,
    view,
    add: () => input.click(),
    addFiles,
    room: () => (photos.length >= MAX_PHOTOS ? `There can be at most ${MAX_PHOTOS} photos and videos.` : null),
    /** @param {Photo} photo */
    waiting: (photo) => !!photo.prepared,
    /** @param {Photo} photo @param {import("./visuals-ui.js").Item} target */
    savePending: (photo, target) => upload(target, photo),
    forget,
  };
}
