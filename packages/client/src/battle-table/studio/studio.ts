/**
 * The Sound Studio (`battle/studio.html`, dev server only). Left: a browser over this PC's sample folders. Middle: the
 * 3D table in a frame, acting out the chosen moment, and a waveform editor for the chosen sound (cut, fades, volume,
 * pitch, delay, and the sync marker that lands on the table's moment). Right: every moment of the game that makes a
 * sound, each with its variants.
 *
 * Edits stay in the page until Save, which hands the edited moments to the dev server
 * (`vite-sound-studio.ts`): it copies library files into a folder on this PC and the dev game plays them from then
 * on. Everything plays through the game's own sound board (`sound.ts`), with its random wobble off, so what is heard
 * here is what the game plays.
 */

import "./studio.css";
import { regionOf, type SoundManifest, type Variant } from "../sound-edit.js";
import { SOUND_MOMENTS, type SoundName } from "../sound-moments.js";
import { BUNDLED_MANIFEST, resolveSound, SoundBoard } from "../sound.js";
import { WaveEditor } from "./waveform.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const fileLabel = (file: string, source?: unknown) =>
  file.startsWith("lib:")
    ? file.slice(4)
    : typeof source === "string"
      ? source
      : file.startsWith("studio:")
        ? "Saved in the studio"
        : `Game sound: ${file}`;

// ── State ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let saved: SoundManifest = clone(BUNDLED_MANIFEST);
let draft: SoundManifest = clone(BUNDLED_MANIFEST);
const edited = new Set<string>();
let selected: { name: SoundName; index: number } | null = null;
let folder: string | null = null;
let listing: {
  dirs: string[];
  files: { name: string; size: number }[];
  parent: string | null;
  truncated: boolean;
} | null = null;
let cursor = -1;

const board = new SoundBoard(draft, resolveSound);
board.jitter = false;
// Made at once (suspended until the first click) so waveforms can be decoded before anything plays.
board.unlock();
for (const type of ["pointerdown", "keydown"] as const)
  addEventListener(type, () => board.unlock(), { capture: true, passive: true });

const wave = new WaveEditor($<HTMLCanvasElement>("wave"), (variant) => {
  if (!selected) return;
  draft.sounds[selected.name]![selected.index] = variant;
  changed(selected.name, `wave:${selected.name}:${selected.index}`);
  paintKnobs();
});

// ── Talking to the preview table ────────────────────────────────────────────────────────────────────────────────────
interface Studio {
  demo(name: string): Promise<boolean>;
  sfx: SoundBoard;
  ready(): boolean;
}
const frame = $<HTMLIFrameElement>("preview");
const preview = (): Studio | undefined =>
  (frame.contentWindow as unknown as { __battleStudio?: Studio })?.__battleStudio;
let linked = false;
function linkPreview() {
  const studio = preview();
  if (!studio) return;
  // The table hands its sounds to this page's board: it plays the edits, in audio this page has unlocked.
  studio.sfx.forwardTo(board);
  linked = true;
}
frame.addEventListener("load", () => {
  linked = false;
  const wait = setInterval(() => {
    if (preview()?.ready()) {
      clearInterval(wait);
      linkPreview();
      paintMomentButton();
    }
  }, 250);
});

async function playOnTable() {
  if (!selected) return;
  const studio = preview();
  if (!studio?.ready()) return status("The table is still loading…");
  if (!linked) linkPreview();
  board.stopAll();
  board.unlock();
  // Every variation takes its turn, as in the game, unless only the one being edited is asked for.
  const name = selected.name;
  const only: SoundManifest = clone(draft);
  if ($<HTMLInputElement>("only-this").checked) only.sounds[name] = [draft.sounds[name]![selected.index]!];
  board.setManifest(only);
  try {
    await studio.demo(name);
  } finally {
    board.setManifest(draft);
  }
}

