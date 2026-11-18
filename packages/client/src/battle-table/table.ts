import * as THREE from "three";
import { cardRadius } from "../art/card-shape.js";
import rooftop from "../art/tabletop/rooftop.webp?url";

export interface TableCard {
  readonly id: string;
  readonly name: string;
  readonly art: string;
}

export interface TableCards {
  readonly hand: readonly TableCard[];
  readonly hero: TableCard;
  readonly villain: TableCard;
  readonly inPlay: readonly TableCard[];
  /** In engine order, ending with the visible top card. */
  readonly discard: readonly TableCard[];
  readonly discardOpen: boolean;
  readonly staged: TableCard | null;
  readonly selected: readonly string[];
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
  rim: THREE.Mesh;
  target: Pose;
}

interface Flight {
  from: Pose;
  started: number;
  kind: "play" | "return" | "discard";
}

const HEIGHT = 1.407;
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
  readonly #host: HTMLElement;
  readonly #handlers: Handlers;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
  readonly #renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  readonly #ray = new THREE.Raycaster();
  readonly #ndc = new THREE.Vector2();
  readonly #scratch = new THREE.Vector3();
  readonly #floor = new THREE.Plane(new THREE.Vector3(0, 1, 0));
  readonly #pieces = new Map<string, Piece>();
  readonly #textures = new Map<string, THREE.Texture>();
  readonly #loader = new THREE.TextureLoader();
  readonly #cardShape = roundedRect(1, HEIGHT, cardRadius(1, HEIGHT));
  readonly #face = faceGeometry(this.#cardShape, 1, HEIGHT);
  readonly #stock = new THREE.ExtrudeGeometry(this.#cardShape, { depth: 0.018, bevelEnabled: false, curveSegments: 8 });
  readonly #stockMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b2a2, roughness: 0.87 });
  readonly #glow = new THREE.MeshBasicMaterial({ color: 0xffc66c });
  readonly #mat = new THREE.Group();
  readonly #discardSlot = new THREE.Group();
  readonly #observer: ResizeObserver;
  readonly #reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  #state: TableCards | null = null;
  #hovered: string | null = null;
  #hoverFootprint: { x: number; y: number; width: number } | null = null;
  #frame = 0;
  #lastFrame = 0;
  #width = 1;
  #height = 1;
  #disposed = false;
  #contextLost = false;
  readonly #flights = new Map<string, Flight>();
  #discardDeal: { ids: string[]; landed: number; done(): void } | null = null;
  #press: { id: string; pointer: number; x: number; y: number; dragging: boolean } | null = null;

  constructor(host: HTMLElement, handlers: Handlers) {
    this.#host = host;
    this.#handlers = handlers;
    const canvas = this.#renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;";
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
    const cloth = new THREE.Mesh(
      faceGeometry(surface, 1, 1),
      new THREE.MeshStandardMaterial({ map: print, roughness: 0.98, metalness: 0 }),
    );
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
    this.#observer = new ResizeObserver(this.#resize);
    this.#observer.observe(host);
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
    this.#state = state;
    const cards = [state.hero, state.villain, ...state.inPlay, ...state.hand, ...state.discard];
    if (state.staged) cards.push(state.staged);
    const live = new Set(cards.map((card) => card.id));
    for (const [id, piece] of this.#pieces) {
      if (live.has(id)) continue;
      this.#scene.remove(piece.root);
      piece.face.material.dispose();
      this.#pieces.delete(id);
      this.#flights.delete(id);
    }
    const fresh = new Set<string>();
    for (const card of cards) {
      let piece = this.#pieces.get(card.id);
      if (!piece) {
        const root = new THREE.Group();
        root.name = card.name;
        const stock = new THREE.Mesh(this.#stock, this.#stockMaterial);
        stock.castShadow = true;
        const face = new THREE.Mesh(this.#face, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        face.position.z = 0.019;
        const rim = new THREE.Mesh(this.#face, this.#glow);
        rim.scale.set(1.042, 1.03, 1);
        rim.position.z = 0.009;
        root.add(stock, rim, face);
        this.#scene.add(root);
        piece = { card, root, face, rim, target: { position: new THREE.Vector3(), pitch: 0, roll: 0, scale: 1 } };
        this.#pieces.set(card.id, piece);
        fresh.add(card.id);
      }
      if (fresh.has(card.id) || card.art !== piece.card.art) {
        piece.face.material.map = this.#texture(card.art);
        piece.face.material.needsUpdate = true;
      }
      piece.card = card;
      piece.rim.visible = state.selected.includes(card.id);
      piece.face.material.color.setHex(
        state.discardOpen && !state.discard.some((discarded) => discarded.id === card.id) ? 0x848993 : 0xffffff,
      );
    }
    if (previous !== state.staged?.id) {
      if (previous) this.#flights.delete(previous);
      if (state.staged) {
        this.#startFlight(state.staged.id, "play");
      } else if (previous && state.hand.some((card) => card.id === previous)) {
        this.#startFlight(previous, "return");
      } else if (previous && state.discard.some((card) => card.id === previous)) {
        this.#startFlight(previous, "discard");
      }
    }
    this.#layout();
    for (const id of fresh) this.#apply(this.#pieces.get(id)!, 1);
    this.#requestFrame();
  }

  #startFlight(id: string, kind: Flight["kind"], started = performance.now()): void {
    const { position, rotation, scale } = this.#pieces.get(id)!.root;
    this.#flights.set(id, {
      kind,
      started,
      from: { position: position.clone(), scale: scale.x, pitch: rotation.x, roll: rotation.z },
    });
  }

  /** The dialog supplies its last displayed scan rectangles before revealing the table. */
  animateDiscards(cards: readonly { id: string; rect: DOMRect }[], done: () => void): void {
    const visible = cards.filter(({ id }) => this.#pieces.has(id));
    if (!visible.length || this.#contextLost || this.#disposed) {
      done();
      return;
    }
    const canvas = this.#renderer.domElement.getBoundingClientRect();
    const started = performance.now();
    this.#discardDeal = { ids: visible.map(({ id }) => id), landed: 0, done };
    visible.forEach(({ id, rect }, index) => {
      const piece = this.#pieces.get(id)!;
      const x = rect.left + rect.width / 2 - canvas.left;
      const y = rect.top + rect.height / 2 - canvas.top;
      // A source outside the canvas, e.g. below the table on a phone, lifts from its physical hand slot.
      if (rect.width > 0 && x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
        this.#pose(id, x, y, rect.width, 2.1, this.#camera.rotation.x);
        this.#apply(piece, 1);
      }
      piece.rim.visible = false;
      this.#startFlight(id, "discard", started + index * 155);
    });
    this.#layout();
    this.#requestFrame();
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
    return Array.from(this.#pieces, ([id, { root }]) => ({ id, ...this.#anchor(root) }));
  }

  discardAnchor(): { x: number; y: number; bottom: number } {
    return this.#anchor(this.#discardSlot);
  }

  #anchor(root: THREE.Group) {
    root.updateMatrixWorld();
    this.#scratch.copy(root.position).project(this.#camera);
    const x = (0.5 + this.#scratch.x / 2) * this.#width;
    const y = (0.5 - this.#scratch.y / 2) * this.#height;
    let bottom = y;
    let left = x,
      right = x;
    for (const [cx, cy] of corners) {
      this.#scratch.set(cx, cy, 0.02).applyMatrix4(root.matrixWorld).project(this.#camera);
      const cornerX = (0.5 + this.#scratch.x / 2) * this.#width;
      left = Math.min(left, cornerX);
      right = Math.max(right, cornerX);
      bottom = Math.max(bottom, (0.5 - this.#scratch.y / 2) * this.#height);
    }
    return { x, y, bottom, width: right - left };
  }

  setHovered(id: string | null): void {
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
    this.#ndc.set((2 * x) / this.#width - 1, 1 - (2 * y) / this.#height);
    this.#ray.setFromCamera(this.#ndc, this.#camera);
    this.#floor.constant = -elevation;
    return this.#ray.ray.intersectPlane(this.#floor, new THREE.Vector3())!;
  }

  readonly #resize = (): void => {
    this.#width = Math.max(1, this.#host.clientWidth);
    this.#height = Math.max(1, this.#host.clientHeight);
    this.#camera.aspect = this.#width / this.#height;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(this.#width, this.#height, false);
    const far = this.#point(this.#width / 2, this.#height * 0.045, 0);
    const near = this.#point(this.#width * 0.985, this.#height * 0.98, 0);
    this.#mat.position.z = (near.z + far.z) / 2;
    this.#mat.scale.set(near.x * 2, near.z - far.z, 1);
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
    if (this.#hovered === id && !this.#flights.has(id)) {
      this.#hoverFootprint = { x, y, width };
      this.#pose(id, x, y - width * 0.09, width * 1.065, elevation + 0.65, this.#camera.rotation.x);
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
    this.#hoverFootprint = null;
    this.#tablePose(state.hero.id, w * 0.255, h * 0.271, boardWidth, 0.045, flat);
    this.#tablePose(state.villain.id, w * 0.745, h * 0.271, boardWidth, 0.045, flat);
    const inPlay = state.inPlay.filter((c) => c.id !== state.staged?.id);
    const playWidth = Math.min(boardWidth * 0.8, (w * 0.57) / Math.max(3, inPlay.length));
    inPlay.forEach((card, i) =>
      this.#tablePose(
        card.id,
        w * 0.43 + (i - (inPlay.length - 1) / 2) * playWidth * 1.1,
        h * 0.49,
        playWidth,
        0.05,
        flat,
      ),
    );
    const hand = state.hand.filter((card) => card.id !== state.staged?.id);
    const spread = w < 550 ? 0.73 : 1.03;
    const cardWidth = Math.min(
      h * 0.235,
      (w - Math.min(62, w * 0.08)) / (1 + Math.max(0, hand.length - 1) * spread),
      w * 0.245,
    );
    const center = (hand.length - 1) / 2;
    const baseline = h - Math.min(56, Math.max(39, h * 0.079)) - cardWidth * 0.78;
    hand.forEach((card, i) => {
      const offset = i - center;
      const outward = center ? offset / center : 0;
      const selected = state.selected.includes(card.id);
      const raised = this.#hovered === card.id && !this.#press?.dragging;
      const lift = raised ? cardWidth * 0.17 : selected ? cardWidth * 0.078 : 0;
      const x = w * 0.5 + offset * cardWidth * spread;
      const restY = baseline + outward ** 2 * cardWidth * 0.045;
      if (raised) this.#hoverFootprint = { x, y: restY, width: cardWidth };
      this.#pose(
        card.id,
        x,
        restY - lift,
        cardWidth * (raised ? 1.09 : 1),
        1.34 + i * 0.012 + (raised ? 0.72 : selected ? 0.15 : 0),
        // Keep a little perspective in the resting fan; lift the print square to the camera for reading.
        this.#camera.rotation.x + (raised ? 0 : 0.1),
        raised ? 0 : -outward * 0.066,
      );
    });
    if (state.staged) {
      this.#tablePose(state.staged.id, w * 0.5, h * (inPlay.length ? 0.31 : 0.43), boardWidth, 0.16, flat + 0.1);
    }
    const pileX = w * 0.822;
    const pileY = h * 0.505;
    const pileWidth = Math.min(w * 0.125, h * 0.125);
    const base = this.#point(pileX, pileY, 0.025);
    const scale = this.#point(pileX + pileWidth, pileY, 0.025).x - base.x;
    this.#discardSlot.position.copy(base);
    this.#discardSlot.scale.setScalar(scale);
    if (state.discardOpen && state.discard.length) {
      this.#fanDiscard(state.discard);
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
    const top = pileIds.at(-1);
    if (!this.#discardDeal && top && this.#hovered === top && !this.#flights.has(top)) {
      this.#tablePose(top, pileX, pileY, pileWidth, base.y, flat);
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

  #apply(piece: Piece, t: number): void {
    const { root, target } = piece;
    root.position.lerp(target.position, t);
    root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, target.pitch, t);
    root.rotation.z = THREE.MathUtils.lerp(root.rotation.z, target.roll, t);
    root.scale.setScalar(THREE.MathUtils.lerp(root.scale.x, target.scale, t));
  }

  readonly #requestFrame = (): void => {
    if (!this.#frame && !this.#disposed && !this.#contextLost) this.#frame = requestAnimationFrame(this.#draw);
  };

  readonly #draw = (now: number): void => {
    this.#frame = 0;
    const dt = Math.min(40, Math.max(1, now - this.#lastFrame)) / 1000;
    this.#lastFrame = now;
    const smooth = this.#reduced.matches ? 1 : 1 - Math.exp(-dt * 22);
    let moving = false;
    let landed: string | null = null;
    for (const [id, piece] of this.#pieces) {
      if (this.#press?.dragging && this.#press.id === id) continue;
      const flight = this.#flights.get(id);
      if (flight) {
        const { from, started, kind } = flight;
        const duration = kind === "discard" ? 460 : 310;
        const progress = this.#reduced.matches ? 1 : THREE.MathUtils.clamp((now - started) / duration, 0, 1);
        const t = progress * progress * (3 - 2 * progress);
        piece.root.position.lerpVectors(from.position, piece.target.position, t);
        piece.root.position.y += Math.sin(Math.PI * progress) * (kind === "discard" ? 0.95 : 0.46);
        piece.root.rotation.x = THREE.MathUtils.lerp(from.pitch, piece.target.pitch, t);
        piece.root.rotation.z = THREE.MathUtils.lerp(from.roll, piece.target.roll, t);
        piece.root.scale.setScalar(THREE.MathUtils.lerp(from.scale, piece.target.scale, t));
        if (progress === 1) {
          this.#flights.delete(id);
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
        this.#apply(piece, delta > 0.00025 ? smooth : 1);
      }
    }
    this.#renderer.render(this.#scene, this.#camera);
    this.#handlers.onDraw?.();
    if (moving) this.#requestFrame();
    if (landed) this.#handlers.onLanded(landed);
    if (this.#discardDeal && this.#discardDeal.landed === this.#discardDeal.ids.length) this.#finishDiscards();
  };

  #finishDiscards(): void {
    const deal = this.#discardDeal;
    if (!deal) return;
    this.#discardDeal = null;
    for (const id of deal.ids) this.#flights.delete(id);
    deal.done();
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
      if (this.#state?.discardOpen && !this.#state.discard.some((card) => card.id === piece.card.id)) continue;
      const [hit] = this.#ray.intersectObject(piece.face, false);
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
      Math.abs(event.clientY - rect.top - footprint.y) < footprint.width * 0.72
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
      if (event.pointerType !== "touch") this.#notifyHover(this.#hit(event));
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
    const rect = this.#renderer.domElement.getBoundingClientRect();
    piece.root.position.copy(this.#point(event.clientX - rect.left, event.clientY - rect.top, 1.9));
    piece.root.rotation.set(this.#camera.rotation.x, 0, 0);
    this.#renderer.domElement.style.cursor = "grabbing";
    this.#requestFrame();
  };

  readonly #down = (event: PointerEvent): void => {
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
      event.clientY < rect.top + rect.height * 0.68;
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
    const geometries = new Set<THREE.BufferGeometry>([this.#face, this.#stock]);
    const materials = new Set<THREE.Material>([this.#stockMaterial, this.#glow]);
    this.#scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        materials.add(object.material);
        if (object.material.map instanceof THREE.CanvasTexture) object.material.map.dispose();
      }
      if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.#textures.forEach((texture) => texture.dispose());
    this.#renderer.dispose();
    canvas.remove();
  }
}
