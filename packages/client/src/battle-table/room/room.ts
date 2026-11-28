/**
 * The room itself: the renderer, the layer laid over the table page, the scene, its lights, the soft backdrop, the
 * wooden table and the cube shelf of other game boxes on the back wall. The places in the room (`places/`) stand their
 * own things in it; the camera is `camera.ts`.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { camera, FOG_FAR, FOG_NEAR } from "./camera.js";
import { canvas, setAnisotropy, texture } from "./canvas.js";
import "../design.css";
import "./room.css";

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
// The room's own layer over the table page: the picture, a dark veil for fades, and each place's buttons and words.
export const root = document.createElement("div");
root.id = "shelf";
root.className = "shelf";
root.setAttribute("role", "dialog");
root.setAttribute("aria-label", "Marvel Champions");
root.hidden = true;
root.tabIndex = -1;
root.innerHTML = `
  <div class="shelf-stage"></div>
  <div class="room-fade" aria-hidden="true"></div>
  <div class="room-panels"></div>
  <p class="shelf-toast" role="status" hidden></p>`;
document.body.append(root);
root.querySelector(".shelf-stage")!.append(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0a08);
scene.fog = new THREE.Fog(0x0d0a08, FOG_NEAR, FOG_FAR);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.32;

scene.add(new THREE.HemisphereLight(0xffe8cc, 0x1a120c, 0.45));
const key = new THREE.SpotLight(0xffe2b8, 340, 0, 0.62, 0.65, 2);
key.position.set(2.2, 10.5, 6.5);
key.target.position.set(0, 0.6, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x9db4ff, 0.55);
fill.position.set(-7, 4, 6);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xff9a50, 0.9);
rim.position.set(0, 5, -8);
scene.add(rim);
const shelfLight = new THREE.SpotLight(0xffd7a0, 260, 0, 0.9, 1, 2);
shelfLight.position.set(0, 6.5, -3.5);
shelfLight.target.position.set(0, 0.4, -8.6);
scene.add(shelfLight, shelfLight.target);

// ---------- the soft backdrop ----------
// The shelf and the wall live on their own layer. Each frame they are drawn small, blurred, and laid behind the table
// as the scene's background, like a camera focused on the boxes. The table and the boxes are drawn sharp on top.

export const BACKDROP = 1;
const backdropColour = new THREE.Color(0x0d0a08);
const backdrop = {
  a: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
  b: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
  material: new THREE.ShaderMaterial({
    uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // A 9-tap Gaussian along `step`, run across then down, twice.
    fragmentShader: `
      uniform sampler2D source; uniform vec2 step; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(source, vUv) * 0.2270270270;
        c += (texture2D(source, vUv + step * 1.3846153846) + texture2D(source, vUv - step * 1.3846153846)) * 0.3162162162;
        c += (texture2D(source, vUv + step * 3.2307692308) + texture2D(source, vUv - step * 3.2307692308)) * 0.0702702703;
        gl_FragColor = c;
      }`,
    depthTest: false,
    depthWrite: false,
  }),
  scene: new THREE.Scene(),
  camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
};
backdrop.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdrop.material));

function blurPass(from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, x: number, y: number) {
  backdrop.material.uniforms.source!.value = from.texture;
  (backdrop.material.uniforms.step!.value as THREE.Vector2).set(x / from.width, y / from.height);
  renderer.setRenderTarget(to);
  renderer.render(backdrop.scene, backdrop.camera);
}

/**
 * Draws a frame. `blur` is how soft the back wall and the shelf are: 1 is the shelf's own depth of field (drawn small,
 * blurred and laid behind the table); near 0 the whole room is drawn sharp in one pass, as the doorway sees it.
 */
