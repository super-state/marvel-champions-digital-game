import * as THREE from "three";
import { CARD_BACKS } from "../art/art-source.js";
import { cardRadius } from "../art/card-shape.js";
import rooftop from "../art/tabletop/rooftop.webp?url";
import { fitBoard, fitToBox, type BoardFit, type TableBox } from "./board-fit.js";
import { loadWithRetry } from "./picture-retry.js";
import { revealAside, type ScreenBox } from "./dock-spot.js";
import { TokenKit, placeTokens } from "./tokens3d.js";
import { tuckPath } from "./tuck-path.js";

export interface TableCard {
  readonly attachedTo?: string | null;
  /** A facedown boost card: the enemy it was dealt to. */
  readonly boostFor?: string | null;
  readonly id: string;
  readonly name: string;
  readonly art: string;
  readonly landscape: boolean;
  readonly exhausted: boolean;
  readonly markers?: readonly { name: string; count: number }[];
  readonly playable?: boolean;
  readonly resourceAbility?: boolean;
  readonly showAsFullCard?: boolean;
  readonly reverseArt: string | null;
  readonly threat: number | null;
  readonly type: string;
  /** Lying facedown under this card (Highway Robbery's stolen card): only its back shows, peeking out. */
  readonly under?: string;
}

export function isTuckedUpgrade(card: Pick<TableCard, "type" | "showAsFullCard">): boolean {
  return card.type === "upgrade" && !card.showAsFullCard;
}

export interface TableCards {
  readonly hand: readonly TableCard[];
  readonly hero: TableCard;
  readonly villain: TableCard;
  readonly enemyCards: readonly TableCard[];
  readonly inPlay: readonly TableCard[];
  /** In engine order, ending with the visible top card. */
  readonly discard: readonly TableCard[];
  readonly drawn: readonly string[];
  readonly targets: readonly string[];
  readonly encounterCount: number;
  readonly encounterDiscard: readonly TableCard[];
  readonly viewingEncounterDiscard: boolean;
  readonly deckCount: number;
  readonly discardOpen: boolean;
  readonly staged: TableCard | null;
  /** The staged card is an attachment waiting for its host: it hovers over the villain's side, not the hero's. */
  readonly stagedOverEnemies?: boolean;
  readonly selected: readonly string[];
  readonly defending: boolean;
  readonly menuCard: string | null;
  readonly paymentSources: readonly string[] | null;
  /** Cards are being picked from the hand (a mulligan, the hand limit): a sunk hand rises so every card shows. */
  readonly handPick?: boolean;
  /** Cards lying facedown under an enemy card, each naming it in `under`. */
  readonly under?: readonly TableCard[];
}

interface Handlers {
  onPick(id: string): void;
  onHover(id: string | null): void;
  onLanded(id: string): void;
  onDismissDiscard(): void;
  onDiscardLanded?(count: number): void;
  onDraw?(): void;
}

interface Pose {
  position: THREE.Vector3;
  pitch: number;
  roll: number;
  scale: number;
}

interface Piece {
  card: TableCard;
  root: THREE.Group;
  face: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  back: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  tokens: THREE.Group;
  markers: THREE.Group;
  rim: THREE.Mesh;
  aura: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
  target: Pose;
}

interface Flight {
  from: Pose;
  started: number;
  liftOffset: number;
  kind: "play" | "return" | "discard" | "draw" | "place" | "equip" | "flip" | "turn" | "tuck" | "stash";
  /** Set once the landing puff for this flight has been thrown. */
  puffed?: boolean;
}

interface Spark {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  born: number;
  life: number;
  size: number;
  /** A mote of vapour: it floats up and slows, instead of falling back like a spark. */
  drifts?: boolean;
}

/** A card removed from the game, dissolving where it stood (`evaporate`). */
interface Vapour {
  piece: Piece;
  start: number;
  rise: number;
  scale: number;
  dissolve: { value: number };
  /** Its own copies of materials it shared with other cards, disposed with it. */
  owned: THREE.Material[];
  motes: number;
}

const EVAPORATE_MS = 1250;
const VAPOUR_COLOR = 0xbfe4ff;
const VAPOUR_MOTES = 30;

/**
 * The card's picture breaks up from its edges inward in soft noisy patches, each patch glowing pale blue just before
 * it goes, while `dissolve` runs from 0 to 1. What is gone is cut away, not faded, so the card stays opaque.
 */
function dissolving(material: THREE.MeshBasicMaterial, dissolve: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dissolve = dissolve;
    shader.uniforms.vapourColor = { value: new THREE.Color(VAPOUR_COLOR) };
    shader.fragmentShader =
      `uniform float dissolve;
      uniform vec3 vapourColor;
      float vapourHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vapourNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(vapourHash(i), vapourHash(i + vec2(1.0, 0.0)), f.x),
          mix(vapourHash(i + vec2(0.0, 1.0)), vapourHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
` +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
          float vapourEdge = min(min(vMapUv.x, 1.0 - vMapUv.x), min(vMapUv.y, 1.0 - vMapUv.y));
          float vapourField = (vapourNoise(vMapUv * vec2(7.0, 10.0)) * 0.6 + vapourNoise(vMapUv * vec2(21.0, 29.0)) * 0.4)
            * 0.72 + smoothstep(0.0, 0.5, vapourEdge) * 0.28;
          float vapourCut = dissolve * 1.16 - 0.08;
          if (vapourField < vapourCut) discard;
          float vapourGlow = (1.0 - smoothstep(0.0, 0.08, vapourField - vapourCut)) * step(0.001, dissolve);
          diffuseColor.rgb += vapourColor * 0.22 * sin(3.14159 * min(1.0, dissolve * 1.6));
          diffuseColor.rgb = mix(diffuseColor.rgb, vapourColor * 1.35, vapourGlow);
        #endif`,
      );
  };
  material.needsUpdate = true;
}

/** How much of a sunk hand's cards shows above the bottom edge, in card widths: all but the bottom seventh. */
const SUNK_SHOWS = 1.2;
/** Room a sunk hand's raised question needs over the hand: the turn bar, its gap and a margin. */
const QUESTION_ROOM = 64 + 12 + 8;
const FLICKER_MS = 560;
/** A card just played shining as it starts its ability (Black Cat's Forced Response). */
export const SHINE_MS = 760;
/** How the hand meets the bottom of the table (`BattleTable.setHandLayout`). */
export interface HandLayout {
  /**
   * The hand sits low, partly off the bottom edge, and the turn bar floats over the table only while it has something
   * to say. Off (a phone): the hand stands above the turn bar, which spans the bottom of the table.
   */
  readonly sunk: boolean;
}
export const INTERRUPT_MS = 440;
/** A When Revealed firing: rise, flash, hold, settle. */
export const ACTIVATION_MS = 1000;
export const HIT_CONTACT_MS = 235;
export const EXHAUST_MS = 240;
export const READY_MS = 520;
/** A short freeze at the moment of contact sells the weight of a hit (the strike still ends at STRIKE_MS). */
const HIT_STOP_MS = 50;
const STRIKE_MS = 700;
/** How long a spent resource card (a Peter Parker style ability) takes to burn away. */
const SPEND_MS = 760;
const READY_TURN_START = 0.22;
const READY_TURN_END = 0.78;
const HEIGHT = 1.407;
/** The layer of cards drawn over everything else, whatever their depth (see #render). */
const FRONT_LAYER = 1;
const TAB = 0.18;
/** How far a hovered attachment slides out to the left from under its host, in card widths. */
const ATTACHMENT_FAN = 0.32;

/** A facedown boost card beside its enemy: smaller than the enemy, never bigger than a waiting encounter card. */
function boostCardWidth(hostWidth: number, w: number, h: number) {
  return Math.min(hostWidth * 0.62, h * 0.125, w * 0.105);
}

// Keep the original scan coordinates so the printed title stays on the exposed edge.
function upgradeTab() {
  const geo = new THREE.ShapeGeometry(roundedRect(TAB, HEIGHT, 0.025), 8);
  geo.translate((TAB - 1) / 2, 0, 0);
  const { position, uv } = geo.attributes;
  for (let i = 0; i < position!.count; i++) {
    const x = position!.getX(i) + 0.5;
    const y = position!.getY(i) / HEIGHT + 0.5;
    uv!.setXY(i, x, y);
  }
  return geo;
}

// Draw the halo in card space so it follows the hand fan and its rounded corners.
function resourceAura(geometry: THREE.PlaneGeometry) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { spent: { value: -1 }, map: { value: null as THREE.Texture | null } },
    vertexShader: `varying vec2 card;
      void main() {
        card = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    // Once spent, the aura also draws the card itself and burns it away from the bottom up, with an ember edge.
    fragmentShader: `varying vec2 card;
      uniform float spent;
      uniform sampler2D map;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1)), f.x), f.y);
      }
      vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
      void main() {
        vec2 edge = abs(card) - vec2(.46, .6635);
        float distanceToCard = length(max(edge, 0.)) + min(max(edge.x, edge.y), 0.) - .04;
        float halo = exp(-max(0., distanceToCard) * 44.);
        vec4 glow = vec4(1., .74, .25, .85 * halo);
        if (spent < 0.) {
          gl_FragColor = glow;
          return;
        }
        float n = .62 * noise(card * 9.) + .38 * noise(card * 27.);
        // 0 at the bottom edge, 1 at the top, roughened by the noise so the front is ragged.
        float key = .62 * (card.y / ${HEIGHT.toFixed(4)} + .5) + .38 * n;
        float front = spent * 1.22 - .08;
        float alive = smoothstep(front, front + .015, key);
        float ember = smoothstep(front + .085, front + .015, key) * alive;
        float inside = 1. - smoothstep(-.004, .004, distanceToCard);
        vec2 uv = vec2(card.x + .5, card.y / ${HEIGHT.toFixed(4)} + .5);
        vec3 face = toSRGB(texture2D(map, uv).rgb);
        // Warm the print as the heat climbs, then let the edge glow white-hot to orange.
        face = mix(face, face * vec3(1.15, .95, .75), clamp(spent * 1.4, 0., 1.));
        vec3 emberColor = mix(vec3(1., .42, .08), vec3(1., .95, .7), ember * ember);
        vec3 color = mix(face, emberColor, ember);
        float cardAlpha = inside * alive;
        float haloAlpha = glow.a * alive * (1. - spent);
        float alpha = max(cardAlpha, haloAlpha);
        gl_FragColor = vec4(mix(glow.rgb, color, cardAlpha), alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.008;
  return mesh;
}

function contactShadow() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = -3;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(10, 10, 172, 236, 9);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, HEIGHT * 1.085),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.72, depthWrite: false }),
  );
}
function sparkTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, "#fff");
  glow.addColorStop(0.25, "#ffffffcc");
  glow.addColorStop(1, "#fff0");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

const corners = [
  [-0.5, -HEIGHT / 2],
  [0.5, -HEIGHT / 2],
  [-0.5, HEIGHT / 2],
  [0.5, HEIGHT / 2],
] as const;

