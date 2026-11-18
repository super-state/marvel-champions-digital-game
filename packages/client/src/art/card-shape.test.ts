import { afterEach, describe, expect, it, vi } from "vitest";
import { roundScan } from "./card-shape.js";

afterEach(() => vi.unstubAllGlobals());

describe("physical card scans", () => {
  it.each([
    [630, 900],
    [900, 630],
  ])("clips all corners of a %i × %i face without resizing its print", (width, height) => {
    const ctx = {
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      arcTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    vi.stubGlobal("document", { createElement: () => canvas });
    const image = { naturalWidth: width, naturalHeight: height } as HTMLImageElement;

    expect(roundScan(image)).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([width, height]);
    const radius = 630 * 0.058;
    expect(ctx.arcTo.mock.calls).toEqual([
      [width, 0, width, height, radius],
      [width, height, 0, height, radius],
      [0, height, 0, 0, radius],
      [0, 0, width, 0, radius],
    ]);
    expect(ctx.clip).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0);
  });

  it("keeps the original scan available if a device cannot allocate a clipping surface", () => {
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
    const image = { naturalWidth: 630, naturalHeight: 900 } as HTMLImageElement;
    expect(roundScan(image)).toBe(image);
  });
});
