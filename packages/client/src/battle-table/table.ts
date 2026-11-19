import * as THREE from "three";
import { CARD_BACKS } from "../art/art-source.js";
import { cardRadius } from "../art/card-shape.js";
import rooftop from "../art/tabletop/rooftop.webp?url";
import { TokenKit, placeTokens } from "./tokens3d.js";

export interface TableCard {
  readonly attachedTo?: string | null;
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
  readonly selected: readonly string[];
  readonly defending: boolean;
  readonly menuCard: string | null;
  readonly paymentSources: readonly string[] | null;
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
  kind: "play" | "return" | "discard" | "draw" | "place" | "equip" | "flip" | "turn";
  /** Set once the landing puff for this flight has been thrown. */
  puffed?: boolean;
}

interface Spark {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  born: number;
  life: number;
  size: number;
}

export const INTERRUPT_MS = 440;
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
const TAB = 0.18;

// Keep the original scan coordinates so the printed title stays on the exposed edge.
function upgradeTab(topTitle = false) {
  const geo = new THREE.ShapeGeometry(roundedRect(TAB, HEIGHT, 0.025), 8);
  geo.translate((TAB - 1) / 2, 0, 0);
  const { position, uv } = geo.attributes;
  for (let i = 0; i < position!.count; i++) {
    const x = position!.getX(i) + 0.5;
    const y = position!.getY(i) / HEIGHT + 0.5;
    uv!.setXY(i, topTitle ? y : x, topTitle ? 1 - x / HEIGHT : y);
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
  readonly #pieces = new Map<string, Piece>();
  readonly #textures = new Map<string, THREE.Texture>();
  readonly #loader = new THREE.TextureLoader();
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
  readonly #attachmentTab = upgradeTab(true);
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
  #hoverFootprint: { x: number; y: number; width: number } | null = null;
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

  strike(source: string | null, target: string): void {
    const piece = source && this.#pieces.get(source);
    if (!source || source === target || !piece || !this.#pieces.has(target) || this.#reduced.matches) return;
    this.#strike = {
      source,
      target,
      start: performance.now(),
      origin: piece.root.position.clone(),
      color: this.#pieces.get(target)!.face.material.color.clone(),
    };
    this.#requestFrame();
  }

  #frame = 0;
  #lastFrame = 0;
  #paymentEdge = 0;
  get paymentEdge(): number {
    return this.#paymentEdge + this.#extension;
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
    this.#scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x364351, 1.9));
    const light = new THREE.DirectionalLight(0xfff2dd, 2.05);
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

  setCards(state: TableCards): void {
    const previous = this.#state?.staged?.id;
    if (this.#state?.discardOpen !== state.discardOpen) this.#hovered = null;
    const previousHand = this.#state?.hand;
    const newDraw = this.#state?.drawn !== state.drawn;
    if (this.#power !== state.staged?.id) {
      this.#power = null;
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
    ];
    for (const card of this.#encounters.values()) if (!cards.some((c) => c.id === card.id)) cards.push(card);
    if (state.staged) cards.push(state.staged);
    const live = new Set(cards.map((card) => card.id));
    for (const [id, piece] of this.#pieces) {
      if (live.has(id)) continue;
      this.#scene.remove(piece.root);
      for (const token of piece.tokens.children) this.#drops.delete(token as THREE.Group);
      if (piece.card.reverseArt || piece.card.type === "villain") piece.back.material.dispose();
      piece.aura?.material.dispose();
      piece.face.material.dispose();
      this.#pieces.delete(id);
      this.#flights.delete(id);
    }
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
      piece.rim.visible = state.selected.includes(card.id) || state.targets.includes(card.id);
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
    for (const id of fresh) this.#apply(this.#pieces.get(id)!, 1);
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

  showDraw(hand: readonly TableCard[], drawn: string[], deckCount: number, discard: readonly TableCard[]): void {
    if (this.#state) this.setCards({ ...this.#state, hand, drawn, deckCount, discard, selected: [] });
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

  #lightCards(state: TableCards): void {
    this.#cloth.color.setHex(state.paymentSources ? 0x3d444e : 0xffffff);
    this.#deckBack.material.color.setHex(state.paymentSources ? 0x51545b : 0xffffff);
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
  #interrupt: { piece: Piece; start: number; lift: number } | null = null;

  pulseInterrupt(id: string): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    if (this.#interrupt) this.#interrupt.piece.root.position.y -= this.#interrupt.lift;
    this.#interruptSheen.geometry = piece.face.geometry;
    this.#interruptSheen.position.z = 0.028;
    piece.root.add(this.#interruptSheen);
    if (!this.#reduced.matches) {
      this.#interruptPuff.position.z = 0.035;
      this.#interruptPuff.material.uniforms.progress!.value = 0;
      piece.root.add(this.#interruptPuff);
    }
    this.#interrupt = { piece, start: performance.now(), lift: 0 };
    this.#requestFrame();
  }

  #deflection: { token: THREE.Group; start: number } | null = null;

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

  channelEvent(id: string): void {
    if (!this.#pieces.has(id)) return;
    this.#power = id;
    const hero = this.#state && this.#pieces.get(this.#state.hero.id);
    if (hero) {
      // Project the shadow onto the receiving face, with a small offset beyond the action card's edge.
      this.#actionShadow.position.set(-0.061, -0.08, 0.023);
      this.#actionShadow.scale.setScalar(0.87);
      this.#actionShadow.rotation.z = 0.035;
      hero.root.add(this.#actionShadow);
    }
    this.#layout();
    this.#startFlight(id, "place");
    this.#requestFrame();
  }

  dealEncounter(id: string): void {
    if (!this.#state || this.#encounters.has(id)) return;
    this.#encounters.set(id, {
      id,
      name: "Encounter card",
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
    this.#startFlight(id, "place");
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

  retireEncounter(id: string, discarded?: TableCard): void {
    const piece = this.#pieces.get(id);
    if (!piece || !this.#encounters.delete(id)) return;
    if (this.#revealing === id) this.#revealing = null;
    this.markActor(null);
    if (!discarded || !this.#state) return;
    this.setCards({
      ...this.#state,
      encounterDiscard: [...this.#state.encounterDiscard.filter((c) => c.id !== id), discarded],
    });
    this.#startFlight(id, "place");
    this.#requestFrame();
  }

  discardDefeatedCard(id: string, discarded: TableCard | undefined, pile: "discard" | "encounterDiscard"): void {
    const state = this.#state;
    if (!state || !this.#pieces.has(id)) return;
    const stillInPlay = (card: TableCard) => card.id !== id && card.attachedTo !== id;
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
    this.#encounters.delete(card.id);
    this.#revealing = null;
    this.setCards({ ...this.#state, enemyCards: [...this.#state.enemyCards.filter((c) => c.id !== card.id), card] });
    this.#startFlight(card.id, card.attachedTo ? "equip" : "place");
  }

  reconcileEncounters(retain: readonly string[]): void {
    for (const id of this.#encounters.keys()) if (!retain.includes(id)) this.#encounters.delete(id);
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
  }

  setThreat(id: string, total: number): void {
    const group = this.#pieces.get(id)?.tokens;
    if (!group) return;
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
      texture = this.#loader.load(url, this.#requestFrame);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, this.#renderer.capabilities.getMaxAnisotropy());
      this.#textures.set(url, texture);
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

  foregroundCardClips(): string[] {
    if (!this.#state) return [];
    const ids = new Set(this.#state.hand.map((card) => card.id));
    if (this.#flights.get(this.#state.hero.id)?.kind === "flip") ids.add(this.#state.hero.id);
    if (this.#flights.get(this.#state.villain.id)?.kind === "flip") ids.add(this.#state.villain.id);
    if (this.#revealing) ids.add(this.#revealing);
    if (this.#state.staged) ids.add(this.#state.staged.id);
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

  #fitMat(farthestCardEdge?: number): void {
    const far = this.#point(this.#width / 2, this.#height * 0.045, 0);
    const near = this.#point(this.#width * 0.985, this.#height * 0.98, 0);
    const extend = farthestCardEdge !== undefined && farthestCardEdge < far.z;
    if (extend) far.z = farthestCardEdge;
    this.#mat.position.z = (near.z + far.z) / 2;
    this.#mat.scale.set(near.x * 2, near.z - far.z, 1);
    const top = (1 - far.project(this.#camera).y) * this.#canvasHeight * 0.5 - this.#extension;
    const extension = extend ? Math.max(0, Math.ceil(this.#height * 0.045 - top)) : 0;
    if (extension !== this.#extension) {
      const grew = extension > this.#extension;
      this.#extension = extension;
      this.#viewport.style.setProperty("--mat-extension", `${extension}px`);
      this.#viewport.toggleAttribute("data-extended", extension > 0);
      this.#viewport.tabIndex = extension > 0 ? 0 : -1;
      this.#resizeCanvas();
      // The mat grows upward for extra schemes; keep the view on the hand and the hero, scrolled to the bottom.
      if (grew)
        requestAnimationFrame(() => {
          this.#viewport.scrollTop = this.#viewport.scrollHeight;
        });
    }
  }

  readonly #resize = (): void => {
    this.#width = Math.max(1, this.#viewport.clientWidth);
    this.#height = Math.max(1, this.#viewport.clientHeight);
    this.#resizeCanvas();
    if (!this.#state) this.#fitMat();
    this.#layout();
    for (const [id, piece] of this.#pieces) {
      if (!this.#flights.has(id)) this.#apply(piece, 1);
    }
    this.#requestFrame();
  };

  #pose(id: string, x: number, y: number, width: number, elevation: number, pitch: number, roll = 0): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    const center = this.#point(x, y, elevation);
    const widthPoint = this.#point(x + width, y, elevation);
    piece.target = { position: center, scale: widthPoint.x - center.x, pitch, roll };
  }

  #tablePose(id: string, x: number, y: number, width: number, elevation: number, pitch: number): void {
    const hovered = this.#hovered === id;
    if ((hovered || this.#state?.selected.includes(id)) && !this.#flights.has(id)) {
      if (hovered) this.#hoverFootprint = { x, y, width };
      this.#pose(id, x, y - width * 0.09, width * 1.065, elevation + 0.35, pitch + 0.07);
    } else {
      this.#pose(id, x, y, width, elevation, pitch);
    }
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
    const placeEncounterPile = (slot: THREE.Group, y: number) => {
      slot.position.copy(this.#point(pileX, y, 0.025));
      const width = this.#point(pileX + encounterWidth, y, 0.025).x - slot.position.x;
      slot.scale.setScalar(width);
      // Align the piles on the table itself, accounting for the camera perspective.
      slot.position.x = base.x;
    };
    placeEncounterPile(this.#encounterSlot, h * 0.23);
    this.#hoverFootprint = null;
    this.#tucked.clear();
    const enemies = state.enemyCards.filter((c) => !c.attachedTo);
    const poseEnemy = (host: TableCard, x: number, y: number, width: number) => {
      const attachments = state.enemyCards.filter((c) => c.attachedTo === host.id);
      attachments.forEach((card, i) => {
        this.#tucked.set(card.id, { host: host.id, depth: attachments.length - i });
        this.#pose(card.id, x - width * TAB * (attachments.length - i), y, width, 0.045 + i * 0.035, flat);
      });
      this.#tablePose(host.id, x, y, width, 0.05 + attachments.length * 0.035, flat);
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
    const departingSchemes = state.encounterDiscard.filter(
      (card) => isScheme(card) && this.#flights.get(card.id)?.kind === "discard",
    ).length;
    const schemeCount = schemes.length + departingSchemes;
    this.#fitMat(schemeCount ? schemeOrigin.z - (schemeCount - 1) * schemeStep - schemeScale * 0.64 : undefined);
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
      const left = bounds(state.villain, w * 0.5, h * 0.237, villainWidth, villainTabs).right;
      const right = this.encounterAnchor().left;
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
    for (const card of this.#encounters.values()) {
      if (card.id === this.#revealing)
        this.#pose(
          card.id,
          w * 0.5,
          h * (w < 550 ? 0.3 : 0.38),
          Math.min(h * 0.245, w * 0.24),
          1.75,
          this.#camera.rotation.x,
        );
      else
        this.#pose(
          card.id,
          w * (0.67 + (waiting++ % 3) * 0.034),
          h * 0.26,
          Math.min(h * 0.125, w * 0.105),
          0.07 + waiting * 0.045,
          flat,
        );
    }
    const permanents = state.inPlay.filter((c) => c.id !== state.staged?.id);
    if (state.staged && ["ally", "support", "upgrade"].includes(state.staged.type)) permanents.push(state.staged);
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
      if (card.id === state.staged?.id) {
        this.#pose(card.id, x, rowY - playWidth * 0.3, playWidth * 1.12, 1.15, flat + 0.12);
      } else {
        this.#tablePose(card.id, x, rowY, playWidth, elevation, flat);
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
      }
    });
    row.forEach((card, i) => posePermanent(card, centers[i]!, 0.08 + (i === 0 ? upgrades.length * 0.035 : 0)));
    const hand = state.hand.filter((card) => card.id !== state.staged?.id);
    const handLeft = 14;
    const spread = w < 550 ? 0.73 : 1.03;
    // The turn bar floats under the hand; keep its strip of the table clear.
    const bottomMargin = w < 740 ? 112 : Math.min(100, Math.max(78, h * 0.105));
    const cardWidth = Math.min(
      Math.min(h * 0.215, (h * 0.36 - bottomMargin) / 1.5),
      (w - handLeft - 14) / (1 + Math.max(0, hand.length - 1) * spread),
      w * 0.245,
    );
    const center = (hand.length - 1) / 2;
    const baseline = h - bottomMargin - cardWidth * 0.78;
    // Reserve room for a fully raised card, independently of hover or selection.
    this.#paymentEdge = baseline - cardWidth * 1.0 - 8;
    const restPitch = this.#camera.rotation.x + 0.1;
    const normal = new THREE.Vector3(0, -Math.sin(restPitch), Math.cos(restPitch));
    const eye = this.#camera.position;
    const planeDistance = this.#point(w * 0.5, baseline, 1.34)
      .sub(eye)
      .dot(normal);
    // Raised cards face the camera, so they get layers along its view instead: the hovered card nearest, then each
    // picked card a card's thickness behind the last, so neighbours never cut through each other.
    const forward = this.#camera.getWorldDirection(new THREE.Vector3());
    const raisedDepth = this.#point(w * 0.5, baseline - cardWidth * 0.17, 2.06)
      .sub(eye)
      .dot(forward);
    const picked = hand.filter(
      (card) => state.selected.includes(card.id) && !(this.#hovered === card.id && !this.#press?.dragging),
    );
    hand.forEach((card, i) => {
      const offset = i - center;
      const outward = center ? offset / center : 0;
      const hovered = this.#hovered === card.id && !this.#press?.dragging;
      const raised = hovered || state.selected.includes(card.id);
      const handCenter = Math.max(w * 0.5, handLeft + cardWidth * (0.5 + center * spread));
      const x = handCenter + offset * cardWidth * spread;
      const restY = baseline + outward ** 2 * cardWidth * 0.045;
      if (hovered) this.#hoverFootprint = { x, y: restY, width: cardWidth };
      this.#pose(
        card.id,
        x,
        restY - (raised ? cardWidth * 0.17 : 0),
        cardWidth * (raised ? 1.09 : 1),
        1.34 + i * 0.012 + (raised ? 0.72 : 0),
        // Keep a little perspective in the resting fan; lift the print square to the camera for reading.
        raised ? this.#camera.rotation.x : restPitch,
        raised ? 0 : -outward * 0.066,
      );
      // Parallel layers along the camera ray keep every projected corner in place.
      const pose = this.#pieces.get(card.id)!.target;
      const ray = pose.position.clone().sub(eye);
      const ratio = raised
        ? (raisedDepth + (hovered ? -0.12 : picked.indexOf(card) * 0.026) * pose.scale) / ray.dot(forward)
        : (planeDistance + i * 0.035 * pose.scale) / ray.dot(normal);
      pose.position.copy(eye).addScaledVector(ray, ratio);
      pose.scale *= ratio;
    });
    if (state.staged && this.#power !== state.staged.id && !permanents.includes(state.staged)) {
      this.#pose(
        state.staged.id,
        first + playWidth * 0.92,
        rowY - playWidth * 0.48,
        playWidth * 1.12,
        1.18,
        flat + 0.12,
      );
    }
    const pileWidth = Math.min(w * 0.125, h * 0.125);
    const scale = this.#point(pileX + pileWidth, pileY, 0.025).x - base.x;
    this.#discardSlot.position.copy(base);
    this.#discardSlot.scale.setScalar(scale);
    const deckX = w * 0.115,
      deckY = h * 0.505;
    this.#deckSlot.position.copy(this.#point(deckX, deckY, 0.025));
    const deckScale = this.#point(deckX + Math.min(w * 0.125, h * 0.125), deckY, 0.025).x - this.#deckSlot.position.x;
    this.#deckSlot.scale.setScalar(deckScale);
    const slot = this.#encounterDiscardSlot;
    placeEncounterPile(slot, h * 0.102);
    slot.visible = state.encounterDiscard.length > 0;
    const encounterScale = slot.scale.x;
    state.encounterDiscard.forEach((card, index) => {
      const piece = this.#pieces.get(card.id);
      if (!piece || this.#encounters.has(card.id)) return;
      piece.target = {
        position: slot.position.clone(),
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
      const position = base.clone();
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
      if (card.id === this.#hovered && footprint && this.#pointer && !this.#reduced.matches)
        goal = THREE.MathUtils.clamp((this.#pointer.x - footprint.x) / footprint.width, -0.5, 0.5) * 0.32;
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
    const dt = Math.min(40, Math.max(1, now - this.#lastFrame)) / 1000;
    this.#lastFrame = now;
    const handSlide = this.#reduced.matches ? 1 : 1 - Math.exp(-dt * 10);
    const smooth = this.#reduced.matches ? 1 : 1 - Math.exp(-dt * 22);
    const light = this.#villainLight;
    const transitioning = Math.abs(light.value - this.#phaseTarget) > 0.001 && !this.#reduced.matches;
    light.value = transitioning ? THREE.MathUtils.damp(light.value, this.#phaseTarget, 3.4, dt) : this.#phaseTarget;
    let moving = transitioning;
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
          } else if (raw >= HIT_CONTACT_MS) {
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
      if (id === this.#power && this.#state) {
        const hero = this.#pieces.get(this.#state.hero.id)!.root;
        hero.updateMatrixWorld();
        piece.target.position.set(-0.07, -0.07, 0.032).applyMatrix4(hero.matrixWorld);
        piece.target.pitch = hero.rotation.x;
        piece.target.roll = hero.rotation.z + 0.035;
        piece.target.scale = hero.scale.x * 0.87;
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
                : kind === "draw"
                  ? 560
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
        if (kind === "place") {
          const settle = Math.max(0, (progress - 0.54) / 0.46);
          piece.root.position.y += Math.sin(Math.PI * settle) * (1 - settle) * 0.24;
          piece.rim.visible = settle > 0 && settle < 0.74;
        } else if (readying) {
          const rise = THREE.MathUtils.smoothstep(progress, 0, READY_TURN_START);
          const descent = THREE.MathUtils.smoothstep(progress, READY_TURN_END, 1);
          piece.root.position.y += (rise - descent) * (Math.max(0.58, piece.target.scale * 0.5) + liftOffset);
        } else piece.root.position.y += Math.sin(Math.PI * progress) * (kind === "discard" ? 0.95 : 0.46);
        if (kind === "draw") {
          const fromDeck = this.#state?.hand.some((card) => card.id === id);
          // Turn face-up over the first 60% of the flight, as before the ease-out curve.
          const turn = fromDeck ? THREE.MathUtils.smoothstep(progress, 0, 0.6) : t;
          piece.root.rotation.y = Math.PI * (1 - turn);
          if (fromDeck) {
            const fly = THREE.MathUtils.smoothstep(progress, 0.2, 1);
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
        const delta =
          piece.root.position.distanceToSquared(piece.target.position) +
          Math.abs(piece.root.scale.x - piece.target.scale) +
          Math.abs(piece.root.rotation.z - piece.target.roll) +
          Math.abs(piece.root.rotation.x - piece.target.pitch);
        if (delta > 0.00025 && smooth < 1) moving = true;
        const shifting =
          Math.abs(piece.target.position.x - piece.root.position.x) > 0.0005 &&
          this.#state?.hand.some((card) => card.id === id);
        this.#apply(piece, delta > 0.00025 ? (shifting ? handSlide : smooth) : 1);
      }
    }
    // Use the host's rendered pose, including the lift and roll between animation frames.
    for (const [id, { host, depth }] of this.#tucked) {
      const parent = this.#pieces.get(host)?.root;
      const piece = this.#pieces.get(id);
      if (!parent || !piece) continue;
      const flight = this.#flights.get(id);
      if (flight && flight.kind !== "equip") continue;
      parent.updateMatrixWorld();
      piece.target.position.set(-TAB * depth, 0, -0.006 * depth).applyMatrix4(parent.matrixWorld);
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
        token.position.set(
          -0.14 * (1 - fall) + 1.14 * rebound,
          0.08 + 0.45 * rebound,
          0.075 + 1.2 * (1 - fall * fall) + 0.75 * Math.sin(Math.PI * rebound),
        );
        token.rotation.z = -0.15 * (1 - fall) + rebound * 0.72;
        token.scale.setScalar(1 - THREE.MathUtils.smoothstep(rebound, 0.68, 1));
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
        const tucked = this.#tucked.has(id) && !this.#flights.has(id) && this.#state.staged?.id !== id;
        const geometry = tucked
          ? onEnemy && piece.card.type === "attachment"
            ? this.#attachmentTab
            : this.#tab
          : piece.card.landscape
            ? this.#landscapeFace
            : this.#face;
        piece.face.geometry = geometry;
        piece.root.children[0]!.visible = !tucked;
        piece.back.visible = !tucked;
        piece.rim.geometry = geometry;
      }
    }
    if (this.#interrupt) {
      const pulse = this.#interrupt;
      const t = THREE.MathUtils.clamp((now - pulse.start) / INTERRUPT_MS, 0, 1);
      pulse.lift = this.#reduced.matches ? 0 : pulse.piece.root.scale.x * 0.12 * Math.sin(Math.PI * t) ** 2;
      pulse.piece.root.position.y += pulse.lift;
      this.#interruptPuff.material.uniforms.progress!.value = t;
      this.#interruptSheen.material.uniforms.sweep!.value = -0.25 + 2 * t;
      if (t === 1) {
        this.#interruptPuff.removeFromParent();
        this.#interruptSheen.removeFromParent();
        this.#interrupt = null;
      } else moving = true;
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
      spark.velocity.y -= 9 * dt;
      spark.velocity.multiplyScalar(1 - 2.4 * dt);
      spark.sprite.position.addScaledVector(spark.velocity, dt);
      const fade = 1 - age / spark.life;
      spark.sprite.material.opacity = fade;
      spark.sprite.scale.setScalar(spark.size * (0.4 + 0.6 * fade));
      moving = true;
    }
    if (this.#tiltHand(dt)) moving = true;
    this.#renderer.render(this.#scene, this.#camera);
    this.#handlers.onDraw?.();
    if (moving) this.#requestFrame();
    if (landed) this.#handlers.onLanded(landed);
    if (this.#discardDeal && !this.#discardDeal.spent.size && this.#discardDeal.landed === this.#discardDeal.ids.length)
      this.#finishDiscards();
  };

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
    for (const piece of this.#pieces.values()) {
      if (this.#state?.defending && !this.#state.targets.includes(piece.card.id)) continue;
      if (this.#state?.paymentSources && !this.#state.paymentSources.includes(piece.card.id)) continue;
      if (this.#state?.discardOpen && !this.#viewedPile(this.#state).some((card) => card.id === piece.card.id))
        continue;
      const [hit] = this.#ray.intersectObjects(piece.card.reverseArt ? [piece.face, piece.back] : [piece.face], false);
      if (hit && hit.distance < nearest) {
        nearest = hit.distance;
        id = piece.card.id;
      }
    }
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
    this.#renderer.domElement.style.cursor = id ? "pointer" : "default";
    if (this.#hovered === id) return;
    this.setHovered(id);
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
    this.#renderer.domElement.style.cursor = "grabbing";
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
    canvas.style.cursor = this.#hovered ? "pointer" : "default";
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
  };
  readonly #restoreContext = (): void => {
    this.#contextLost = false;
    this.#requestFrame();
  };

  dispose(): void {
    this.#disposed = true;
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
      this.#attachmentTab,
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
