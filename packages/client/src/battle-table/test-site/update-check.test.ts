import { afterEach, describe, expect, it, vi } from "vitest";
import { newerVersionLive } from "./update-check.js";

const live = (body: unknown, ok = true) =>
  vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, json: async () => body }) as unknown as Response);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a new version is taken between matches (update-check.ts)", () => {
  it("is taken when the site serves a different version from the page's", async () => {
    vi.stubEnv("VITE_TABLE_VERSION", "0.2.8");
    const fetch = live({ version: "0.2.9" });
    vi.stubGlobal("fetch", fetch);
    expect(await newerVersionLive()).toBe(true);
    // Asked fresh each time, never from a cache.
    expect(fetch.mock.calls[0]![0]).toMatch(/^\/table-version\.json\?at=\d+$/);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ cache: "no-store" });
  });

  it("is not when the site serves this version, or can't say", async () => {
    vi.stubEnv("VITE_TABLE_VERSION", "0.2.8");
    vi.stubGlobal("fetch", live({ version: "0.2.8" }));
    expect(await newerVersionLive()).toBe(false);
    vi.stubGlobal("fetch", live({}, false));
    expect(await newerVersionLive()).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await newerVersionLive()).toBe(false);
  });

  it("never asks on Adam's own table, which has no version", async () => {
    vi.stubEnv("VITE_TABLE_VERSION", "");
    const fetch = live({ version: "0.2.9" });
    vi.stubGlobal("fetch", fetch);
    expect(await newerVersionLive()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("every shipped build carries table-version.json with its version (vite.config.ts)", async () => {
    // Imported by a path tsc doesn't follow: the config sits outside `src`.
    const configPath = "../../../vite.config.ts";
    type Config = { plugins: unknown[] };
    const loaded = ((await import(/* @vite-ignore */ configPath)) as { default: Config | ((env: object) => Config) })
      .default;
    const config = typeof loaded === "function" ? loaded({ command: "build", mode: "production" }) : loaded;
    const plugin = config.plugins.flat().find((p) => (p as { name?: string })?.name === "table-version") as {
      apply: string;
      generateBundle(this: { emitFile(file: unknown): void }): void;
    };
    expect(plugin.apply).toBe("build");
    const emitted: unknown[] = [];
    vi.stubEnv("VITE_TABLE_VERSION", "0.2.9");
    plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
    expect(emitted).toEqual([{ type: "asset", fileName: "table-version.json", source: '{"version":"0.2.9"}' }]);
    // Adam's own builds (no version) carry none.
    vi.stubEnv("VITE_TABLE_VERSION", "");
    emitted.length = 0;
    plugin.generateBundle.call({ emitFile: (file) => emitted.push(file) });
    expect(emitted).toEqual([]);
  });
});
