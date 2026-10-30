// The poser's pickers, in place of plain menus: Body presets and Arms
// presets (the built-in ones, then my saved ones, with a search box,
// Save as preset, and on each of mine Save over, Rename and Delete), and
// Turn body (where the whole body faces). Tapping a row anywhere but its
// icons chooses it and closes the picker; ✕ closes it with nothing changed.
// The row the figure is in already is tinted. Each opens over the poser,
// as its other questions do (dialog.js), on its heading, so a phone's
// keyboard doesn't open for the search box until it's tapped.

import { h, privateField, showMessage, opensOnTap } from "./dom.js";
import { choose } from "./dialog.js";
import { errorMessage } from "./api.js";
import { dialogHeader, iconButton } from "./dialog-icons.js";
import { presetList } from "./preset-list.js";
import { savedPresets, savePreset, renamePreset, overwritePreset, deletePreset, presetLabel } from "./pose-presets.js";
import { askPresetName } from "./pose-presets-ui.js";
import { MAX_PRESETS, inPreset, bodyPresetFrom, armsPresetFrom } from "./figure-rig.js";

/** @typedef {import("./figure-rig.js").Posture} Posture */
/** @typedef {import("./pose-presets.js").SavedPreset} SavedPreset */

/**
 * A picker's dialog: its heading row (the heading, anything beside it, ✕),
 * then what's put in it.
 * @param {{ id: string, title: string, beside?: HTMLElement[], body: HTMLElement[] }} options
 * @returns {{ dialog: HTMLDialogElement, heading: HTMLHeadingElement, closed: Promise<void> }}
 */
function pickerDialog({ id, title, beside = [], body }) {
  const heading = h("h2", { id: `${id}-title` }, title);
  /** @type {() => void} */
  let resolve = () => {};
  const closed = new Promise((r) => { resolve = () => r(undefined); });
  const dialog = h("dialog", { className: "picker", id, "aria-labelledby": `${id}-title`, onclose: () => { dialog.remove(); resolve(); } },
    dialogHeader(heading, [...beside, iconButton("close", { label: "Close", id: `${id}-close`, onclick: () => dialog.close() })]),
    ...body);
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
  return { dialog, heading, closed };
}

/**
 * One row of a picker: its name as the button keyboards use, tapping it
 * anywhere choosing it.
 * @param {{ id: string, name: string, current: boolean, choose: () => void, icons?: HTMLElement[] }} row
 * @returns {HTMLElement}
 */
function pickerRow({ id, name, current, choose: pick, icons = [] }) {
  return opensOnTap(h("div", { className: current ? "picker-row current" : "picker-row", id },
    h("button", { type: "button", className: "picker-name", "aria-current": current ? "true" : "false", onclick: pick }, name),
    icons.length ? h("span", { className: "picker-icons" }, icons) : null), pick);
}

const KIND_WORDS = /** @type {const} */ ({
  body: { title: "Body Presets", saved: "this body" },
  arms: { title: "Arms Presets", saved: "these arms" },
});

/**
 * Body or Arms presets.
 * @param {{
 *   kind: "body" | "arms",
 *   builtIn: readonly { name: string }[],
 *   posture: () => Posture,
 *   apply: (preset: Record<string, any>) => void,
 * }} options posture: the figure now; apply: puts a preset on it
 * @returns {Promise<void>} once closed
 */
