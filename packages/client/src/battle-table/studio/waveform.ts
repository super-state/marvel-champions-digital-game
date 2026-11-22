/**
 * The Sound Studio's waveform: the whole file drawn, the part in use lit, and handles to drag: Start and End (the
 * cut), the two fades (dots along the top), and the gold "lands here" sync marker, the instant that lines up with the
 * table's moment. Double-click puts the marker there. The wheel zooms around the pointer; dragging empty space pans
 * once zoomed in.
 */

import { regionOf, type Variant } from "../sound-edit.js";

type Handle = "start" | "end" | "sync" | "fadeIn" | "fadeOut" | "pan";

const HIT = 9;
const PAD_TOP = 22;
const PAD_BOTTOM = 20;

export class WaveEditor {
  readonly #canvas: HTMLCanvasElement;
  readonly #onChange: (variant: Variant) => void;
  #buffer: AudioBuffer | null = null;
  #mono: Float32Array | null = null;
  #variant: Variant = { file: "" };
  #view = { from: 0, to: 1 };
  #playhead: number | null = null;
  #drag: { handle: Handle; x: number; from: number; to: number } | null = null;
  #hover: Handle | null = null;

  constructor(canvas: HTMLCanvasElement, onChange: (variant: Variant) => void) {
    this.#canvas = canvas;
    this.#onChange = onChange;
    new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener("pointerdown", (event) => this.#down(event));
    canvas.addEventListener("pointermove", (event) => this.#move(event));
    canvas.addEventListener("pointerup", (event) => this.#up(event));
    canvas.addEventListener("pointercancel", (event) => this.#up(event));
    canvas.addEventListener("dblclick", (event) => {
      if (!this.#buffer) return;
      this.#set({ sync: this.#clampToCut(this.#timeAt(event.offsetX)) });
    });
    canvas.addEventListener(
      "wheel",
      (event) => {
        if (!this.#buffer) return;
        event.preventDefault();
        if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          const span = this.#view.to - this.#view.from;
          this.#setView(this.#view.from + ((event.deltaX || event.deltaY) / this.#width()) * span);
          return;
        }
        const at = this.#timeAt(event.offsetX);
        const factor = event.deltaY > 0 ? 1.25 : 0.8;
        const span = Math.min(this.#duration(), Math.max(0.02, (this.#view.to - this.#view.from) * factor));
        const share = (at - this.#view.from) / (this.#view.to - this.#view.from);
        this.#view = { from: at - span * share, to: at - span * share + span };
        this.#setView(this.#view.from);
      },
      { passive: false },
    );
  }

  get variant(): Variant {
    return this.#variant;
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.#buffer = buffer;
    this.#mono = null;
    if (buffer) {
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
      }
      this.#mono = mono;
    }
    this.zoomFit();
  }

  setVariant(variant: Variant): void {
    this.#variant = { ...variant };
    this.draw();
  }

  setPlayhead(seconds: number | null): void {
    this.#playhead = seconds;
    this.draw();
  }

  zoomFit(): void {
    this.#view = { from: 0, to: this.#duration() };
    this.draw();
  }

  zoomToCut(): void {
    const { start, end } = regionOf(this.#variant, this.#duration());
    const margin = Math.max(0.02, (end - start) * 0.08);
    this.#view = { from: Math.max(0, start - margin), to: Math.min(this.#duration(), end + margin) };
    this.draw();
  }

  #duration() {
    return this.#buffer?.duration ?? 1;
  }

  #width() {
    return this.#canvas.clientWidth || 1;
  }

  #setView(from: number) {
    const span = this.#view.to - this.#view.from;
    const start = Math.min(Math.max(0, from), Math.max(0, this.#duration() - span));
    this.#view = { from: start, to: start + span };
    this.draw();
  }

  #timeAt(x: number) {
    return this.#view.from + (x / this.#width()) * (this.#view.to - this.#view.from);
  }

  #xAt(t: number) {
    return ((t - this.#view.from) / (this.#view.to - this.#view.from)) * this.#width();
  }

  #clampToCut(t: number) {
    const { start, end } = regionOf(this.#variant, this.#duration());
    return Math.min(end, Math.max(start, t));
  }

  #positions() {
    const { start, end } = regionOf(this.#variant, this.#duration());
    const fadeIn = Math.min(this.#variant.fadeIn ?? 0, end - start);
    const fadeOut = Math.min(this.#variant.fadeOut ?? 0, end - start - fadeIn);
    return { start, end, fadeIn, fadeOut, sync: this.#clampToCut(this.#variant.sync ?? start) };
  }

  #handleAt(x: number, y: number): Handle | null {
    if (!this.#buffer) return null;
    const p = this.#positions();
    const near = (t: number) => Math.abs(this.#xAt(t) - x) <= HIT;
    if (y <= PAD_TOP + 10) {
      if (near(p.start + p.fadeIn) && p.fadeIn >= 0) return "fadeIn";
      if (near(p.end - p.fadeOut)) return "fadeOut";
    }
    if (near(p.sync)) return "sync";
    if (near(p.start)) return "start";
    if (near(p.end)) return "end";
    return this.#view.to - this.#view.from < this.#duration() - 0.001 ? "pan" : null;
  }

  #down(event: PointerEvent) {
    const handle = this.#handleAt(event.offsetX, event.offsetY);
    if (!handle) return;
    this.#canvas.setPointerCapture(event.pointerId);
    this.#drag = { handle, x: event.offsetX, ...this.#view };
  }

  #move(event: PointerEvent) {
    if (!this.#drag) {
      const hover = this.#handleAt(event.offsetX, event.offsetY);
      if (hover !== this.#hover) {
        this.#hover = hover;
        this.#canvas.style.cursor = !hover ? "default" : hover === "pan" ? "grab" : "ew-resize";
        this.draw();
      }
      return;
    }
    const t = Math.min(this.#duration(), Math.max(0, this.#timeAt(event.offsetX)));
    const p = this.#positions();
    switch (this.#drag.handle) {
      case "start": {
        const start = Math.min(t, p.end - 0.005);
        this.#set({ start, sync: Math.max(start, p.sync) });
        break;
      }
      case "end": {
        const end = Math.max(t, p.start + 0.005);
        this.#set({ end, sync: Math.min(end, p.sync) });
        break;
      }
      case "sync":
        this.#set({ sync: this.#clampToCut(t) });
        break;
      case "fadeIn":
        this.#set({ fadeIn: Math.min(Math.max(0, t - p.start), p.end - p.start - p.fadeOut) });
        break;
      case "fadeOut":
        this.#set({ fadeOut: Math.min(Math.max(0, p.end - t), p.end - p.start - p.fadeIn) });
        break;
      case "pan": {
        const span = this.#drag.to - this.#drag.from;
        this.#view = { ...this.#drag };
        this.#setView(this.#drag.from - ((event.offsetX - this.#drag.x) / this.#width()) * span);
        break;
      }
    }
  }

  #up(event: PointerEvent) {
    if (this.#drag) this.#canvas.releasePointerCapture(event.pointerId);
    this.#drag = null;
  }

  #set(change: Partial<Variant>) {
    const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 10000) / 10000);
    this.#variant = {
      ...this.#variant,
      ...Object.fromEntries(Object.entries(change).map(([k, v]) => [k, round(v as number)])),
    };
    this.draw();
    this.#onChange(this.#variant);
  }

  draw(): void {
    const canvas = this.#canvas;
    const ratio = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#0a0f18";
    g.fillRect(0, 0, w, h);
    const top = PAD_TOP;
    const bottom = h - PAD_BOTTOM;
    const mid = (top + bottom) / 2;
    const amp = (bottom - top) / 2;
    if (!this.#buffer || !this.#mono) {
      g.fillStyle = "#6b7890";
      g.font = "13px system-ui";
      g.textAlign = "center";
      g.fillText("Pick a sound on the right, or a file in the browser, to edit it here", w / 2, mid);
      return;
    }
    const p = this.#positions();
    const rate = this.#buffer.sampleRate;
    const x0 = this.#xAt(p.start);
    const x1 = this.#xAt(p.end);
    g.fillStyle = "#16233a";
    g.fillRect(x0, top, x1 - x0, bottom - top);
    // Waveform: min and max of the samples under each pixel.
    const mono = this.#mono;
    for (let x = 0; x < w; x++) {
      const t0 = this.#timeAt(x);
      const t1 = this.#timeAt(x + 1);
      const i0 = Math.max(0, Math.floor(t0 * rate));
      const i1 = Math.min(mono.length, Math.max(i0 + 1, Math.floor(t1 * rate)));
      if (i0 >= mono.length) break;
      let lo = 1;
      let hi = -1;
      const step = Math.max(1, Math.floor((i1 - i0) / 400));
      for (let i = i0; i < i1; i += step) {
        const v = mono[i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const inside = t0 >= p.start && t0 <= p.end;
      g.fillStyle = inside ? "#6fb8ff" : "#34405a";
      g.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
    }
    // Fades: the volume line across the cut, from silence up and back down.
    const fx = (t: number) => this.#xAt(t);
    g.strokeStyle = "#f6c564";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(fx(p.start), p.fadeIn > 0 ? bottom : top);
    g.lineTo(fx(p.start + p.fadeIn), top);
    g.lineTo(fx(p.end - p.fadeOut), top);
    g.lineTo(fx(p.end), p.fadeOut > 0 ? bottom : top);
    g.stroke();
    g.fillStyle = "rgba(10,15,24,.55)";
    if (p.fadeIn > 0) {
      g.beginPath();
      g.moveTo(fx(p.start), top);
      g.lineTo(fx(p.start + p.fadeIn), top);
      g.lineTo(fx(p.start), bottom);
      g.fill();
    }
    if (p.fadeOut > 0) {
      g.beginPath();
      g.moveTo(fx(p.end - p.fadeOut), top);
      g.lineTo(fx(p.end), top);
      g.lineTo(fx(p.end), bottom);
      g.fill();
    }
    // Outside the cut: darkened.
    g.fillStyle = "rgba(5,8,14,.6)";
    g.fillRect(0, top, Math.max(0, x0), bottom - top);
    g.fillRect(x1, top, Math.max(0, w - x1), bottom - top);
    // Handles.
    const line = (x: number, color: string, label: string, dashed = false, active = false, low = false) => {
      g.strokeStyle = color;
      g.lineWidth = active ? 3 : 2;
      g.setLineDash(dashed ? [5, 4] : []);
      g.beginPath();
      g.moveTo(x, top - 4);
      g.lineTo(x, bottom);
      g.stroke();
      g.setLineDash([]);
      g.font = "600 11px system-ui";
      const width = g.measureText(label).width + 10;
      const left = Math.min(Math.max(0, x - width / 2), w - width);
      // The marker's tab sits lower, so it never hides Start or End when they meet.
      const y = low ? top + 4 : 2;
      g.fillStyle = color;
      g.fillRect(left, y, width, 16);
      g.fillStyle = "#0a0f18";
      g.textAlign = "left";
      g.fillText(label, left + 5, y + 12);
    };
    line(x0, "#e8edf6", "Start", false, this.#hover === "start");
    line(x1, "#e8edf6", "End", false, this.#hover === "end");
    line(this.#xAt(p.sync), "#f6c564", "⚡ lands here", true, this.#hover === "sync", true);
    for (const [t, handle] of [
      [p.start + p.fadeIn, "fadeIn"],
      [p.end - p.fadeOut, "fadeOut"],
    ] as const) {
      g.fillStyle = this.#hover === handle ? "#fff3c4" : "#f6c564";
      g.beginPath();
      g.arc(this.#xAt(t), top + 1, 5, 0, Math.PI * 2);
      g.fill();
    }
    if (this.#playhead !== null) {
      g.strokeStyle = "#4fb3ff";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(this.#xAt(this.#playhead), top);
      g.lineTo(this.#xAt(this.#playhead), bottom);
      g.stroke();
    }
    // Time ruler.
    const span = this.#view.to - this.#view.from;
    const steps = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const step = steps.find((s) => (s / span) * w >= 70) ?? 60;
    g.fillStyle = "#6b7890";
    g.font = "10px system-ui";
    g.textAlign = "center";
    for (let t = Math.ceil(this.#view.from / step) * step; t <= this.#view.to; t += step) {
      const x = this.#xAt(t);
      g.fillRect(x, bottom + 2, 1, 4);
      g.fillText(step < 1 ? `${Math.round(t * 1000)} ms` : `${t.toFixed(step < 10 ? 1 : 0)} s`, x, h - 4);
    }
  }
}
