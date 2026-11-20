/**
 * The battle table's symbol set: one drawing per idea, used by the DOM controls (inline SVG in `currentColor`) and
 * by the 3D tokens (painted onto canvas textures). Every icon sits on a 24×24 grid. Original drawings, kept simple
 * so they read at 14px and on a token seen at an angle.
 */

interface Layer {
  readonly d: string;
  /** Stroke width on the 24px grid; filled when absent. */
  readonly stroke?: number;
  /** Fill rule; even-odd (so cut-outs work) unless the shapes overlap on purpose. */
  readonly rule?: "nonzero";
}

function polygon(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z";
}

/** A star or burst: `spikes` points alternating between the outer and inner radius. */
function star(cx: number, cy: number, spikes: number, outer: number, inner: number, turn = -Math.PI / 2): string {
  const points: [number, number][] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 ? inner : outer;
    const angle = turn + (i * Math.PI) / spikes;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  return polygon(points);
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
}

/** An exclamation mark cut out of a filled shape (use with the even-odd rule). */
const exclaim = (top: number, bottom: number) =>
  `M10.9 ${top}h2.2l-.35 ${bottom - top - 4.2}h-1.5zM12 ${bottom - 2.6}a1.35 1.35 0 1 1 0 2.7a1.35 1.35 0 1 1 0-2.7z`;

