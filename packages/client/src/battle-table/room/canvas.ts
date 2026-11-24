// Drawing helpers for the room's printed things: canvases, textures, and the shared token kit.
import * as THREE from "three";
import { TokenKit } from "../tokens3d.js";

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d")!];
}

let maxAnisotropy = 8;
/** The sharpest texture filtering the renderer offers, up to 8 (set once the renderer exists). */
export function setAnisotropy(value: number) {
  maxAnisotropy = value;
}
export const anisotropy = () => maxAnisotropy;

export function texture(source: HTMLCanvasElement | HTMLImageElement): THREE.Texture {
  const t = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAnisotropy;
  t.needsUpdate = true;
  return t;
}

let kit: TokenKit | null = null;
export const tokens = () => (kit ??= new TokenKit(maxAnisotropy, () => {}));

/** Greys out a print: most of the colour gone, a little darker. */
export function greyOut(c: HTMLCanvasElement) {
  const g = c.getContext("2d")!;
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const grey = 0.3 * px[i]! + 0.59 * px[i + 1]! + 0.11 * px[i + 2]!;
    for (let k = 0; k < 3; k++) px[i + k] = (px[i + k]! * 0.12 + grey * 0.88) * 0.72;
  }
  g.putImageData(data, 0, 0);
}

export function halftone(g: CanvasRenderingContext2D, width: number, height: number, colour: string, alpha: number) {
  g.save();
  g.fillStyle = colour;
  g.globalAlpha = alpha;
  const step = 18;
  for (let y = 0; y < height + step; y += step)
    for (let x = (y / step) % 2 ? step / 2 : 0; x < width + step; x += step) {
      const r = 2 + 5 * (y / height);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  g.restore();
}

export function polygon(g: CanvasRenderingContext2D, points: readonly (readonly [number, number])[]) {
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
}