function roundedRect(width: number, height: number, radius: number): THREE.Shape {
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

function faceGeometry(shape: THREE.Shape, width: number, height: number): THREE.ShapeGeometry {
  const geometry = new THREE.ShapeGeometry(shape, 8);
  const { position, uv } = geometry.attributes;
  for (let i = 0; i < position!.count; i++) {
    uv!.setXY(i, position!.getX(i) / width + 0.5, position!.getY(i) / height + 0.5);
  }
  return geometry;
}

/** A single cloth print, including the stitched binding. Card scans keep their own sRGB textures. */
function matPrint(redraw: () => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 976;
  const ctx = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  function paint(art?: HTMLImageElement) {
    const { width, height } = canvas;
    ctx.fillStyle = "#1a293b";
    ctx.fillRect(0, 0, width, height);
    if (art) {
      ctx.save();
      ctx.globalAlpha = 0.67;
      const scale = Math.max(width / art.width, height / art.height);
      ctx.drawImage(
        art,
        (width - art.width * scale) / 2,
        (height - art.height * scale) / 2,
        art.width * scale,
        art.height * scale,
      );
      ctx.restore();
    }
    const wash = ctx.createLinearGradient(0, 0, 0, height);
    wash.addColorStop(0, "rgba(15, 31, 54, .09)");
    wash.addColorStop(0.58, "rgba(11, 27, 49, .24)");
    wash.addColorStop(1, "rgba(6, 16, 29, .77)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(193, 210, 215, .047)";
    ctx.beginPath();
    for (let y = 0; y < height; y += 4) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(6, 13, 23, .9)";
    ctx.beginPath();
    ctx.roundRect(11, 11, width - 22, height - 22, 17);
    ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "rgba(167, 184, 186, .5)";
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    texture.needsUpdate = true;
    redraw();
  }
  paint();
  const img = new Image();
  img.onload = () => paint(img);
  img.src = rooftop;
  return texture;
}

/** The scene presents engine state. Only the UI can decide what picking a particular card does. */
export class BattleTable {
  readonly #viewport: HTMLElement;
  readonly #handlers: Handlers;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
  readonly #renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  readonly #ray = new THREE.Raycaster();
  readonly #ndc = new THREE.Vector2();
  readonly #scratch = new THREE.Vector3();
  readonly #layoutCard = new THREE.Group();
  readonly #floor = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  readonly #tucked = new Map<string, { host: string; depth: number }>();
  /** How far each attached card has slid out from under its host while hovered (0 to 1). */
  readonly #fan = new Map<string, number>();
  /** The cards lying facedown under another card (`TableCards.under`), as laid out: kept facedown every frame. */
  readonly #underIds = new Set<string>();
  readonly #pieces = new Map<string, Piece>();
  readonly #textures = new Map<string, THREE.Texture>();
  readonly #images = new THREE.ImageLoader();
  readonly #cardShape = roundedRect(1, HEIGHT, cardRadius(1, HEIGHT));
  readonly #outline = this.#cardShape.getPoints(5);
  readonly #face = faceGeometry(this.#cardShape, 1, HEIGHT);
  readonly #stock = new THREE.ExtrudeGeometry(this.#cardShape, { depth: 0.018, bevelEnabled: false, curveSegments: 8 });
  readonly #landscapeShape = roundedRect(HEIGHT, 1, cardRadius(HEIGHT, 1));
  readonly #landscapeOutline = this.#landscapeShape.getPoints(5);
  readonly #landscapeFace = faceGeometry(this.#landscapeShape, HEIGHT, 1);
  readonly #landscapeStock = new THREE.ExtrudeGeometry(this.#landscapeShape, {
    depth: 0.018,
    bevelEnabled: false,
    curveSegments: 8,
  });
  readonly #tab = upgradeTab();
  readonly #heroShadow = contactShadow();
  readonly #villainShadow = this.#heroShadow.clone();
  readonly #actionShadow = new THREE.Mesh(
    this.#heroShadow.geometry,
    new THREE.MeshBasicMaterial({
      map: this.#heroShadow.material.map,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  readonly #stockMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b2a2, roughness: 0.87 });
  readonly #auraPlane = new THREE.PlaneGeometry(1.3, HEIGHT + 0.3);
  readonly #glow = new THREE.MeshBasicMaterial({ color: 0xffc66c });
  readonly #mat = new THREE.Group();
  readonly #villainLight = { value: 0 };
  #phaseTarget = 0;

  /** Pixels at the bottom of the table that the turn bar covers; the hand sits just above them. */
  #bottomReserve = 0;
  /** Where the mat is easing to: it moves with the cards when the fit changes. */
  #matGoal: { x: number; z: number; width: number; depth: number } | null = null;
  /** Where the pile slots are easing to. */
  readonly #slotGoals = new Map<THREE.Object3D, { position: THREE.Vector3; scale: number }>();
  /** Jump the mat and the slots to their goals on the next frame (first layout, a resize). */
  #snapBoard = true;
  /** The resting pose of a hovered table card, for its footprint once the fit has placed it. */
  #hoverRest: { center: THREE.Vector3; scale: number } | null = null;
  #hand: HandLayout = { sunk: false };
  setHandLayout(layout: HandLayout): void {
    if (this.#hand.sunk === layout.sunk) return;
    this.#hand = layout;
    this.#layout();
    this.#requestFrame();
  }
  #handTop = { resting: 0, hovered: null as number | null };
  /**
   * Viewport pixels from the top of the table to the top of the hand: `resting` allows for the lift a hovered card
   * gets, `hovered` is the top of the hovered card, if one is.
   */
  get handTop(): { readonly resting: number; readonly hovered: number | null } {
    return this.#handTop;
  }
  setBottomReserve(px: number): void {
    const reserve = Math.round(px);
    if (Math.abs(reserve - this.#bottomReserve) < 2) return;
    this.#bottomReserve = reserve;
    this.#layout();
    this.#requestFrame();
  }

  setPhase(phase: "hero" | "villain"): void {
    const target = phase === "villain" ? 1 : 0;
    if (target === this.#phaseTarget) return;
    this.#phaseTarget = target;
    this.#requestFrame();
  }

  readonly #cloth = new THREE.MeshStandardMaterial({ roughness: 0.98 });
  readonly #discardSlot = new THREE.Group();
  readonly #deckSlot = new THREE.Group();
  readonly #deckStock = new THREE.Mesh(this.#stock, this.#stockMaterial);
  readonly #deckBack = new THREE.Mesh(this.#face, new THREE.MeshBasicMaterial({ toneMapped: false }));
  readonly #encounterDiscardSlot = new THREE.Group();
  readonly #encounterSlot = new THREE.Group();
  readonly #encounterStock = new THREE.Mesh(this.#stock, this.#stockMaterial);
  readonly #encounterBack = new THREE.Mesh(this.#face, new THREE.MeshBasicMaterial({ toneMapped: false }));
  readonly #encounters = new Map<string, TableCard>();
  #revealing: string | null = null;
  /**
   * A revealed card still resolving after it was read (Assault while the attack it calls plays out): it stands
   * beside the villain, small and out of the way, until its beat sends it to the encounter discard pile.
   */
  readonly #parked = new Set<string>();
  /** Where a revealed card stands aside for its question's picks (`revealAside`), held for that question. */
  #aside: { key: string; x: number; scale: number } | null = null;
  #actor: string | null = null;
  #power: string | null = null;
  /** Damage discs, counters, status tiles, stat pills and threat chips. */
  readonly #kit = new TokenKit(Math.min(8, this.#renderer.capabilities.getMaxAnisotropy()), () => this.#requestFrame());
  readonly #liftedTokens = new Map<THREE.Group, number>();
  readonly #drops = new Map<THREE.Group, number>();
  readonly #observer: ResizeObserver;
  readonly #reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  #state: TableCards | null = null;
  #hovered: string | null = null;
  /** The card the `onHover` handler last heard about. */
  #reported: string | null = null;
  #hoverFootprint: { x: number; y: number; width: number } | null = null;
  /** The hand card shown full size under the pointer, and the top of the resting hand (viewport pixels): over the
   * hand itself, the pointer moves on to the neighbour underneath rather than staying on the big card. */
  #zoom: { id: string; handTop: number } | null = null;
  readonly #hitColor = new THREE.Color(0xff302a);
  readonly #flashColor = new THREE.Color(1.9, 1.9, 1.9);
  readonly #sparkMap = sparkTexture();
  readonly #sparks: Spark[] = [];
  #pointer: { x: number; y: number } | null = null;
  #windup: { id: string; start: number } | null = null;
  windUp(id: string): void {
    if (this.#reduced.matches) return;
    this.#windup = { id, start: performance.now() };
    this.#requestFrame();
  }

  #strike: {
    source: string;
    target: string;
    start: number;
    origin: THREE.Vector3;
    color: THREE.Color;
    burst?: boolean;
    /** The target got out of the way (Backflip): it neither recoils nor flashes red. */
    dodged?: boolean;
  } | null = null;

  /** Throw a burst of additive sparks from a point; they fly, fall and fade inside the frame loop. */
  #burst(at: THREE.Vector3, color: number, count: number, speed: number, rise: number): void {
    if (this.#reduced.matches) return;
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.#sparkMap,
          color,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      );
      sprite.renderOrder = 10;
      // Sparks fly over everything, the cards drawn on top included (see #render).
      sprite.layers.set(FRONT_LAYER);
      sprite.position.copy(at);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const v = speed * (0.55 + Math.random() * 0.7);
      const size = 0.07 + Math.random() * 0.11;
      sprite.scale.setScalar(size);
      this.#scene.add(sprite);
      this.#sparks.push({
        sprite,
        velocity: new THREE.Vector3(Math.cos(angle) * v, rise * (0.6 + Math.random() * 0.8), Math.sin(angle) * v),
        born: now,
        life: 320 + Math.random() * 260,
        size,
      });
    }
    this.#requestFrame();
  }

  /** Green motes rising off a healed card. */
  healBurst(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    const at = piece.root.position.clone();
    at.y += 0.15;
    this.#burst(at, 0x5dffa0, 16, 0.7, 2.4);
    this.#burst(at, 0xe8fff0, 6, 0.4, 1.6);
  }

  strike(source: string | null, target: string, options: { dodged?: boolean } = {}): void {
    const piece = source && this.#pieces.get(source);
    if (!source || source === target || !piece || !this.#pieces.has(target) || this.#reduced.matches) return;
    this.#strike = {
      source,
      target,
      start: performance.now(),
      origin: piece.root.position.clone(),
      color: this.#pieces.get(target)!.face.material.color.clone(),
      dodged: !!options.dodged,
    };
    this.#requestFrame();
  }

  #frame = 0;
  #lastFrame = 0;
  #paymentEdge = 0;
  get paymentEdge(): number {
    return this.#paymentEdge + this.#extension;
  }
  /** True once every card in the hand has landed: none flying in, none still easing into place. */
  get handSettled(): boolean {
    return (this.#state?.hand ?? []).every((card) => {
      const piece = this.#pieces.get(card.id);
      return !this.#flights.has(card.id) && (!piece || piece.root.position.distanceTo(piece.target.position) < 0.02);
    });
  }
  #width = 1;
  #height = 1;
  #extension = 0;
  get #canvasHeight(): number {
    return this.#height + this.#extension;
  }
  #disposed = false;
  #contextLost = false;
  readonly #flights = new Map<string, Flight>();
  #discardDeal: { ids: string[]; spent: Set<string>; started: number; landed: number; done(): void } | null = null;
  #press: { id: string; pointer: number; x: number; y: number; dragging: boolean } | null = null;

  constructor(host: HTMLElement, viewport: HTMLElement, handlers: Handlers) {
    this.#viewport = viewport;
    this.#handlers = handlers;
    const canvas = this.#renderer.domElement;
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.#scene.background = new THREE.Color(0x0b111b);
    this.#camera.position.set(0, 10.8, 8.3);
    this.#camera.lookAt(0, 0, 0);
    this.#camera.updateMatrixWorld();
    const sky = new THREE.HemisphereLight(0xf0f4ff, 0x364351, 1.9);
    sky.layers.enable(FRONT_LAYER);
    this.#scene.add(sky);
    const light = new THREE.DirectionalLight(0xfff2dd, 2.05);
    light.layers.enable(FRONT_LAYER);
    light.position.set(-4, 10, -3);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, { left: -12, right: 12, top: 9, bottom: -9, near: 0.1, far: 35 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.normalBias = 0.01;
    light.shadow.bias = -0.0003;
    this.#scene.add(light);

    const surface = roundedRect(1, 1, 0.023);
    const binding = new THREE.Mesh(
      new THREE.ExtrudeGeometry(surface, { depth: 0.1, bevelEnabled: false }),
      new THREE.MeshStandardMaterial({ color: 0x152032, roughness: 0.8 }),
    );
    binding.position.z = -0.105;
    const print = matPrint(this.#requestFrame);
    print.anisotropy = Math.min(4, this.#renderer.capabilities.getMaxAnisotropy());
    this.#cloth.map = print;
    this.#cloth.onBeforeCompile = (shader) => {
      shader.uniforms.villainLight = this.#villainLight;
      shader.fragmentShader =
        "uniform float villainLight;\n" +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
        vec2 heroDistance = (vMapUv - vec2(0.5, 0.06)) * vec2(1.55, 2.70);
        vec2 enemyDistance = (vMapUv - vec2(0.5, 0.88)) * vec2(1.55, 3.25);
        vec3 heroLight = vec3(0.001, 0.009, 0.027) * exp(-dot(heroDistance, heroDistance));
        vec3 enemyLight = vec3(0.030, 0.002, 0.002) * exp(-dot(enemyDistance, enemyDistance));
        diffuseColor.rgb += diffuse * mix(heroLight, enemyLight, villainLight);`,
        );
    };
    const cloth = new THREE.Mesh(faceGeometry(surface, 1, 1), this.#cloth);
    cloth.receiveShadow = true;
    this.#mat.rotation.x = -Math.PI / 2;
    this.#mat.add(binding, cloth);
    this.#scene.add(this.#mat);
    const slotShape = roundedRect(1.07, HEIGHT + 0.07, 0.055);
    slotShape.holes.push(roundedRect(1.042, HEIGHT + 0.042, 0.044));
    const border = new THREE.Mesh(
      new THREE.ShapeGeometry(slotShape, 8),
      new THREE.MeshBasicMaterial({ color: 0x869897, transparent: true, opacity: 0.72 }),
    );
    const well = new THREE.Mesh(
      this.#face,
      new THREE.MeshBasicMaterial({ color: 0x101a24, transparent: true, opacity: 0.45 }),
    );
    this.#discardSlot.rotation.x = -Math.PI / 2;
    this.#discardSlot.add(well, border);
    this.#scene.add(this.#discardSlot);
    this.#deckSlot.rotation.copy(this.#discardSlot.rotation);
    this.#deckBack.material.map = this.#texture(CARD_BACKS.player.url);
    this.#deckSlot.add(well.clone(), border.clone(), this.#deckStock, this.#deckBack);
    this.#scene.add(this.#deckSlot);
    this.#encounterSlot.rotation.copy(this.#deckSlot.rotation);
    this.#encounterBack.material.map = this.#texture(CARD_BACKS.encounter.url);
    this.#encounterSlot.add(well.clone(), border.clone(), this.#encounterStock, this.#encounterBack);

    this.#encounterDiscardSlot.rotation.copy(this.#deckSlot.rotation);
    this.#encounterDiscardSlot.add(well.clone(), border.clone());
    this.#scene.add(this.#encounterSlot, this.#encounterDiscardSlot);
    this.#observer = new ResizeObserver(this.#resize);
    this.#observer.observe(viewport);
    this.#resize();
    canvas.addEventListener("pointermove", this.#move);
    canvas.addEventListener("pointerdown", this.#down);
    canvas.addEventListener("pointerup", this.#up);
    canvas.addEventListener("pointercancel", this.#abort);
    canvas.addEventListener("pointerleave", this.#leave);
    canvas.addEventListener("webglcontextlost", this.#loseContext);
    canvas.addEventListener("webglcontextrestored", this.#restoreContext);
  }

  #dropPiece(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    this.#scene.remove(piece.root);
    for (const token of piece.tokens.children) this.#drops.delete(token as THREE.Group);
    if (piece.card.reverseArt || piece.card.type === "villain") piece.back.material.dispose();
    piece.aura?.material.dispose();
    piece.face.material.dispose();
    this.#pieces.delete(id);
    this.#flights.delete(id);
  }

  setCards(state: TableCards): void {
    const previous = this.#state?.staged?.id;
    if (this.#state?.discardOpen !== state.discardOpen) this.#hovered = null;
    const previousHand = this.#state?.hand;
    const newDraw = this.#state?.drawn !== state.drawn;
    if (this.#power !== state.staged?.id) {
      this.#power = null;
      this.#powerHost = null;
      this.#powerWaiting = false;
      this.#actionShadow.removeFromParent();
    }
    if (state.menuCard || this.#state?.menuCard) this.#hovered = state.menuCard;
    this.#state = state;
    const cards = [
      state.hero,
      state.villain,
      ...state.enemyCards,
      ...state.inPlay,
      ...state.hand,
      ...state.discard,
      ...state.encounterDiscard,
      ...(state.under ?? []),
    ];
    for (const card of this.#encounters.values()) if (!cards.some((c) => c.id === card.id)) cards.push(card);
    for (const card of this.#deckReveal) if (!cards.some((c) => c.id === card.id)) cards.push(card);
    for (const { card } of this.#stashing.values()) if (!cards.some((c) => c.id === card.id)) cards.push(card);
    if (state.staged) cards.push(state.staged);
    const live = new Set(cards.map((card) => card.id));
    for (const id of [...this.#pieces.keys()]) if (!live.has(id)) this.#dropPiece(id);
    const fresh = new Set<string>();
    const turnStart = performance.now();
    let readyIndex = 0;
    for (const card of cards) {
      let piece = this.#pieces.get(card.id);
      if (!piece) {
        const root = new THREE.Group();
        root.name = card.name;
        const surface = card.landscape ? this.#landscapeFace : this.#face;
        const stock = new THREE.Mesh(card.landscape ? this.#landscapeStock : this.#stock, this.#stockMaterial);
        stock.castShadow = true;
        const face = new THREE.Mesh(surface, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        face.position.z = 0.019;
        const rim = new THREE.Mesh(surface, this.#glow);
        rim.scale.set(1.042, 1.03, 1);
        rim.position.z = 0.009;
        const back = new THREE.Mesh(
          this.#face,
          card.reverseArt || card.type === "villain"
            ? new THREE.MeshBasicMaterial({
                map: this.#texture(card.reverseArt ?? CARD_BACKS.encounter.url),
                toneMapped: false,
              })
            : this.#encounters.has(card.id)
              ? this.#encounterBack.material
              : this.#deckBack.material,
        );
        if (card.landscape) back.rotation.z = Math.PI / 2;
        back.rotation.y = Math.PI;
        back.position.z = -0.001;
        const tokens = new THREE.Group();
        const markers = new THREE.Group();
        root.add(stock, rim, face, back, tokens, markers);
        const aura = card.resourceAbility ? resourceAura(this.#auraPlane) : undefined;
        if (aura) root.add(aura);
        if (card.id === state.hero.id) {
          this.#heroShadow.position.z = -0.003;
          root.add(this.#heroShadow);
        }
        if (card.id === state.villain.id) {
          this.#villainShadow.position.z = -0.003;
          root.add(this.#villainShadow);
        }
        this.#scene.add(root);
        piece = {
          card,
          root,
          face,
          back,
          tokens,
          markers,
          rim,
          aura,
          target: { position: new THREE.Vector3(), pitch: 0, roll: 0, scale: 1 },
        };
        this.#pieces.set(card.id, piece);
        fresh.add(card.id);
      }
      if (!fresh.has(card.id) && card.reverseArt && card.art !== piece.card.art) {
        piece.back.material.map = this.#texture(card.art);
        this.#startFlight(card.id, "flip");
      } else if (fresh.has(card.id) || card.art !== piece.card.art) {
        piece.face.material.map = this.#texture(card.art);
        piece.face.material.needsUpdate = true;
      }
      if (
        !fresh.has(card.id) &&
        piece.card.exhausted !== card.exhausted &&
        this.#flights.get(card.id)?.kind !== "flip"
      ) {
        // Give simultaneously readying cards separate heights if their corners cross in the air.
        const liftOffset = card.exhausted ? 0 : readyIndex++ * 0.07;
        this.#startFlight(card.id, "turn", turnStart, liftOffset);
      }
      piece.card = card;
      const tucked =
        (!!card.attachedTo && state.enemyCards.some((c) => c.id === card.id)) ||
        (isTuckedUpgrade(card) && state.inPlay.some((item) => item.id === card.id));
      const onBoard =
        card.id === state.hero.id ||
        card.id === state.villain.id ||
        state.inPlay.some((item) => item.id === card.id) ||
        state.enemyCards.some((item) => item.id === card.id);
      this.#setMarkers(piece, onBoard ? (card.markers ?? []) : [], tucked);
      if (card.threat !== null) this.setThreat(card.id, card.threat);
      piece.rim.visible =
        state.selected.includes(card.id) || state.targets.includes(card.id) || this.#deckPicks.has(card.id);
    }
    this.#lightCards(state);
    if (previous !== state.staged?.id) {
      const permanent = state.inPlay.find((card) => card.id === previous);
      if (previous) this.#flights.delete(previous);
      if (state.staged) {
        this.#startFlight(state.staged.id, "play");
      } else if (previous && state.hand.some((card) => card.id === previous)) {
        this.#startFlight(previous, "return");
      } else if (previous && state.enemyCards.some((card) => card.id === previous && !!card.attachedTo)) {
        this.#startFlight(previous, "equip");
      } else if (permanent) {
        this.#startFlight(permanent.id, isTuckedUpgrade(permanent) ? "equip" : "place");
      } else if (previous && state.discard.some((card) => card.id === previous)) {
        this.#startFlight(previous, "discard");
      }
    }
    for (const card of [...state.enemyCards, ...state.inPlay]) {
      if (!card.attachedTo || !previousHand?.some((held) => held.id === card.id)) continue;
      const tucked = isTuckedUpgrade(card) || state.enemyCards.some((enemy) => enemy.id === card.id);
      this.#startFlight(card.id, tucked ? "equip" : "place");
    }
    this.#layout();
    for (const id of fresh) {
      this.#apply(this.#pieces.get(id)!, 1);
      if (this.#underIds.has(id)) this.#pieces.get(id)!.root.rotation.y = Math.PI;
    }
    if (newDraw) {
      const start = performance.now();
      state.drawn
        .filter((id) => state.hand.some((card) => card.id === id) && !previousHand?.some((card) => card.id === id))
        .forEach((id, index) => {
          const root = this.#pieces.get(id)!.root;
          root.position.copy(this.#deckSlot.position);
          root.position.y += this.#deckBack.position.z * this.#deckSlot.scale.x + 0.03;
          root.scale.copy(this.#deckSlot.scale);
          root.rotation.set(-Math.PI / 2, Math.PI, 0);
          this.#startFlight(id, "draw", start + 120 + index * 180);
        });
    }
    this.#requestFrame();
  }

  showDraw(hand: readonly TableCard[], drawn: string[], deckCount: number, discard?: readonly TableCard[]): void {
    if (this.#state)
      this.setCards({ ...this.#state, hand, drawn, deckCount, discard: discard ?? this.#state.discard, selected: [] });
  }

  #startFlight(id: string, kind: Flight["kind"], started = performance.now(), liftOffset = 0): void {
    const { position, rotation, scale } = this.#pieces.get(id)!.root;
    if (kind !== "draw") rotation.y = 0;
    this.#flights.set(id, {
      kind,
      started,
      liftOffset,
      from: { position: position.clone(), scale: scale.x, pitch: rotation.x, roll: rotation.z },
    });
  }

  #viewedPile(state: TableCards) {
    return state.viewingEncounterDiscard ? state.encounterDiscard : state.discard;
  }

  /** Paying: true for a card that isn't paying, so it and its tokens sit back in the dim with the table. */
  #dimFor(id: string): boolean {
    return !!this.#state?.paymentSources && !this.#state.paymentSources.includes(id);
  }

  readonly #dimMaterials = new Map<THREE.Material, THREE.Material>();
  /** Swap a card's tokens to darkened copies of their materials (shared with every other token), or back. */
  #shadeTokens(piece: Piece, dim: boolean): void {
    for (const group of [piece.tokens, piece.markers])
      group.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const lit: THREE.Material = mesh.userData.lit ?? mesh.material;
        if (!dim) {
          mesh.material = lit;
          delete mesh.userData.lit;
          return;
        }
        let dark = this.#dimMaterials.get(lit);
        if (!dark) {
          dark = lit.clone();
          (dark as THREE.MeshBasicMaterial).color?.multiplyScalar(0.36);
          this.#dimMaterials.set(lit, dark);
        }
        mesh.userData.lit = lit;
        mesh.material = dark;
      });
  }

  #lightCards(state: TableCards): void {
    this.#cloth.color.setHex(state.paymentSources ? 0x3d444e : 0xffffff);
    this.#deckBack.material.color.setHex(state.paymentSources ? 0x51545b : 0xffffff);
    this.#encounterBack.material.color.setHex(state.paymentSources ? 0x51545b : 0xffffff);
    this.#stockMaterial.color.setHex(state.paymentSources ? 0x3f3e39 : 0xb7b2a2);
    for (const [id, piece] of this.#pieces) {
      const color =
        state.paymentSources && !state.paymentSources.includes(id)
          ? id === state.staged?.id
            ? 0xa5a5a5
            : 0x51545b
          : state.discardOpen && !this.#viewedPile(state).some((card) => card.id === id)
            ? 0x848993
            : 0xffffff;
      piece.face.material.color.setHex(color);
      this.#shadeTokens(piece, !!state.paymentSources && !state.paymentSources.includes(id));
    }
  }

  animateDiscards(cards: readonly string[], done: () => void): void {
    const visible = cards.filter((id) => this.#pieces.has(id));
    const spent = new Set(this.#state?.selected.filter((id) => this.#pieces.get(id)?.aura));
    if ((!visible.length && !spent.size) || this.#contextLost || this.#disposed) {
      done();
      return;
    }
    if (this.#state) {
      this.#state = { ...this.#state, paymentSources: null };
      this.#lightCards(this.#state);
    }
    const started = performance.now();
    this.#discardDeal = { ids: visible, spent, started, landed: 0, done };
    visible.forEach((id, index) => {
      const piece = this.#pieces.get(id)!;
      piece.rim.visible = false;
      this.#startFlight(id, "discard", started + index * 155);
    });
    this.#layout();
    this.#requestFrame();
  }

  /**
   * A payment ended without the screen being redrawn (it was called off and the game played on): the table stops
   * dimming everything but the resources, and the hand and staged card are set to what they are now.
   */
  endPayment(hand: readonly TableCard[], staged: TableCard | null): void {
    const s = this.#state;
    if (!s?.paymentSources) return;
    this.setCards({ ...s, paymentSources: null, selected: [], hand, staged });
  }

  /** Paid: the table stops dimming for the payment (a payment with no hand cards to fly off never got there). */
  clearPaymentDim(): void {
    const s = this.#state;
    if (s?.paymentSources) this.setCards({ ...s, paymentSources: null, selected: [] });
  }

  stageEvent(card: TableCard): void {
    const s = this.#state;
    if (!s || s.staged?.id === card.id) return;
    this.setCards({
      ...s,
      staged: card,
      hand: s.hand.filter((c) => c.id !== card.id),
      discard: s.discard.filter((c) => c.id !== card.id),
      selected: [],
      paymentSources: null,
    });
  }

  discardEvent(card: TableCard): void {
    const s = this.#state;
    if (!s) return;
    this.setCards({
      ...s,
      staged: null,
      hand: s.hand.filter((c) => c.id !== card.id),
      discard: [...s.discard.filter((c) => c.id !== card.id), card],
    });
  }

  setModifier(card: TableCard, name: string, count: number): void {
    const s = this.#state;
    if (!s) return;
    // A newly played ally must land before its continuous bonuses can land on it.
    if (s.staged?.id === card.id && card.type === "ally")
      this.setCards({
        ...s,
        staged: null,
        inPlay: [...s.inPlay.filter((c) => c.id !== card.id), { ...card, markers: [] }],
      });
    const piece = this.#pieces.get(card.id);
    if (!piece) return;
    const markers = (piece.card.markers ?? []).filter((m) => m.name !== name);
    if (count) markers.push({ name, count });
    this.#updateMarkers(piece, markers);
  }

  #updateMarkers(piece: Piece, markers: NonNullable<TableCard["markers"]>): void {
    const s = this.#state;
    if (!s) return;
    const updated = { ...piece.card, markers };
    const replace = (c: TableCard) => (c.id === updated.id ? updated : c);
    piece.card = updated;
    this.#state = {
      ...s,
      hero: replace(s.hero),
      villain: replace(s.villain),
      inPlay: s.inPlay.map(replace),
      enemyCards: s.enemyCards.map(replace),
      staged: s.staged && replace(s.staged),
    };
    this.#setMarkers(
      piece,
      markers,
      (!!updated.attachedTo && s.enemyCards.some((card) => card.id === updated.id)) ||
        (isTuckedUpgrade(updated) && s.inPlay.some((card) => card.id === updated.id)),
    );
    this.#requestFrame();
  }

  // In card space the sheen and the point of impact follow the card throughout the effect.
  readonly #sheenMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { sweep: { value: 0 } },
    vertexShader: `varying vec2 faceUv;
      void main(){ faceUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float sweep; varying vec2 faceUv;
      void main(){ float band = (faceUv.x + 0.48 * faceUv.y - sweep) / 0.11;
        gl_FragColor=vec4(0.78,0.94,1.0,0.64*exp(-band*band)); }`,
  });
  readonly #sheen = new THREE.Mesh(this.#face, this.#sheenMaterial);
  readonly #interruptSheen = new THREE.Mesh(this.#face, this.#sheenMaterial.clone());
  readonly #interruptPuff = new THREE.Mesh(
    new THREE.PlaneGeometry(2.75, 2.75),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { progress: { value: 0 } },
      vertexShader: `varying vec2 puffUv;
        void main(){ puffUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float progress; varying vec2 puffUv;
        void main() {
          vec2 pos = (puffUv - 0.5) * 2.75;
          float travel = 1.0 - pow(1.0-progress, 2.6);
          float cloud = 0.0;
          for (int i=0; i<13; i++) {
            float seed = float(i);
            float angle = seed * 0.48332 + 0.065 * sin(seed * 7.1);
            vec2 dir = vec2(cos(angle), sin(angle));
            float edge = min(0.48/max(abs(dir.x),0.01), 0.66/max(abs(dir.y),0.01));
            vec2 center = dir * (edge + travel * (0.28 + 0.1*sin(seed*3.4)));
            float radius = (0.09 + 0.095*travel) * (1.0 + 0.22*cos(seed*2.9));
            float body = 1.0-smoothstep(0.38,1.0,length(pos-center)/radius);
            vec2 curl = center + vec2(-dir.y,dir.x) * radius * 0.67;
            body = max(body,1.0-smoothstep(0.25,1.0,length(pos-curl)/(radius*0.72)));
            cloud = max(cloud,body);
          }
          float fade = smoothstep(0.0,0.09,progress)*(1.0-smoothstep(0.2,1.0,progress));
          gl_FragColor = vec4(mix(vec3(0.55,0.70,0.79),vec3(0.93,0.97,1.0),cloud),cloud*fade*0.72);
        }`,
    }),
  );
  #interrupt: {
    piece: Piece;
    start: number;
    lift: number;
    activation?: { flashed: boolean };
    /** A card just played (`shinePlayed`): no rise and no smoke, a stretch it is put back from each frame. */
    shine?: { flashed: boolean; stretch: number };
  } | null = null;
  #wave: { start: number; lifts: Map<Piece, number> } | null = null;

  /** A ripple through the hand, each card hopping in turn: a question about the hand points at it. */
  waveHand(): void {
    if (this.#reduced.matches || !this.#state?.hand.length) return;
    this.#wave ??= { start: 0, lifts: new Map() };
    this.#wave.start = performance.now();
    this.#requestFrame();
  }

  pulseInterrupt(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    if (this.#interrupt) this.#interrupt.piece.root.position.y -= this.#interrupt.lift;
    this.#interruptSheen.geometry = piece.face.geometry;
    this.#interruptSheen.position.z = 0.028;
    piece.root.add(this.#interruptSheen);
    // Smoke rises off a card lying on the table. A card held up in the air (a revealed encounter card being read or
    // standing aside, a card being played or still in hand) only shines and grows a little (Adam, 2026-11-22).
    if (!this.#reduced.matches && !this.#heldUp(id)) {
      this.#interruptPuff.position.z = 0.035;
      this.#interruptPuff.material.uniforms.progress!.value = 0;
      piece.root.add(this.#interruptPuff);
    } else {
      this.#interruptPuff.removeFromParent();
    }
    this.#interrupt = { piece, start: performance.now(), lift: 0 };
    this.#requestFrame();
  }

  /** The card is held up in the air rather than lying on the table. */
  #heldUp(id: string): boolean {
    const s = this.#state;
    return (
      id === this.#revealing || this.#parked.has(id) || s?.staged?.id === id || !!s?.hand.some((card) => card.id === id)
    );
  }

  /** A card whose effect was cancelled (Enhanced Spider-Sense) flickers out and back, like a signal cut. */
  #flicker: { piece: Piece; start: number } | null = null;
  flickerCancelled(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece || this.#reduced.matches) return;
    if (this.#flicker) this.#flicker.piece.root.visible = true;
    this.#flicker = { piece, start: performance.now() };
    this.#requestFrame();
  }

  /**
   * A When Revealed firing: the card rises toward the player, flashes white with a burst of light, and settles back,
   * so its effect reads as the card's own and not an ordinary attack.
   */
  activateWhenRevealed(id: string): void {
    this.pulseInterrupt(id);
    if (this.#interrupt?.piece === this.#pieces.get(id)) this.#interrupt!.activation = { flashed: false };
  }

  /**
   * A card just played that starts an ability as it lands (Black Cat's Forced Response): a light sweeps across it as it
   * stretches a touch and settles, with a small glint. Not the smoke and rise of an ability on a card already in play.
   */
  shinePlayed(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    this.pulseInterrupt(id);
    if (this.#interrupt?.piece !== piece) return;
    this.#interruptPuff.removeFromParent();
    this.#interrupt.shine = { flashed: false, stretch: 1 };
  }

  /**
   * The staged card `id` goes down in its place on the table now, before the move ends, so an ability it starts on
   * entering play fires once it is down. False when it isn't a card that stands on the hero's side.
   */
  landStaged(id: string): boolean {
    const s = this.#state;
    const card = s?.staged;
    if (!s || card?.id !== id || s.stagedOverEnemies || !["ally", "support", "upgrade"].includes(card.type))
      return false;
    this.setCards({ ...s, staged: null, inPlay: [...s.inPlay.filter((c) => c.id !== id), card] });
    return true;
  }

  #deflection: { token: THREE.Group; start: number } | null = null;

  /** How high above its face a card's tokens reach, in the card's own units (0 with none). */
  #tokenTop(piece: Piece): number {
    let top = 0;
    for (const token of [...piece.markers.children, ...piece.tokens.children])
      top = Math.max(top, token.position.z + 0.085 * token.scale.z);
    return top;
  }

  deflectDamage(id: string, amount: number): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    this.#deflection?.token.removeFromParent();
    const token = this.#kit.build("damage", amount);
    piece.root.add(token, this.#sheen);
    this.#sheen.position.z = 0.025;
    this.#deflection = { token, start: performance.now() };
    this.#requestFrame();
  }

  /** The card a played event goes to when it is not the hero: the scheme Great Responsibility shields, say. */
  #powerHost: string | null = null;

  /**
   * An event that still needs its target picked (First Aid) waits beside the row like a card being paid for, clear of
   * every card, until `channelEvent` or `channelEventTo` sends it onto the one picked.
   */
  #powerWaiting = false;
  get #powerAside(): boolean {
    return !!this.#power && this.#powerWaiting;
  }

  /** A played event waits for its target to be picked, on the mat clear of every card, nothing under it. */
  holdEvent(id: string): void {
    if (!this.#pieces.has(id)) return;
    this.#power = id;
    this.#powerHost = null;
    this.#powerWaiting = true;
    this.#actionShadow.removeFromParent();
    this.#layout();
    this.#requestFrame();
  }

  /** A played event goes over to the card it acts on (a scheme it shields) instead of onto the hero. */
  channelEventTo(id: string, host: string): void {
    if (!this.#pieces.has(id) || !this.#pieces.has(host) || host === this.#state?.hero.id) return this.channelEvent(id);
    this.#power = id;
    this.#powerHost = host;
    this.#powerWaiting = false;
    this.#actionShadow.removeFromParent();
    this.#layout();
    this.#startFlight(id, "place");
    this.#requestFrame();
  }

  channelEvent(id: string): void {
    if (!this.#pieces.has(id)) return;
    this.#power = id;
    this.#powerHost = null;
    this.#powerWaiting = false;
    const hero = this.#state && this.#pieces.get(this.#state.hero.id);
    if (hero) {
      // Project the shadow onto the receiving face, with a small offset beyond the action card's edge.
      this.#actionShadow.position.set(-0.04, -0.06, 0.023);
      this.#actionShadow.scale.setScalar(1);
      this.#actionShadow.rotation.z = 0.035;
      hero.root.add(this.#actionShadow);
    }
    this.#layout();
    this.#startFlight(id, "place");
    this.#requestFrame();
  }

  dealEncounter(id: string, boostFor: string | null = null): void {
    if (!this.#state || this.#encounters.has(id)) return;
    this.#encounters.set(id, {
      id,
      boostFor,
      name: boostFor ? "Boost card" : "Encounter card",
      art: CARD_BACKS.encounter.url,
      type: "facedown",
      landscape: false,
      exhausted: false,
      reverseArt: null,
      threat: null,
    });
    this.setCards(this.#state);
    const root = this.#pieces.get(id)!.root;
    root.position.copy(this.#encounterSlot.position);
    root.position.y += 0.15;
    root.scale.copy(this.#encounterSlot.scale);
    root.rotation.copy(this.#encounterSlot.rotation);
    this.#startFlight(id, boostFor ? "tuck" : "place");
  }

  #question = false;
  /**
   * A question is up in the turn bar just above the hand: the table eases up to make room for it, and a hovered hand
   * card lifts a small step instead of growing, so it never comes up over the buttons.
   */
  setQuestion(up: boolean): void {
    if (this.#question === up) return;
    this.#question = up;
    this.#layout();
    this.#requestFrame();
  }

  #revealHeld = false;
  /** The revealed card waits to be read before Continue: it stands full size in the middle of the table. */
  /** Cards turned up off the top of the player's deck (Black Cat's discard), standing in a row in the middle. */
  #deckReveal: TableCard[] = [];
  /** Of those, the ones the effect keeps for the hand: they rise and glow. */
  readonly #deckPicks = new Set<string>();

  /** Turn `cards` up off the top of the deck, one after another, into a row in the middle of the table. */
  revealFromDeck(cards: readonly TableCard[]): void {
    if (!this.#state || !cards.length) return;
    this.#deckReveal = [...cards];
    this.#deckPicks.clear();
    this.setCards(this.#state);
    const start = performance.now();
    cards.forEach((card, index) => {
      const root = this.#pieces.get(card.id)?.root;
      if (!root) return;
      root.position.copy(this.#deckSlot.position);
      root.position.y += this.#deckBack.position.z * this.#deckSlot.scale.x + 0.03;
      root.scale.copy(this.#deckSlot.scale);
      root.rotation.set(-Math.PI / 2, Math.PI, 0);
      this.#startFlight(card.id, "draw", start + index * 180);
    });
  }

  /** The revealed cards the effect keeps rise out of the row and glow. */
  pickFromReveal(ids: readonly string[]): void {
    for (const id of ids) if (this.#deckReveal.some((card) => card.id === id)) this.#deckPicks.add(id);
    if (this.#state) this.setCards(this.#state);
  }

  /** Revealed cards the effect doesn't keep go to the discard pile, the last one on top (the pile's last entry). */
  discardFromReveal(ids: readonly string[]): void {
    const s = this.#state;
    const going = this.#deckReveal.filter((card) => ids.includes(card.id));
    if (!s || !going.length) return;
    this.#deckReveal = this.#deckReveal.filter((card) => !ids.includes(card.id));
    for (const id of ids) this.#deckPicks.delete(id);
    const left = s.discard.filter((card) => !ids.includes(card.id));
    this.setCards({ ...s, discard: [...left, ...going] });
    for (const card of going) this.#startFlight(card.id, "discard");
  }

  /**
   * Cards put back in the hand from where they lie (a revealed card Black Cat keeps, a card returned from the discard
   * pile) fly there from that spot, not out of the deck like a draw.
   */
  returnToHand(hand: readonly TableCard[], ids: readonly string[], from?: string): void {
    const s = this.#state;
    if (!s) return;
    const lying = new Set(ids.filter((id) => this.#pieces.has(id)));
    const fromUnder = new Set(ids.filter((id) => this.#underIds.has(id)));
    this.#deckReveal = this.#deckReveal.filter((card) => !ids.includes(card.id));
    for (const id of ids) this.#deckPicks.delete(id);
    this.setCards({
      ...s,
      hand,
      discard: s.discard.filter((card) => !ids.includes(card.id)),
      under: (s.under ?? []).filter((card) => !ids.includes(card.id)),
      selected: [],
    });
    // Cards that lay facedown under a card (Highway Robbery's) slide out from under it and turn up on the way.
    const host = from ? this.#pieces.get(from) : undefined;
    const start = performance.now();
    ids.forEach((id, index) => {
      // A card lying facedown under another slides out from there and turns up as it flies, like a draw.
      if (fromUnder.has(id)) return this.#startFlight(id, "draw", start + index * 160);
      if (lying.has(id)) return this.#startFlight(id, "return");
      const root = this.#pieces.get(id)?.root;
      if (!root || !host) return;
      root.position.copy(host.root.position);
      root.position.y -= 0.01;
      root.scale.setScalar(host.root.scale.x * 0.92);
      root.rotation.set(host.root.rotation.x, Math.PI, 0);
      this.#startFlight(id, "draw", start + index * 160);
    });
    if (host) this.#addUnder(from!, -ids.length);
  }

  /**
   * A new game: every card from the last one leaves the table, including any still standing aside (an Advance that lost
   * the game while the villain schemed), standing revealed off a deck, or on its way somewhere. Card ids repeat from
   * game to game, so nothing is kept to be reused: the next `setCards` deals the table afresh.
   */
  newGame(): void {
    this.#deckReveal = [];
    this.#deckPicks.clear();
    this.#stashing.clear();
    this.#encounters.clear();
    this.#parked.clear();
    this.#tucked.clear();
    this.#underIds.clear();
    this.#revealing = this.#aside = this.#actor = this.#power = this.#powerHost = null;
    this.#powerWaiting = this.#revealHeld = false;
    this.#actionShadow.removeFromParent();
    this.#hovered = this.#zoom = this.#press = this.#discardDeal = null;
    this.#windup = this.#strike = this.#interrupt = this.#wave = this.#flicker = this.#deflection = null;
    for (const id of [...this.#pieces.keys()]) this.#dropPiece(id);
    for (const vapour of this.#vapours.splice(0)) this.#releaseVapour(vapour);
    this.#liftedTokens.clear();
    this.#drops.clear();
    this.#state = null;
    this.#requestFrame();
  }

  /** Cards on their way facedown into a deck or under a card: they fly there, turning over, and are then gone. */
  readonly #stashing = new Map<string, { card: TableCard; to: "deck" | "encounterDeck" | { under: string } }>();

  /** Set-aside cards shown in the middle a moment (Shadow of the Past's nemesis set) before they go somewhere. */
  showInRow(cards: readonly TableCard[]): void {
    if (!this.#state || !cards.length) return;
    this.#deckReveal = [...cards];
    this.#deckPicks.clear();
    this.setCards(this.#state);
    const start = performance.now();
    cards.forEach((card, index) => {
      const root = this.#pieces.get(card.id)?.root;
      if (!root) return;
      root.scale.multiplyScalar(0.2);
      this.#startFlight(card.id, "place", start + index * 120);
    });
  }

  #stash(cards: readonly TableCard[], to: "deck" | "encounterDeck" | { under: string }, next: TableCards): void {
    const ids = new Set(cards.map((card) => card.id));
    for (const card of cards) this.#stashing.set(card.id, { card, to });
    this.#deckReveal = this.#deckReveal.filter((card) => !ids.has(card.id));
    for (const id of ids) this.#deckPicks.delete(id);
    this.setCards(next);
    const start = performance.now();
    const step = Math.min(60, 700 / Math.max(1, cards.length));
    cards.forEach((card, index) => {
      const piece = this.#pieces.get(card.id);
      if (!piece) return;
      // A card with its own printed back (a villain, a double-sided card) keeps it: that material is its own.
      if (!piece.card.reverseArt && piece.card.type !== "villain")
        piece.back.material = to === "encounterDeck" ? this.#encounterBack.material : this.#deckBack.material;
      this.#startFlight(card.id, "stash", start + index * step);
    });
  }

  /** A pile shuffled back into its deck (a deck that ran out): every card flies in facedown. */
  shuffleIntoDeck(pile: "discard" | "encounterDiscard"): void {
    const s = this.#state;
    if (!s) return;
    const cards = [...s[pile]].reverse();
    this.#stash(cards, pile === "discard" ? "deck" : "encounterDeck", { ...s, [pile]: [] });
  }

  /** The cards standing in the middle go facedown into the encounter deck (Shadow of the Past). */
  rowIntoEncounterDeck(): void {
    const s = this.#state;
    if (!s) return;
    this.#stash([...this.#deckReveal], "encounterDeck", s);
  }

  /** Cards from the hand go facedown under `host` (Highway Robbery's When Revealed). */
  tuckUnder(ids: readonly string[], host: string, hand: readonly TableCard[]): void {
    const s = this.#state;
    if (!s) return;
    const cards = s.hand.filter((card) => ids.includes(card.id));
    this.#stash(cards, { under: host }, { ...s, hand, selected: [] });
  }

  /** The stashed cards are in place: they go, a deck shows its new count, and a card shows what lies under it. */
  settleStash(counts: { deckCount?: number; encounterCount?: number } = {}): void {
    const s = this.#state;
    if (!s) return;
    // A card that went under another stays there, its back peeking out, until an effect takes it back.
    const under = [...(s.under ?? [])];
    for (const { card, to } of this.#stashing.values())
      if (typeof to === "object" && !under.some((other) => other.id === card.id))
        under.push({ ...card, under: to.under });
    this.#stashing.clear();
    this.setCards({ ...s, ...counts, under });
  }

  /** True while `id` is still on its way somewhere (landing in its place after being read). */
  flying(id: string): boolean {
    return this.#flights.has(id);
  }

  /**
   * Hand cards an effect is picking from light up (`ids`), the hand raised so every card shows; none to put it back.
   * The random pick (Highway Robbery, Eviction Notice) hops this light across the hand before it stops.
   */
  spotlightHand(ids: readonly string[]): void {
    const s = this.#state;
    if (!s) return;
    this.setCards({ ...s, selected: [...ids], handPick: ids.length > 0 });
  }

  /** How many facedown cards lie under `host` now (Highway Robbery's stolen cards). */
  setUnder(host: string, count: number): void {
    const piece = this.#pieces.get(host);
    const current = piece?.card.markers?.find((m) => m.name === "tucked")?.count ?? 0;
    if (piece) this.#addUnder(host, count - current);
  }

  /** The count of facedown cards lying under `host`, up or down by `delta`. */
  #addUnder(host: string, delta: number): void {
    const piece = this.#pieces.get(host);
    if (!piece) return;
    const markers = (piece.card.markers ?? []).filter((m) => m.name !== "tucked");
    const count = Math.max(0, (piece.card.markers?.find((m) => m.name === "tucked")?.count ?? 0) + delta);
    if (count) markers.push({ name: "tucked", count });
    this.#updateMarkers(piece, markers);
  }

  holdReveal(held: boolean): void {
    if (this.#revealHeld === held) return;
    this.#revealHeld = held;
    this.#layout();
    this.#requestFrame();
  }

  revealEncounter(card: { id: string; name: string; art: string; landscape: boolean }): void {
    if (!this.#state) return;
    if (!this.#encounters.has(card.id)) this.dealEncounter(card.id);
    this.#revealing = card.id;
    this.#encounters.set(card.id, { ...this.#encounters.get(card.id)!, ...card, type: "revealed" });
    this.setCards(this.#state);
    const piece = this.#pieces.get(card.id)!;
    if (card.landscape) {
      piece.face.geometry = this.#landscapeFace;
      piece.rim.geometry = this.#landscapeFace;
      const stock = piece.root.children[0] as THREE.Mesh;
      stock.geometry = this.#landscapeStock;
      piece.back.rotation.z = Math.PI / 2;
    }
    piece.root.rotation.y = Math.PI;
    this.#startFlight(card.id, "draw");
    this.markActor(card.id);
  }

  showVillain(card: TableCard, flip: boolean): void {
    if (this.#state) {
      this.setCards({ ...this.#state, villain: flip ? { ...card, reverseArt: this.#state.villain.art } : card });
    }
  }

  /**
   * The revealed card `id` steps aside while its effect plays out: it goes from the middle of the table to stand beside
   * the villain, still face up, so the attack or question it causes is seen and the card is still there to see after.
   */
  parkEncounter(id: string): void {
    if (!this.#state || !this.#encounters.has(id)) return;
    if (this.#revealing === id) this.#revealing = null;
    this.#parked.add(id);
    this.markActor(null);
    this.setCards(this.#state);
    this.#startFlight(id, "place");
    this.#requestFrame();
  }

  /** The cards standing aside while they resolve (`parkEncounter`). */
  parkedEncounters(): string[] {
    return [...this.#parked];
  }

  /** False when `id` was not on the table to retire (already gone). */
  retireEncounter(id: string, discarded?: TableCard): boolean {
    const piece = this.#pieces.get(id);
    this.#parked.delete(id);
    if (!piece || !this.#encounters.delete(id)) return false;
    if (this.#revealing === id) this.#revealing = null;
    this.markActor(null);
    if (!this.#state) return true;
    // An obligation was given to the player while it asked its question, so the last cards the table was shown may
    // still list it in their play area: it leaves that too, or it would stay drawn there until the next redraw.
    const state = this.#withoutInPlay(this.#state, id);
    if (!discarded) {
      // Nowhere to fly to: it goes from the table now rather than being left where it stood.
      this.setCards(state);
      return true;
    }
    this.setCards({
      ...state,
      encounterDiscard: [...state.encounterDiscard.filter((c) => c.id !== id), discarded],
    });
    this.#startFlight(id, "place");
    this.#requestFrame();
    return true;
  }

  #withoutInPlay(state: TableCards, id: string): TableCards {
    const stays = (card: TableCard) => card.id !== id;
    return { ...state, enemyCards: state.enemyCards.filter(stays), inPlay: state.inPlay.filter(stays) };
  }

  /**
   * A card removed from the game has no pile to go to: it evaporates where it stands, rising a little as its picture
   * breaks up into pale motes that float away (Eviction Notice, when Peter Parker exhausts for it). It leaves the
   * table's lists at once; the piece stays only until it has gone. Returns how long that takes, 0 when it went at once.
   */
  evaporate(id: string): number {
    const piece = this.#pieces.get(id);
    this.#parked.delete(id);
    this.#encounters.delete(id);
    if (this.#revealing === id) this.#revealing = null;
    if (this.#actor === id) this.markActor(null);
    if (this.#interrupt?.piece === piece) this.#interrupt = null;
    if (this.#flicker?.piece === piece) this.#flicker = null;
    // Out of the pieces first, so laying the table out again neither moves it nor drops it.
    this.#pieces.delete(id);
    this.#flights.delete(id);
    if (this.#state) this.setCards(this.#withoutInPlay(this.#state, id));
    if (!piece) return 0;
    if (this.#reduced.matches || this.#contextLost || this.#disposed) {
      this.#releaseVapour({ piece, start: 0, rise: 0, scale: 1, dissolve: { value: 1 }, owned: [], motes: 0 });
      return 0;
    }
    const dissolve = { value: 0 };
    const owned: THREE.Material[] = [];
    piece.rim.visible = piece.tokens.visible = piece.markers.visible = false;
    if (piece.aura) piece.aura.visible = false;
    // The card's body is a material every card shares, and it would show dark through the holes: it goes at once,
    // leaving the picture on both sides to break up.
    (piece.root.children[0] as THREE.Mesh).visible = false;
    dissolving(piece.face.material, dissolve);
    if (piece.back.material === this.#deckBack.material || piece.back.material === this.#encounterBack.material) {
      const back = piece.back.material.clone();
      owned.push(back);
      piece.back.material = back;
    }
    dissolving(piece.back.material, dissolve);
    this.#vapours.push({
      piece,
      start: performance.now(),
      rise: piece.root.position.y,
      scale: piece.root.scale.x,
      dissolve,
      owned,
      motes: 0,
    });
    this.#requestFrame();
    return EVAPORATE_MS;
  }

  readonly #vapours: Vapour[] = [];

  /** Each evaporating card one frame on: false once none is left. */
  #evaporateStep(now: number): boolean {
    for (let i = this.#vapours.length - 1; i >= 0; i--) {
      const vapour = this.#vapours[i]!;
      const { piece } = vapour;
      const progress = THREE.MathUtils.clamp((now - vapour.start) / EVAPORATE_MS, 0, 1);
      if (progress === 1) {
        this.#vapours.splice(i, 1);
        this.#releaseVapour(vapour);
        continue;
      }
      vapour.dissolve.value = THREE.MathUtils.smoothstep(progress, 0.06, 0.94);
      piece.root.position.y = vapour.rise + easeOutCubic(progress) * 0.42 * vapour.scale;
      piece.root.scale.setScalar(vapour.scale * (1 + 0.05 * progress));
      // Motes come off the card as its picture goes, most in the middle of it.
      const due = Math.round(VAPOUR_MOTES * THREE.MathUtils.smoothstep(progress, 0.04, 0.85));
      if (due > vapour.motes) piece.root.updateMatrixWorld();
      const [width, height] = piece.card.landscape ? [HEIGHT, 1] : [1, HEIGHT];
      for (; vapour.motes < due; vapour.motes++) {
        const at = new THREE.Vector3((Math.random() - 0.5) * width, (Math.random() - 0.5) * height, 0.03).applyMatrix4(
          piece.root.matrixWorld,
        );
        this.#mote(at, vapour.scale);
      }
    }
    return this.#vapours.length > 0;
  }

  /** One pale mote of vapour drifting up off an evaporating card. */
  #mote(at: THREE.Vector3, scale: number): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.#sparkMap,
        color: Math.random() < 0.3 ? 0xffffff : VAPOUR_COLOR,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    sprite.renderOrder = 10;
    sprite.layers.set(FRONT_LAYER);
    sprite.position.copy(at);
    const size = (0.06 + Math.random() * 0.09) * Math.max(0.6, scale);
    sprite.scale.setScalar(size);
    this.#scene.add(sprite);
    this.#sparks.push({
      sprite,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.35,
        0.7 + Math.random() * 0.8,
        (Math.random() - 0.5) * 0.35,
      ),
      born: performance.now(),
      life: 650 + Math.random() * 500,
      size,
      drifts: true,
    });
  }

  /** The evaporated card leaves the scene for good. */
  #releaseVapour({ piece, owned }: Vapour): void {
    this.#scene.remove(piece.root);
    for (const token of piece.tokens.children) this.#drops.delete(token as THREE.Group);
    if (piece.card.reverseArt || piece.card.type === "villain") piece.back.material.dispose();
    for (const material of owned) material.dispose();
    piece.aura?.material.dispose();
    piece.face.material.dispose();
  }

  discardDefeatedCard(id: string, discarded: TableCard | undefined, pile: "discard" | "encounterDiscard"): void {
    const state = this.#state;
    if (!state || !this.#pieces.has(id)) return;
    // Only the defeated card leaves here: anything attached to it keeps its place until its own beat discards it.
    const stillInPlay = (card: TableCard) => card.id !== id;
    if (discarded) this.#startFlight(id, "discard");
    this.setCards({
      ...state,
      enemyCards: state.enemyCards.filter(stillInPlay),
      inPlay: state.inPlay.filter(stillInPlay),
      [pile]: discarded ? [...state[pile].filter((card) => card.id !== id), discarded] : state[pile],
    });
  }

  landEncounter(card: TableCard): void {
    if (!this.#state) return;
    this.#parked.delete(card.id);
    this.#encounters.delete(card.id);
    this.#revealing = null;
    this.setCards({ ...this.#state, enemyCards: [...this.#state.enemyCards.filter((c) => c.id !== card.id), card] });
    this.#startFlight(card.id, card.attachedTo ? "equip" : "place");
  }

  reconcileEncounters(retain: readonly string[]): void {
    for (const id of this.#encounters.keys()) if (!retain.includes(id)) this.#encounters.delete(id);
    for (const id of this.#parked) if (!this.#encounters.has(id)) this.#parked.delete(id);
    if (this.#revealing && !this.#encounters.has(this.#revealing)) this.#revealing = null;
  }

  markActor(id: string | null): void {
    const previous = this.#actor && this.#pieces.get(this.#actor);
    if (previous) {
      previous.rim.visible =
        this.#state?.targets.includes(previous.card.id) || this.#state?.selected.includes(previous.card.id) || false;
      previous.rim.scale.set(1.042, 1.03, 1);
    }
    this.#actor = id;
    this.#requestFrame();
  }

  turnCards(turns: readonly { id: string; exhausted: boolean }[]): void {
    const state = this.#state;
    if (!state) return;
    // Set every landing pose in a single layout before the group takes off.
    const exhaustedByCard = new Map(turns.map(({ id, exhausted }) => [id, exhausted]));
    const turn = (card: TableCard) => {
      const exhausted = exhaustedByCard.get(card.id);
      return exhausted === undefined ? card : { ...card, exhausted };
    };
    this.setCards({
      ...state,
      hero: turn(state.hero),
      villain: turn(state.villain),
      enemyCards: state.enemyCards.map(turn),
      inPlay: state.inPlay.map(turn),
      staged: state.staged && turn(state.staged),
    });
  }

  changeStatus(id: string, name: string, delta: number): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    const old = piece.card.markers ?? [];
    const count = Math.max(0, (old.find((m) => m.name === name)?.count ?? 0) + delta);
    if (name === "tough" && delta < 0) {
      const token = piece.markers.children.find((child) => child.name === name) as THREE.Group | undefined;
      if (token) {
        this.#drops.delete(token);
        piece.root.attach(token);
        this.#liftedTokens.set(token, performance.now());
      }
    }
    const markers = old.filter((m) => m.name !== name);
    if (count) markers.push({ name, count });
    this.#updateMarkers(piece, markers);
  }

  #setMarkers(piece: Piece, markers: NonNullable<TableCard["markers"]>, tucked: boolean): void {
    const group = piece.markers;
    const key = JSON.stringify([tucked, markers]);
    if (group.name === key) return;
    group.name = key;
    const prior = new Map(
      group.children.map((token) => [
        token.name,
        { count: token.userData.count, drop: this.#drops.get(token as THREE.Group) },
      ]),
    );
    for (const token of group.children) this.#drops.delete(token as THREE.Group);
    group.clear();
    const places = placeTokens(markers, piece.card.landscape);
    markers.forEach(({ name, count }, i) => {
      const token = this.#kit.build(name, count);
      const old = prior.get(name);
      // A new token, or one whose number changed, drops onto the card; an unchanged one stays put.
      const drop = old?.count === count ? old.drop : performance.now() + i * 55;
      if (drop !== undefined) this.#drops.set(token, drop);
      if (tucked) {
        // On an upgrade or attachment tab: a short column along the exposed edge.
        token.scale.setScalar(0.62);
        token.position.set(-0.41, -0.42 + i * 0.27, 0.04);
      } else {
        const place = places[i]!;
        token.position.set(place.x, place.y, 0.03);
        token.rotation.z = place.rotation;
        token.scale.setScalar(place.scale);
      }
      group.add(token);
    });
    this.#shadeTokens(piece, this.#dimFor(piece.card.id));
  }

  setThreat(id: string, total: number): void {
    const piece = this.#pieces.get(id);
    const group = piece?.tokens;
    if (!piece || !group) return;
    // Remember the new count on the card too. A later redraw in the same move (a deal, a reveal, a discard) rebuilds
    // every card's chips from its card; with the old count there it would take the new chips straight back off.
    if (piece.card.threat !== total && this.#state) {
      const updated = { ...piece.card, threat: total };
      const replace = (c: TableCard) => (c.id === id ? updated : c);
      piece.card = updated;
      const s = this.#state;
      this.#state = {
        ...s,
        hero: replace(s.hero),
        villain: replace(s.villain),
        inPlay: s.inPlay.map(replace),
        enemyCards: s.enemyCards.map(replace),
        staged: s.staged && replace(s.staged),
      };
    }
    while (group.children.length > total) {
      const token = group.children.at(-1)! as THREE.Group;
      this.#drops.delete(token);
      group.parent?.add(token);
      this.#liftedTokens.set(token, performance.now());
    }
    while (group.children.length < total) {
      const i = group.children.length;
      const token = this.#kit.threatChip();
      // Chips settle in a loose three-by-two tray in the corner of the scheme, then stack.
      token.position.set(
        0.48 - (i % 3) * 0.235,
        -0.29 + Math.floor((i % 6) / 3) * 0.21,
        0.03 + Math.floor(i / 6) * 0.047,
      );
      token.rotation.z = ((i * 0.61) % 0.5) - 0.25;
      group.add(token);
      this.#drops.set(token, performance.now() + Math.min(i, 4) * 45);
    }
    this.#shadeTokens(piece, this.#dimFor(id));
    this.#requestFrame();
  }

  encounterDiscardAnchor() {
    return this.#anchor(this.#encounterDiscardSlot);
  }

  encounterAnchor() {
    return this.#anchor(this.#encounterSlot);
  }

  #texture(url: string): THREE.Texture | null {
    if (!url) return null;
    let texture = this.#textures.get(url);
    if (!texture) {
      const made = new THREE.Texture();
      made.colorSpace = THREE.SRGBColorSpace;
      made.anisotropy = Math.min(8, this.#renderer.capabilities.getMaxAnisotropy());
      // A picture that fails is asked for again a little later, rather than leaving the card black all game.
      loadWithRetry(
        url,
        (attemptUrl, onError) =>
          this.#images.load(
            attemptUrl,
            (image) => {
              made.image = image;
              made.needsUpdate = true;
              this.#requestFrame();
            },
            undefined,
            onError,
          ),
        () => !this.#disposed,
      );
      this.#textures.set(url, made);
      texture = made;
    }
    return texture;
  }

  /** Stage-relative CSS pixel positions for DOM controls, including cards in flight. */
  anchors() {
    return Array.from(this.#pieces, ([id, { root, card }]) => ({ id, ...this.#anchor(root, card.landscape) }));
  }

  cardOutline(id: string): string[] {
    const piece = this.#pieces.get(id);
    if (!piece?.root.visible) return [];
    piece.root.updateMatrixWorld();
    return (piece.card.landscape ? this.#landscapeOutline : this.#outline).map(({ x, y }) => {
      this.#scratch.set(x, y, 0.019).applyMatrix4(piece.root.matrixWorld).project(this.#camera);
      return `${(((1 + this.#scratch.x) * this.#width) / 2).toFixed(1)} ${(((1 - this.#scratch.y) * this.#canvasHeight) / 2).toFixed(1)}`;
    });
  }

  /** `extra`: cards the caller knows are held up in front (a revealed card being read). */
  foregroundCardClips(extra: readonly (string | null)[] = []): string[] {
    if (!this.#state) return [];
    const ids = new Set(this.#state.hand.map((card) => card.id));
    for (const id of extra) if (id) ids.add(id);
    if (this.#flights.get(this.#state.hero.id)?.kind === "flip") ids.add(this.#state.hero.id);
    if (this.#flights.get(this.#state.villain.id)?.kind === "flip") ids.add(this.#state.villain.id);
    if (this.#revealing) ids.add(this.#revealing);
    if (this.#state.staged) ids.add(this.#state.staged.id);
    // Anything raised off the table or moving over it sits in front of the labels, so it hides any it covers: a card
    // dealt or revealed from the encounter deck, a card in flight, an event at work, a card lifted by its ability.
    for (const [id, card] of this.#encounters) if (!("boostFor" in card && card.boostFor)) ids.add(id);
    for (const [id, flight] of this.#flights) if (flight.kind !== "tuck") ids.add(id);
    if (this.#power) ids.add(this.#power);
    if (this.#interrupt) ids.add(this.#interrupt.piece.card.id);
    for (const card of this.#deckReveal) ids.add(card.id);
    if (this.#state.discardOpen) for (const card of this.#viewedPile(this.#state)) ids.add(card.id);
    const clips: string[] = [];
    for (const id of ids) {
      const piece = this.#pieces.get(id);
      if (!piece?.root.visible) continue;
      const outline = this.cardOutline(id);
      clips.push(`path(evenodd, "M0 0 H${this.#width} V${this.#canvasHeight} H0 Z M${outline.join(" L")} Z")`);
    }
    return clips;
  }

  discardAnchor(): { x: number; y: number; bottom: number } {
    return this.#anchor(this.#discardSlot);
  }

  deckAnchor(): { x: number; bottom: number } {
    return this.#anchor(this.#deckSlot);
  }

  #anchor(root: THREE.Group, landscape = false) {
    root.updateMatrixWorld();
    this.#scratch.copy(root.position).project(this.#camera);
    const x = (0.5 + this.#scratch.x / 2) * this.#width;
    const y = (0.5 - this.#scratch.y / 2) * this.#canvasHeight;
    let bottom = y,
      top = y;
    let left = x,
      right = x;
    for (const [cx, cy] of corners) {
      this.#scratch
        .set(landscape ? cy : cx, landscape ? cx : cy, 0.02)
        .applyMatrix4(root.matrixWorld)
        .project(this.#camera);
      const cornerX = (0.5 + this.#scratch.x / 2) * this.#width;
      left = Math.min(left, cornerX);
      right = Math.max(right, cornerX);
      const cornerY = (0.5 - this.#scratch.y / 2) * this.#canvasHeight;
      top = Math.min(top, cornerY);
      bottom = Math.max(bottom, cornerY);
    }
    return { x, y, top, bottom, left, right, width: right - left };
  }

  setHovered(id: string | null): void {
    if (this.#state?.menuCard) id = this.#state.menuCard;
    if (this.#hovered === id) return;
    const previous = this.#hovered;
    this.#hovered = id;
    this.#layout();
    if (previous && !this.#flights.has(previous) && !(this.#press?.dragging && this.#press.id === previous)) {
      const piece = this.#pieces.get(previous);
      if (piece) {
        this.#apply(piece, 1);
        piece.root.updateMatrixWorld();
      }
    }
    this.#requestFrame();
  }

  #point(x: number, y: number, elevation: number): THREE.Vector3 {
    this.#ndc.set((2 * x) / this.#width - 1, 1 - (2 * (y + this.#extension)) / this.#canvasHeight);
    this.#ray.setFromCamera(this.#ndc, this.#camera);
    this.#floor.constant = -elevation;
    return this.#ray.ray.intersectPlane(this.#floor, new THREE.Vector3())!;
  }

  #resizeCanvas(): void {
    // Extend the frustum above the board so the existing play area keeps its scale.
    this.#camera.setViewOffset(this.#width, this.#height, 0, -this.#extension, this.#width, this.#canvasHeight);
    this.#renderer.setSize(this.#width, this.#canvasHeight, false);
  }

  readonly #resize = (): void => {
    this.#width = Math.max(1, this.#viewport.clientWidth);
    this.#height = Math.max(1, this.#viewport.clientHeight);
    this.#resizeCanvas();
    this.#snapBoard = true;
    if (!this.#state) this.#defaultMat();
    this.#layout();
    for (const [id, piece] of this.#pieces) {
      if (!this.#flights.has(id)) this.#apply(piece, 1);
    }
    this.#requestFrame();
  };

  /** Before any cards: the mat fills the screen. */
  #defaultMat(): void {
    const far = this.#point(this.#width / 2, this.#height * 0.045, 0);
    const near = this.#point(this.#width * 0.985, this.#height * 0.98, 0);
    this.#matGoal = { x: 0, z: (near.z + far.z) / 2, width: near.x * 2, depth: near.z - far.z };
  }

  /** Where a card will rest on screen once it gets there (its target pose), lying on the table. */
  #screenBox(id: string): ScreenBox | null {
    const piece = this.#pieces.get(id);
    if (!piece) return null;
    const { position, scale, roll } = piece.target;
    const sideways = piece.card.landscape !== Math.abs(Math.sin(roll)) > 0.7;
    const halfX = (scale * (sideways ? HEIGHT : 1)) / 2;
    const halfZ = (scale * (sideways ? 1 : HEIGHT)) / 2;
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => this.#project(position.x + sx * halfX, position.y, position.z + sz * halfZ)),
    );
    return {
      left: Math.min(...corners.map((c) => c.x)),
      right: Math.max(...corners.map((c) => c.x)),
      top: Math.min(...corners.map((c) => c.y)),
      bottom: Math.max(...corners.map((c) => c.y)),
    };
  }

  /** Screen pixels of a world point. */
  readonly #project = (x: number, y: number, z: number): { x: number; y: number } => {
    this.#scratch.set(x, y, z).project(this.#camera);
    return { x: ((this.#scratch.x + 1) / 2) * this.#width, y: ((1 - this.#scratch.y) / 2) * this.#height };
  };

  #pose(id: string, x: number, y: number, width: number, elevation: number, pitch: number, roll = 0): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    const center = this.#point(x, y, elevation);
    const widthPoint = this.#point(x + width, y, elevation);
    piece.target = { position: center, scale: widthPoint.x - center.x, pitch, roll };
  }

  /** Pose a card on the table, lifted while hovered or picked; returns where it rests, for fitting the table. */
  #tablePose(
    id: string,
    x: number,
    y: number,
    width: number,
    elevation: number,
    pitch: number,
  ): { center: THREE.Vector3; scale: number } {
    const center = this.#point(x, y, elevation);
    const rest = { center, scale: this.#point(x + width, y, elevation).x - center.x };
    const hovered = this.#hovered === id;
    if ((hovered || this.#state?.selected.includes(id)) && !this.#flights.has(id)) {
      if (hovered) this.#hoverRest = rest;
      this.#pose(id, x, y - width * 0.09, width * 1.065, elevation + 0.35, pitch + 0.07);
    } else {
      this.#pose(id, x, y, width, elevation, pitch);
    }
    return rest;
  }

  /**
   * Scale and slide the table's cards so they fill the room between the top of the screen and the hand: a busy board
   * shrinks instead of scrolling, a quiet one grows. Only lasting cards decide the fit (`rests`), and the room is
   * measured from a hand of any size and a turn bar of one line, so hovering, picking, a dealt card or a long question
   * never rescale the table. The mat is sized around the fitted cards and reaches under the hand.
   */
  #fitTable(
    onBoard: ReadonlySet<string>,
    rests: readonly TableBox[],
    slots: readonly (readonly [THREE.Object3D, { position: THREE.Vector3; scale: number }])[],
  ): void {
    const w = this.#width,
      h = this.#height;
    if (!rests.length) return;
    const box: TableBox = {
      x0: Math.min(...rests.map((r) => r.x0)),
      x1: Math.max(...rests.map((r) => r.x1)),
      z0: Math.min(...rests.map((r) => r.z0)),
      z1: Math.max(...rests.map((r) => r.z1)),
    };
    const handCard = Math.min(h * 0.215, (h * (w < 740 ? 0.4 : 0.36) - 50) / 1.5, w * 0.245);
    // A phone's turn bar spans the screen and wraps its buttons under the question, so it stands taller.
    const bar = w < 740 ? 92 : 50;
    const room = {
      left: 6,
      right: w - 6,
      top: 6,
      // A sunk hand shows the top of its cards (`SUNK_SHOWS`); the table comes down to just above them. Paying or
      // picking from it raises the hand whole; a question in the turn bar sits just above the hand, and the table
      // eases up to make room for it.
      bottom: !this.#hand.sunk
        ? h - bar - handCard * 1.48 - 26
        : this.#state?.paymentSources || this.#state?.handPick
          ? h - 12 - handCard * 1.64 - QUESTION_ROOM
          : this.#question
            ? h - handCard * (SUNK_SHOWS + 0.24) - QUESTION_ROOM
            : h - handCard * SUNK_SHOWS - 20,
    };
    // The table fills the room above the hand: a quiet board grows up into empty space at the top (up to a quarter
    // bigger), a busy one (a tall stack of side schemes) shrinks until it fits. The hero's row keeps its edge where
    // the layout put it, over the top of the hand, and the villain stays in the middle.
    const corners = [box.x0, box.x1].flatMap((x) => [box.z0, box.z1].map((z) => this.#project(x, 0.06, z)));
    const lowest = Math.max(...corners.map((p) => p.y));
    const fit: BoardFit = fitBoard(
      box,
      this.#project,
      { ...room, top: 46, bottom: Math.max(room.bottom, lowest) },
      { maxScale: 1.25 },
    );
    const place = (p: THREE.Vector3) => {
      const q = fitToBox(fit, p);
      return p.set(q.x, q.y, q.z);
    };
    for (const id of onBoard) {
      const target = this.#pieces.get(id)?.target;
      if (!target) continue;
      place(target.position);
      target.scale *= fit.scale;
    }
    for (const [slot, goal] of slots) {
      place(goal.position);
      goal.scale *= fit.scale;
      // A pile's first place is taken at once; after that it eases with the cards.
      if (!this.#slotGoals.has(slot)) {
        slot.position.copy(goal.position);
        slot.scale.setScalar(goal.scale);
      }
      this.#slotGoals.set(slot, goal);
    }
    if (this.#hoverRest) {
      const center = place(this.#hoverRest.center.clone());
      const at = this.#project(center.x, center.y, center.z);
      const edge = this.#project(center.x + this.#hoverRest.scale * fit.scale, center.y, center.z);
      this.#hoverFootprint = { x: at.x, y: at.y, width: edge.x - at.x };
    }
    // The mat fills the screen as it always has, and stretches past any card or pile that would sit off its edge.
    const far = fitToBox(fit, { x: box.x0, y: 0, z: box.z0 });
    const near = fitToBox(fit, { x: box.x1, y: 0, z: box.z1 });
    const margin = (fitToBox(fit, { x: 0.32, y: 0, z: 0 }).x - fitToBox(fit, { x: 0, y: 0, z: 0 }).x) * 0.8;
    const screenNear = this.#point(w * 0.985, h * 0.98, 0);
    const halfWidth = Math.max(screenNear.x, -(far.x - margin), near.x + margin);
    // The mat's far edge follows the cards: no bare strip of mat above the villain's row.
    const top = far.z - margin * 1.6;
    const front = Math.max(screenNear.z, near.z + margin);
    this.#matGoal = { x: 0, z: (top + front) / 2, width: halfWidth * 2, depth: front - top };
  }

  #layout(): void {
    const state = this.#state;
    if (!state) return;
    const w = this.#width,
      h = this.#height;
    const boardWidth = Math.min(w * 0.2, h * 0.22);
    const flat = -Math.PI / 2;
    // Piles sit out at the mat's edges, leaving the middle to the cards in play.
    const pileX = w * 0.885;
    const pileY = h * 0.505;
    const base = this.#point(pileX, pileY, 0.025);
    const encounterWidth = Math.min(w * 0.088, h * 0.088);
    const encounterPile = (y: number) => {
      const position = this.#point(pileX, y, 0.025);
      const scale = this.#point(pileX + encounterWidth, y, 0.025).x - position.x;
      // Align the piles on the table itself, accounting for the camera perspective.
      position.x = base.x;
      return { position, scale };
    };
    const encounterGoal = encounterPile(h * 0.23);
    this.#hoverFootprint = null;
    this.#hoverRest = null;
    this.#tucked.clear();
    // The cards lying on the table (fitted to the screen at the end) and where the lasting ones rest.
    const onBoard = new Set<string>();
    const rests: TableBox[] = [];
    const rest = (center: THREE.Vector3, scale: number, wide: boolean) => {
      const halfX = (wide ? HEIGHT : 1) * scale * 0.5;
      const halfZ = (wide ? 1 : HEIGHT) * scale * 0.5;
      // A little room under each card for its hit points, threat or count.
      rests.push({
        x0: center.x - halfX,
        x1: center.x + halfX,
        z0: center.z - halfZ,
        z1: center.z + halfZ + scale * 0.3,
      });
    };
    const enemies = state.enemyCards.filter((c) => !c.attachedTo);
    const enemyPoses = new Map<string, { x: number; y: number; width: number }>();
    const poseEnemy = (host: TableCard, x: number, y: number, width: number) => {
      enemyPoses.set(host.id, { x, y, width });
      const attachments = state.enemyCards.filter((c) => c.attachedTo === host.id);
      attachments.forEach((card, i) => {
        this.#tucked.set(card.id, { host: host.id, depth: attachments.length - i });
        this.#pose(card.id, x - width * TAB * (attachments.length - i), y, width, 0.045 + i * 0.035, flat);
        onBoard.add(card.id);
        const target = this.#pieces.get(card.id)?.target;
        if (target) rest(target.position, target.scale, false);
      });
      const resting = this.#tablePose(host.id, x, y, width, 0.05 + attachments.length * 0.035, flat);
      onBoard.add(host.id);
      rest(resting.center, resting.scale, host.landscape);
    };
    const villainTabs = state.enemyCards.filter((c) => c.attachedTo === state.villain.id).length;
    this.#villainShadow.visible = villainTabs > 0;
    const villainWidth = Math.min(boardWidth, (w * 0.3) / (1 + 2 * TAB * villainTabs));
    poseEnemy(state.villain, w * 0.5, h * 0.237, villainWidth);
    const isScheme = (card: TableCard) => card.type === "main_scheme" || card.type === "side_scheme";
    const schemes = enemies.filter(isScheme);
    const otherEnemies = enemies.filter((card) => !isScheme(card));
    const enemyRow = h * 0.242;
    const enemyCardWidth = Math.min(w * 0.117, h * 0.145);
    const schemeX = w * 0.255;
    const schemeElevation = 0.05;
    const schemeOrigin = this.#point(schemeX, enemyRow, schemeElevation);
    const schemeScale = this.#point(schemeX + enemyCardWidth, enemyRow, schemeElevation).x - schemeOrigin.x;
    // Leave room below each full-size scheme for its threat label.
    const schemeStep = Math.max(
      schemeScale * 1.75,
      schemeOrigin.z - this.#point(schemeX, h * 0.105, schemeElevation).z,
    );
    schemes.forEach((card, i) => {
      const position = schemeOrigin.clone();
      position.z -= i * schemeStep;
      const projected = this.#scratch.copy(position).project(this.#camera);
      const x = (projected.x + 1) * w * 0.5;
      const y = (1 - projected.y) * this.#canvasHeight * 0.5 - this.#extension;
      position.x += schemeScale;
      const right = (position.project(this.#camera).x + 1) * w * 0.5;
      poseEnemy(card, x, y, right - x);
    });
    if (otherEnemies.length) {
      const bounds = (card: TableCard, x: number, y: number, width: number, tabs: number) => {
        const elevation = 0.05 + tabs * 0.035;
        const root = this.#layoutCard;
        root.position.copy(this.#point(x, y, elevation));
        root.scale.setScalar(this.#point(x + width, y, elevation).x - root.position.x);
        root.rotation.x = flat;
        return this.#anchor(root, card.landscape);
      };
      const villainBoosts = [...this.#encounters.values()].filter(
        (card) => card.boostFor === state.villain.id && card.id !== this.#revealing,
      ).length;
      const boostWidth = boostCardWidth(villainWidth, w, h);
      const left =
        bounds(state.villain, w * 0.5, h * 0.237, villainWidth, villainTabs).right +
        (villainBoosts ? boostWidth * (0.7 + (villainBoosts - 1) * 0.3) : 0);
      const right = this.#project(
        encounterGoal.position.x - encounterGoal.scale * 0.5,
        0.025,
        encounterGoal.position.z,
      ).x;
      const slotWidth = (right - left) / otherEnemies.length;
      otherEnemies.forEach((card, i) => {
        const tabs = state.enemyCards.filter((c) => c.attachedTo === card.id).length;
        const footprint = (card.landscape ? HEIGHT : 1) + TAB * tabs;
        const width = Math.min(enemyCardWidth, Math.max(1, slotWidth * 0.78) / footprint);
        const center = left + (i + 0.5) * slotWidth;
        const x = center + (width * TAB * tabs) / 2;
        const { left: cardLeft, right: cardRight } = bounds(card, x, enemyRow, width, tabs);
        const perspectiveOffset = (cardLeft + cardRight) / 2 - x;
        poseEnemy(card, x - perspectiveOffset, enemyRow, width);
      });
    }
    let waiting = 0;
    // Where the revealed card stands on screen while it is held up, so a card being paid for keeps clear of it.
    let revealRect: { x: number; y: number; halfWidth: number; halfHeight: number } | null = null;
    let revealPose: { id: string; y: number; width: number; across: number } | null = null;
    const boosts = new Map<string, number>();
    for (const card of this.#encounters.values()) {
      const host = card.boostFor ? enemyPoses.get(card.boostFor) : undefined;
      // Facedown cards come and go each villain phase: they lie on the table but never move the fit.
      if (card.id !== this.#revealing) onBoard.add(card.id);
      if (card.id === this.#revealing) {
        // One size for every reveal (Adam, 2026-11-21: the held one was too big, the one with a question too small),
        // whether it waits to be read, asks a question or just plays out: readable, never crowding the table. It ends
        // a little above the turn bar's room over the hand, so a question never presses up against it.
        // On a phone the turn bar sits below the table, not over the hand: there the card keeps its usual height.
        const floor = w >= 741 ? this.#handTop.resting - QUESTION_ROOM - 28 : 0;
        let width = Math.min(h * 0.32, w * 0.27);
        const half = card.landscape ? 0.5 : 0.7;
        if (floor > 0) width = Math.max(h * 0.2, Math.min(width, (floor - 16) / (half * 2)));
        let y = Math.max(h * (w < 550 ? 0.3 : 0.38), 16 + width * half);
        if (floor > 0) y = Math.max(16 + width * half, Math.min(y, floor - width * half));
        this.#pose(card.id, w * 0.5, y, width, 1.75, this.#camera.rotation.x);
        revealPose = { id: card.id, y, width, across: card.landscape ? HEIGHT : 1 };
        revealRect = {
          x: w * 0.5,
          y,
          halfWidth: (width * (card.landscape ? HEIGHT : 1)) / 2,
          halfHeight: (width * (card.landscape ? 1 : HEIGHT)) / 2,
        };
      } else if (this.#parked.has(card.id)) {
        // Standing just right of the villain (past any boost card tucked under its edge), turned to the player like
        // a held card but small, raised over anything in that row so the labels it covers hide behind it.
        const villain = enemyPoses.get(state.villain.id)!;
        const width = Math.min(villain.width * 0.6, h * 0.2);
        const boostsOut = [...this.#encounters.values()].some((other) => other.boostFor === state.villain.id);
        const x = Math.min(
          w - 12 - width * 0.5,
          villain.x + villain.width * 0.5 + (boostsOut ? boostCardWidth(villain.width, w, h) * 0.55 : 0) + width * 0.62,
        );
        this.#pose(card.id, x, villain.y + width * 0.12, width, 1.2, this.#camera.rotation.x, -0.05);
      } else if (card.boostFor && host) {
        // A boost card waits facedown beside the enemy it was dealt to, tucked under its right edge, until the
        // activation turns it up.
        const stacked = boosts.get(card.boostFor) ?? 0;
        boosts.set(card.boostFor, stacked + 1);
        const width = boostCardWidth(host.width, w, h);
        this.#pose(
          card.id,
          host.x + host.width * 0.5 + width * (0.14 + stacked * 0.3),
          host.y + host.width * 0.2,
          width,
          0.02 + stacked * 0.008,
          flat,
          -0.13,
        );
      } else
        this.#pose(
          card.id,
          w * (0.67 + (waiting++ % 3) * 0.034),
          h * 0.26,
          Math.min(h * 0.125, w * 0.105),
          0.07 + waiting * 0.045,
          flat,
        );
    }
    // Cards turned up off the deck stand in a row in the middle, above the hand; the ones being kept rise a little.
    if (this.#deckReveal.length) {
      const count = this.#deckReveal.length;
      const floor = this.#handTop.resting - 24;
      let width = Math.min(h * 0.3, (w * 0.8) / (count * 1.22));
      if (floor > 0) width = Math.max(h * 0.12, Math.min(width, (floor - 16) / 1.6));
      let y = Math.max(16 + width * 0.8, h * 0.42);
      if (floor > 0) y = Math.min(y, floor - width * 0.7);
      this.#deckReveal.forEach((card, index) => {
        const x = w * 0.5 + (index - (count - 1) / 2) * width * 1.22;
        const rise = this.#deckPicks.has(card.id) ? width * 0.1 : 0;
        this.#pose(card.id, x, y - rise, width, 1.75 + index * 0.01, this.#camera.rotation.x);
      });
    }
    // Cards lying facedown under an enemy card (Highway Robbery's) show a strip of their back past its left edge.
    this.#underIds.clear();
    const underCount = new Map<string, number>();
    // The `index`th card under `hostId`: shoved under its left edge so a strip of its back shows, turned to lie the
    // way the host lies, a little below it.
    const poseUnder = (id: string, hostId: string, index: number) => {
      const host = enemyPoses.get(hostId);
      const landscape = !!state.enemyCards.find((card) => card.id === hostId)?.landscape;
      if (!host) return;
      // Fitted to the screen with the rest of the table, so it stays where its host ends up.
      onBoard.add(id);
      const across = (landscape ? HEIGHT : 1) * host.width;
      this.#pose(
        id,
        host.x - across * (0.2 + index * 0.08),
        host.y,
        host.width * 0.97,
        0.02 - index * 0.004,
        flat,
        (landscape ? Math.PI / 2 : 0) + 0.025 + index * 0.03,
      );
    };
    for (const card of state.under ?? []) {
      const piece = this.#pieces.get(card.id);
      if (!card.under || !enemyPoses.has(card.under) || !piece || this.#stashing.has(card.id)) continue;
      this.#underIds.add(card.id);
      const index = underCount.get(card.under) ?? 0;
      underCount.set(card.under, index + 1);
      if (this.#flights.get(card.id)?.kind !== "draw") poseUnder(card.id, card.under, index);
    }
    // Cards on their way facedown into a deck rest on its top; cards going under a card lie just beneath it.
    for (const [id, { to }] of this.#stashing) {
      const piece = this.#pieces.get(id);
      if (!piece) continue;
      if (typeof to === "object") {
        if (!enemyPoses.has(to.under)) continue;
        poseUnder(id, to.under, underCount.get(to.under) ?? 0);
        underCount.set(to.under, (underCount.get(to.under) ?? 0) + 1);
      } else {
        const slot = to === "deck" ? this.#deckSlot : this.#encounterSlot;
        const back = to === "deck" ? this.#deckBack : this.#encounterBack;
        const position = slot.position.clone();
        position.y += back.position.z * slot.scale.x + 0.03;
        piece.target = { position, scale: slot.scale.x, pitch: slot.rotation.x, roll: 0 };
      }
    }
    const permanents = state.inPlay.filter((c) => c.id !== state.staged?.id);
    if (state.staged && !state.stagedOverEnemies && ["ally", "support", "upgrade"].includes(state.staged.type))
      permanents.push(state.staged);
    const upgrades = permanents.filter(isTuckedUpgrade);
    const visibleUpgrades = permanents.filter((card) => card.type === "upgrade" && card.showAsFullCard);
    const row = [state.hero, ...visibleUpgrades, ...permanents.filter((card) => card.type !== "upgrade")];
    const tabs = upgrades.length * TAB;
    this.#heroShadow.visible = upgrades.some((card) => card.id !== state.staged?.id);
    // Airborne cards can sweep over their neighbours. Space the row for their settled poses.
    const footprints = row.map((card) => (card.exhausted !== card.landscape ? HEIGHT : 1));
    const tabScale = state.hero.exhausted ? 1 / HEIGHT : 1;
    // A busy row closes up before its cards shrink.
    const gap = row.length > 5 ? 0.16 : 0.28;
    const rowWidth = tabs * tabScale + footprints.reduce((total, width) => total + width, 0) + gap * (row.length - 1);
    const playWidth = Math.min(w * 0.1134, h * 0.133, (w * 0.62) / rowWidth);
    let left = (w - rowWidth * playWidth) / 2 + tabs * tabScale * playWidth;
    const centers = footprints.map((width) => {
      const center = left + (width * playWidth) / 2;
      left += (width + gap) * playWidth;
      return center;
    });
    const first = centers[0]!;
    const rowY = h * 0.532;
    const posePermanent = (card: TableCard, x: number, elevation: number) => {
      onBoard.add(card.id);
      if (card.id === state.staged?.id) {
        this.#pose(card.id, x, rowY - playWidth * 0.3, playWidth * 1.12, 1.15, flat + 0.12);
        // Where it will land, so the table is already fitted for it.
        const center = this.#point(x, rowY, elevation);
        rest(center, this.#point(x + playWidth, rowY, elevation).x - center.x, card.landscape);
      } else {
        const resting = this.#tablePose(card.id, x, rowY, playWidth, elevation, flat);
        // Counted upright: turning sideways to exhaust, and back to ready, never moves a fitted table.
        rest(resting.center, resting.scale, card.landscape);
        if (card.exhausted) this.#pieces.get(card.id)!.target.roll = -Math.PI / 2;
      }
    };
    const heroHalf = (playWidth * (state.hero.exhausted ? HEIGHT : 1)) / 2;
    upgrades.forEach((card, i) => {
      const width = playWidth * tabScale;
      const x = first - heroHalf + width * 0.5 - width * TAB * (upgrades.length - i);
      if (card.id === state.staged?.id) posePermanent(card, x, 0.05);
      else {
        this.#tucked.set(card.id, { host: state.hero.id, depth: upgrades.length - i });
        this.#pose(card.id, x, rowY, width, 0.045 + i * 0.035, flat);
        onBoard.add(card.id);
        const target = this.#pieces.get(card.id)!.target;
        rest(target.position, target.scale, false);
      }
    });
    row.forEach((card, i) => posePermanent(card, centers[i]!, 0.08 + (i === 0 ? upgrades.length * 0.035 : 0)));
    const hand = state.hand.filter((card) => card.id !== state.staged?.id);
    const handLeft = 14;
    // A phone's hand overlaps more so each card stays big enough to read; a hovered card lifts clear.
    const spread = w < 550 ? 0.6 : 1.03;
    // The hand is centred on the whole table and sized for its full width; the turn corner sits over its end.
    const { sunk } = this.#hand;
    // A sunk hand keeps the card size it had over a turn bar (the bar and its gap, 86px); otherwise the turn bar spans
    // the bottom under the hand, so keep its strip of the table clear, measured from the bar itself.
    const bottomMargin = sunk ? 86 : Math.max(40, this.#bottomReserve + 10);
    const cardWidth = Math.min(
      Math.min(h * 0.215, (h * (w < 740 ? 0.4 : 0.36) - bottomMargin) / 1.5),
      (w - handLeft - 14) / (1 + Math.max(0, hand.length - 1) * spread),
      w * 0.245,
    );
    const center = (hand.length - 1) / 2;
    // Paying or picking from the hand lifts a sunk hand whole, so every card's resource icons and title show.
    const lifted = sunk && (!!state.paymentSources || !!state.handPick);
    const baseline = !sunk
      ? h - bottomMargin - cardWidth * 0.78
      : lifted
        ? h - 12 - cardWidth * 0.7
        : h - cardWidth * (SUNK_SHOWS - 0.7);
    // A hovered card lifts by the same small step wherever the hand sits.
    const lift = cardWidth * 0.17;
    // A raised card is drawn 1.09 times its size: its top sits 0.77 card widths over its centre.
    this.#handTop = { resting: baseline - lift - cardWidth * 0.77, hovered: null };
    // Reserve room for a fully raised card, independently of hover or selection.
    this.#paymentEdge = sunk ? baseline - lift - cardWidth * 0.77 - 8 : baseline - cardWidth * 1.0 - 8;
    const restPitch = this.#camera.rotation.x + 0.1;
    const normal = new THREE.Vector3(0, -Math.sin(restPitch), Math.cos(restPitch));
    const eye = this.#camera.position;
    const planeDistance = this.#point(w * 0.5, baseline, 1.34)
      .sub(eye)
      .dot(normal);
    // Raised cards face the camera, so they get layers along its view instead: the hovered card nearest, then each
    // picked card a card's thickness behind the last, so neighbours never cut through each other.
    const forward = this.#camera.getWorldDirection(new THREE.Vector3());
    const raisedDepth = this.#point(w * 0.5, baseline - lift, 2.06)
      .sub(eye)
      .dot(forward);
    // A picked card keeps its layer when hovered: popping in front of a picked neighbour looks like the two clip.
    const picked = hand.filter((card) => state.selected.includes(card.id));
    // Hovering a sunk hand card shows it full size where it is, standing on the bottom edge, so it reads without the
    // card panel. Not while paying or picking from the hand, where the whole hand is up and a card only lifts a step.
    const zoomWidth = cardWidth * 1.45;
    this.#zoom = null;
    hand.forEach((card, i) => {
      const offset = i - center;
      const outward = center ? offset / center : 0;
      const hovered = this.#hovered === card.id && !this.#press?.dragging;
      const raised = hovered || state.selected.includes(card.id);
      const zoomed = hovered && sunk && !lifted && !this.#question && !state.selected.includes(card.id);
      const handCenter = Math.max(w * 0.5, handLeft + cardWidth * (0.5 + center * spread));
      const restX = handCenter + offset * cardWidth * spread;
      const restY = baseline + outward ** 2 * cardWidth * 0.045;
      // Grown from its slot but kept on screen.
      const x = zoomed ? Math.min(Math.max(restX, zoomWidth / 2 + 8), w - zoomWidth / 2 - 8) : restX;
      const y = zoomed ? h - 8 - zoomWidth * 0.7 : restY - (raised ? lift : 0);
      const width = zoomed ? zoomWidth : cardWidth * (raised ? 1.09 : 1);
      if (hovered) {
        this.#hoverFootprint = { x: restX, y: restY, width: cardWidth };
        this.#handTop = { ...this.#handTop, hovered: y - width * 0.7 };
      }
      if (zoomed) this.#zoom = { id: card.id, handTop: baseline - cardWidth * 0.7 };
      this.#pose(
        card.id,
        x,
        y,
        width,
        1.34 + i * 0.012 + (raised ? 0.72 : 0),
        // Keep a little perspective in the resting fan; lift the print square to the camera for reading.
        raised ? this.#camera.rotation.x : restPitch,
        raised ? 0 : -outward * 0.066,
      );
      // Parallel layers along the camera ray keep every projected corner in place.
      const pose = this.#pieces.get(card.id)!.target;
      const ray = pose.position.clone().sub(eye);
      const ratio = raised
        ? (raisedDepth + (picked.includes(card) ? picked.indexOf(card) * 0.026 : -0.16) * pose.scale) / ray.dot(forward)
        : (planeDistance + i * 0.12 * pose.scale) / ray.dot(normal);
      pose.position.copy(eye).addScaledVector(ray, ratio);
      pose.scale *= ratio;
    });
    if (state.staged && state.stagedOverEnemies) {
      // Out of the hand and held up over the villain's side, in the open space beside the minions, until its host is chosen.
      onBoard.add(state.staged.id);
      this.#pose(state.staged.id, w * 0.71, h * 0.5, playWidth * 1.1, 1.18, flat + 0.12);
    } else if (
      state.staged &&
      (this.#power !== state.staged.id || this.#powerAside) &&
      !permanents.includes(state.staged)
    ) {
      onBoard.add(state.staged.id);
      // Held up beside the hero while it is paid for, but never over a card that could pay for it (Web-Shooter):
      // right of the hero if that is clear, else left of the row, else up in the gap above the row.
      // Nor over a card the player must pick next (First Aid's target, the hero included).
      const sources = new Set([...(state.paymentSources ?? []), ...state.targets]);
      const stagedHalf = (playWidth * 1.12) / 2;
      // Nor under a revealed card held up full size (Enhanced Spider-Sense paid for while Shadow of the Past waits to
      // be cancelled, Adam 2026-11-21): the card being read stays on top and whole, the paid card waits beside it.
      const underReveal = (x: number, y: number) =>
        !!revealRect &&
        Math.abs(revealRect.x - x) < revealRect.halfWidth + stagedHalf + 10 &&
        Math.abs(revealRect.y - y) < revealRect.halfHeight + stagedHalf * HEIGHT;
      const covers = (x: number, y: number) =>
        underReveal(x, y) ||
        row.some((card, i) => {
          if (!sources.has(card.id) && !card.resourceAbility) return false;
          const half = (footprints[i]! * playWidth) / 2;
          return Math.abs(centers[i]! - x) < half + playWidth * 0.62 && Math.abs(rowY - y) < playWidth * 1.45;
        });
      const rowLeft = first - heroHalf - tabs * tabScale * playWidth;
      const spots: [number, number][] = [
        [first + playWidth * 0.92, rowY - playWidth * 0.48],
        [rowLeft - playWidth * 0.75, rowY - playWidth * 0.48],
        [first, rowY - playWidth * 1.5],
      ];
      if (revealRect) {
        // Beside the revealed card, level with its lower half, on whichever side has room.
        const beside = revealRect.halfWidth + stagedHalf + 24;
        const y = revealRect.y + revealRect.halfHeight * 0.25;
        spots.push([revealRect.x + beside, y], [revealRect.x - beside, y]);
      }
      const onScreen = (x: number) => x - stagedHalf > 8 && x + stagedHalf < w - 8;
      // With no clear spot (a narrow screen) it stands beside the revealed card as far as the screen allows, partly
      // behind it: the revealed card is drawn on top either way (#render).
      const fallback: [number, number] = revealRect
        ? [Math.min(spots[3]![0], w - stagedHalf - 8), spots[3]![1]]
        : spots[2]!;
      const [x, y] =
        spots.find(([sx, sy], i) => (i !== 1 || sx > playWidth * 0.7) && onScreen(sx) && !covers(sx, sy)) ?? fallback;
      this.#pose(state.staged.id, x, y, playWidth * 1.12, 1.18, flat + 0.12);
    }
    const pileWidth = Math.min(w * 0.125, h * 0.125);
    const discardGoal = { position: base.clone(), scale: this.#point(pileX + pileWidth, pileY, 0.025).x - base.x };
    const deckX = w * 0.115,
      deckY = h * 0.505;
    const deckCenter = this.#point(deckX, deckY, 0.025);
    const deckGoal = {
      position: deckCenter,
      scale: this.#point(deckX + Math.min(w * 0.125, h * 0.125), deckY, 0.025).x - deckCenter.x,
    };
    const encounterDiscardGoal = encounterPile(h * 0.102);
    this.#encounterDiscardSlot.visible = state.encounterDiscard.length > 0;
    // The piles are part of the table too, the encounter discard pile even while it is empty, so a first discard
    // doesn't move everything (the first encounter card discarded once shrank and slid the whole board).
    for (const goal of [discardGoal, deckGoal, encounterGoal, encounterDiscardGoal])
      rest(goal.position, goal.scale, false);
    this.#fitTable(onBoard, rests, [
      [this.#discardSlot, discardGoal],
      [this.#deckSlot, deckGoal],
      [this.#encounterSlot, encounterGoal],
      [this.#encounterDiscardSlot, encounterDiscardGoal],
    ]);
    // A revealed card asking the player to pick cards on the table steps aside, clear of them (`revealAside`).
    // Worked out once per question and screen size, then held: a pick lifted under the pointer grows a little, and
    // the card must not twitch with it.
    if (revealPose && revealRect && state.targets.length) {
      const key = `${revealPose.id}|${state.targets.join(",")}|${w}x${h}|${this.#question}|${this.#hand.sunk}`;
      const reveal = revealRect as { x: number; y: number; halfWidth: number; halfHeight: number };
      if (this.#aside?.key !== key) {
        const picks = state.targets.flatMap((id) => {
          const box = id === revealPose!.id ? null : this.#screenBox(id);
          return box ? [box] : [];
        });
        this.#aside = {
          key,
          ...revealAside(
            {
              left: reveal.x - reveal.halfWidth,
              right: reveal.x + reveal.halfWidth,
              top: reveal.y - reveal.halfHeight,
              bottom: reveal.y + reveal.halfHeight,
            },
            picks,
            w,
          ),
        };
      }
      const aside = this.#aside!;
      if (aside.x !== reveal.x || aside.scale !== 1)
        this.#pose(revealPose.id, aside.x, revealPose.y, revealPose.width * aside.scale, 1.75, this.#camera.rotation.x);
    }
    const base2 = discardGoal.position;
    const scale = discardGoal.scale;
    const encounterScale = encounterDiscardGoal.scale;
    state.encounterDiscard.forEach((card, index) => {
      const piece = this.#pieces.get(card.id);
      if (!piece || this.#encounters.has(card.id)) return;
      piece.target = {
        position: encounterDiscardGoal.position.clone(),
        pitch: flat,
        roll: card.landscape ? -Math.PI / 2 : 0,
        scale: encounterScale,
      };
      piece.target.position.y += encounterScale * (0.016 + 0.009 * index);
    });
    const encounterThickness = Math.min(7, Math.max(1, state.encounterCount * 0.25));
    this.#encounterStock.visible = this.#encounterBack.visible = state.encounterCount > 0;
    this.#encounterStock.scale.z = encounterThickness;
    this.#encounterBack.position.z = 0.018 * encounterThickness + 0.002;
    const thickness = Math.min(7, Math.max(1, state.deckCount * 0.22));
    this.#deckStock.visible = this.#deckBack.visible = state.deckCount > 0;
    this.#deckStock.scale.z = thickness;
    this.#deckBack.position.z = 0.018 * thickness + 0.002;
    if (state.discardOpen && this.#viewedPile(state).length) {
      this.#fanDiscard(this.#viewedPile(state));
      return;
    }
    const pileIds = state.discard.map((card) => card.id).concat(this.#discardDeal?.ids ?? []);
    pileIds.forEach((id, i) => {
      const piece = this.#pieces.get(id);
      if (!piece) return;
      const position = base2.clone();
      position.y += (0.012 + i * 0.023) * scale;
      position.x += Math.min(i, 8) * scale * 0.008;
      piece.target = { position, pitch: flat, roll: 0, scale };
    });
    for (const id of pileIds) {
      const piece = this.#pieces.get(id);
      if (piece) piece.rim.visible = !this.#discardDeal && id === pileIds.at(-1) && this.#hovered === id;
    }
    const top = pileIds.at(-1);
    if (!this.#discardDeal && top && this.#hovered === top && !this.#flights.has(top)) {
      this.#pieces.get(top)!.target.position.y += scale * 0.025;
    }
  }

  #fanDiscard(cards: readonly TableCard[]): void {
    const w = this.#width,
      h = this.#height;
    const columns = Math.min(cards.length, Math.max(3, Math.floor((w * 0.88) / 125)));
    const rows = Math.ceil(cards.length / columns);
    const width = Math.min(
      190,
      h * 0.285,
      (w * 0.86) / (1 + (columns - 1) * 0.88),
      Math.max(1, (h * 0.84) / rows - 24) / 1.72,
    );
    const rowStep = width * 1.72 + 22;
    cards.forEach((card, index) => {
      const row = Math.floor(index / columns);
      const rowSize = Math.min(columns, cards.length - row * columns);
      const offset = (index % columns) - (rowSize - 1) / 2;
      const outward = rowSize > 1 ? (2 * offset) / (rowSize - 1) : 0;
      const raised = this.#hovered === card.id;
      const x = w * 0.5 + offset * width * 0.88;
      const y = h * 0.46 + (row - (rows - 1) / 2) * rowStep + outward ** 2 * width * 0.13;
      if (raised) this.#hoverFootprint = { x, y, width };
      this.#pose(
        card.id,
        x,
        y - (raised ? width * 0.07 : 0),
        width * (raised ? 1.045 : 1),
        2.6 + (index % columns) * 0.075 + (raised ? 0.6 : 0),
        this.#camera.rotation.x,
        raised ? 0 : -outward * 0.11,
      );
    });
  }

  #equipPose(piece: Piece, from: Pose, progress: number): void {
    const { root, target } = piece;
    const sweep = THREE.MathUtils.smoothstep(progress, 0, 0.43);
    const lower = THREE.MathUtils.smoothstep(progress, 0.38, 0.68);
    const slide = THREE.MathUtils.smoothstep(progress, 0.68, 1);
    const tabs =
      piece.card.attachedTo && this.#state!.enemyCards.some((c) => c.id === piece.card.id)
        ? this.#state!.enemyCards.filter((card) => card.attachedTo === piece.card.attachedTo).length
        : this.#state!.inPlay.filter(isTuckedUpgrade).length;
    // Clear even the outermost existing tab before descending to the stack's height.
    const clearance = Math.max(from.scale, target.scale) * (1.12 + tabs * TAB);
    const outsideX = target.position.x - clearance;
    root.position.set(
      THREE.MathUtils.lerp(from.position.x, outsideX, sweep) + clearance * slide,
      THREE.MathUtils.lerp(from.position.y, target.position.y, lower) + Math.sin(sweep * Math.PI) * target.scale * 0.16,
      THREE.MathUtils.lerp(from.position.z, target.position.z, lower) - Math.sin(sweep * Math.PI) * target.scale * 0.22,
    );
    root.rotation.set(
      THREE.MathUtils.lerp(from.pitch, target.pitch, sweep),
      0,
      THREE.MathUtils.lerp(from.roll, target.roll, sweep) + Math.sin(sweep * Math.PI) * 0.08,
    );
    root.scale.setScalar(THREE.MathUtils.lerp(from.scale, target.scale, sweep));
  }

  readonly #forward = new THREE.Vector3();
  readonly #goal = new THREE.Vector3();

  /** Slide a card along its line of sight to its target's depth: unchanged on screen, but already in its layer. */
  #holdDepth(piece: Piece): void {
    const eye = this.#camera.position;
    const forward = this.#camera.getWorldDirection(this.#forward);
    const goal = this.#goal.copy(piece.target.position).sub(eye).dot(forward);
    const ray = this.#scratch.copy(piece.root.position).sub(eye);
    const depth = ray.dot(forward);
    if (depth <= 0.001 || Math.abs(goal - depth) < 1e-5) return;
    const ratio = goal / depth;
    piece.root.position.copy(eye).addScaledVector(ray, ratio);
    piece.root.scale.multiplyScalar(ratio);
  }

  #apply(piece: Piece, t: number): void {
    const { root, target } = piece;
    root.position.lerp(target.position, t);
    root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, target.pitch, t);
    root.rotation.z = THREE.MathUtils.lerp(root.rotation.z, target.roll, t);
    root.scale.setScalar(THREE.MathUtils.lerp(root.scale.x, target.scale, t));
  }

  /** Lean the hovered hand card towards the pointer, like a card held up to the light. True while easing. */
  #tiltHand(dt: number): boolean {
    let easing = false;
    const footprint = this.#hoverFootprint;
    for (const card of this.#state?.hand ?? []) {
      const piece = this.#pieces.get(card.id);
      if (!piece || this.#flights.has(card.id) || (this.#press?.dragging && this.#press.id === card.id)) continue;
      let goal = 0;
      // A picked card sits a card's thickness from its picked neighbours, so leaning it would cut through them.
      const picked = this.#state?.selected.includes(card.id);
      if (card.id === this.#hovered && !picked && footprint && this.#pointer && !this.#reduced.matches)
        goal = THREE.MathUtils.clamp((this.#pointer.x - footprint.x) / footprint.width, -0.5, 0.5) * 0.32;
      // The lean eases in under the pointer but drops at once when the card is let go, so a card settling back
      // into the fan never swings through its neighbour.
      if (card.id !== this.#hovered) {
        piece.root.rotation.y = 0;
        continue;
      }
      const y = this.#reduced.matches ? goal : THREE.MathUtils.damp(piece.root.rotation.y, goal, 14, dt);
      piece.root.rotation.y = Math.abs(y - goal) < 0.0008 ? goal : y;
      if (piece.root.rotation.y !== goal) easing = true;
    }
    return easing;
  }

  readonly #requestFrame = (): void => {
    if (!this.#frame && !this.#disposed && !this.#contextLost) this.#frame = requestAnimationFrame(this.#draw);
  };

  readonly #draw = (now: number): void => {
    this.#frame = 0;
    if (this.#interrupt) this.#interrupt.piece.root.position.y -= this.#interrupt.lift;
    if (this.#interrupt?.shine) {
      this.#interrupt.piece.root.scale.y /= this.#interrupt.shine.stretch;
      this.#interrupt.shine.stretch = 1;
    }
    if (this.#wave) {
      for (const [piece, lift] of this.#wave.lifts) piece.root.position.y -= lift;
      this.#wave.lifts.clear();
    }
    // The first frame after the table has been still counts as one ordinary frame, not the whole pause: otherwise a
    // board that starts moving then jumps more than half its way in one step and judders.
    const since = now - this.#lastFrame;
    const dt = (since > 100 ? 1000 / 60 : Math.min(40, Math.max(1, since))) / 1000;
    this.#lastFrame = now;
    const handSlide = this.#reduced.matches ? 1 : 1 - Math.exp(-dt * 10);
    const smooth = this.#reduced.matches ? 1 : 1 - Math.exp(-dt * 22);
    const settle = this.#snapBoard ? 1 : smooth;
    this.#snapBoard = false;
    let easingBoard = false;
    const goal = this.#matGoal;
    if (goal) {
      const mat = this.#mat;
      const gap =
        Math.abs(goal.x - mat.position.x) +
        Math.abs(goal.z - mat.position.z) +
        Math.abs(goal.width - mat.scale.x) +
        Math.abs(goal.depth - mat.scale.y);
      const k = gap < 0.0005 ? 1 : settle;
      mat.position.x += (goal.x - mat.position.x) * k;
      mat.position.z += (goal.z - mat.position.z) * k;
      mat.scale.x += (goal.width - mat.scale.x) * k;
      mat.scale.y += (goal.depth - mat.scale.y) * k;
      if (k < 1) easingBoard = true;
    }
    for (const [slot, target] of this.#slotGoals) {
      const gap = slot.position.distanceTo(target.position) + Math.abs(slot.scale.x - target.scale);
      const k = gap < 0.0005 ? 1 : settle;
      slot.position.lerp(target.position, k);
      slot.scale.setScalar(slot.scale.x + (target.scale - slot.scale.x) * k);
      if (k < 1) easingBoard = true;
    }
    const light = this.#villainLight;
    const transitioning = Math.abs(light.value - this.#phaseTarget) > 0.001 && !this.#reduced.matches;
    light.value = transitioning ? THREE.MathUtils.damp(light.value, this.#phaseTarget, 3.4, dt) : this.#phaseTarget;
    let moving = transitioning || easingBoard;
    let landed: string | null = null;
    for (const [id, piece] of this.#pieces) {
      if (this.#press?.dragging && this.#press.id === id) continue;
      const deal = this.#discardDeal;
      if (piece.aura && deal?.spent.has(id)) {
        const t = this.#reduced.matches ? 1 : THREE.MathUtils.clamp((now - deal.started) / SPEND_MS, 0, 1);
        const uniforms = piece.aura.material.uniforms;
        if (uniforms.spent!.value < 0) {
          uniforms.map!.value = piece.face.material.map;
          const at = piece.root.position.clone();
          at.y += 0.1;
          this.#burst(at, 0xffb347, 14, 0.9, 2.2);
        }
        piece.root.children.forEach((child) => {
          child.visible = child === piece.aura;
        });
        // Rise a little towards the light and swell as it burns.
        const rise = easeOutCubic(t);
        piece.root.position.copy(piece.target.position);
        piece.root.position.y += rise * 0.28;
        piece.root.scale.setScalar(piece.target.scale * (1 + 0.07 * rise));
        uniforms.spent!.value = t;
        if (t === 1) {
          piece.root.visible = false;
          deal.spent.delete(id);
        } else moving = true;
        continue;
      }
      if (this.#windup?.id === id) {
        const t = THREE.MathUtils.clamp((now - this.#windup.start) / 300, 0, 1);
        const lift = Math.sin(Math.PI * t) ** 1.4;
        this.#apply(piece, 1);
        piece.root.position.y += piece.target.scale * 0.055 * lift;
        piece.root.scale.multiplyScalar(1 + 0.045 * lift);
        piece.root.rotation.x += 0.035 * lift;
        if (t < 1) {
          moving = true;
          continue;
        }
        this.#windup = null;
      }
      const strike = this.#strike;
      if (strike && (strike.source === id || strike.target === id)) {
        const raw = Math.max(0, now - strike.start);
        // Hold the contact frame for HIT_STOP_MS, then play the rest of the strike on a delayed clock.
        const ms = raw < HIT_CONTACT_MS ? raw : Math.max(HIT_CONTACT_MS, raw - HIT_STOP_MS);
        const target = this.#pieces.get(strike.target);
        if (target && raw < STRIKE_MS) {
          const recoverMs = STRIKE_MS - HIT_STOP_MS - HIT_CONTACT_MS - 65;
          const recovery = THREE.MathUtils.clamp((ms - HIT_CONTACT_MS - 65) / recoverMs, 0, 1);
          const pull = Math.min(1, ms / 140);
          const dash = THREE.MathUtils.clamp((ms - 140) / (HIT_CONTACT_MS - 140), 0, 1);
          if (strike.source === id) {
            const travel = ms < 140 ? -0.17 * pull : (-0.17 + 1.14 * dash ** 2) * (1 - recovery) ** 2;
            piece.root.position.lerpVectors(strike.origin, target.target.position, travel);
            piece.root.position.y += (0.7 * pull + Math.sin(Math.PI * dash) * 0.65) * (1 - recovery);
            piece.root.rotation.z = piece.target.roll + (0.16 * pull - 0.29 * dash) * (1 - recovery);
            // Coil a little on the wind-up, stretch into the dash.
            const stretch = 1 - 0.04 * pull * (1 - dash) + 0.07 * dash * (1 - recovery);
            piece.root.scale.setScalar(piece.target.scale * stretch);
          } else if (raw >= HIT_CONTACT_MS && !strike.dodged) {
            const age = ms - HIT_CONTACT_MS;
            const recoil = Math.sin(Math.min(1, age / 220) * Math.PI) * Math.exp(-age / 180);
            piece.root.position.lerpVectors(piece.target.position, strike.origin, -0.28 * recoil);
            piece.root.position.y += recoil * 0.42;
            piece.root.rotation.z = piece.target.roll + recoil * 0.19;
            // Squash on contact, then spring back with the recoil.
            const squash = Math.exp(-(raw - HIT_CONTACT_MS) / 70);
            piece.root.scale.setScalar(piece.target.scale * (1 - 0.08 * squash + 0.05 * recoil));
            // A white-hot frame first, then the red tint fades back to the card's own colour.
            if (raw - HIT_CONTACT_MS < HIT_STOP_MS + 20) piece.face.material.color.copy(this.#flashColor);
            else piece.face.material.color.copy(strike.color).lerp(this.#hitColor, Math.max(0, 1 - age / 330));
            if (!strike.burst) {
              strike.burst = true;
              const at = piece.root.position.clone();
              at.y += 0.25;
              this.#burst(at, 0xffa040, 18, 3.2, 2.6);
              this.#burst(at, 0xfff1c0, 8, 1.6, 1.4);
            }
          }
          moving = true;
          continue;
        }
      }
      // The hero is updated first. Follow its live face, including its lift and roll during a strike.
      const aside = this.#powerAside;
      const shielded = id === this.#power && this.#powerHost && !aside ? this.#pieces.get(this.#powerHost) : undefined;
      if (shielded) {
        // Held up over the card it protects, overlapping its edge, so it reads as standing in front of it.
        shielded.root.updateMatrixWorld();
        const lift = Math.max(0.2, this.#tokenTop(shielded) + 0.08);
        // Over a revealed card held up full size it stands off to the side, just over its edge, so the card it
        // cancels stays readable (and its flicker visible).
        const revealed = shielded.card.id === this.#revealing;
        piece.target.position
          .set(revealed ? 0.86 : 0.42, revealed ? -0.12 : 0.06, lift)
          .applyMatrix4(shielded.root.matrixWorld);
        piece.target.pitch = shielded.root.rotation.x;
        piece.target.roll = shielded.root.rotation.z - 0.06;
        piece.target.scale = shielded.root.scale.x * (revealed ? 0.66 : shielded.card.landscape ? 0.8 : 0.92);
        if (!this.#flights.has(id)) {
          this.#apply(piece, 1);
          continue;
        }
      } else if (id === this.#power && this.#state && !aside) {
        const heroPiece = this.#pieces.get(this.#state.hero.id)!;
        const hero = heroPiece.root;
        hero.updateMatrixWorld();
        // Full size on the hero, and laid over the top of any tokens on it rather than through them.
        const above = Math.max(0.032, this.#tokenTop(heroPiece) + 0.012);
        piece.target.position.set(-0.05, -0.05, above).applyMatrix4(hero.matrixWorld);
        piece.target.pitch = hero.rotation.x;
        piece.target.roll = hero.rotation.z + 0.035;
        piece.target.scale = hero.scale.x;
        if (!this.#flights.has(id)) {
          this.#apply(piece, 1);
          continue;
        }
      }
      const flight = this.#flights.get(id);
      if (this.#tucked.has(id) && (!flight || flight.kind === "equip")) continue;
      if (flight?.kind === "equip") {
        const progress = this.#reduced.matches ? 1 : THREE.MathUtils.clamp((now - flight.started) / 670, 0, 1);
        this.#equipPose(piece, flight.from, progress);
        if (progress === 1) this.#flights.delete(id);
        else moving = true;
        continue;
      }
      if (flight) {
        const { from, started, kind, liftOffset } = flight;
        const exhausting = kind === "turn" && piece.card.exhausted;
        const readying = kind === "turn" && !exhausting;
        const duration =
          kind === "flip"
            ? 340
            : kind === "turn"
              ? exhausting
                ? EXHAUST_MS
                : READY_MS
              : kind === "place"
                ? 440
                : kind === "tuck"
                  ? 720
                  : kind === "draw"
                    ? 560
                    : kind === "stash"
                      ? 540
                      : kind === "discard"
                        ? 460
                        : 310;
        const progress = this.#reduced.matches ? 1 : THREE.MathUtils.clamp((now - started) / duration, 0, 1);
        const contact = Math.min(1, progress / 0.54);
        const t = readying
          ? THREE.MathUtils.smoothstep(progress, READY_TURN_START, READY_TURN_END)
          : kind === "place"
            ? contact ** 2
            : kind === "flip" || kind === "turn"
              ? progress * progress * (3 - 2 * progress)
              : // Leave fast and glide in. The curve never overshoots, so a drawn card never shows its back.
                easeOutCubic(progress);
        piece.root.position.lerpVectors(from.position, piece.target.position, t);
        if (kind === "tuck") {
          // Drop to the table by the deck, then slide in flat: it passes under its enemy's edge, never over it.
          const { drop, across } = tuckPath(progress);
          piece.root.position.lerpVectors(from.position, piece.target.position, across);
          piece.root.position.y = THREE.MathUtils.lerp(from.position.y, piece.target.position.y, drop);
        } else if (kind === "place") {
          const settle = Math.max(0, (progress - 0.54) / 0.46);
          piece.root.position.y += Math.sin(Math.PI * settle) * (1 - settle) * 0.24;
          piece.rim.visible = settle > 0 && settle < 0.74;
        } else if (readying) {
          const rise = THREE.MathUtils.smoothstep(progress, 0, READY_TURN_START);
          const descent = THREE.MathUtils.smoothstep(progress, READY_TURN_END, 1);
          piece.root.position.y += (rise - descent) * (Math.max(0.58, piece.target.scale * 0.5) + liftOffset);
        } else piece.root.position.y += Math.sin(Math.PI * progress) * (kind === "discard" ? 0.95 : 0.46);
        // Turned facedown on the way into a deck or under a card.
        if (kind === "stash") piece.root.rotation.y = Math.PI * THREE.MathUtils.smoothstep(progress, 0.08, 0.7);
        if (kind === "draw") {
          const fromDeck =
            this.#state?.hand.some((card) => card.id === id) || this.#deckReveal.some((card) => card.id === id);
          // Turn face-up over the first 60% of the flight, as before the ease-out curve.
          const turn = fromDeck ? THREE.MathUtils.smoothstep(progress, 0, 0.6) : t;
          piece.root.rotation.y = Math.PI * (1 - turn);
          if (fromDeck) {
            // The usual glide, then a 1% carry past its place in the direction it flew, and back.
            const fly =
              THREE.MathUtils.smoothstep(progress, 0.2, 0.9) +
              Math.sin(Math.PI * THREE.MathUtils.clamp((progress - 0.82) / 0.18, 0, 1)) * 0.01;
            piece.root.position.lerpVectors(from.position, piece.target.position, fly);
            piece.root.position.y += Math.sin(progress * Math.PI) * 1.55;
          }
        }
        piece.root.rotation.x = THREE.MathUtils.lerp(from.pitch, piece.target.pitch, t);
        piece.root.rotation.z = THREE.MathUtils.lerp(from.roll, piece.target.roll, exhausting ? progress ** 2 : t);
        piece.root.scale.setScalar(THREE.MathUtils.lerp(from.scale, piece.target.scale, t));
        if (!this.#reduced.matches) {
          if (kind === "play" || kind === "return" || kind === "discard") {
            // Swing into the direction of travel, levelling out as the card arrives.
            const lean = THREE.MathUtils.clamp((piece.target.position.x - from.position.x) * -0.045, -0.16, 0.16);
            piece.root.rotation.z += Math.sin(Math.PI * progress) * (1 - progress) * lean * 1.6;
          }
          if (kind === "play" || kind === "draw") {
            // A small pop as the card settles.
            const settle = THREE.MathUtils.clamp((progress - 0.7) / 0.3, 0, 1);
            piece.root.scale.multiplyScalar(1 + Math.sin(Math.PI * settle) * 0.045);
          }
          if (kind === "place") {
            const settle = Math.max(0, (progress - 0.54) / 0.46);
            piece.root.scale.multiplyScalar(1 - Math.sin(Math.PI * Math.min(1, settle * 2.2)) * 0.05 * (1 - settle));
            if (settle > 0 && !flight.puffed) {
              flight.puffed = true;
              const at = piece.target.position.clone();
              at.y += 0.05;
              this.#burst(at, 0xd9e4ff, 12, 1.9, 0.5);
            }
          }
        }
        if (kind === "flip") {
          piece.root.position.y += Math.sin(Math.PI * t) * piece.root.scale.x * 0.65;
          piece.root.rotation.y = 0;
          piece.root.rotateY(Math.PI * (0.5 - 0.5 * Math.cos(Math.PI * t)));
        }
        if (progress === 1) {
          if (kind === "flip") {
            piece.face.material.map = this.#texture(piece.card.art);
            piece.back.material.map = this.#texture(piece.card.reverseArt ?? CARD_BACKS.encounter.url);
            piece.root.rotation.set(piece.target.pitch, 0, piece.target.roll);
          }
          this.#flights.delete(id);
          if (kind === "discard" && piece.card.type === "side_scheme") this.#layout();
          if (kind === "play") landed = id;
          if (kind === "discard" && this.#discardDeal?.ids.includes(id)) {
            this.#discardDeal.landed++;
            this.#handlers.onDiscardLanded?.((this.#state?.discard.length ?? 0) + this.#discardDeal.landed);
          }
        } else moving = true;
      } else {
        const inHand = !!this.#state?.hand.some((card) => card.id === id);
        // A hand card that rises in front of a picked neighbour would pass through it on the way. Jump it straight
        // to its new depth instead, sliding along its line of sight so it looks no different, and animate only
        // where it sits on screen; then no two hand cards can ever cut through each other.
        if (inHand) this.#holdDepth(piece);
        const delta =
          piece.root.position.distanceToSquared(piece.target.position) +
          Math.abs(piece.root.scale.x - piece.target.scale) +
          Math.abs(piece.root.rotation.z - piece.target.roll) +
          Math.abs(piece.root.rotation.x - piece.target.pitch);
        if (delta > 0.00025 && smooth < 1) moving = true;
        const shifting = inHand && Math.abs(piece.target.position.x - piece.root.position.x) > 0.0005;
        this.#apply(piece, delta > 0.00025 ? (shifting ? handSlide : smooth) : 1);
        if (this.#underIds.has(id)) piece.root.rotation.y = Math.PI;
      }
    }
    // Use the host's rendered pose, including the lift and roll between animation frames.
    for (const [id, { host, depth }] of this.#tucked) {
      const parent = this.#pieces.get(host)?.root;
      const piece = this.#pieces.get(id);
      if (!parent || !piece) continue;
      const flight = this.#flights.get(id);
      if (flight && flight.kind !== "equip") continue;
      // A hovered card under it slides out to the left a little on the mat, so more of it shows; it is not picked up.
      const fanGoal = this.#hovered === id && !flight ? 1 : 0;
      const fanNow = this.#fan.get(id) ?? 0;
      const fan = this.#reduced.matches
        ? fanGoal
        : Math.abs(fanGoal - fanNow) < 0.004
          ? fanGoal
          : fanNow + (fanGoal - fanNow) * Math.min(1, dt * 14);
      if (fan) this.#fan.set(id, fan);
      else this.#fan.delete(id);
      if (fan !== fanGoal) moving = true;
      // A hovered host rises on its own: what is attached to it stays down on the mat where it was laid out.
      if (this.#hovered === host && !flight) {
        if (piece.root.position.distanceToSquared(piece.target.position) > 1e-8) {
          this.#apply(piece, this.#reduced.matches ? 1 : Math.min(1, dt * 14));
          moving = true;
        }
        continue;
      }
      parent.updateMatrixWorld();
      piece.target.position
        .set(-TAB * depth - ATTACHMENT_FAN * fan, 0, -0.006 * depth)
        .applyMatrix4(parent.matrixWorld);
      piece.target.scale = parent.scale.x;
      piece.target.pitch = parent.rotation.x;
      piece.target.roll = parent.rotation.z;
      if (flight) {
        const t = this.#reduced.matches ? 1 : Math.min(1, (now - flight.started) / 670);
        this.#equipPose(piece, flight.from, t);
        if (t === 1) this.#flights.delete(id);
        else moving = true;
      } else {
        piece.root.position.copy(piece.target.position);
        piece.root.quaternion.copy(parent.quaternion);
        piece.root.scale.copy(parent.scale);
      }
    }
    if (this.#strike && now - this.#strike.start >= STRIKE_MS) {
      this.#pieces.get(this.#strike.target)?.face.material.color.copy(this.#strike.color);
      this.#strike = null;
    }
    const actor = this.#actor && this.#pieces.get(this.#actor);
    if (actor) {
      actor.rim.visible = true;
      actor.rim.scale.set(1.022, 1.016, 1);
    }
    for (const [chip, start] of this.#liftedTokens) {
      const t = this.#reduced.matches ? 1 : Math.min(1, (now - start) / 280);
      chip.position.z = 0.055 + 0.7 * t * t;
      chip.scale.setScalar(1 - t * t);
      if (t === 1) {
        chip.removeFromParent();
        this.#liftedTokens.delete(chip);
      } else moving = true;
    }
    if (this.#deflection) {
      const { token, start } = this.#deflection;
      const t = Math.min(1, Math.max(0, (now - start) / 900));
      const fall = Math.min(1, t / 0.46);
      const rebound = Math.max(0, (t - 0.46) / 0.54);
      this.#sheenMaterial.uniforms.sweep!.value = -0.4 + Math.min(1, t / 0.58) * 2.3;
      if (this.#reduced.matches) {
        token.position.set(0, 0.08, 0.09);
        this.#sheen.visible = false;
      } else {
        this.#sheen.visible = true;
        // Bursts out of the card where the blow lands, then the Backflip knocks it away.
        token.position.set(
          1.14 * rebound,
          0.08 + 0.45 * rebound,
          0.075 + 0.32 * Math.sin(Math.PI * fall) + 0.75 * Math.sin(Math.PI * rebound),
        );
        token.rotation.z = -0.15 * (1 - fall) + rebound * 0.72;
        token.scale.setScalar(
          THREE.MathUtils.smoothstep(fall, 0, 0.45) * 1.15 * (1 - THREE.MathUtils.smoothstep(rebound, 0.68, 1)),
        );
      }
      if (t === 1) {
        token.removeFromParent();
        this.#sheen.removeFromParent();
        this.#deflection = null;
      } else moving = true;
    }
    for (const [chip, start] of this.#drops) {
      const t = this.#reduced.matches ? 1 : THREE.MathUtils.clamp((now - start) / 460, 0, 1);
      const height = t < 0.7 ? 0.9 * (1 - (t / 0.7) ** 2) : 0.12 * Math.sin((Math.PI * (t - 0.7)) / 0.3);
      // Every token is a group around one piece: the piece falls and bounces, the group stays where it was laid.
      chip.children[0]!.position.z = height;
      if (t === 1) this.#drops.delete(chip);
      else moving = true;
    }
    if (this.#state) {
      for (const [id, piece] of this.#pieces) {
        const onEnemy = !!piece.card.attachedTo && this.#state.enemyCards.some((c) => c.id === id);
        if (piece.card.type !== "upgrade" && piece.card.type !== "attachment" && !onEnemy) continue;
        // Slid out while hovered, it shows whole: the part still under its host stays hidden behind it.
        const tucked =
          this.#tucked.has(id) && !this.#flights.has(id) && this.#state.staged?.id !== id && !this.#fan.has(id);
        // Upgrades and attachments both print their title down the left edge: that strip is what shows when tucked.
        const geometry = tucked ? this.#tab : piece.card.landscape ? this.#landscapeFace : this.#face;
        piece.face.geometry = geometry;
        piece.root.children[0]!.visible = !tucked;
        piece.back.visible = !tucked;
        piece.rim.geometry = geometry;
      }
    }
    if (this.#interrupt) {
      const pulse = this.#interrupt;
      const length = pulse.shine ? SHINE_MS : pulse.activation ? ACTIVATION_MS : INTERRUPT_MS;
      const t = THREE.MathUtils.clamp((now - pulse.start) / length, 0, 1);
      const rise = pulse.activation
        ? THREE.MathUtils.smoothstep(t, 0, 0.3) - THREE.MathUtils.smoothstep(t, 0.68, 1)
        : Math.sin(Math.PI * t) ** 2;
      // A revealed card already held up full size near the camera rises only a little, or it would leave the screen.
      const rises = pulse.activation ? (pulse.piece.card.id === this.#revealing ? 0.18 : 0.9) : 0.12;
      pulse.lift = this.#reduced.matches || pulse.shine ? 0 : pulse.piece.root.scale.x * rises * rise;
      if (pulse.shine && !this.#reduced.matches) {
        // Up a touch along its length and back, easing out, as the light crosses it.
        pulse.shine.stretch = 1 + 0.05 * Math.sin(Math.PI * THREE.MathUtils.smoothstep(t, 0, 0.75));
        pulse.piece.root.scale.y *= pulse.shine.stretch;
        if (!pulse.shine.flashed && t >= 0.4) {
          pulse.shine.flashed = true;
          this.#burst(pulse.piece.root.position.clone(), 0xfff3d0, 10, 0.8, 0.9);
        }
      }
      pulse.piece.root.position.y += pulse.lift;
      if (pulse.activation && !pulse.activation.flashed && t >= 0.3) {
        pulse.activation.flashed = true;
        const at = pulse.piece.root.position.clone();
        this.#burst(at, 0xffffff, 22, 1.5, 1.2);
        this.#burst(at, 0xffe9a8, 12, 0.9, 1.8);
      }
      this.#interruptPuff.material.uniforms.progress!.value = t;
      this.#interruptSheen.material.uniforms.sweep!.value = -0.25 + 2 * t;
      if (t === 1) {
        this.#interruptPuff.removeFromParent();
        this.#interruptSheen.removeFromParent();
        this.#interrupt = null;
      } else moving = true;
    }
    if (this.#vapours.length && this.#evaporateStep(now)) moving = true;
    if (this.#flicker) {
      const age = now - this.#flicker.start;
      // Out and back four times, the gaps shortening, then it stays.
      const done = age >= FLICKER_MS;
      this.#flicker.piece.root.visible = done || Math.floor((age / FLICKER_MS) ** 0.8 * 8) % 2 === 0;
      if (done) this.#flicker = null;
      else moving = true;
    }
    if (this.#wave && now - this.#wave.start >= 380 + (this.#state?.hand.length ?? 0) * 65) this.#wave = null;
    if (this.#wave) {
      const wave = this.#wave;
      const elapsed = now - wave.start;
      const hand = this.#state?.hand ?? [];
      hand.forEach((card, i) => {
        const piece = this.#pieces.get(card.id);
        if (!piece || this.#flights.has(card.id)) return;
        const t = THREE.MathUtils.clamp((elapsed - i * 65) / 380, 0, 1);
        const lift = piece.root.scale.x * 0.14 * Math.sin(Math.PI * t);
        if (lift <= 0) return;
        piece.root.position.y += lift;
        wave.lifts.set(piece, lift);
      });
      moving = true;
    }
    for (let i = this.#sparks.length - 1; i >= 0; i--) {
      const spark = this.#sparks[i]!;
      const age = now - spark.born;
      if (age >= spark.life || this.#reduced.matches) {
        spark.sprite.removeFromParent();
        spark.sprite.material.dispose();
        this.#sparks.splice(i, 1);
        continue;
      }
      if (!spark.drifts) spark.velocity.y -= 9 * dt;
      spark.velocity.multiplyScalar(1 - (spark.drifts ? 1.3 : 2.4) * dt);
      spark.sprite.position.addScaledVector(spark.velocity, dt);
      const fade = 1 - age / spark.life;
      spark.sprite.material.opacity = fade;
      spark.sprite.scale.setScalar(spark.size * (0.4 + 0.6 * fade));
      moving = true;
    }
    if (this.#tiltHand(dt)) moving = true;
    this.#render();
    this.#handlers.onDraw?.();
    if (moving) this.#requestFrame();
    if (landed) this.#handlers.onLanded(landed);
    if (this.#discardDeal && !this.#discardDeal.spent.size && this.#discardDeal.landed === this.#discardDeal.ids.length)
      this.#finishDiscards();
  };

  /** Every object put on the front layer last frame, so each frame starts from none (the sheen moves between cards). */
  readonly #onFront = new Set<THREE.Object3D>();
  /** The cards drawn on top last frame (`#frontCards`): the pointer finds them first, as the player sees them. */
  #frontIds = new Set<string>();
  /** The same, less cards only settling back after being let go, which must not catch the pointer again. */
  #frontPick = new Set<string>();

  /**
   * The cards the player must see whole: a revealed card held up to be read (and the card cancelling it, standing over
   * its edge), cards turned up off a deck, and the hand card under the pointer. In 3D a card resting or flying nearer
   * the camera can cut through them (Enhanced Spider-Sense paid for beside the hero went into Shadow of the Past; the
   * rightmost hand card cut through its hovered neighbour; Adam, 2026-11-21), so they are drawn over everything else.
   */
  #frontCards(): Set<THREE.Object3D> {
    const roots = new Set<THREE.Object3D>();
    const state = this.#state;
    if (!state) {
      this.#frontIds.clear();
      this.#frontPick.clear();
      return roots;
    }
    const ids = new Set<string>();
    const add = (id: string | null | undefined) => {
      if (id && this.#pieces.has(id)) ids.add(id);
    };
    add(this.#revealing);
    for (const card of this.#deckReveal) add(card.id);
    if (this.#power && this.#powerHost && !this.#powerAside && this.#powerHost === this.#revealing) add(this.#power);
    // A picked hand card keeps its own layer among the picked (see the hand layout), hovered or not.
    const held = this.#press?.dragging ? this.#press.id : this.#hovered;
    if (held && state.hand.some((card) => card.id === held) && !state.selected.includes(held)) add(held);
    this.#frontPick = new Set(ids);
    // A card let go stays in front until it is back in its place, so it never cuts through a neighbour on the way.
    for (const id of this.#frontIds) {
      const piece = this.#pieces.get(id);
      if (!ids.has(id) && piece && piece.root.position.distanceTo(piece.target.position) > piece.target.scale * 0.01)
        ids.add(id);
    }
    this.#frontIds = ids;
    for (const id of ids) roots.add(this.#pieces.get(id)!.root);
    return roots;
  }

  /**
   * Draw the table, then the front cards over it: the table pass leaves out their see-through parts (sheen, glow) so
   * nothing is drawn twice, the depth is cleared, and the front pass draws them whole, lit the same, with the shadows
   * the table pass already cast.
   */
  #render(): void {
    for (const object of this.#onFront) object.layers.disable(FRONT_LAYER);
    this.#onFront.clear();
    const front = this.#frontCards();
    const camera = this.#camera;
    if (!front.size) {
      camera.layers.enableAll();
      this.#renderer.render(this.#scene, camera);
      return;
    }
    const hidden: THREE.Object3D[] = [];
    for (const root of front)
      root.traverse((object) => {
        object.layers.enable(FRONT_LAYER);
        this.#onFront.add(object);
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (object.visible && material && !Array.isArray(material) && material.transparent) {
          object.visible = false;
          hidden.push(object);
        }
      });
    camera.layers.set(0);
    this.#renderer.render(this.#scene, camera);
    for (const object of hidden) object.visible = true;
    const renderer = this.#renderer;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.clearDepth();
    camera.layers.set(FRONT_LAYER);
    // A colour background always clears the picture first, whatever autoClear says: leave it out of the front pass.
    const background = this.#scene.background;
    this.#scene.background = null;
    renderer.render(this.#scene, camera);
    this.#scene.background = background;
    renderer.shadowMap.autoUpdate = true;
    renderer.autoClear = true;
    camera.layers.enableAll();
  }

  #finishDiscards(): void {
    const deal = this.#discardDeal;
    if (!deal) return;
    this.#discardDeal = null;
    for (const id of deal.ids) this.#flights.delete(id);
    const state = this.#state;
    if (state) {
      // Effect and attack animations can run before the next engine snapshot reaches the table.
      // Their layouts must already see the paid cards in the pile.
      const landed = deal.ids.map((id) => this.#pieces.get(id)!.card);
      this.setCards({
        ...state,
        hand: state.hand.filter((card) => !card.resourceAbility && !deal.ids.includes(card.id)),
        discard: [...state.discard, ...landed],
        selected: [],
      });
    }
    deal.done();
  }

  cardAt(event: PointerEvent): string | null {
    return this.#hit(event);
  }

  #hit(event: PointerEvent): string | null {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    this.#ndc.set(
      (2 * (event.clientX - rect.left)) / rect.width - 1,
      1 - (2 * (event.clientY - rect.top)) / rect.height,
    );
    this.#ray.setFromCamera(this.#ndc, this.#camera);
    let nearest = Infinity;
    let id: string | null = null;
    // A card drawn on top of the rest (#render) is what the pointer is over, even where another is nearer in depth.
    let front: { id: string; distance: number } | null = null;
    let underZoom: { id: string; distance: number } | null = null;
    const handIds = new Set(this.#state?.hand.map((card) => card.id));
    for (const piece of this.#pieces.values()) {
      if (this.#state?.defending && !this.#state.targets.includes(piece.card.id)) continue;
      if (this.#state?.paymentSources && !this.#state.paymentSources.includes(piece.card.id)) continue;
      if (this.#state?.discardOpen && !this.#viewedPile(this.#state).some((card) => card.id === piece.card.id))
        continue;
      const [hit] = this.#ray.intersectObjects(piece.card.reverseArt ? [piece.face, piece.back] : [piece.face], false);
      if (hit && piece.card.id !== this.#zoom?.id && handIds.has(piece.card.id))
        if (!underZoom || hit.distance < underZoom.distance) underZoom = { id: piece.card.id, distance: hit.distance };
      if (hit && hit.distance < nearest) {
        nearest = hit.distance;
        id = piece.card.id;
      }
      if (hit && this.#frontPick.has(piece.card.id) && (!front || hit.distance < front.distance))
        front = { id: piece.card.id, distance: hit.distance };
    }
    if (front) id = front.id;
    // Over the hand, the full-size card gives way to the hand card under the pointer, so the hand can be swept.
    if (id && id === this.#zoom?.id && underZoom && event.clientY - rect.top - this.#extension > this.#zoom.handTop)
      return underZoom.id;
    // The bottom edge rises away from the pointer. Keep its resting footprint active until the user leaves it.
    const footprint = this.#hoverFootprint;
    if (
      !id &&
      footprint &&
      Math.abs(event.clientX - rect.left - footprint.x) < footprint.width / 2 &&
      Math.abs(event.clientY - rect.top - this.#extension - footprint.y) < footprint.width * 0.72
    )
      return this.#hovered;
    return id;
  }

  #notifyHover(id: string | null): void {
    this.#renderer.domElement.style.cursor = id ? "var(--cursor-hand)" : "var(--cursor-arrow)";
    // The table sometimes marks a card hovered by itself (the card whose menu is open), so the handler is told about
    // every change from what it last heard, not from what the table shows.
    if (this.#hovered !== id) this.setHovered(id);
    if (this.#reported === id) return;
    this.#reported = id;
    this.#handlers.onHover(id);
  }

  readonly #move = (event: PointerEvent): void => {
    if (this.#discardDeal) return;
    const press = this.#press;
    if (!press) {
      if (event.pointerType !== "touch") {
        const rect = this.#renderer.domElement.getBoundingClientRect();
        this.#pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top - this.#extension };
        this.#notifyHover(this.#hit(event));
        if (this.#hovered && this.#state?.hand.some((card) => card.id === this.#hovered)) this.#requestFrame();
      }
      return;
    }
    if (
      event.pointerId !== press.pointer ||
      this.#state?.staged ||
      !this.#state?.hand.some((card) => card.id === press.id)
    )
      return;
    if (!press.dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 9) return;
    const piece = this.#pieces.get(press.id);
    if (!piece) return;
    press.dragging = true;
    if (piece.card.playable === false && !this.#state?.paymentSources) return;
    const rect = this.#renderer.domElement.getBoundingClientRect();
    piece.root.position.copy(this.#point(event.clientX - rect.left, event.clientY - rect.top - this.#extension, 1.9));
    piece.root.rotation.set(this.#camera.rotation.x, 0, 0);
    this.#renderer.domElement.style.cursor = "var(--cursor-held)";
    this.#requestFrame();
  };

  readonly #down = (event: PointerEvent): void => {
    // A touch has no hover, so don't let an old mouse position aim the hand tilt.
    if (event.pointerType === "touch") this.#pointer = null;
    if (event.button !== 0 || !event.isPrimary || this.#press || this.#discardDeal) return;
    const id = this.#hit(event);
    if (!id) {
      if (this.#state?.discardOpen) this.#handlers.onDismissDiscard();
      return;
    }
    this.#notifyHover(id);
    this.#press = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    this.#renderer.domElement.setPointerCapture(event.pointerId);
  };

  readonly #up = (event: PointerEvent): void => {
    const press = this.#press;
    if (!press || press.pointer !== event.pointerId) return;
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const playArea =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY < rect.top + this.#extension + this.#height * 0.68;
    const activate = press.dragging
      ? playArea
      : Math.hypot(event.clientX - press.x, event.clientY - press.y) < 9 || this.#hit(event) === press.id;
    this.#abort(event);
    if (activate) this.#handlers.onPick(press.id);
    if (event.pointerType === "touch") this.#notifyHover(null);
  };

  readonly #abort = (event: PointerEvent): void => {
    if (this.#press?.pointer !== event.pointerId) return;
    this.#press = null;
    const canvas = this.#renderer.domElement;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = this.#hovered ? "var(--cursor-hand)" : "var(--cursor-arrow)";
    this.#layout();
    this.#requestFrame();
  };

  readonly #leave = (): void => {
    this.#pointer = null;
    if (!this.#press) this.#notifyHover(null);
  };
  readonly #loseContext = (event: Event): void => {
    event.preventDefault();
    this.#contextLost = true;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#finishDiscards();
    for (const vapour of this.#vapours.splice(0)) this.#releaseVapour(vapour);
  };
  readonly #restoreContext = (): void => {
    this.#contextLost = false;
    this.#requestFrame();
  };

  dispose(): void {
    this.#disposed = true;
    for (const vapour of this.#vapours.splice(0)) this.#releaseVapour(vapour);
    for (const material of this.#dimMaterials.values()) material.dispose();
    for (const spark of this.#sparks) spark.sprite.material.dispose();
    this.#sparks.length = 0;
    this.#sparkMap.dispose();
    this.#observer.disconnect();
    cancelAnimationFrame(this.#frame);
    const canvas = this.#renderer.domElement;
    canvas.removeEventListener("pointermove", this.#move);
    canvas.removeEventListener("pointerdown", this.#down);
    canvas.removeEventListener("pointerup", this.#up);
    canvas.removeEventListener("pointercancel", this.#abort);
    canvas.removeEventListener("pointerleave", this.#leave);
    canvas.removeEventListener("webglcontextlost", this.#loseContext);
    canvas.removeEventListener("webglcontextrestored", this.#restoreContext);
    const geometries = new Set<THREE.BufferGeometry>([
      this.#auraPlane,
      this.#interruptPuff.geometry,
      this.#tab,
      this.#face,
      this.#stock,
      this.#landscapeFace,
      this.#landscapeStock,
    ]);
    const materials = new Set<THREE.Material>([
      this.#sheenMaterial,
      this.#interruptSheen.material,
      this.#interruptPuff.material,
      this.#actionShadow.material,
      this.#stockMaterial,
      this.#glow,
    ]);
    this.#scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        materials.add(object.material);
        if (object.material.map instanceof THREE.CanvasTexture) object.material.map.dispose();
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    this.#kit.dispose();
    materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#renderer.dispose();
    canvas.remove();
  }
}