const ICONS = {
  /** Remaining hit points. */
  heart: [
    {
      d: "M12 21.1l-1.45-1.32C5.4 15.1 2 12.03 2 8.25 2 5.17 4.42 2.75 7.5 2.75c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09 3.08 0 5.5 2.42 5.5 5.5 0 3.78-3.4 6.85-8.55 11.54z",
    },
  ],
  /** Damage dealt. */
  damage: [{ d: star(12, 12, 9, 11.4, 6.1, -Math.PI / 2 + 0.17) }],
  /** Healing. */
  heal: [{ d: `${circle(12, 12, 10.5)}M10.4 6.2h3.2v4.2h4.2v3.2h-4.2v4.2h-3.2v-4.2H6.2v-3.2h4.2z` }],
  /** Threat on a scheme. */
  threat: [
    {
      d:
        "M12 2.2c.55 0 1.05.3 1.33.78l9.4 16.3a1.53 1.53 0 0 1-1.33 2.3H2.6a1.53 1.53 0 0 1-1.33-2.3l9.4-16.3c.28-.48.78-.78 1.33-.78z" +
        exclaim(8.2, 19.2),
    },
  ],
  /** Acceleration: extra threat every villain phase. */
  acceleration: [
    { d: "M12 2.5l8.5 8-2.2 2.3L12 6.9l-6.3 5.9-2.2-2.3zM12 10.4l8.5 8-2.2 2.3L12 14.8l-6.3 5.9-2.2-2.3z" },
  ],
  /** Crisis: threat cannot be removed from the main scheme. */
  crisis: [{ d: polygon(octagon(12, 12, 10.6)) + exclaim(6.4, 18.2) }],
  /** Hazard: an extra encounter card each round. */
  hazard: [{ d: "M12 1.4L22.6 12 12 22.6 1.4 12z" + exclaim(6.6, 17.8) }],
  /** Surge: another encounter card follows. */
  surge: [{ d: "M2.5 4.5h4.6l7.2 7.5-7.2 7.5H2.5l7.2-7.5zM10.2 4.5h4.6l7.2 7.5-7.2 7.5h-4.6l7.2-7.5z" }],
  /** Boost icons on an encounter card. */
  boost: [
    {
      d: "M1.8 3.2C5.4 3.2 8.8 6.8 12 6.8C15.2 6.8 18.6 3.2 22.2 3.2C21.4 6 17.8 9 15.4 10.4C14.6 11 14.4 12.2 14.3 14C14.1 16.4 13.4 18.8 12 21.4C10.6 18.8 9.9 16.4 9.7 14C9.6 12.2 9.4 11 8.6 10.4C6.2 9 2.6 6 1.8 3.2Z",
    },
  ],
  /** Wild resource. */
  wild: [{ d: star(12, 12, 4, 11.2, 3.6) + star(19, 5, 4, 3.4, 1.1) }],
  /** Energy resource; also a hero interrupt's lightning. */
  energy: [{ d: "M13.6 1.6L3.9 13.7h6.6l-1.6 8.7 10.2-13.2h-6.9z" }],
  /** Mental resource: an atom. */
  mental: [
    {
      d: "M2.5 12a9.5 3.7 0 1 0 19 0a9.5 3.7 0 1 0-19 0M7.25 3.77a9.5 3.7 60 1 0 9.5 16.46a9.5 3.7 60 1 0-9.5-16.46M16.75 3.77a9.5 3.7 120 1 0-9.5 16.46a9.5 3.7 120 1 0 9.5-16.46",
      stroke: 1.7,
    },
    { d: circle(12, 12, 2.4) },
  ],
  /** Physical resource: a clenched fist, knuckles forward. */
  physical: [
    {
      d:
        "M6.2 4.4h2.9a1.5 1.5 0 0 1 1.5 1.5v4.4H4.7V5.9a1.5 1.5 0 0 1 1.5-1.5z" +
        "M11.1 3.6H14a1.5 1.5 0 0 1 1.5 1.5v5.2h-5.9V5.1a1.5 1.5 0 0 1 1.5-1.5z" +
        "M16.2 4.6h2.6a1.5 1.5 0 0 1 1.5 1.5v4.2h-5.6V6.1a1.5 1.5 0 0 1 1.5-1.5z" +
        "M4.7 11.2h15.6v4.1c0 3.9-3.1 7-7 7h-1.8c-3.7 0-6.8-3-6.8-6.8z" +
        "M2.9 12.6a2.2 2.2 0 0 1 2.2-2.2h4.6a2.2 2.2 0 0 1 0 4.4H5.1a2.2 2.2 0 0 1-2.2-2.2z",
      rule: "nonzero",
    },
  ],
  /** Stunned status: seeing stars. */
  stunned: [{ d: star(10, 13.5, 5, 8.6, 3.7) + star(19.3, 5.2, 4, 3.6, 1.2) + star(4, 4, 4, 2.6, 0.9) }],
  /** Confused status: a spiral. */
  confused: [
    {
      d: "M12.2 12.2c.6-.9-.3-2-1.3-1.6-1.6.6-1.3 3 .2 3.6 2.3.9 4.5-1.3 4-3.6-.7-3.3-4.7-4.4-7.1-2.4-3.2 2.6-2.2 7.9 1.6 9.1 4.4 1.4 9-1.9 8.9-6.6",
      stroke: 2.3,
    },
  ],
  /** Tough status, and defense. */
  tough: [{ d: "M12 1.8l8.6 3.2v6.2c0 5.5-3.6 10.3-8.6 11.6-5-1.3-8.6-6.1-8.6-11.6V5z" }],
  /** Exhausting a card for its ability (turns it sideways). */
  exhaust: [{ d: "M5.2 15.6A7.6 7.6 0 1 1 12.4 20", stroke: 2.4 }, { d: "M2 12.2l3.3 5.4 4.6-4.3z" }],
  /** Undo the last move. */
  undo: [{ d: "M8.6 9.2h7.2a5.1 5.1 0 0 1 0 10.2H9.4", stroke: 2.4 }, { d: "M9.6 4.2L3.4 9.2l6.2 5z" }],
  /** End the turn / continue. */
  next: [{ d: "M3.8 10.6h11.4l-4.3-4.3 2-2 7.7 7.7-7.7 7.7-2-2 4.3-4.3H3.8z" }],
  /** Swap cards out of the opening hand. */
  mulligan: [
    { d: "M19.2 9.4A7.6 7.6 0 0 0 5.4 7.6M4.8 14.6a7.6 7.6 0 0 0 13.8 1.8", stroke: 2.3 },
    { d: "M21.4 3.7l-.6 7.3-7-2.2zM2.6 20.3l.6-7.3 7 2.2z" },
  ],
  /** A face-down deck. */
  deck: [
    { d: "M7.6 2.6h9.6a2 2 0 0 1 2 2v13.6a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2V4.6a2 2 0 0 1 2-2z", stroke: 1.9 },
    { d: "M4.6 6.2v13a2.2 2.2 0 0 0 2.2 2.2h9.4", stroke: 1.9 },
  ],
  /** Draw a card. */
  draw: [
    { d: "M6.6 7.4h9a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V9.4a2 2 0 0 1 2-2z", stroke: 1.9 },
    { d: "M15.5 1.6l5.3 5.2h-3.4v4.2h-3.8V6.8h-3.4z" },
  ],
  /** Discard a card. */
  discard: [
    { d: "M6.6 2.2h9a2 2 0 0 1 2 2v10.4a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V4.2a2 2 0 0 1 2-2z", stroke: 1.9 },
    { d: "M11.1 9.2h3.8v6h3.4l-5.3 6.6-5.3-6.6h3.4z" },
  ],
  /** A forced effect or an alert. */
  forced: [{ d: circle(12, 12, 10.6) + exclaim(5.2, 18.6) }],
  /** A response: after something happens. */
  response: [{ d: "M10 8.6V4.2L2.6 11.6 10 19v-4.5c5.1 0 8.6 1.6 11.4 5.2-1.1-5.4-4.4-10-11.4-11.1z" }],
  /** A card's action ability. */
  action: [
    {
      d: polygon([
        [5, 3],
        [20.5, 12],
        [5, 21],
      ]),
    },
  ],
  /** Defeated: a skull. */
  defeated: [
    {
      d:
        "M12 2.4c-4.9 0-8.6 3.5-8.6 8.3 0 2.7 1.2 4.7 3.1 5.9v3.4c0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2v-3.4c1.9-1.2 3.1-3.2 3.1-5.9 0-4.8-3.7-8.3-8.6-8.3z" +
        circle(8.5, 11.2, 2.3) +
        circle(15.5, 11.2, 2.3) +
        "M12 13.9l1.4 2.5h-2.8zM9.7 18.4h1.1v2.4H9.7zM13.2 18.4h1.1v2.4h-1.1z",
    },
  ],
  /** Done, keep as it is. */
  check: [{ d: "M4.5 12.6l4.9 4.9L19.6 7.1", stroke: 2.6 }],
  /** The game menu. */
  menu: [{ d: "M4 6.5h16M4 12h16M4 17.5h16", stroke: 2.4 }],
  /** Close a panel. */
  close: [{ d: "M6 6l12 12M18 6L6 18", stroke: 2.4 }],
  /** Attack: a strike with speed lines. */
  attack: [
    { d: star(14.5, 9.5, 7, 8.6, 4.2) },
    { d: "M2.6 21.4l5.6-5.6M2.6 16.6l3.1-3.1M7.4 21.4l3.1-3.1", stroke: 2.2 },
  ],
  /** Thwart. */
  thwart: [
    { d: `${circle(12, 12, 9.6)}`, stroke: 2.3 },
    { d: "M7.2 16.8L16.8 7.2", stroke: 2.6 },
  ],
  /** Recover. */
  recover: [{ d: `${circle(12, 12, 10.5)}M10.4 6.2h3.2v4.2h4.2v3.2h-4.2v4.2h-3.2v-4.2H6.2v-3.2h4.2z` }],
  /** Change form: flip the identity card. */
  flip: [
    { d: "M4.4 9.2a7.8 7.8 0 0 1 14.2-2.8M19.6 14.8a7.8 7.8 0 0 1-14.2 2.8", stroke: 2.3 },
    { d: "M20.8 2.6v6.3h-6.3zM3.2 21.4v-6.3h6.3z" },
  ],
  /** A scheme: villain plotting. */
  scheme: [
    { d: `${circle(12, 12, 4)}`, stroke: 2.2 },
    {
      d: "M10.6 1.6h2.8l.5 2.6 2 .9 2.2-1.5 2 2-1.5 2.2.9 2 2.6.5v2.8l-2.6.5-.9 2 1.5 2.2-2 2-2.2-1.5-2 .9-.5 2.6h-2.8l-.5-2.6-2-.9-2.2 1.5-2-2 1.5-2.2-.9-2-2.6-.5v-2.8l2.6-.5.9-2-1.5-2.2 2-2 2.2 1.5 2-.9z",
      stroke: 1.6,
    },
  ],
  /** Your side: a shield with a star cut out of it. */
  hero: [
    {
      d: "M12 1.8l8.6 3.1v6.3c0 5.3-3.6 9.6-8.6 11.2-5-1.6-8.6-5.9-8.6-11.2V4.9z" + star(12, 11.4, 5, 5, 2.05),
    },
  ],
  /** The enemy's side: a horned mask with slit eyes. */
  villain: [
    {
      d:
        polygon([
          [2.6, 2.4],
          [8.2, 6.6],
          [15.8, 6.6],
          [21.4, 2.4],
          [20, 12.2],
          [12, 22],
          [4, 12.2],
        ]) +
        polygon([
          [6.6, 10.2],
          [10.9, 11.7],
          [10.5, 13.4],
          [7.3, 12.4],
        ]) +
        polygon([
          [17.4, 10.2],
          [13.1, 11.7],
          [13.5, 13.4],
          [16.7, 12.4],
        ]),
    },
  ],
} satisfies Record<string, readonly Layer[]>;