// ── Saving ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function changed(name: string, run?: string) {
  edited.add(name);
  board.setManifest(draft);
  remember(run);
  paintSave();
  paintSound(name);
}

// ── Undo ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Each change keeps the state before it. A run of changes from one drag (a slider, a handle on the waveform) is one
// step: changes with the same `run` key less than a second apart join the step before.
type Snapshot = string;
const past: Snapshot[] = [];
const future: Snapshot[] = [];
let last: Snapshot = "";
let lastRun: string | undefined;
let lastAt = 0;
const snapshot = (): Snapshot => JSON.stringify({ draft, selected });

function remember(run?: string) {
  const now = performance.now();
  const joins = run !== undefined && run === lastRun && now - lastAt < 1000;
  if (!joins && last) {
    past.push(last);
    if (past.length > 200) past.shift();
    future.length = 0;
  }
  lastRun = run;
  lastAt = now;
  last = snapshot();
  paintUndo();
}

function restore(state: Snapshot) {
  const { draft: before, selected: pick } = JSON.parse(state) as { draft: SoundManifest; selected: typeof selected };
  draft = before;
  // Unsaved is whatever now differs from what is saved, whichever way the history went.
  edited.clear();
  for (const name of new Set([...Object.keys(draft.sounds), ...Object.keys(saved.sounds)]))
    if (JSON.stringify(draft.sounds[name]) !== JSON.stringify(saved.sounds[name])) edited.add(name);
  board.setManifest(draft);
  last = snapshot();
  lastRun = undefined;
  paintSounds();
  paintSave();
  paintUndo();
  if (pick) select(pick.name, pick.index);
}

function undo() {
  const state = past.pop();
  if (state === undefined) return;
  future.push(snapshot());
  restore(state);
  status("Undone.");
}

function redo() {
  const state = future.pop();
  if (state === undefined) return;
  past.push(snapshot());
  restore(state);
  status("Redone.");
}

function paintUndo() {
  $<HTMLButtonElement>("undo").disabled = !past.length;
  $<HTMLButtonElement>("redo").disabled = !future.length;
}

$("undo").onclick = undo;
$("redo").onclick = redo;
addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  // A text box keeps its own undo for what is typed in it.
  if ((event.target as HTMLElement).matches?.('input[type="search"], input:not([type]), input[type="text"], textarea'))
    return;
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (key === "y" || (key === "z" && event.shiftKey)) {
    event.preventDefault();
    redo();
  }
});

function paintSave() {
  const save = $<HTMLButtonElement>("studio-save");
  save.disabled = !edited.size;
  save.textContent = edited.size ? `Save ${edited.size} change${edited.size === 1 ? "" : "s"}` : "Saved";
}

function status(text: string) {
  $("studio-status").textContent = text;
}

async function save() {
  if (!edited.size) return;
  // null: back to the game's own sound; an empty list: switched off.
  const sounds: Record<string, Variant[] | null> = {};
  for (const name of edited) {
    const same = JSON.stringify(draft.sounds[name]) === JSON.stringify(BUNDLED_MANIFEST.sounds[name]);
    sounds[name] = same ? null : (draft.sounds[name] ?? []);
  }
  status("Saving…");
  const response = await fetch("/__studio/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sounds }),
  });
  const result = (await response.json()) as SoundManifest & { error?: string };
  if (!response.ok) return status(`Couldn't save: ${result.error ?? response.status}`);
  saved = { version: 1, sounds: { ...clone(BUNDLED_MANIFEST.sounds), ...result.sounds } };
  for (const name of edited) draft.sounds[name] = clone(saved.sounds[name] ?? []);
  edited.clear();
  board.setManifest(draft);
  last = snapshot();
  paintSave();
  paintSounds();
  if (selected) select(selected.name, selected.index);
  status(
    `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Your game plays these now.`,
  );
}

$("studio-save").onclick = () => void save();
addEventListener("beforeunload", (event) => {
  if (edited.size) event.preventDefault();
});

