/**
 * The Sound Studio's dev-server routes (installed by `vite-sound-studio.ts`) (`battle/studio.html`): browse this PC's sample folders, play their files, and
 * save the studio's edits. Installed on `vite dev` only, never in a build.
 *
 * Saved edits go to a folder on this PC, outside the repo (`%LOCALAPPDATA%\Marvel3DTable\studio`, or
 * `MC_SOUND_STUDIO_DIR`): the main folder stays a copy of GitHub, and the edits reach everyone only once a session
 * ships them into the repo. The dev game plays them in the meantime (`sound.ts`, `loadStudioSounds`).
 *
 * The dev server listens on the network (`server.host`), so every route answers only a browser on this PC: the
 * request must come from the loopback address, name a local host, and (when it says) come from a local page. Only
 * audio files are listed or served, and only the staging folder is written.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, extname, join, parse, resolve } from "node:path";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".aif",
  ".aiff",
  ".opus",
  ".webm",
]);
/** Played in the browser through ffmpeg: Chromium can't decode these itself. */
const TRANSCODE_FOR_PREVIEW = new Set([".aif", ".aiff"]);
const MAX_LISTED = 4000;

export function defaultStudioDir(): string {
  if (process.env.MC_SOUND_STUDIO_DIR) return process.env.MC_SOUND_STUDIO_DIR;
  const base = process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  return join(base, "Marvel3DTable", "studio");
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Only a browser on this PC, on a page this server gave it. */
export function isLocalRequest(request: IncomingMessage): boolean {
  if (!LOOPBACK.has(request.socket.remoteAddress ?? "")) return false;
  const host = (request.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = request.headers.origin;
  if (origin) {
    try {
      if (!LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export const isAudio = (path: string) => AUDIO_EXTENSIONS.has(extname(path).toLowerCase());

function hasFfmpeg(): boolean {
  try {
    return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

interface Settings {
  pins: string[];
}

export interface StudioOptions {
  dir?: string;
  /** Told after each save (the dev server tells the open game to load the new sounds). */
  onSaved?: () => void;
  ffmpeg?: boolean;
}

export function studioMiddleware(options: StudioOptions = {}) {
  const dir = options.dir ?? defaultStudioDir();
  const staged = join(dir, "staged");
  const library = join(dir, "library");
  const settingsFile = join(dir, "studio.json");
  mkdirSync(staged, { recursive: true });
  mkdirSync(library, { recursive: true });
  const ffmpeg = options.ffmpeg ?? hasFfmpeg();

  const readSettings = (): Settings => {
    try {
      return { pins: [], ...JSON.parse(readFileSync(settingsFile, "utf8")) };
    } catch {
      const home = homedir();
      const guesses = ["E:\\Samples", "D:\\timeroad-sfx-source\\sonniss", join(home, "Music"), join(home, "Downloads")];
      return { pins: [library, ...guesses.filter((path) => existsSync(path))] };
    }
  };

  const json = (response: ServerResponse, status: number, body: unknown) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify(body));
  };

  const body = (request: IncomingMessage, limit = 2_000_000) =>
    new Promise<string>((done, fail) => {
      let size = 0;
      const parts: Buffer[] = [];
      request.on("data", (part: Buffer) => {
        size += part.length;
        if (size > limit) fail(new Error("too large"));
        else parts.push(part);
      });
      request.on("end", () => done(Buffer.concat(parts).toString("utf8")));
      request.on("error", fail);
    });

  const drives = () =>
    process.platform === "win32"
      ? "CDEFGHIJKLMNOPQRSTUVWXYZ"
          .split("")
          .map((letter) => `${letter}:\\`)
          .filter((root) => existsSync(root))
      : ["/"];

  async function list(path: string) {
    const full = resolve(path);
    const entries = await fs.readdir(full, { withFileTypes: true });
    const dirs: string[] = [];
    const files: { name: string; size: number }[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name.startsWith("$")) continue;
      if (entry.isDirectory()) dirs.push(entry.name);
      else if (entry.isFile() && isAudio(entry.name) && files.length < MAX_LISTED) {
        const stat = await fs.stat(join(full, entry.name)).catch(() => null);
        files.push({ name: entry.name, size: stat?.size ?? 0 });
      }
    }
    const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
    dirs.sort(byName);
    files.sort((a, b) => byName(a.name, b.name));
    const parent = dirname(full);
    return { path: full, parent: parent === full ? null : parent, dirs, files, truncated: files.length >= MAX_LISTED };
  }

  function sendFile(response: ServerResponse, path: string) {
    const ext = extname(path).toLowerCase();
    if (TRANSCODE_FOR_PREVIEW.has(ext)) {
      if (!ffmpeg) return json(response, 415, { error: "AIFF files need ffmpeg installed to preview." });
      response.setHeader("content-type", "audio/wav");
      const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "wav", "-"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      child.stdout.pipe(response);
      response.on("close", () => child.kill());
      return;
    }
    const types: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".opus": "audio/ogg",
      ".webm": "audio/webm",
    };
    response.setHeader("content-type", types[ext] ?? "application/octet-stream");
    response.setHeader("cache-control", "no-store");
    createReadStream(path)
      .on("error", () => json(response, 404, { error: "not found" }))
      .pipe(response);
  }

  /**
   * A library file copied into the staging folder, named by its content: as it is, so cuts and sync markers stay
   * exact, except AIFF, which the browser can't play, converted to WAV.
   */
  async function importFile(path: string): Promise<string> {
    const stat = await fs.stat(path);
    const ext = extname(path).toLowerCase();
    const hash = createHash("sha1").update(`${path}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 16);
    const convert = TRANSCODE_FOR_PREVIEW.has(ext);
    const name = `${hash}${convert ? ".wav" : ext}`;
    const target = join(staged, name);
    if (!existsSync(target)) {
      if (!convert) await fs.copyFile(path, target);
      else if (!ffmpeg) throw new Error(`${basename(path)}: AIFF files need ffmpeg installed`);
      else if (spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path, target], { stdio: "ignore" }).status !== 0)
        throw new Error(`could not convert ${basename(path)}`);
    }
    return `studio:${name}`;
  }

  type Variant = { file: string; source?: unknown; [key: string]: unknown };

  async function save(sounds: Record<string, Variant[]>) {
    const manifestFile = join(staged, "sounds.json");
    let current: { version: 1; sounds: Record<string, Variant[]> } = { version: 1, sounds: {} };
    try {
      current = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    } catch {
      // Nothing saved yet.
    }
    for (const [name, variants] of Object.entries(sounds)) {
      if (!/^[a-z][a-z-]*$/.test(name)) continue;
      if (variants === null || (Array.isArray(variants) && !variants.length)) {
        // Back to the game's own sound.
        delete current.sounds[name];
        continue;
      }
      const out: Variant[] = [];
      for (const variant of variants) {
        if (typeof variant?.file !== "string") continue;
        let file = variant.file;
        if (file.startsWith("lib:")) {
          const path = file.slice(4);
          if (!isAudio(path) || !existsSync(path)) throw new Error(`missing file ${path}`);
          file = await importFile(path);
        }
        out.push({
          ...variant,
          file,
          source: variant.file.startsWith("lib:") ? variant.file.slice(4) : variant.source,
        });
      }
      current.sounds[name] = out;
    }
    await fs.writeFile(manifestFile, JSON.stringify(current, null, 1));
    return current;
  }

  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/__studio/")) return next();
    if (!isLocalRequest(request)) return json(response, 403, { error: "The Sound Studio only answers this PC." });
    const route = url.pathname.slice("/__studio/".length);
    void (async () => {
      try {
        if (request.method === "GET" && route === "places")
          return json(response, 200, { ...readSettings(), drives: drives(), library, ffmpeg, dir });
        if (request.method === "POST" && route === "pins") {
          const pins = (JSON.parse(await body(request)) as Settings).pins.filter((pin) => typeof pin === "string");
          writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), pins }, null, 1));
          return json(response, 200, { pins });
        }
        if (request.method === "GET" && route === "list") {
          const path = url.searchParams.get("path");
          if (!path) return json(response, 400, { error: "path missing" });
          return json(response, 200, await list(path));
        }
        if (request.method === "GET" && route === "file") {
          const path = url.searchParams.get("path") ?? "";
          if (!isAudio(path)) return json(response, 403, { error: "Only audio files." });
          if (!existsSync(path)) return json(response, 404, { error: "not found" });
          return sendFile(response, resolve(path));
        }
        if (request.method === "GET" && route === "sounds.json") {
          const file = join(staged, "sounds.json");
          if (!existsSync(file)) return json(response, 404, { error: "nothing saved" });
          return json(response, 200, JSON.parse(await fs.readFile(file, "utf8")));
        }
        if (request.method === "GET" && route.startsWith("staged/")) {
          const name = parse(decodeURIComponent(route.slice(7))).base;
          const path = join(staged, name);
          if (!isAudio(name) || !existsSync(path)) return json(response, 404, { error: "not found" });
          return sendFile(response, path);
        }
        if (request.method === "POST" && route === "save") {
          const { sounds } = JSON.parse(await body(request)) as { sounds: Record<string, Variant[]> };
          const saved = await save(sounds ?? {});
          options.onSaved?.();
          return json(response, 200, saved);
        }
        json(response, 404, { error: "unknown route" });
      } catch (error) {
        json(response, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    })();
  };
}
