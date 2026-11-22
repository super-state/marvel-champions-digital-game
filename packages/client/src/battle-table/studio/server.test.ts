import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isLocalRequest, studioMiddleware } from "./studio-server.js";

let server: Server;
let port = 0;
let samples = "";
let studio = "";
let saves = 0;

beforeAll(async () => {
  samples = mkdtempSync(join(tmpdir(), "studio-samples-"));
  studio = mkdtempSync(join(tmpdir(), "studio-dir-"));
  mkdirSync(join(samples, "Drums"));
  writeFileSync(join(samples, "Drums", "kick.wav"), "RIFF-fake-wave");
  writeFileSync(join(samples, "Drums", "readme.txt"), "secret");
  writeFileSync(join(samples, "whoosh.mp3"), "ID3-fake");
  const handle = studioMiddleware({ dir: studio, ffmpeg: false, onSaved: () => saves++ });
  server = createServer((req, res) => handle(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => server.close());

function call(
  path: string,
  {
    method = "GET",
    host = "localhost",
    origin,
    body,
  }: { method?: string; host?: string; origin?: string; body?: unknown } = {},
) {
  return new Promise<{ status: number; text: string }>((done, fail) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers: { host: `${host}:${port}`, ...(origin ? { origin } : {}) } },
      (res) => {
        let text = "";
        res.on("data", (part) => (text += part));
        res.on("end", () => done({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", fail);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("the Sound Studio's routes", () => {
  test("a folder lists its folders and only its audio files", async () => {
    const { status, text } = await call(`/__studio/list?path=${encodeURIComponent(samples)}`);
    expect(status).toBe(200);
    const listing = JSON.parse(text);
    expect(listing.dirs).toEqual(["Drums"]);
    expect(listing.files.map((f: { name: string }) => f.name)).toEqual(["whoosh.mp3"]);
    const drums = JSON.parse((await call(`/__studio/list?path=${encodeURIComponent(join(samples, "Drums"))}`)).text);
    expect(drums.files.map((f: { name: string }) => f.name)).toEqual(["kick.wav"]);
  });

  test("an audio file is served; anything else is refused", async () => {
    expect((await call(`/__studio/file?path=${encodeURIComponent(join(samples, "Drums", "kick.wav"))}`)).text).toBe(
      "RIFF-fake-wave",
    );
    expect((await call(`/__studio/file?path=${encodeURIComponent(join(samples, "Drums", "readme.txt"))}`)).status).toBe(
      403,
    );
  });

  test("a page or host from elsewhere is refused", async () => {
    const path = `/__studio/list?path=${encodeURIComponent(samples)}`;
    expect((await call(path, { host: "evil.example" })).status).toBe(403);
    expect((await call(path, { origin: "https://evil.example" })).status).toBe(403);
    expect((await call(path, { origin: `http://localhost:${port}` })).status).toBe(200);
  });

  test("only the loopback address counts as this PC", () => {
    const fake = (remoteAddress: string) =>
      ({ socket: { remoteAddress }, headers: { host: "localhost:5173" } }) as unknown as IncomingMessage;
    expect(isLocalRequest(fake("127.0.0.1"))).toBe(true);
    expect(isLocalRequest(fake("::1"))).toBe(true);
    expect(isLocalRequest(fake("192.168.1.20"))).toBe(false);
  });

  test("saving copies a library file into the studio folder and the game can load it", async () => {
    const kick = join(samples, "Drums", "kick.wav");
    const saved = await call("/__studio/save", {
      method: "POST",
      body: { sounds: { hit: [{ file: `lib:${kick}`, start: 0.01, sync: 0.02 }], "../evil": [{ file: "x" }] } },
    });
    expect(saved.status).toBe(200);
    const manifest = JSON.parse((await call("/__studio/sounds.json")).text);
    expect(Object.keys(manifest.sounds)).toEqual(["hit"]);
    const variant = manifest.sounds.hit[0];
    expect(variant.file).toMatch(/^studio:[0-9a-f]{16}\.wav$/);
    expect(variant).toMatchObject({ start: 0.01, sync: 0.02, source: kick });
    expect((await call(`/__studio/staged/${variant.file.slice(7)}`)).text).toBe("RIFF-fake-wave");
    expect(saves).toBe(1);
    // Nothing outside the studio folder is reachable through the staged route.
    expect((await call(`/__studio/staged/${encodeURIComponent("../studio.json")}`)).status).toBe(404);
  });

  test("an empty list switches a sound off; null puts it back to the game's own", async () => {
    await call("/__studio/save", { method: "POST", body: { sounds: { hit: [] } } });
    expect(JSON.parse((await call("/__studio/sounds.json")).text).sounds).toEqual({ hit: [] });
    await call("/__studio/save", { method: "POST", body: { sounds: { hit: null } } });
    expect(JSON.parse((await call("/__studio/sounds.json")).text).sounds).toEqual({});
  });

  test("search finds sounds in every folder below, every word counting, folder names too", async () => {
    mkdirSync(join(samples, "Impacts", "Heavy"), { recursive: true });
    writeFileSync(join(samples, "Impacts", "Heavy", "Body Slam 02.wav"), "x");
    writeFileSync(join(samples, "Impacts", "Heavy", "notes.txt"), "x");
    const ask = async (path: string, q: string) => {
      for (let i = 0; i < 50; i++) {
        const found = JSON.parse(
          (await call(`/__studio/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`)).text,
        );
        if (!found.indexing) return found;
        await new Promise((done) => setTimeout(done, 20));
      }
      throw new Error("never finished");
    };
    const slam = await ask(samples, "slam");
    expect(slam.results).toEqual([
      {
        path: join(samples, "Impacts", "Heavy", "Body Slam 02.wav"),
        name: "Body Slam 02.wav",
        folder: join("Impacts", "Heavy"),
      },
    ]);
    expect((await ask(samples, "heavy body")).total).toBe(1);
    expect((await ask(samples, "heavy whoosh")).total).toBe(0);
    expect((await ask(samples, "notes")).total).toBe(0);
    // A folder inside one already searched uses the same index, its results relative to it.
    const inner = await ask(join(samples, "Impacts"), "slam");
    expect(inner.results[0].folder).toBe("Heavy");
  });

  test("pins are remembered", async () => {
    await call("/__studio/pins", { method: "POST", body: { pins: [samples] } });
    expect(JSON.parse((await call("/__studio/places")).text).pins).toEqual([samples]);
    expect(existsSync(join(studio, "studio.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(studio, "studio.json"), "utf8")).pins).toEqual([samples]);
  });
});