// ── The game's sounds ──────────────────────────────────────────────────────────────────────────────────────────────
function paintSounds() {
  const host = $("sounds");
  host.replaceChildren();
  let group = "";
  for (const moment of SOUND_MOMENTS) {
    if (moment.group !== group) {
      group = moment.group;
      const heading = document.createElement("h3");
      heading.textContent = group;
      host.append(heading);
    }
    const row = document.createElement("div");
    row.className = "sound";
    row.dataset.name = moment.name;
    row.onclick = () => select(moment.name, 0);
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("drop");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("drop");
      const path = event.dataTransfer?.getData("text/x-studio-file");
      if (path) addVariant(moment.name, path);
    });
    host.append(row);
    paintSound(moment.name);
  }
}

function paintSound(name: string) {
  const row = document.querySelector<HTMLElement>(`.sound[data-name="${name}"]`);
  const moment = SOUND_MOMENTS.find((m) => m.name === name);
  if (!row || !moment) return;
  const count = draft.sounds[name]?.length ?? 0;
  const off = count === 0;
  row.classList.toggle("off", off);
  const custom = JSON.stringify(draft.sounds[name]) !== JSON.stringify(BUNDLED_MANIFEST.sounds[name]);
  row.classList.toggle("active", selected?.name === name);
  row.innerHTML = "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = moment.label;
  const tag = document.createElement("button");
  tag.type = "button";
  tag.className = "switch";
  tag.setAttribute("role", "switch");
  tag.setAttribute("aria-checked", String(!off));
  tag.setAttribute("aria-label", `${moment.label} sound ${off ? "off" : "on"}`);
  tag.title = off ? "Off: this moment is silent. Click to turn it on." : "On. Click to make this moment silent.";
  tag.onclick = (event) => {
    event.stopPropagation();
    switchSound(name as SoundName, off);
  };
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.innerHTML = `${off ? "off · silent" : `${count} sound${count === 1 ? "" : "s"}`}${custom && !off ? ' · <span class="edited">yours</span>' : ""}${
    edited.has(name) ? ' · <span class="edited">● unsaved</span>' : ""
  }`;
  row.append(label, tag, meta);
}

/** What a sound was before it was switched off, to bring back when it goes on again (this visit). */
const switchedOff = new Map<string, Variant[]>();

function switchSound(name: SoundName, on: boolean) {
  if (on) {
    const back = switchedOff.get(name);
    draft.sounds[name] = clone(back?.length ? back : (BUNDLED_MANIFEST.sounds[name] ?? []));
    switchedOff.delete(name);
  } else {
    switchedOff.set(name, clone(draft.sounds[name] ?? []));
    draft.sounds[name] = [];
  }
  changed(name);
  if (selected?.name === name) select(name, 0);
  status(`${SOUND_MOMENTS.find((m) => m.name === name)?.label}: ${on ? "on" : "off"}. Save to keep it.`);
}

function select(name: SoundName, index: number) {
  const variants = draft.sounds[name] ?? [];
  selected = { name, index: Math.min(index, Math.max(0, variants.length - 1)) };
  for (const row of document.querySelectorAll<HTMLElement>(".sound"))
    row.classList.toggle("active", row.dataset.name === name);
  paintEditor();
  paintMomentButton();
}

function addVariant(name: SoundName, path: string) {
  const list = (draft.sounds[name] ??= []);
  // A sound still on the game's own files is replaced by the first file added; after that, files add up as variants.
  const own = JSON.stringify(list) === JSON.stringify(BUNDLED_MANIFEST.sounds[name]);
  if (own) list.length = 0;
  list.push({ file: `lib:${path}` });
  changed(name);
  select(name, list.length - 1);
  status(`${baseName(path)} added to ${SOUND_MOMENTS.find((m) => m.name === name)?.label}.`);
}

