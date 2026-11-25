/**
 * Campaign: the villain boxes on the table, the room's first place. Pick one and it tips onto its back, the lid lifts
 * off and is set aside, and the villain card rises out of the tray towards you. A campaign marked `open: false` is
 * sealed ("coming soon", or the player's lock) and won't open. Play hands over to `campaign-play.ts`.
 */
import * as THREE from "three";
import { tokens, texture, loadImage } from "../canvas.js";
import { camera, shelfPose, type Pose } from "../camera.js";
import { lerp, span } from "../motion.js";
import { pointer, raycaster, renderer, say, scene } from "../room.js";
import { beginPlay, play, resetPlay } from "./campaign-play.js";
import { makePanel, type Place } from "./place.js";
import {
  bandPrint,
  CAMPAIGNS,
  CARDS,
  frontPrint,
  GUIDE_H,
  GUIDE_W,
  guidePrint,
  pagesPrint,
  spinePrint,
  trayPrint,
  type Campaign,
} from "./campaign-prints.js";

// ---------- sizes (the box lying flat: X across, Y up out of the lid, Z down the front picture) ----------

const W = 2.4;
const H = 3.0;
const D = 1.0;
const WALL = 0.03;
const LID_DROP = 0.5;
const INSET = 0.026;
const BASE_H = D - 0.04;
const CARD_W = 1.02;
const CARD_H = 1.43;

const OPEN_AT = new THREE.Vector3(0.45, 0, 0.35);
const LID_REST = new THREE.Vector3(W + 0.45, -(D - LID_DROP), 0.25);
// Out to the left of the open tray, near enough to read as part of the box (Adam, 2026-11-24: it sat too far left).
const CARD_END = new THREE.Vector3(-1.9, 2.55, 1.85);
const CARD_END_SCALE = 1.5;
const SHELF_X = [-3.4, 0, 3.4];
const SHELF_YAW = [-0.3, 0.26, 0.3];

/** Seconds into the opening at which everything has landed. */
export const OPENED = 3.4;
/** How high the villain card lifts, flat, before it turns: clear of the tray's walls (D tall) with room to spare. */
const CARD_LIFT = D + 0.8;

// ---------- a campaign box ----------

interface Box {
  campaign: Campaign;
  index: number;
  group: THREE.Group;
  lid: THREE.Group;
  card: THREE.Group;
  /** Where the villain card sits in the tray, in the box's own frame. */
  cardInTray: THREE.Matrix4;
  /** The encounter deck and the campaign guide in the tray: where cards leave from on the way to the table. */
  deck: THREE.Mesh;
  guide: THREE.Mesh;
  hover: number;
  shake: number;
}