export function renderFrame(blur = 1) {
  if (blur < 0.04) {
    renderer.setRenderTarget(null);
    camera.layers.set(0);
    camera.layers.enable(BACKDROP);
    scene.background = backdropColour;
    renderer.render(scene, camera);
    return;
  }
  camera.layers.set(BACKDROP);
  scene.background = backdropColour;
  renderer.setRenderTarget(backdrop.a);
  renderer.render(scene, camera);
  for (let i = 0; i < 2; i++) {
    blurPass(backdrop.a, backdrop.b, 1.6 * blur, 0);
    blurPass(backdrop.b, backdrop.a, 0, 1.6 * blur);
  }
  renderer.setRenderTarget(null);
  camera.layers.set(0);
  scene.background = backdrop.a.texture;
  renderer.render(scene, camera);
}

/**
 * The room's size, in the boxes' units (a box is 2.4 wide, about 30 cm: one unit is about 12 cm). The table top is at
 * y = 0, as it always was; everything else stands round it.
 */
export const ROOM = {
  /** The side walls stand at x = -HALF_WIDTH and +HALF_WIDTH. */
  HALF_WIDTH: 19,
  BACK: -9.9,
  /** The floor runs on past the doorway, so a phone's camera, standing further back, still sees floor. */
  FRONT: 46,
  FLOOR: -6.2,
  TABLE_WIDTH: 24,
  TABLE_DEPTH: 15,
  TABLE_Z: 2.4,
  /** The top of the cube shelf on the back wall. */
  SHELF_TOP: 3.88,
  /**
   * The cube shelf's middle along the back wall: in the right-hand corner, beside the hero shelf, which stands behind
   * the table in the middle (`places/seats.ts`).
   */
  SHELF_X: 14.5,
};

let tableWood: THREE.Texture | null = null;

function buildTable() {
  const wood = texture(woodPrint());
  tableWood = wood;
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  // Whole repeats only: a fraction would cut a board in half at the table's edge.
  wood.repeat.set(2, 1);
  const top = new THREE.MeshPhysicalMaterial({
    map: wood,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  const side = new THREE.MeshStandardMaterial({ color: 0x24150b, roughness: 0.7 });
  const { TABLE_WIDTH: tw, TABLE_DEPTH: td, TABLE_Z: tz, FLOOR: floor } = ROOM;
  const table = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.5, td), [side, side, top, side, side, side]);
  table.position.set(0, -0.25, tz);
  table.receiveShadow = true;
  scene.add(table);
  // The apron under the top, and four square legs down to the floor.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(tw - 1.2, 0.9, td - 1.2), side);
  apron.position.set(0, -0.95, tz);
  scene.add(apron);
  const legHeight = -0.5 - floor;
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.85, legHeight, 0.85), side);
      leg.position.set(x * (tw / 2 - 1), floor + legHeight / 2, tz + z * (td / 2 - 1));
      scene.add(leg);
    }

  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95 }),
  );
  wall.position.set(0, 4, -9.9);
  wall.layers.set(BACKDROP);
  scene.add(wall);
}

/**
 * A plank table top, 8 boards to the texture. Every wave in the grain repeats a whole number of times across the
 * texture and the boards end exactly at its top and bottom, so repeated tiles meet with no visible seam.
 */