function paintMomentButton() {
  const moment = SOUND_MOMENTS.find((m) => m.name === selected?.name);
  const button = $<HTMLButtonElement>("play-moment");
  button.disabled = !moment || !preview()?.ready();
  $("moment-note").textContent = !moment ? "" : moment.demo ? moment.about : moment.about;
}

// ── Editor ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let loadToken = 0;
async function paintEditor() {
  const variants = selected ? (draft.sounds[selected.name] ?? []) : [];
  const variant = selected ? variants[selected.index] : undefined;
  const moment = SOUND_MOMENTS.find((m) => m.name === selected?.name);
  $("editor-title").textContent = moment
    ? `${moment.label}${variants.length > 1 ? ` · sound ${String.fromCharCode(65 + selected!.index)} of ${variants.length}` : ""}`
    : "Pick a sound";
  $("editor-file").textContent = variant ? fileLabel(variant.file, (variant as { source?: unknown }).source) : "";
  $("show-folder").hidden = !(variant && sourcePath(variant));
  const chips = $("variants");
  chips.replaceChildren();
  if (selected) {
    variants.forEach((_, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.setAttribute("aria-pressed", String(i === selected!.index));
      chip.innerHTML = `${String.fromCharCode(65 + i)} <span class="x" title="Remove this sound">✕</span>`;
      chip.onclick = (event) => {
        if ((event.target as HTMLElement).classList.contains("x")) {
          variants.splice(i, 1);
          if (!variants.length) draft.sounds[selected!.name] = clone(BUNDLED_MANIFEST.sounds[selected!.name] ?? []);
          changed(selected!.name);
          select(selected!.name, Math.max(0, i - 1));
          return;
        }
        select(selected!.name, i);
      };
      chips.append(chip);
    });
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "chip";
    copy.textContent = "＋ Copy as variation";
    copy.title = "A copy of this sound to cut, re-pitch or re-time differently: the game takes turns between them";
    copy.onclick = () => {
      const source = variants[selected!.index];
      if (!source) return;
      variants.splice(selected!.index + 1, 0, { ...source, rate: Math.round((source.rate ?? 1) * 1.06 * 1000) / 1000 });
      changed(selected!.name);
      select(selected!.name, selected!.index + 1);
      status("Copied, a little higher. Change its pitch or cut so the two differ.");
    };
    chips.append(copy);
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "chip";
    reset.textContent = "Back to game's sound";
    reset.onclick = () => {
      draft.sounds[selected!.name] = clone(BUNDLED_MANIFEST.sounds[selected!.name] ?? []);
      changed(selected!.name);
      select(selected!.name, 0);
    };
    chips.append(reset);
  }
  wave.setVariant(variant ?? { file: "" });
  const token = ++loadToken;
  if (!variant) {
    wave.setBuffer(null);
    paintKnobs();
    return;
  }
  const buffer = await board.buffer(variant.file);
  if (token !== loadToken) return;
  wave.setBuffer(buffer);
  if (!buffer) status(`Couldn't open ${baseName(fileLabel(variant.file))}.`);
  else if (variant.start || variant.end !== undefined) wave.zoomToCut();
  paintKnobs();
}

