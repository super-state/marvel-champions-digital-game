/** Die-cut corners, measured against the short edge so landscape scans and enlarged previews match the hand. */
export function cardRadius(width: number, height: number): number {
  return Math.max(0, Math.min(width, height)) * 0.058;
}

type CardPathContext = Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "arcTo" | "closePath">;

export function cardCanvasPath(ctx: CardPathContext, width: number, height: number, inset = 0): void {
  const r = Math.max(0, cardRadius(width, height) - inset);
  const right = width - inset;
  const bottom = height - inset;
  ctx.beginPath();
  ctx.moveTo(inset + r, inset);
  ctx.arcTo(right, inset, right, bottom, r);
  ctx.arcTo(right, bottom, inset, bottom, r);
  ctx.arcTo(inset, bottom, inset, inset, r);
  ctx.arcTo(inset, inset, right, inset, r);
  ctx.closePath();
}

/** Punch the corners out before the scan's single texture upload. Every use of the face then shares the same alpha
 * (including rotated, clipped and flying cards), with no per-card filter or second texture to evict. */
export function roundScan(image: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return image;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // A CPU-backed surface also uploads reliably after a lost context on WebKitGTK.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return image;
  cardCanvasPath(ctx, width, height);
  ctx.clip();
  ctx.drawImage(image, 0, 0);
  return canvas;
}