export function pickPreset({ kind, builtIn, posture, apply }) {
  const id = `pose-${kind}-presets`;
  const words = KIND_WORDS[kind];
  /** The figure's angles now, as a preset of this kind (without a name). */
  const now = () => {
    const { name: _name, ...data } = kind === "body" ? bodyPresetFrom(posture(), "") : armsPresetFrom(posture(), "");
    return data;
  };
  const matches = (/** @type {Record<string, any>} */ data) => inPreset(kind, posture(), /** @type {any} */ (data));

  /** @type {SavedPreset[]} */
  let mine = [];
  const search = privateField(h("input", {
    type: "search", id: `${id}-search`, placeholder: "Search", "aria-label": "Search presets", oninput: () => draw(),
  }));
  const list = h("div", { className: "picker-list", id: `${id}-list` });
  const message = h("p", { className: "message", id: `${id}-message`, "aria-live": "polite" });
  const saveButton = h("button", { type: "button", className: "tool picker-save", id: `${id}-save`, onclick: () => saveNew() }, "Save as preset");
  const { dialog, closed } = pickerDialog({ id, title: words.title, beside: [saveButton], body: [search, list, message] });

  /** Chooses one: the figure moves into it and the picker closes. */
  const pick = (/** @type {Record<string, any>} */ data) => {
    apply(data);
    dialog.close();
  };

  function draw() {
    const all = mine.filter((p) => p.kind === kind);
    // Nothing to save when the figure's in one already.
    saveButton.disabled = [...builtIn, ...all.map((p) => p.data)].some((p) => matches(p));
    saveButton.title = saveButton.disabled ? "The figure is in one of these already" : `Save ${words.saved} as a preset`;
    const shown = presetList({
      builtIn: builtIn.map((p, i) => ({ p, i })), builtInName: ({ p }) => p.name, mine: all, mineName: presetLabel,
    }, search.value);
    /** @type {HTMLElement[]} */
    const rows = shown.builtIn.map(({ p, i }) => pickerRow({ id: `${id}-b${i}`, name: p.name, current: matches(p), choose: () => pick(p) }));
    if (shown.mine.length) {
      rows.push(h("div", { className: "picker-divider", role: "separator" }, h("span", {}, "My presets")));
      for (const preset of shown.mine) rows.push(mineRow(preset));
    }
    if (rows.length === 0) rows.push(h("p", { className: "hint" }, "No presets have that in their name."));
    list.replaceChildren(...rows);
  }

  /** @param {SavedPreset} preset */
  function mineRow(preset) {
    const label = presetLabel(preset);
    return pickerRow({
      id: `${id}-s-${preset.id}`, name: label, current: matches(preset.data), choose: () => pick(preset.data),
      icons: [
        iconButton("save", { label: `Save ${words.saved} over ${label}`, onclick: () => saveOver(preset) }),
        iconButton("rename", { label: `Rename ${label}`, onclick: () => rename(preset) }),
        iconButton("delete", { label: `Delete ${label}`, onclick: () => remove(preset) }),
      ],
    });
  }

  async function saveNew() {
    if (mine.length >= MAX_PRESETS) {
      showMessage(message, `You can keep up to ${MAX_PRESETS} presets. Delete one to save another.`, true);
      return;
    }
    const data = now();
    const done = await askPresetName({
      title: kind === "body" ? "Save this body as a preset" : "Save these arms as a preset", action: "Save preset",
      save: async (name) => { await savePreset(kind, name, data); },
    });
    if (done) {
      showMessage(message, "Saved, for any pose.");
      draw();
    }
  }

  /** @param {SavedPreset} preset */
  async function saveOver(preset) {
    const choice = await choose({
      title: `Save over "${presetLabel(preset)}"?`,
      message: `It will hold ${words.saved} as they are now. Poses already made from it stay as they are.`,
      choices: [{ label: "Save over it", value: "save" }],
    });
    if (choice !== "save") return;
    try {
      await overwritePreset(preset.id, now());
      showMessage(message, "Saved.");
      draw();
    } catch (err) {
      showMessage(message, `Couldn't save it: ${errorMessage(err)}`, true);
    }
  }

  /** @param {SavedPreset} preset */
  async function rename(preset) {
    const done = await askPresetName({
      title: "Rename preset", value: preset.name ?? "", action: "Rename", save: (name) => renamePreset(preset.id, name),
    });
    if (done) draw();
  }

  /** @param {SavedPreset} preset */
  async function remove(preset) {
    const choice = await choose({
      title: `Delete "${presetLabel(preset)}"?`,
      message: "Poses already made from it stay as they are.",
      choices: [{ label: "Delete preset", value: "delete", style: "solid-danger" }],
    });
    if (choice !== "delete") return;
    try {
      await deletePreset(preset.id);
      showMessage(message, "");
      draw();
    } catch (err) {
      showMessage(message, `Couldn't delete it: ${errorMessage(err)}`, true);
    }
  }

  draw();
  savedPresets().then((list) => {
    mine = list;
    draw();
  }, () => showMessage(message, "Couldn't load your saved presets. The built-in ones are here.", true));
  return closed;
}

/**
 * Turn body: where the whole body faces.
 * @param {{
 *   orientations: readonly { name: string, body: readonly number[] }[],
 *   body: readonly number[],
 *   apply: (body: number[]) => void,
 * }} options body: the body's turn now
 * @returns {Promise<void>} once closed
 */
export function pickTurn({ orientations, body, apply }) {
  const id = "pose-turn";
  const list = h("div", { className: "picker-list", id: `${id}-list` });
  const { dialog, closed } = pickerDialog({ id, title: "Turn body", body: [list] });
  list.replaceChildren(...orientations.map((o, i) => pickerRow({
    id: `${id}-${i}`, name: o.name, current: o.body.every((n, k) => Math.abs(n - body[k]) < 0.05),
    choose: () => {
      apply([...o.body]);
      dialog.close();
    },
  })));
  return closed;
}
