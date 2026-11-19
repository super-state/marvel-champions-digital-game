import * as THREE from "three";
import { paintIcon, type IconName } from "./icons.js";

/**
 * The physical tokens on the table: enamel damage discs, counter discs, status tiles and stat pills. Each is a small
 * piece of 3D kit with a painted face, sized in card units (a card is 1 wide), readable at a glance from the camera:
 * one big number, one symbol, one colour per meaning.
 */

export type TokenShape = "damage" | "counter" | "status" | "modifier";

const STATUS: Record<string, { color: string; deep: string; ink: string; icon: IconName; label: string }> = {
  stunned: { color: "#ffc53d", deep: "#b97a06", ink: "#2f1d00", icon: "stunned", label: "Stunned" },
  confused: { color: "#c49bff", deep: "#6d3fc0", ink: "#1f0b40", icon: "confused", label: "Confused" },
  tough: { color: "#62d6ec", deep: "#1d7f96", ink: "#04242c", icon: "tough", label: "Tough" },
};

const COUNTER: Record<string, { color: string; icon: IconName | null; label: string }> = {
  acceleration: { color: "#ff7a3d", icon: "acceleration", label: "Accel" },
  threat: { color: "#ffa53a", icon: "threat", label: "Threat" },
  tucked: { color: "#d8c49a", icon: "deck", label: "Under" },
  web: { color: "#e9f1f7", icon: null, label: "Web" },
  snoop: { color: "#6cc0ff", icon: null, label: "Snoop" },
};

const STAT_COLOR: Record<string, string> = {
  THW: "#2f84d4",
  ATK: "#d93a33",
  DEF: "#2a9e68",
  SCH: "#6a6f96",
  REC: "#1f8f9d",
  HP: "#c8323f",
};

export function shapeOf(name: string): TokenShape {
  if (name === "damage") return "damage";
  if (name in STATUS) return "status";
  if (/^(THW|ATK|DEF|SCH|REC|HP)$/.test(name)) return "modifier";
  return "counter";
}

const FONT = '"Public Sans", system-ui, sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, max: number) {
  let px = size;
  do {
    ctx.font = `${weight} ${px}px ${FONT}`;
    px -= 4;
  } while (ctx.measureText(text).width > max && px > 12);
}

/** A big number with a dark outline, the way a printed token reads from across a table. */
function number(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, max: number) {
  fitText(ctx, text, "italic 900", size, max);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = "rgba(20, 4, 2, 0.85)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y);
}

function paintDamage(ctx: CanvasRenderingContext2D, size: number, count: number) {
  const c = size / 2;
  const enamel = ctx.createRadialGradient(c * 0.8, c * 0.7, c * 0.1, c, c, c);
  enamel.addColorStop(0, "#ff8a6e");
  enamel.addColorStop(0.55, "#e2382a");
  enamel.addColorStop(1, "#8f160f");
  ctx.fillStyle = enamel;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.035;
  ctx.strokeStyle = "rgba(255, 236, 214, 0.9)";
  ctx.beginPath();
  ctx.arc(c, c, c * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 245, 235, 0.16)";
  paintIcon(ctx, "damage", c, c, size * 0.86);
  number(ctx, String(count), c, c * 1.04, size * 0.56, size * 0.7);
  // A soft highlight across the top, like glaze on enamel.
  const glaze = ctx.createLinearGradient(0, 0, 0, size);
  glaze.addColorStop(0, "rgba(255,255,255,0.28)");
  glaze.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = glaze;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.98, 0, Math.PI * 2);
  ctx.fill();
}