interface Knob {
  key: keyof Variant;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Shown value from stored value. */
  show: (v: number) => string;
  /** Stored value from the slider, and back. */
  from?: (slider: number) => number;
  to?: (stored: number) => number;
  fallback: (variant: Variant, duration: number) => number;
  /** Starts a new group of sliders under this heading. */
  section?: string;
}

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const percent = (share: number) => `${Math.round(share * 100)}%`;
const KNOBS: Knob[] = [
  {
    key: "gainDb",
    label: "Volume",
    min: -24,
    max: 12,
    step: 0.5,
    show: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`,
    fallback: () => 0,
  },
  {
    key: "rate",
    label: "Pitch / speed",
    min: -12,
    max: 12,
    step: 0.5,
    show: (v) => `${v >= 1 ? "+" : ""}${(12 * Math.log2(v)).toFixed(1)} semitones`,
    from: (semitones) => Math.round(2 ** (semitones / 12) * 1000) / 1000,
    to: (rate) => 12 * Math.log2(rate),
    fallback: () => 1,
  },
  {
    key: "delay",
    label: "Delay after the moment",
    min: 0,
    max: 600,
    step: 5,
    show: (v) => `${Math.round(v)} ms`,
    fallback: () => 0,
  },
  { key: "fadeIn", label: "Fade in", min: 0, max: 2, step: 0.005, show: ms, fallback: () => 0 },
  { key: "fadeOut", label: "Fade out", min: 0, max: 3, step: 0.005, show: ms, fallback: () => 0 },
  { key: "start", label: "Start", min: 0, max: 1, step: 0.001, show: ms, fallback: () => 0 },
  { key: "end", label: "End", min: 0, max: 1, step: 0.001, show: ms, fallback: (_, d) => d },
  { key: "sync", label: "⚡ Lands here", min: 0, max: 1, step: 0.001, show: ms, fallback: (v) => v.start ?? 0 },
  {
    key: "echoMix",
    label: "Echo level",
    min: 0,
    max: 1,
    step: 0.01,
    show: (v) => (v ? percent(v) : "Off"),
    fallback: () => 0,
    section: "Echo & reverb",
  },
  {
    key: "echoMs",
    label: "Echo time",
    min: 20,
    max: 1000,
    step: 5,
    show: (v) => `${Math.round(v)} ms`,
    fallback: () => 250,
  },
  { key: "echoFeedback", label: "Echo repeats", min: 0, max: 0.9, step: 0.01, show: percent, fallback: () => 0.35 },
  {
    key: "reverbMix",
    label: "Reverb level",
    min: 0,
    max: 1,
    step: 0.01,
    show: (v) => (v ? percent(v) : "Off"),
    fallback: () => 0,
  },
  {
    key: "reverbSeconds",
    label: "Reverb size",
    min: 0.2,
    max: 6,
    step: 0.1,
    show: (v) => `${v.toFixed(1)} s`,
    fallback: () => 1.5,
  },
];

function paintKnobs() {
  const host = $("knobs");
  const variant = selected ? draft.sounds[selected.name]?.[selected.index] : undefined;
  host.replaceChildren();
  if (!variant) return;
  const length = currentDuration();
  for (const knob of KNOBS) {
    if (knob.section) {
      const heading = document.createElement("h4");
      heading.className = "knob-section";
      heading.textContent = knob.section;
      host.append(heading);
    }
    const wrap = document.createElement("label");
    wrap.className = "knob";
    const stored = (variant[knob.key] as number | undefined) ?? knob.fallback(variant, length);
    const max = ["start", "end", "sync"].includes(knob.key) ? length : knob.max;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(knob.min);
    input.max = String(max);
    input.step = String(knob.step);
    input.value = String(knob.to ? knob.to(stored) : stored);
    const out = document.createElement("output");
    out.textContent = knob.show(stored);
    input.oninput = () => {
      const value = knob.from ? knob.from(Number(input.value)) : Number(input.value);
      const next = { ...variant, [knob.key]: value } as Variant;
      const { start, end } = regionOf(next, length);
      if (knob.key === "start" || knob.key === "end") next.sync = Math.min(end, Math.max(start, next.sync ?? start));
      draft.sounds[selected!.name]![selected!.index] = next;
      Object.assign(variant, next);
      out.textContent = knob.show(value);
      wave.setVariant(next);
      changed(selected!.name, `knob:${knob.key}:${selected!.name}:${selected!.index}`);
    };
    wrap.append(knob.label, out, input);
    host.append(wrap);
  }
}

let currentBuffer: AudioBuffer | null = null;
function currentDuration() {
  return currentBuffer?.duration ?? 1;
}
const setBuffer = wave.setBuffer.bind(wave);
wave.setBuffer = (buffer) => {
  currentBuffer = buffer;
  setBuffer(buffer);
};

// Playing the cut, with a playhead.
let playheadFrame = 0;
async function playCut() {
  if (!selected) return;
  const variant = draft.sounds[selected.name]?.[selected.index];
  if (!variant) return;
  board.stopAll();
  board.unlock();
  const run = await board.playVariant(selected.name, variant);
  const context = board.context;
  cancelAnimationFrame(playheadFrame);
  if (!run || !context) return;
  const tick = () => {
    const played = (context.currentTime - run.at) * run.rate;
    if (played > run.length) return wave.setPlayhead(null);
    wave.setPlayhead(played >= 0 ? run.offset + played : null);
    playheadFrame = requestAnimationFrame(tick);
  };
  tick();
}

$("play").onclick = () => void playCut();
$("stop").onclick = () => {
  board.stopAll();
  cancelAnimationFrame(playheadFrame);
  wave.setPlayhead(null);
};
$("zoom-fit").onclick = () => wave.zoomFit();
$("zoom-cut").onclick = () => wave.zoomToCut();
$("play-moment").onclick = () => void playOnTable();
$("reset-table").onclick = () => frame.contentWindow?.location.reload();

/** Where on this PC a sound came from: a library file, or the original of one the studio has saved. */
function sourcePath(variant: Variant): string | null {
  if (variant.file.startsWith("lib:")) return variant.file.slice(4);
  const source = (variant as { source?: unknown }).source;
  return typeof source === "string" ? source : null;
}

/** Opens the folder a sample lives in and puts the browser's cursor on it, so its neighbours are a key press away. */
async function showInFolder() {
  const variant = selected ? draft.sounds[selected.name]?.[selected.index] : undefined;
  const path = variant && sourcePath(variant);
  if (!path) return;
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  await open(dir);
  const name = baseName(path).toLowerCase();
  cursor = rows().findIndex((row) => row.kind === "file" && row.name.toLowerCase() === name);
  if (cursor < 0) return status(`${baseName(path)} is no longer in ${dir}.`);
  paintCursor();
  $("files").focus({ preventScroll: true });
}

$("show-folder").onclick = () => void showInFolder();

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let pins: string[] = [];
let drives: string[] = [];
let libraryDir = "";

async function loadPlaces() {
  const places = (await (await fetch("/__studio/places")).json()) as {
    pins: string[];
    drives: string[];
    library: string;
  };
  pins = places.pins;
  drives = places.drives;
  libraryDir = places.library;
  paintPlaces();
  if (!folder && pins[0]) void open(pins[0]);
}

function paintPlaces() {
  const host = $("places");
  host.replaceChildren();
  const section = (title: string, paths: string[], removable: boolean) => {
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = title;
    host.append(label);
    for (const path of paths) {
      const row = document.createElement("div");
      row.className = "place";
      row.classList.toggle("active", folder === path);
      row.title = path;
      row.innerHTML = `<span>${removable ? "📁" : "💽"}</span><span class="name"></span>`;
      row.querySelector(".name")!.textContent =
        path === libraryDir
          ? "Studio library (Freesound picks)"
          : removable
            ? baseName(path.replace(/[\\/]$/, "")) || path
            : path;
      row.onclick = () => void open(path);
      if (removable) {
        const unpin = document.createElement("button");
        unpin.className = "unpin";
        unpin.textContent = "✕";
        unpin.title = "Unpin";
        unpin.onclick = (event) => {
          event.stopPropagation();
          void savePins(pins.filter((p) => p !== path));
        };
        row.append(unpin);
      }
      host.append(row);
    }
  };
  section("Pinned", pins, true);
  section("Drives", drives, false);
}

async function savePins(next: string[]) {
  pins = next;
  await fetch("/__studio/pins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pins }),
  });
  paintPlaces();
}

/** Counts folder opens, so only the latest one is shown. */
let opening = 0;

async function open(path: string) {
  // A slower, older open (the first pinned folder the studio opens as it starts, say) must not land on top of a
  // folder opened since.
  const mine = ++opening;
  const response = await fetch(`/__studio/list?path=${encodeURIComponent(path)}`);
  const result = await response.json();
  if (mine !== opening) return;
  if (!response.ok) return status(`Couldn't open ${path}: ${result.error}`);
  folder = result.path;
  listing = result;
  cursor = -1;
  $<HTMLInputElement>("filter").value = "";
  found = null;
  $("search-info").hidden = true;
  $<HTMLInputElement>("crumbs").value = folder!;
  paintPlaces();
  paintFiles();
}

// ── Search: every folder below the open one ────────────────────────────────────────────────────────────────────────
interface Found {
  query: string;
  results: { path: string; name: string; folder: string }[];
  total: number;
  indexing: boolean;
  scanned: number;
}
let found: Found | null = null;
let searchTimer = 0;

async function runSearch(rescan = false) {
  const query = $<HTMLInputElement>("filter").value.trim();
  clearTimeout(searchTimer);
  if (!query || !folder) {
    // Already showing the folder: drawing it again would only drop the row under the pointer (and its ＋).
    if (!found) return;
    found = null;
    $("search-info").hidden = true;
    cursor = -1;
    return paintFiles();
  }
  const response = await fetch(
    `/__studio/search?path=${encodeURIComponent(folder)}&q=${encodeURIComponent(query)}${rescan ? "&rescan=1" : ""}`,
  );
  if (query !== $<HTMLInputElement>("filter").value.trim()) return;
  const result = await response.json();
  if (!response.ok) return status(`Search failed: ${result.error}`);
  const first = found?.query !== query;
  found = { query, ...result };
  if (first) cursor = -1;
  paintSearchInfo();
  paintFiles();
  // Still gathering the folder's files the first time: ask again as more come in.
  if (result.indexing) searchTimer = window.setTimeout(() => void runSearch(), 700);
}

function paintSearchInfo() {
  const info = $("search-info");
  info.hidden = !found;
  if (!found) return;
  const count = (n: number) => n.toLocaleString();
  info.replaceChildren(
    found.indexing
      ? `Looking through every folder below… ${count(found.scanned)} sounds so far, ${count(found.total)} match`
      : `${count(found.total)} found in every folder below (${count(found.scanned)} sounds)${
          found.total > found.results.length ? `, showing the first ${found.results.length}` : ""
        } · `,
  );
  if (!found.indexing) {
    const rescan = document.createElement("button");
    rescan.type = "button";
    rescan.className = "link";
    rescan.textContent = "Rescan";
    rescan.title = "Look again for files added since";
    rescan.onclick = () => void runSearch(true);
    info.append(rescan);
  }
}

type Row = { kind: "dir" | "file"; name: string; path: string; where?: string };
function rows(): Row[] {
  if (found)
    return found.results.map((hit) => ({ kind: "file" as const, name: hit.name, path: hit.path, where: hit.folder }));
  if (!listing || !folder) return [];
  return [
    ...listing.dirs.map((name) => ({ kind: "dir" as const, name, path: join(folder!, name) })),
    ...listing.files.map((f) => ({ kind: "file" as const, name: f.name, path: join(folder!, f.name) })),
  ];
}

const join = (dir: string, name: string) => `${dir.replace(/[\\/]$/, "")}\\${name}`;

function paintFiles() {
  const host = $("files");
  host.replaceChildren();
  const list = rows();
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = found
      ? found.indexing
        ? "Searching…"
        : "Nothing matches in any folder below."
      : listing
        ? "No folders or sound files here."
        : "Pick a folder.";
    host.append(empty);
  }
  list.forEach((row, i) => {
    const item = document.createElement("li");
    item.classList.toggle("current", i === cursor);
    item.innerHTML = `<span>${row.kind === "dir" ? "📁" : "🔊"}</span><span class="name"><span class="file"></span><span class="where"></span></span>`;
    item.querySelector(".file")!.textContent = row.name;
    if (row.where) item.querySelector(".where")!.textContent = row.where;
    item.title = row.where ? `${row.where}\\${row.name}` : row.name;
    if (row.kind === "dir") item.onclick = () => void open(row.path);
    else {
      const path = row.path;
      item.draggable = true;
      item.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/x-studio-file", path));
      item.onclick = () => {
        cursor = i;
        paintCursor();
        audition(path);
      };
      item.ondblclick = () => selected && addVariant(selected.name, path);
      const add = document.createElement("button");
      add.className = "add";
      add.textContent = "＋";
      add.title = "Add to the selected sound";
      add.onclick = (event) => {
        event.stopPropagation();
        if (selected) addVariant(selected.name, path);
        else status("Pick a game sound on the right first.");
      };
      item.append(add);
    }
    host.append(item);
  });
  if (!found && listing?.truncated) {
    const more = document.createElement("li");
    more.className = "empty";
    more.textContent = "Showing the first 4,000 files: search to find the rest.";
    host.append(more);
  }
}

