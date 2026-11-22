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
  changed(selected.name);
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
function changed(name: string) {
  edited.add(name);
  board.setManifest(draft);
  paintSave();
  paintSound(name);
}

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
  const sounds: Record<string, Variant[]> = {};
  for (const name of edited) {
    const same = JSON.stringify(draft.sounds[name]) === JSON.stringify(BUNDLED_MANIFEST.sounds[name]);
    sounds[name] = same ? [] : (draft.sounds[name] ?? []);
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
  const custom = JSON.stringify(draft.sounds[name]) !== JSON.stringify(BUNDLED_MANIFEST.sounds[name]);
  row.classList.toggle("active", selected?.name === name);
  row.innerHTML = "";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = moment.label;
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = moment.demo ? "on table" : "sound only";
  tag.title = moment.demo ? "Play on table shows this moment" : "Plays without a visual";
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.innerHTML = `${count} sound${count === 1 ? "" : "s"}${custom ? ' · <span class="edited">yours</span>' : ""}${
    edited.has(name) ? ' · <span class="edited">● unsaved</span>' : ""
  }`;
  row.append(label, tag, meta);
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
}

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
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
];

function paintKnobs() {
  const host = $("knobs");
  const variant = selected ? draft.sounds[selected.name]?.[selected.index] : undefined;
  host.replaceChildren();
  if (!variant) return;
  const length = currentDuration();
  for (const knob of KNOBS) {
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
      changed(selected!.name);
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

async function open(path: string) {
  const response = await fetch(`/__studio/list?path=${encodeURIComponent(path)}`);
  const result = await response.json();
  if (!response.ok) return status(`Couldn't open ${path}: ${result.error}`);
  folder = result.path;
  listing = result;
  cursor = -1;
  $<HTMLInputElement>("filter").value = "";
  $<HTMLInputElement>("crumbs").value = folder!;
  paintPlaces();
  paintFiles();
}

type Row = { kind: "dir" | "file"; name: string };
function rows(): Row[] {
  if (!listing) return [];
  const filter = $<HTMLInputElement>("filter").value.trim().toLowerCase();
  const match = (name: string) => !filter || name.toLowerCase().includes(filter);
  return [
    ...listing.dirs.filter(match).map((name) => ({ kind: "dir" as const, name })),
    ...listing.files.filter((f) => match(f.name)).map((f) => ({ kind: "file" as const, name: f.name })),
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
    empty.textContent = listing ? "No folders or sound files here." : "Pick a folder.";
    host.append(empty);
  }
  list.forEach((row, i) => {
    const item = document.createElement("li");
    item.classList.toggle("current", i === cursor);
    item.innerHTML = `<span>${row.kind === "dir" ? "📁" : "🔊"}</span><span class="name"></span>`;
    item.querySelector(".name")!.textContent = row.name;
    item.title = row.name;
    if (row.kind === "dir") item.onclick = () => void open(join(folder!, row.name));
    else {
      const path = join(folder!, row.name);
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
  if (listing?.truncated) {
    const more = document.createElement("li");
    more.className = "empty";
    more.textContent = "Showing the first 4,000 files: use the filter.";
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
  cursor = -1;
  paintFiles();
};
$<HTMLInputElement>("crumbs").addEventListener("keydown", (event) => {
  if (event.key === "Enter") void open($<HTMLInputElement>("crumbs").value.trim().replace(/^"|"$/g, ""));
});
$("up").onclick = () => listing?.parent && void open(listing.parent);
$("pin").onclick = () => folder && !pins.includes(folder) && void savePins([...pins, folder]);
$("files").addEventListener("keydown", (event) => {
  const list = rows();
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    cursor = Math.min(list.length - 1, Math.max(0, cursor + (event.key === "ArrowDown" ? 1 : -1)));
    paintCursor();
    const row = list[cursor];
    if (row?.kind === "file" && $<HTMLInputElement>("autoplay").checked) audition(join(folder!, row.name));
  } else if (event.key === "Enter") {
    const row = list[cursor];
    if (!row) return;
    if (row.kind === "dir") void open(join(folder!, row.name));
    else if (selected) addVariant(selected.name, join(folder!, row.name));
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
  await loadPlaces();
}
void start();