function buildBox(c: Campaign, index: number, art: HTMLImageElement | null, backs: Backs): Box {
  const group = new THREE.Group();
  group.rotation.order = "YXZ";
  group.userData.box = index;

  const board = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.deep).multiplyScalar(0.9), roughness: 0.7 });
  const greyBoard = new THREE.MeshStandardMaterial({ color: 0x8d877d, roughness: 0.9 });
  const gloss = (map: THREE.Texture) =>
    new THREE.MeshPhysicalMaterial({
      map,
      roughness: c.open ? 0.42 : 0.18,
      clearcoat: c.open ? 0.55 : 1,
      clearcoatRoughness: c.open ? 0.3 : 0.05,
    });
  const shadowed = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  // The lid: a shell a little bigger than the tray, printed on all five outer faces.
  const lid = new THREE.Group();
  const slab = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), greyBoard));
    m.position.set(x, y, z);
    lid.add(m);
  };
  slab(W, WALL, H, 0, D - WALL / 2, 0);
  slab(WALL, LID_DROP, H, W / 2 - WALL / 2, D - LID_DROP / 2, 0);
  slab(WALL, LID_DROP, H, -W / 2 + WALL / 2, D - LID_DROP / 2, 0);
  slab(W, LID_DROP, WALL, 0, D - LID_DROP / 2, H / 2 - WALL / 2);
  slab(W, LID_DROP, WALL, 0, D - LID_DROP / 2, -H / 2 + WALL / 2);
  const print = (geometry: THREE.PlaneGeometry, material: THREE.Material, place: (m: THREE.Mesh) => void) => {
    const m = new THREE.Mesh(geometry, material);
    m.receiveShadow = true;
    place(m);
    lid.add(m);
  };
  const front = gloss(texture(frontPrint(c, art)));
  print(new THREE.PlaneGeometry(W, H), front, (m) => {
    m.rotation.x = -Math.PI / 2;
    m.position.y = D + 0.002;
  });
  const spine = gloss(texture(spinePrint(c)));
  for (const side of [1, -1])
    print(new THREE.PlaneGeometry(H, LID_DROP), spine, (m) => {
      m.rotation.y = (side * Math.PI) / 2;
      m.position.set(side * (W / 2 + 0.002), D - LID_DROP / 2, 0);
    });
  const band = gloss(texture(bandPrint(c)));
  for (const side of [1, -1])
    print(new THREE.PlaneGeometry(W, LID_DROP), band, (m) => {
      m.rotation.y = side > 0 ? 0 : Math.PI;
      m.position.set(0, D - LID_DROP / 2, side * (H / 2 + 0.002));
    });
  group.add(lid);

  // The tray, a touch smaller, printed inside.
  const tray = new THREE.Group();
  const innerW = W - 2 * INSET;
  const innerH = H - 2 * INSET;
  const wall = (w: number, d: number, x: number, z: number) => {
    const m = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, BASE_H, d), board));
    m.position.set(x, BASE_H / 2, z);
    tray.add(m);
  };
  wall(WALL, innerH, innerW / 2 - WALL / 2, 0);
  wall(WALL, innerH, -innerW / 2 + WALL / 2, 0);
  wall(innerW, WALL, 0, innerH / 2 - WALL / 2);
  wall(innerW, WALL, 0, -innerH / 2 + WALL / 2);
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(innerW, 0.03, innerH),
    new THREE.MeshStandardMaterial({ map: texture(trayPrint(c)), roughness: 0.8 }),
  );
  floor.position.y = 0.015;
  floor.receiveShadow = true;
  tray.add(floor);

  // What's inside: the encounter deck, some tokens, and the villain card on top of the deck slot.
  const deckTop = new THREE.MeshStandardMaterial({ map: backs.encounter, roughness: 0.6 });
  const edges = new THREE.MeshStandardMaterial({ color: 0xe9e3d6, roughness: 0.9 });
  const deck = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.26, CARD_H), [edges, edges, deckTop, edges, edges, edges]),
  );
  deck.position.set(0.55, 0.03 + 0.13, 0.55);
  tray.add(deck);
  // The villain's later stages, under the villain card.
  const stagesTop = new THREE.MeshStandardMaterial({ map: backs.villain, roughness: 0.6 });
  const stages = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(CARD_W, 0.08, CARD_H), [edges, edges, stagesTop, edges, edges, edges]),
  );
  stages.position.set(-0.55, 0.03 + 0.04, 0.55);
  stages.rotation.y = -0.04;
  tray.add(stages);
  // The campaign guide: a stapled booklet in the top corner.
  const pages = new THREE.MeshStandardMaterial({ map: texture(pagesPrint()), roughness: 0.9 });
  const cover = new THREE.MeshPhysicalMaterial({
    map: texture(guidePrint(c, art)),
    roughness: 0.55,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
  });
  const guide = shadowed(
    new THREE.Mesh(new THREE.BoxGeometry(GUIDE_W, 0.035, GUIDE_H), [pages, pages, cover, pages, pages, pages]),
  );
  guide.position.set(-0.5, 0.03 + 0.0175, -0.84);
  guide.rotation.y = 0.035;
  tray.add(guide);

  // The same tokens the game table uses, loose in the other corner.
  const loose: [name: string, count: number, x: number, y: number, z: number, turn: number][] = [
    ["damage", 3, 0.47, 0, -1.13, 0.2],
    ["damage", 1, 0.88, 0, -1.2, -0.4],
    ["damage", 1, 0.86, 0.053, -1.15, 0.9],
    ["threat", 2, 0.5, 0, -0.78, 0.1],
    ["acceleration", 1, 0.86, 0, -0.8, -0.2],
    ["stunned", 1, 0.48, 0, -0.45, 0.12],
    ["tough", 1, 0.93, 0, -0.42, -0.1],
  ];
  for (const [name, count, x, y, z, turn] of loose) {
    const token = tokens().build(name, count);
    token.rotation.set(-Math.PI / 2, 0, turn);
    token.position.set(x, 0.03 + y, z);
    token.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    tray.add(token);
  }
  group.add(tray);

  // The villain card is its own object so it can leave the box; `cardInTray` is where it lies inside.
  const card = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.MeshPhysicalMaterial({
      map: art ? texture(art) : null,
      color: art ? 0xffffff : new THREE.Color(c.mid),
      roughness: 0.35,
      clearcoat: 0.4,
    }),
  );
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(CARD_W, CARD_H),
    new THREE.MeshStandardMaterial({ map: backs.villain, roughness: 0.5 }),
  );
  back.rotation.y = Math.PI;
  face.castShadow = back.castShadow = true;
  card.add(face, back);
  scene.add(card);
  const cardInTray = new THREE.Matrix4().compose(
    new THREE.Vector3(-0.55, 0.03 + 0.08 + 0.003, 0.55),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.04)),
    new THREE.Vector3(1, 1, 1),
  );

  group.traverse((o) => (o.userData.box = index));
  scene.add(group);
  return { campaign: c, index, group, lid, card, cardInTray, deck, guide, hover: 0, shake: 0 };
}