function paintCursor() {
  const items = [...$("files").querySelectorAll("li")];
  items.forEach((item, i) => item.classList.toggle("current", i === cursor));
  items[cursor]?.scrollIntoView({ block: "nearest" });
}

function audition(path: string) {
  board.stopAll();
  board.unlock();
  void board.playVariant("__audition", { file: `lib:${path}` });
}

$<HTMLInputElement>("filter").oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void runSearch(), 220);
};
$<HTMLInputElement>("crumbs").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void open($<HTMLInputElement>("crumbs").value.trim().replace(/^"|"$/g, ""));
});
$("up").onclick = () => listing?.parent && void open(listing.parent);
$("pin").onclick = () => folder && !pins.includes(folder) && void savePins([...pins, folder]);
$<HTMLInputElement>("filter").addEventListener("keydown", (event) => {
  // Down from the search box goes into the results.
  if (event.key === "ArrowDown") {
    event.preventDefault();
    $("files").focus();
    cursor = -1;
    $("files").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  }
});
$("files").addEventListener("keydown", (event) => {
  const list = rows();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    cursor = Math.min(list.length - 1, Math.max(0, cursor + (event.key === "ArrowDown" ? 1 : -1)));
    paintCursor();
    const row = list[cursor];
    if (row?.kind === "file" && $<HTMLInputElement>("autoplay").checked) audition(row.path);
  } else if (event.key === "Enter") {
    const row = list[cursor];
    if (!row) return;
    if (row.kind === "dir") void open(row.path);
    else if (selected) addVariant(selected.name, row.path);
    else status("Pick a game sound on the right first.");
  } else if (event.key === "Backspace") {
    event.preventDefault();
    if (listing?.parent) void open(listing.parent);
  }
});

addEventListener("keydown", (event) => {
  const typing = (event.target as HTMLElement).closest("input, textarea, .files");
  if (typing) return;
  if (event.key === " ") {
    event.preventDefault();
    void playCut();
  } else if (event.key === "t" || event.key === "T") void playOnTable();
  else if (event.key === "f" || event.key === "F") void showInFolder();
  else if (event.key === "Escape") $("stop").click();
});
addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();
    void save();
  }
});

// ── Start ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function start() {
  try {
    const response = await fetch("/__studio/sounds.json", { cache: "no-store" });
    if (response.ok) {
      const studio = (await response.json()) as SoundManifest;
      saved = { version: 1, sounds: { ...clone(BUNDLED_MANIFEST.sounds), ...studio.sounds } };
    }
  } catch {
    // Nothing saved yet.
  }
  draft = clone(saved);
  board.setManifest(draft);
  paintSounds();
  paintSave();
  select("hit", 0);
  last = snapshot();
  paintUndo();
  await loadPlaces();
}
void start();