function octagon(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number];
  });
}

export type IconName = keyof typeof ICONS;

const SVG = "http://www.w3.org/2000/svg";

/** An inline icon in `currentColor`, hidden from assistive tech unless it carries a title. */
export function icon(name: IconName, title?: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon icon-${name}`);
  if (title) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", title);
  } else svg.setAttribute("aria-hidden", "true");
  for (const layer of ICONS[name] as readonly Layer[]) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", layer.d);
    if (layer.stroke) {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", String(layer.stroke));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    } else {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("fill-rule", layer.rule ?? "evenodd");
    }
    svg.append(path);
  }
  return svg;
}

const paths = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let path = paths.get(d);
  if (!path) paths.set(d, (path = new Path2D(d)));
  return path;
}

/** Paint an icon centred on (x, y) at `size` pixels, for token faces. */
export function paintIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  for (const layer of ICONS[name] as readonly Layer[]) {
    if (layer.stroke) {
      ctx.lineWidth = layer.stroke;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke(path2d(layer.d));
    } else ctx.fill(path2d(layer.d), layer.rule ?? "evenodd");
  }
  ctx.restore();
}

/** The resource icons, by engine resource type. */
export const RESOURCE_ICON: Record<string, IconName> = {
  physical: "physical",
  mental: "mental",
  energy: "energy",
  wild: "wild",
};
