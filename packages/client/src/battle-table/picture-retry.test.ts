import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PICTURE_RETRY_DELAYS_MS, loadWithRetry, pictureOf, retryUrl } from "./picture-retry.js";

describe("retryUrl / pictureOf", () => {
  it("leaves the first try plain and marks later ones", () => {
    expect(retryUrl("/card-art/bundles/cards/01062.png", 0)).toBe("/card-art/bundles/cards/01062.png");
    expect(retryUrl("/card-art/bundles/cards/01062.png", 2)).toBe("/card-art/bundles/cards/01062.png?retry=2");
    expect(retryUrl("/a.png?v=1", 1)).toBe("/a.png?v=1&retry=1");
  });

  it("never marks data or blob URLs", () => {
    expect(retryUrl("data:image/png;base64,AAAA", 3)).toBe("data:image/png;base64,AAAA");
    expect(retryUrl("blob:http://x/1", 1)).toBe("blob:http://x/1");
  });

  it("finds the picture a try is of", () => {
    for (const url of ["/card-art/x.png", "/a.png?v=1"])
      for (const n of [0, 1, 4]) expect(pictureOf(retryUrl(url, n))).toBe(url);
  });
});

describe("loadWithRetry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks again after each delay until a try works", () => {
    const asked: string[] = [];
    loadWithRetry("/p.png", (url, onError) => {
      asked.push(url);
      if (asked.length < 3) onError();
    });
    expect(asked).toEqual(["/p.png"]);
    vi.advanceTimersByTime(PICTURE_RETRY_DELAYS_MS[0]!);
    expect(asked).toEqual(["/p.png", "/p.png?retry=1"]);
    vi.advanceTimersByTime(PICTURE_RETRY_DELAYS_MS[1]!);
    expect(asked).toEqual(["/p.png", "/p.png?retry=1", "/p.png?retry=2"]);
    vi.runAllTimers();
    expect(asked).toHaveLength(3);
  });

  it("gives up after the last delay", () => {
    const asked: string[] = [];
    loadWithRetry("/p.png", (url, onError) => {
      asked.push(url);
      onError();
    });
    vi.runAllTimers();
    expect(asked).toHaveLength(PICTURE_RETRY_DELAYS_MS.length + 1);
  });

  it("stops once the picture isn't wanted any more", () => {
    const asked: string[] = [];
    let alive = true;
    loadWithRetry(
      "/p.png",
      (url, onError) => {
        asked.push(url);
        onError();
      },
      () => alive,
    );
    alive = false;
    vi.runAllTimers();
    expect(asked).toEqual(["/p.png"]);
  });
});