interface Backs {
  villain: THREE.Texture | null;
  encounter: THREE.Texture | null;
}

// ---------- the page ----------

const panel = makePanel(
  "campaign",
  "room-campaign",
  `<header class="shelf-head">
    <p class="eyebrow">Marvel Champions</p>
    <h1>Choose your campaign</h1>
  </header>
  <div class="shelf-picks" role="group" aria-label="Campaigns"></div>
  <p class="shelf-hover-tag" hidden></p>
  <p class="shelf-hint">Pick a box to open it</p>
  <button type="button" class="btn btn-secondary room-back shelf-leave">Back</button>
  <section class="shelf-opened" hidden>
    <p class="eyebrow shelf-kicker"></p>
    <h2 class="shelf-title"></h2>
    <p class="shelf-blurb"></p>
    <div class="shelf-buttons">
      <button type="button" class="btn btn-primary" id="shelf-play">Play</button>
      <button type="button" class="btn btn-secondary" id="shelf-back">Back to the shelf</button>
    </div>
  </section>`,
);
const el = <T extends HTMLElement>(selector: string) => panel.querySelector(selector) as T;
const head = el<HTMLElement>(".shelf-head");
const hoverTag = el<HTMLParagraphElement>(".shelf-hover-tag");
const hint = el<HTMLParagraphElement>(".shelf-hint");
const opened = el<HTMLElement>(".shelf-opened");
const playButton = el<HTMLButtonElement>("#shelf-play");
const picks = el<HTMLElement>(".shelf-picks");
const leave = el<HTMLButtonElement>(".shelf-leave");

let boxes: Box[] = [];
/** The open box, or -1 on the shelf. */
let chosen = -1;
/** A box asked for from the keyboard while another was still going back onto the shelf. */
let queued = -1;
/** How far into the opening the chosen box is, in seconds (0 = on the shelf, OPENED = all out). */
let s = 0;
let target = 0;
let hovered = -1;
/** The camera is here, standing still: the boxes answer the pointer. */
let active = false;

function choose(index: number) {
  const box = boxes[index]!;
  if (!box.campaign.open) {
    box.shake = 1;
    const name = `${box.campaign.name[0]}${box.campaign.name.slice(1).toLowerCase()}`;
    say(box.campaign.lock ? `${name} is locked. ${box.campaign.lock}.` : `${name} is coming soon.`);
    return;
  }
  chosen = index;
  queued = -1;
  target = OPENED;
  hovered = -1;
  hoverTag.hidden = true;
  hint.hidden = true;
  leave.hidden = true;
  renderer.domElement.style.cursor = "default";
}

function close() {
  if (play.outro) return;
  target = 0;
  opened.hidden = true;
  // The keyboard goes back to the box it opened.
  picks.querySelectorAll("button")[chosen]?.focus({ preventScroll: true });
}

