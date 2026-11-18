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
  readonly staged: TableCard | null;
  readonly selected: readonly string[];
}

interface Handlers {
  onPick(id: string): void;
  onHover(id: string | null): void;
  onLanded(id: string): void;
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
  #flight: { id: string; from: Pose; started: number } | null = null;
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
    this.#state = state;
    const cards = [state.hero, state.villain, ...state.inPlay, ...state.hand];
    if (state.staged) cards.push(state.staged);
    const live = new Set(cards.map((card) => card.id));
    for (const [id, piece] of this.#pieces) {
      if (live.has(id)) continue;
      this.#scene.remove(piece.root);
      piece.face.material.dispose();
      this.#pieces.delete(id);
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
    }
    if (previous !== state.staged?.id) {
      this.#flight = null;
      if (state.staged) {
        const piece = this.#pieces.get(state.staged.id)!;
        const { position, rotation, scale } = piece.root;
        this.#flight = {
          id: state.staged.id,
          started: performance.now(),
          from: { position: position.clone(), scale: scale.x, pitch: rotation.x, roll: rotation.z },
        };
      }
    }
    this.#layout();
    for (const id of fresh) this.#apply(this.#pieces.get(id)!, 1);
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
  anchors(): { id: string; x: number; y: number; bottom: number }[] {
    return Array.from(this.#pieces, ([id, { root }]) => {
      root.updateMatrixWorld();
      this.#scratch.copy(root.position).project(this.#camera);
      const x = (0.5 + this.#scratch.x / 2) * this.#width;
      const y = (0.5 - this.#scratch.y / 2) * this.#height;
      let bottom = y;
      for (const [cx, cy] of corners) {
        this.#scratch.set(cx, cy, 0.02).applyMatrix4(root.matrixWorld).project(this.#camera);
        bottom = Math.max(bottom, (0.5 - this.#scratch.y / 2) * this.#height);
      }
      return { id, x, y, bottom };
    });
  }

  setHovered(id: string | null): void {
    if (this.#hovered === id) return;
    this.#hovered = id;
    this.#layout();
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
    for (const piece of this.#pieces.values()) this.#apply(piece, 1);
    this.#requestFrame();
  };

  #pose(id: string, x: number, y: number, width: number, elevation: number, pitch: number, roll = 0): void {
    const piece = this.#pieces.get(id);
    if (!piece) return;
    const center = this.#point(x, y, elevation);
    const widthPoint = this.#point(x + width, y, elevation);
    piece.target = { position: center, scale: widthPoint.x - center.x, pitch, roll };
  }

  #layout(): void {
    const state = this.#state;
    if (!state) return;
    const w = this.#width,
      h = this.#height;
    const boardWidth = Math.min(w * 0.2, h * 0.22);
    const flat = -Math.PI / 2;
    this.#pose(state.hero.id, w * 0.255, h * 0.271, boardWidth, 0.045, flat);
    this.#pose(state.villain.id, w * 0.745, h * 0.271, boardWidth, 0.045, flat);
    const inPlay = state.inPlay.filter((c) => c.id !== state.staged?.id);
    const playWidth = Math.min(boardWidth * 0.8, (w * 0.65) / Math.max(3, inPlay.length));
    inPlay.forEach((card, i) =>
      this.#pose(card.id, w * 0.5 + (i - (inPlay.length - 1) / 2) * playWidth * 1.15, h * 0.49, playWidth, 0.05, flat),
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
    this.#hoverFootprint = null;
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
        -0.48,
        raised ? 0 : -outward * 0.066,
      );
    });
    if (state.staged) {
      this.#pose(state.staged.id, w * 0.5, h * (inPlay.length ? 0.31 : 0.43), boardWidth, 0.16, flat + 0.1);
    }
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
      if (this.#flight?.id === id) {
        const { from, started } = this.#flight;
        const progress = this.#reduced.matches ? 1 : Math.min(1, Math.max(0, (now - started) / 310));
        const t = progress * progress * (3 - 2 * progress);
        piece.root.position.lerpVectors(from.position, piece.target.position, t);
        piece.root.position.y += Math.sin(Math.PI * progress) * 0.46;
        piece.root.rotation.x = THREE.MathUtils.lerp(from.pitch, piece.target.pitch, t);
        piece.root.rotation.z = THREE.MathUtils.lerp(from.roll, piece.target.roll, t);
        piece.root.scale.setScalar(THREE.MathUtils.lerp(from.scale, piece.target.scale, t));
        if (progress === 1) {
          landed = id;
          this.#flight = null;
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
  };

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
    piece.root.rotation.set(-0.53, 0, 0);
    this.#renderer.domElement.style.cursor = "grabbing";
    this.#requestFrame();
  };

  readonly #down = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary || this.#press) return;
    const id = this.#hit(event);
    if (!id) return;
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