function woodPrint(): HTMLCanvasElement {
  const size = 2048;
  const planks = 8;
  const ph = size / planks;
  const TAU = Math.PI * 2;
  const [cv, g] = canvas(size, size);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const wave = (x: number, cycles: number, phase: number) => Math.sin((TAU * cycles * x) / size + phase);
  for (let p = 0; p < planks; p++) {
    const top = p * ph;
    const tone = 0.8 + rand() * 0.32;
    const warm = 0.88 + rand() * 0.2;
    g.fillStyle = `rgb(${82 * tone}, ${50 * tone}, ${28 * tone * warm})`;
    g.fillRect(0, top, size, ph);
    g.save();
    g.beginPath();
    g.rect(0, top, size, ph);
    g.clip();
    for (let i = 0; i < 7; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? "255,205,150" : "26,12,4"},${0.03 + rand() * 0.05})`;
      g.fillRect(0, top + rand() * ph, size, 12 + rand() * 50);
    }
    for (let i = 0; i < 120; i++) {
      const y0 = top + rand() * ph;
      const c1 = 1 + Math.floor(rand() * 3);
      const c2 = 4 + Math.floor(rand() * 7);
      const a1 = 2 + rand() * 9;
      const a2 = 0.4 + rand() * 2;
      const p1 = rand() * TAU;
      const p2 = rand() * TAU;
      g.strokeStyle =
        rand() < 0.55 ? `rgba(22,10,3,${0.07 + rand() * 0.16})` : `rgba(170,112,64,${0.05 + rand() * 0.1})`;
      g.lineWidth = 0.7 + rand() * 2.4;
      g.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + a1 * wave(x, c1, p1) + a2 * wave(x, c2, p2);
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
    // A knot now and then, drawn three times so one near an edge carries on into the next tile.
    if (rand() < 0.7) {
      const kx = rand() * size;
      const ky = top + ph * (0.3 + rand() * 0.4);
      for (const dx of [-size, 0, size]) {
        for (let r = 7; r >= 1; r--) {
          g.beginPath();
          g.ellipse(kx + dx, ky, r * 15, r * 4.2, 0, 0, TAU);
          g.strokeStyle = `rgba(30,14,5,${0.1 + (7 - r) * 0.03})`;
          g.lineWidth = 2;
          g.stroke();
        }
        g.beginPath();
        g.ellipse(kx + dx, ky, 12, 4, 0, 0, TAU);
        g.fillStyle = "rgba(26,11,3,0.6)";
        g.fill();
      }
    }
    g.restore();
    // The gap between boards, and where one board butts against the next one along.
    g.fillStyle = "rgba(10,5,2,0.85)";
    g.fillRect(0, top, size, 4);
    g.fillStyle = "rgba(255,220,180,0.07)";
    g.fillRect(0, top + 4, size, 2);
    const joint = rand() * size;
    g.fillStyle = "rgba(10,5,2,0.7)";
    g.fillRect(joint, top, 3, ph);
  }
  return cv;
}

function spineStripes(colour: string, light: string): HTMLCanvasElement {
  const [cv, g] = canvas(64, 256);
  g.fillStyle = colour;
  g.fillRect(0, 0, 64, 256);
  g.fillStyle = light;
  g.fillRect(0, 30, 64, 14);
  g.fillRect(0, 196, 64, 30);
  g.globalAlpha = 0.5;
  g.fillRect(14, 70, 36, 100);
  return cv;
}

/** A cube shelf of other game boxes behind the table, the kind of shelf people who play this game have at home. */
function buildShelf() {
  const frame = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
  const shelf = new THREE.Group();
  // Five across, to fit the corner beside the hero shelf.
  const cols = 5;
  const rows = 3;
  const cube = 1.5;
  const board = 0.12;
  const depth = 1.6;
  const width = cols * cube + (cols + 1) * board;
  const height = rows * cube + (rows + 1) * board;
  for (let c = 0; c <= cols; c++) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(board, height, depth), frame);
    post.position.set(-width / 2 + board / 2 + c * (cube + board), height / 2, 0);
    shelf.add(post);
  }
  for (let r = 0; r <= rows; r++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width, board, depth), frame);
    plank.position.set(0, board / 2 + r * (cube + board), 0);
    shelf.add(plank);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.04), frame);
  back.position.set(0, height / 2, -depth / 2);
  shelf.add(back);

  const palette = [
    ["#7b2d26", "#d9a441"],
    ["#2f4b6e", "#e3e0d3"],
    ["#5d6b3a", "#efe2b8"],
    ["#8a6a2a", "#241a10"],
    ["#4a3560", "#e7b94a"],
    ["#2d5a5a", "#f0e6d0"],
    ["#6e3d1f", "#f2c46b"],
    ["#3b3f46", "#d34b3a"],
  ] as const;
  const spines = palette.map(([colour, light]) => {
    const t = texture(spineStripes(colour, light));
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
  });
  const plain = palette.map(([colour]) => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 }));
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const left = -width / 2 + board + c * (cube + board);
      const floor = board + r * (cube + board);
      const kind = rand();
      if (kind < 0.12) continue;
      if (kind < 0.62) {
        // Boxes standing like books, spines out, sometimes one leaning.
        let x = left + 0.04;
        while (x < left + cube - 0.3) {
          const thick = 0.18 + rand() * 0.22;
          const tall = 1.05 + rand() * 0.33;
          const pick = Math.floor(rand() * palette.length);
          const geo = new THREE.BoxGeometry(thick, tall, 1.3);
          const m = plain[pick]!;
          const book = new THREE.Mesh(geo, [m, m, m, m, spines[pick]!, m]);
          book.position.set(x + thick / 2, floor + tall / 2, 0.08);
          shelf.add(book);
          x += thick + 0.015;
        }
      } else {
        // A stack of boxes lying flat.
        let y = floor;
        const count = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < count; i++) {
          const thick = 0.22 + rand() * 0.2;
          const pick = Math.floor(rand() * palette.length);
          const box = new THREE.Mesh(new THREE.BoxGeometry(1.3 - rand() * 0.15, thick, 1.3), plain[pick]!);
          box.position.set(left + cube / 2 + (rand() - 0.5) * 0.08, y + thick / 2, 0.08);
          box.rotation.y = (rand() - 0.5) * 0.08;
          shelf.add(box);
          y += thick;
        }
      }
    }
  shelf.position.set(ROOM.SHELF_X, -1.1, -8.7);
  shelf.traverse((o) => o.layers.set(BACKDROP));
  scene.add(shelf);
}

/** A rug under the table: a deep red field with a border, our own simple pattern. */
function rugPrint(): HTMLCanvasElement {
  const [cv, g] = canvas(512, 384);
  g.fillStyle = "#3a1512";
  g.fillRect(0, 0, 512, 384);
  g.strokeStyle = "#b9893f";
  g.lineWidth = 6;
  g.strokeRect(18, 18, 476, 348);
  g.strokeStyle = "#6b2a1f";
  g.lineWidth = 14;
  g.strokeRect(36, 36, 440, 312);
  g.fillStyle = "#471a15";
  for (let i = 0; i < 9; i++) {
    g.save();
    g.translate(256, 192);
    g.rotate((i * Math.PI) / 4.5);
    g.fillRect(-6, -110, 12, 220);
    g.restore();
  }
  return cv;
}

/**
 * The rest of the room round the table: the floor and a rug, the side walls panelled to a dado rail, a sideboard under
 * the cube shelf, and the lamp hanging over the table. The floor, the sideboard and the back wall's panelling are with
 * the shelf on the soft layer, so the shelf's depth of field takes them too; the side walls stand in front of them.
 */
function buildWalls() {
  const { HALF_WIDTH: half, BACK: back, FRONT: front, FLOOR: floor } = ROOM;
  const soft = (o: THREE.Object3D) => {
    o.traverse((child) => child.layers.set(BACKDROP));
    scene.add(o);
  };
  const boards = tableWood!.clone();
  boards.repeat.set(5, 6);
  boards.needsUpdate = true;
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, front - back),
    new THREE.MeshStandardMaterial({ map: boards, color: 0x5d4636, roughness: 0.8 }),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.set(0, floor, (front + back) / 2);
  floorMesh.receiveShadow = true;
  soft(floorMesh);
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 21),
    new THREE.MeshStandardMaterial({ map: texture(rugPrint()), roughness: 0.95 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, floor + 0.02, ROOM.TABLE_Z);
  rug.receiveShadow = true;
  soft(rug);

  const plaster = new THREE.MeshStandardMaterial({ color: 0x2a1f18, roughness: 0.95 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1c130d, roughness: 0.8 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
  for (const side of [-1, 1]) {
    // One-sided, facing in: a camera standing back past the doorway sees through them.
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(front - back, 30), plaster);
    wall.rotation.y = -side * (Math.PI / 2);
    wall.position.set(side * half, 4, (front + back) / 2);
    const wainscot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.6, front - back), panel);
    wainscot.position.set(side * (half - 0.1), floor + 2.3, (front + back) / 2);
    const dado = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, front - back), rail);
    dado.position.set(side * (half - 0.17), floor + 4.7, (front + back) / 2);
    // The left wall, behind the scenario cabinet, is on the soft layer with the back wall: drawn sharp, it would
    // cover the cabinet when a box up close softens it (`places/seats.ts`).
    if (side < 0) for (const each of [wall, wainscot, dado]) soft(each);
    else scene.add(wall, wainscot, dado);
  }
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 4.6, 0.2), panel);
  backPanel.position.set(0, floor + 2.3, back + 0.1);
  const backDado = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.3, 0.34), rail);
  backDado.position.set(0, floor + 4.7, back + 0.17);
  soft(backPanel);
  soft(backDado);

  // The sideboard the cube shelf stands on.
  const wood = new THREE.MeshStandardMaterial({ color: 0x2e2016, roughness: 0.65 });
  const sideboard = new THREE.Group();
  const height = -1.1 - floor;
  const body = new THREE.Mesh(new THREE.BoxGeometry(8.6, height, 1.9), wood);
  body.position.y = height / 2;
  sideboard.add(body);
  for (let i = 0; i < 3; i++) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, height - 0.9, 0.06), rail);
    door.position.set(-2.75 + i * 2.75, height / 2, 0.96);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), rail);
    knob.position.set(-2.75 + i * 2.75 + (i % 2 ? -1.05 : 1.05), height / 2 + 0.6, 1.02);
    sideboard.add(door, knob);
  }
  sideboard.position.set(ROOM.SHELF_X, floor, -8.7);
  soft(sideboard);

  // The lamp over the table: a shade on a long cord, glowing underneath.
  const lamp = new THREE.Group();
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 2.3, 1.5, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1f3a2c, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
  );
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  bulb.position.y = -0.35;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 14, 6), rail);
  cord.position.y = 7.7;
  lamp.add(shade, bulb, cord);
  lamp.position.set(0, 13.5, ROOM.TABLE_Z - 1);
  scene.add(lamp);
  hangingLamp = lamp;

  // Dim warm light on the two side walls, where the bench and the cabinet stand.
  for (const side of [-1, 1]) {
    const glow = new THREE.SpotLight(0xffc98a, 420, 0, 0.8, 0.8, 2);
    glow.position.set(side * (half - 6), 13, -1);
    glow.target.position.set(side * (half - 1), -2, -1);
    scene.add(glow, glow.target);
  }
}

let hangingLamp: THREE.Object3D | null = null;
/**
 * Shows or hides the lamp over the table. At the hero shelf behind the table the camera stands up level with the lamp,
 * on the doorway's side of it, so its shade and cord would hang across the shelf; there it is put out of the way
 * (`index.ts`). From everywhere else it is out of the picture, or in it where it belongs.
 */
export function showLamp(on: boolean) {
  if (hangingLamp) hangingLamp.visible = on;
}

/** Builds the room round the places: the table, the walls and the shelf, lit. */
export function buildRoom() {
  buildTable();
  buildWalls();
  buildShelf();
  // Lights shine on both layers: the sharp table and the soft backdrop.
  scene.traverse((o) => {
    if (o instanceof THREE.Light) o.layers.enableAll();
  });
}

export function resize() {
  renderer.setSize(innerWidth, innerHeight);
  const px = renderer.getPixelRatio() / 4;
  backdrop.a.setSize(Math.ceil(innerWidth * px), Math.ceil(innerHeight * px));
  backdrop.b.setSize(Math.ceil(innerWidth * px), Math.ceil(innerHeight * px));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

const toast = root.querySelector<HTMLElement>(".shelf-toast")!;
let toastTimer = 0;
/** A short line at the top of the room, gone after a moment ("Free Play is coming soon"). */
export function say(text: string) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
}

/** One of the room's own elements. */
export const el = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;

/** Where the pointer is, in the -1 to 1 the raycaster takes (off the page: -9). */
export const pointer = new THREE.Vector2(-9, -9);
export const raycaster = new THREE.Raycaster();