function showOpened(c: Campaign) {
  el(".shelf-kicker").textContent = `Campaign ${c.number}`;
  el(".shelf-title").textContent = c.name;
  el(".shelf-blurb").textContent = c.blurb;
  playButton.textContent = `Play vs ${c.name[0]}${c.name.slice(1).toLowerCase()}`;
  playButton.onclick = () => {
    if (c.villain) beginPlay(c.villain);
    else say("This villain's table is still being built.");
  };
  opened.hidden = false;
  playButton.focus();
  // `&play` presses Play at once (for checks).
  if (c.villain && play.pressPlay) {
    play.pressPlay = false;
    beginPlay(c.villain);
  }
}

function pickAt(x: number, y: number): number {
  pointer.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    boxes.map((b) => b.group),
    true,
  )[0];
  return hit ? (hit.object.userData.box as number) : -1;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!active || chosen >= 0) return;
  hovered = pickAt(event.clientX, event.clientY);
  renderer.domElement.style.cursor =
    hovered < 0 ? "default" : boxes[hovered]!.campaign.open ? "pointer" : "not-allowed";
});
renderer.domElement.addEventListener("pointerleave", () => {
  if (active) hovered = -1;
});
renderer.domElement.addEventListener("click", (event) => {
  if (!active || chosen >= 0) return;
  const index = pickAt(event.clientX, event.clientY);
  if (index >= 0) choose(index);
});
el("#shelf-back").addEventListener("click", close);

const scratch = {
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  endQuat: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
  look: new THREE.Object3D(),
};

/** Where the camera stands for the shelf now: further in as a box opens, round to the game's angle as Play runs. */
function view(out: Pose) {
  const outro = play.outro;
  const toGame = outro ? span(outro.u, 0, 1.2) : 0;
  shelfPose(out, span(s, 0.15, 1.2), toGame, active ? pointer.x : -9, camera.aspect);
}

/** Stands each box where it is in its opening (and the others where they have been cleared to). */
function pose(time: number, dt: number) {
  const outro = play.outro;
  const moved = span(s, 0, 0.9);
  const others = span(s, 0, 0.8);
  for (const box of boxes) {
    const { group, index } = box;
    box.hover = lerp(box.hover, hovered === index && box.campaign.open ? 1 : 0, 1 - Math.exp(-dt * 12));
    box.shake = Math.max(0, box.shake - dt * 1.8);
    const h = box.hover;
    const shelf = new THREE.Vector3(SHELF_X[index]!, H / 2 + 0.2 * h, -D / 2 + 0.35 * h);
    group.rotation.z = Math.sin(time * 38) * 0.035 * box.shake;
    if (index === chosen) {
      group.position.lerpVectors(shelf, OPEN_AT, moved);
      group.position.y += Math.sin(Math.PI * moved) * 0.9;
      group.rotation.x = lerp(Math.PI / 2 - 0.1 * h, 0, moved);
      group.rotation.y = lerp(SHELF_YAW[index]!, 0, moved);
      // Play: the emptied box and its lid are cleared off the table to the side.
      if (outro) group.position.x += 16 * span(outro.u, 0.1, 1.0);
    } else {
      const away = chosen >= 0 ? others : 0;
      const side = Math.sign(SHELF_X[index]! - (chosen >= 0 ? SHELF_X[chosen]! : 0)) || 1;
      group.position.copy(shelf);
      group.position.x += side * 10 * away;
      group.position.z -= 3 * away;
      group.rotation.x = Math.PI / 2 - 0.1 * h;
      group.rotation.y = SHELF_YAW[index]!;
    }

    // The lid: up, then over to the side, landing top up.
    const { lid } = box;
    if (index === chosen) {
      const up = span(s, 1.0, 0.6);
      const aside = span(s, 1.55, 0.75);
      const lift = 1.45;
      lid.position.set(
        LID_REST.x * aside,
        aside > 0 ? lerp(lift, LID_REST.y, aside) + Math.sin(Math.PI * aside) * 0.55 : lift * up,
        LID_REST.z * aside,
      );
      lid.rotation.set(0, 0.14 * aside, -Math.sin(Math.PI * aside) * 0.4 + Math.sin(Math.PI * up) * 0.04);
    } else {
      lid.position.set(0, 0, 0);
      lid.rotation.set(0, 0, 0);
    }
    group.updateMatrixWorld(true);

    // The villain card rides in the tray, lifts straight up, still flat, until it is clear of the tray's walls, and
    // only then turns and travels out to face you.
    const lift = index === chosen ? span(s, 2.0, 0.5) : 0;
    const travel = index === chosen ? span(s, 2.4, 0.95) : 0;
    scratch.matrix.multiplyMatrices(group.matrixWorld, box.cardInTray);
    scratch.matrix.decompose(scratch.pos, scratch.quat, scratch.scale);
    scratch.pos.y += CARD_LIFT * lift;
    const end = CARD_END.clone();
    if (index === chosen && s >= OPENED - 0.001) end.y += Math.sin(time * 1.6) * 0.06;
    scratch.look.position.copy(end);
    scratch.look.lookAt(camera.position);
    scratch.endQuat.copy(scratch.look.quaternion);
    box.card.position.lerpVectors(scratch.pos, end, travel);
    box.card.position.y += Math.sin(Math.PI * travel) * 0.35;
    box.card.quaternion.slerpQuaternions(scratch.quat, scratch.endQuat, travel);
    box.card.scale.setScalar(lerp(1, CARD_END_SCALE, travel));
    if (index === chosen && travel >= 1) box.card.rotation.z += Math.sin(time * 1.1) * 0.02;
    // Play: it rises up out of view as the box clears; the table brings in its own villain card from above.
    if (index === chosen && outro) box.card.position.y += 9 * span(outro.u, 0.05, 0.75);
  }
}