function paintCounter(ctx: CanvasRenderingContext2D, size: number, name: string, count: number) {
  const c = size / 2;
  const style = COUNTER[name] ?? { color: "#a9bccb", icon: null, label: name.slice(0, 6) };
  const ground = ctx.createRadialGradient(c * 0.85, c * 0.75, c * 0.1, c, c, c);
  ground.addColorStop(0, "#2c3d4e");
  ground.addColorStop(1, "#0c151e");
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = style.color;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  if (style.icon) {
    ctx.fillStyle = style.color;
    paintIcon(ctx, style.icon, c, c * 0.5, size * 0.24);
  }
  number(ctx, String(count), c, c * (style.icon ? 1.08 : 0.98), size * 0.48, size * 0.6);
  ctx.fillStyle = style.color;
  ctx.font = `800 ${Math.round(size * 0.11)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(style.label.toUpperCase(), c, c * 1.62, size * 0.62);
}

function paintThreatChip(ctx: CanvasRenderingContext2D, size: number) {
  const c = size / 2;
  const enamel = ctx.createRadialGradient(c * 0.8, c * 0.7, c * 0.1, c, c, c);
  enamel.addColorStop(0, "#ffd88a");
  enamel.addColorStop(0.6, "#ffa52c");
  enamel.addColorStop(1, "#b8620c");
  ctx.fillStyle = enamel;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#4a2604";
  paintIcon(ctx, "threat", c, c * 1.02, size * 0.56);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function paintStatus(ctx: CanvasRenderingContext2D, w: number, h: number, name: string) {
  const style = STATUS[name]!;
  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, style.color);
  ground.addColorStop(1, style.deep);
  ctx.fillStyle = ground;
  roundRect(ctx, 0, 0, w, h, h * 0.22);
  ctx.fill();
  ctx.lineWidth = h * 0.05;
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  roundRect(ctx, h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14, h * 0.17);
  ctx.stroke();
  ctx.fillStyle = style.ink;
  paintIcon(ctx, style.icon, h * 0.56, h / 2, h * 0.62);
  fitText(ctx, style.label.toUpperCase(), "italic 900", h * 0.42, w - h * 1.25);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(style.label.toUpperCase(), h * 1.02, h * 0.53);
}

function paintModifier(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, count: number) {
  ctx.fillStyle = "#0d1620";
  roundRect(ctx, 0, 0, w, h, h / 2);
  ctx.fill();
  const color = STAT_COLOR[name] ?? "#6f8597";
  ctx.fillStyle = color;
  roundRect(ctx, h * 0.08, h * 0.08, w * 0.46, h * 0.84, h * 0.42);
  ctx.fill();
  const sign = `${count > 0 ? "+" : "−"}${Math.abs(count)}`;
  fitText(ctx, sign, "italic 900", h * 0.62, w * 0.4);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(sign, h * 0.08 + w * 0.23, h * 0.54);
  fitText(ctx, name, "800", h * 0.46, w * 0.42);
  ctx.fillStyle = count > 0 ? "#e9f4ff" : "#ffb3a8";
  ctx.fillText(name, w * 0.76, h * 0.54);
}

interface Face {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  paint(): void;
}

export class TokenKit {
  readonly #faces = new Map<string, Face>();
  readonly #anisotropy: number;
  readonly #damageBody = new THREE.CylinderGeometry(0.15, 0.155, 0.05, 40);
  readonly #damageFace = new THREE.CircleGeometry(0.148, 40);
  readonly #damageRim = new THREE.TorusGeometry(0.15, 0.011, 8, 40);
  readonly #counterBody = new THREE.CylinderGeometry(0.115, 0.12, 0.04, 36);
  readonly #counterFace = new THREE.CircleGeometry(0.113, 36);
  readonly #statusBody: THREE.ExtrudeGeometry;
  readonly #statusFace = new THREE.PlaneGeometry(0.4, 0.17);
  readonly #modifierBody: THREE.ExtrudeGeometry;
  readonly #modifierFace = new THREE.PlaneGeometry(0.33, 0.12);
  readonly #chipBody = new THREE.CylinderGeometry(0.12, 0.127, 0.045, 6);
  readonly #chipFace = new THREE.CircleGeometry(0.112, 6);
  readonly #materials = {
    damage: new THREE.MeshStandardMaterial({ color: 0x7c140e, metalness: 0.35, roughness: 0.42 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xf2c25a, metalness: 0.85, roughness: 0.28 }),
    counter: new THREE.MeshStandardMaterial({ color: 0x1a2733, metalness: 0.5, roughness: 0.4 }),
    pill: new THREE.MeshStandardMaterial({ color: 0x0b131b, metalness: 0.2, roughness: 0.6 }),
    chip: new THREE.MeshStandardMaterial({ color: 0xd9861c, metalness: 0.55, roughness: 0.32 }),
  };
  readonly #statusMaterials = new Map<string, THREE.MeshStandardMaterial>();

  constructor(anisotropy: number, redraw: () => void) {
    this.#anisotropy = anisotropy;
    this.#statusBody = new THREE.ExtrudeGeometry(roundedShape(0.42, 0.19, 0.04), {
      depth: 0.028,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
      curveSegments: 6,
    });
    this.#modifierBody = new THREE.ExtrudeGeometry(roundedShape(0.34, 0.13, 0.065), {
      depth: 0.02,
      bevelEnabled: false,
      curveSegments: 8,
    });
    this.#damageBody.rotateX(Math.PI / 2);
    this.#counterBody.rotateX(Math.PI / 2);
    // Line the hexagonal chip's edges up with its painted hexagon face.
    this.#chipBody.rotateX(Math.PI / 2).rotateZ(Math.PI / 6);
    // Fonts arrive after the first frame: repaint every face once they have, so numbers use Public Sans.
    void document.fonts?.ready.then(() => {
      for (const face of this.#faces.values()) {
        face.paint();
        face.texture.needsUpdate = true;
      }
      redraw();
    });
  }

  #face(key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
    let face = this.#faces.get(key);
    if (!face) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.#anisotropy;
      face = {
        canvas,
        texture,
        paint: () => {
          ctx.clearRect(0, 0, width, height);
          paint(ctx);
        },
      };
      face.paint();
      this.#faces.set(key, face);
    }
    return face.texture;
  }

  #faceMaterial(texture: THREE.Texture) {
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false });
  }

  /**
   * A token as a group whose only child is the piece itself, so a drop or a lift can move the piece without
   * disturbing where the layout put the group.
   */
  build(name: string, count: number): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    group.userData.count = count;
    const piece = new THREE.Group();
    group.add(piece);
    const shape = shapeOf(name);
    if (shape === "damage") {
      const body = new THREE.Mesh(this.#damageBody, this.#materials.damage);
      body.position.z = 0.025;
      body.castShadow = true;
      const rim = new THREE.Mesh(this.#damageRim, this.#materials.gold);
      rim.position.z = 0.05;
      const face = new THREE.Mesh(
        this.#damageFace,
        this.#faceMaterial(this.#face(`damage:${count}`, 256, 256, (ctx) => paintDamage(ctx, 256, count))),
      );
      face.position.z = 0.0515;
      piece.add(body, rim, face);
    } else if (shape === "counter") {
      const body = new THREE.Mesh(this.#counterBody, this.#materials.counter);
      body.position.z = 0.02;
      body.castShadow = true;
      const face = new THREE.Mesh(
        this.#counterFace,
        this.#faceMaterial(
          this.#face(`counter:${name}:${count}`, 256, 256, (ctx) => paintCounter(ctx, 256, name, count)),
        ),
      );
      face.position.z = 0.0415;
      piece.add(body, face);
    } else if (shape === "status") {
      let material = this.#statusMaterials.get(name);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: new THREE.Color(STATUS[name]!.deep),
          metalness: 0.2,
          roughness: 0.55,
        });
        this.#statusMaterials.set(name, material);
      }
      const body = new THREE.Mesh(this.#statusBody, material);
      body.castShadow = true;
      const face = new THREE.Mesh(
        this.#statusFace,
        this.#faceMaterial(this.#face(`status:${name}`, 400, 170, (ctx) => paintStatus(ctx, 400, 170, name))),
      );
      face.position.z = 0.036;
      piece.add(body, face);
    } else {
      const body = new THREE.Mesh(this.#modifierBody, this.#materials.pill);
      body.castShadow = true;
      const face = new THREE.Mesh(
        this.#modifierFace,
        this.#faceMaterial(
          this.#face(`modifier:${name}:${count}`, 330, 120, (ctx) => paintModifier(ctx, 330, 120, name, count)),
        ),
      );
      face.position.z = 0.0215;
      piece.add(body, face);
    }
    return group;
  }

  /** One threat chip: an amber hexagon with the threat symbol, dropped one per threat on a scheme. */
  threatChip(): THREE.Group {
    const group = new THREE.Group();
    const piece = new THREE.Group();
    group.add(piece);
    const body = new THREE.Mesh(this.#chipBody, this.#materials.chip);
    body.position.z = 0.0225;
    body.castShadow = true;
    const face = new THREE.Mesh(
      this.#chipFace,
      this.#faceMaterial(this.#face("threat-chip", 128, 128, (ctx) => paintThreatChip(ctx, 128))),
    );
    face.position.z = 0.0455;
    piece.add(body, face);
    return group;
  }

  dispose(): void {
    for (const face of this.#faces.values()) face.texture.dispose();
    for (const geometry of [
      this.#damageBody,
      this.#damageFace,
      this.#damageRim,
      this.#counterBody,
      this.#counterFace,
      this.#statusBody,
      this.#statusFace,
      this.#modifierBody,
      this.#modifierFace,
      this.#chipBody,
      this.#chipFace,
    ])
      geometry.dispose();
    for (const material of [...Object.values(this.#materials), ...this.#statusMaterials.values()]) material.dispose();
  }
}

function roundedShape(width: number, height: number, radius: number): THREE.Shape {
  const x = width / 2,
    y = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

/**
 * Where each token sits on a card, in card units. Damage takes the art's open right side; counters line up under
 * it; statuses peek out from the right edge like status cards tucked under; stat changes sit beside the printed
 * stats on the left.
 */
export function placeTokens(
  markers: readonly { name: string; count: number }[],
  landscape: boolean,
): { name: string; x: number; y: number; rotation: number; scale: number }[] {
  const placed: { name: string; x: number; y: number; rotation: number; scale: number }[] = [];
  let counters = 0;
  let statuses = 0;
  let modifiers = 0;
  for (const { name } of markers) {
    const shape = shapeOf(name);
    if (shape === "damage")
      placed.push({ name, x: landscape ? 0.36 : 0.2, y: landscape ? 0.18 : 0.2, rotation: 0, scale: 1 });
    else if (shape === "counter") {
      const i = counters++;
      placed.push(
        landscape
          ? { name, x: -0.48 + i * 0.27, y: 0.2, rotation: 0, scale: 1 }
          : { name, x: 0.24 - i * 0.26, y: -0.1, rotation: 0, scale: 1 },
      );
    } else if (shape === "status") {
      const i = statuses++;
      placed.push({
        name,
        x: landscape ? 0.58 : 0.42,
        y: (landscape ? 0.3 : 0.5) - i * 0.205,
        rotation: -0.05 + i * 0.03,
        scale: 1,
      });
    } else {
      const i = modifiers++;
      placed.push({
        name,
        x: landscape ? -0.45 : -0.22,
        y: (landscape ? -0.05 : 0.08) - i * 0.15,
        rotation: 0,
        scale: 1,
      });
    }
  }
  return placed;
}