/** The hover tag's half width, measured when its text changes; where it points, worked out each frame. */
let tagHalf = 0;
const tagAt = new THREE.Vector3();
function placeHoverTag() {
  if (hovered < 0 || chosen >= 0) {
    hoverTag.hidden = true;
    return;
  }
  const box = boxes[hovered]!;
  const top = tagAt.set(0, 0, -H / 2).applyMatrix4(box.group.matrixWorld);
  top.y += 0.25;
  top.project(camera);
  const text = box.campaign.open
    ? `Campaign ${box.campaign.number} · ${box.campaign.name}`
    : `${box.campaign.name} · ${box.campaign.lock ?? "coming soon"}`;
  if (hoverTag.textContent !== text || hoverTag.hidden) {
    hoverTag.textContent = text;
    hoverTag.hidden = false;
    tagHalf = hoverTag.offsetWidth / 2 + 8;
  }
  // Kept on the screen: a box at the edge of a phone's view would push its tag off it.
  const half = tagHalf;
  hoverTag.style.left = `${Math.min(innerWidth - half, Math.max(half, ((top.x + 1) / 2) * innerWidth))}px`;
  hoverTag.style.top = `${((1 - top.y) / 2) * innerHeight}px`;
}

/** Back to the room as it first stands: every box on the shelf, nothing in flight. */
export function reset() {
  resetPlay();
  queued = -1;
  chosen = -1;
  s = target = 0;
  hovered = -1;
  head.style.opacity = "";
  hint.textContent = "Pick a box to open it";
  hint.hidden = false;
  leave.hidden = false;
  opened.hidden = true;
  hoverTag.hidden = true;
  renderer.domElement.style.cursor = "default";
}

async function build() {
  // The player's locks seal a box the same way coming soon does, saying what opens it. Drawn once: main.ts starts the
  // page again when a villain unlocks, so the box is drawn open.
  const campaigns = CAMPAIGNS.map((c) => {
    const lock = c.villain ? play.host?.lock?.(c.villain) : null;
    return lock ? { ...c, open: false, lock } : c;
  });
  await Promise.all([document.fonts.load("120px Bangers"), document.fonts.load("900 40px 'Public Sans'")]);
  const [villainBack, encounterBack, ...arts] = await Promise.all([
    loadImage(`${CARDS}marvel-villain-back.webp`),
    loadImage(`${CARDS}marvel-encounter-back.webp`),
    ...campaigns.map((c) => loadImage(c.scan)),
  ]);
  const backs: Backs = {
    villain: villainBack ? texture(villainBack) : null,
    encounter: encounterBack ? texture(encounterBack) : null,
  };
  boxes = campaigns.map((c, i) => buildBox(c, i, arts[i] ?? null, backs));
  // The boxes from the keyboard (and for screen readers): a button each, which lifts its box while it has the focus.
  campaigns.forEach((c, i) => {
    const name = `${c.name[0]}${c.name.slice(1).toLowerCase()}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = c.open ? `Open ${name}` : `${name} (${c.lock ?? "coming soon"})`;
    button.onclick = () => {
      if (play.outro) return;
      // On the shelf, or this box still going back onto it (it turns round and opens again).
      if (chosen < 0 || (chosen === i && target === 0)) choose(i);
      // Another box, asked for while the last one is still going back: it opens as soon as that one is home (the
      // press used to be dropped, so Escape then a different box did nothing).
      else if (chosen !== i && target === 0) queued = i;
    };
    button.onfocus = () => {
      if (chosen < 0) hovered = i;
    };
    button.onblur = () => {
      if (hovered === i) hovered = -1;
    };
    picks.append(button);
  });
}

/** Moves the opening on by `dt` seconds towards where it is headed. */
function advance(dt: number) {
  if (s === target) return;
  const speed = target > s ? 1 : 1.7;
  s = target > s ? Math.min(target, s + dt * speed) : Math.max(target, s - dt * speed);
  if (s === OPENED && chosen >= 0) showOpened(boxes[chosen]!.campaign);
  if (s === 0 && chosen >= 0) {
    chosen = -1;
    hint.hidden = false;
    leave.hidden = false;
    if (queued >= 0) {
      const next = queued;
      queued = -1;
      choose(next);
    }
  }
}

/**
 * ?open=rhino opens a box at once; &at=1.8 freezes the opening that many seconds in (for screenshots). Only the first
 * time: the address loses them once the game is on the table.
 */
export function openFromAddress() {
  const params = new URLSearchParams(location.search);
  const preset = boxes.findIndex((b) => b.campaign.id === params.get("open") && b.campaign.open);
  if (preset >= 0) {
    const at = Number(params.get("at") ?? OPENED);
    chosen = preset;
    s = target = Math.min(OPENED, Math.max(0, at));
    hint.hidden = true;
    leave.hidden = true;
    play.pressPlay = params.has("play");
    if (s === OPENED) showOpened(boxes[preset]!.campaign);
  }
}

/**
 * The keyboard's (and a pad's) way to the boxes, and a screen reader's: a see-through button over each box, which
 * lifts its box while it has the focus. The pointer passes through them to the room, which picks boxes itself.
 */
const corner = new THREE.Vector3();
function placePicks() {
  const buttons = picks.children;
  boxes.forEach((box, i) => {
    const button = buttons[i] as HTMLElement | undefined;
    if (!button) return;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const x of [-W / 2, W / 2])
      for (const y of [0, D])
        for (const z of [-H / 2, H / 2]) {
          corner.set(x, y, z).applyMatrix4(box.group.matrixWorld).project(camera);
          const px = ((corner.x + 1) / 2) * innerWidth;
          const py = ((1 - corner.y) / 2) * innerHeight;
          left = Math.min(left, px);
          right = Math.max(right, px);
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.style.width = `${Math.max(1, right - left)}px`;
    button.style.height = `${Math.max(1, bottom - top)}px`;
  });
}

let built: Promise<void> | null = null;

export const campaignPlace: Place = {
  id: "campaign",
  label: "Campaign",
  line: "Rhino, then Klaw, then Ultron",
  panel,
  ready: () => true,
  view,
  build: () => (built ??= build()),
  enter() {
    active = true;
    if (chosen >= 0 && s === OPENED) playButton.focus({ preventScroll: true });
    else picks.querySelector("button")?.focus({ preventScroll: true });
  },
  leave() {
    active = false;
    hovered = -1;
    queued = -1;
    hoverTag.hidden = true;
    renderer.domElement.style.cursor = "default";
  },
  back() {
    // An open box (or one opening) goes back on the shelf first.
    if (chosen >= 0 && target > 0) {
      close();
      return true;
    }
    return false;
  },
  step(dt, time) {
    if (!built) return;
    advance(dt);
    pose(time, dt);
    if (active) {
      placeHoverTag();
      placePicks();
    }
  },
};

/** Whether the boxes have been built (they stand on the table, seen from the doorway too). */
export const boxesBuilt = () => boxes.length > 0;
