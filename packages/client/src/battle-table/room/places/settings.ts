/**
 * Settings: the radio on top of the cube shelf. The camera goes up close to it and the settings the table's own menu
 * has (which side the card panel sits, sound on or off) are laid over the picture, read from and written to the table
 * through `ShelfHost.settings`, so the two always agree.
 */
import * as THREE from "three";
import { canvas, texture } from "../canvas.js";
import { camera, setPose } from "../camera.js";
import { BACKDROP, ROOM, scene } from "../room.js";
import { fitNarrow, makePanel, type Place } from "./place.js";

/** One setting the table offers, with its choices (`main.ts` makes them from its own menu's). */
export interface RoomSetting {
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  value(): string;
  choose(value: string): void;
}

/** The radio, on the shelf's top near its right end. */
const RADIO = { x: 3.3, z: -8.45, width: 1.9, height: 1.15, depth: 0.75 };

const panel = makePanel(
  "settings",
  "room-place room-settings",
  `<header class="room-place-head">
    <p class="eyebrow">Marvel Champions</p>
    <h2>Settings</h2>
  </header>
  <div class="room-settings-rows"></div>
  <button type="button" class="btn btn-secondary room-back">Back</button>`,
);
const rows = panel.querySelector<HTMLElement>(".room-settings-rows")!;
let settings: readonly RoomSetting[] = [];

/** The settings to offer (from the table); drawn again each time the camera arrives, so they show what is set now. */
export function offerSettings(next: readonly RoomSetting[]) {
  settings = next;
}

function paint() {
  rows.replaceChildren();
  if (!settings.length) {
    const none = document.createElement("p");
    none.className = "room-soon";
    none.textContent = "Nothing to set here yet.";
    rows.append(none);
    return;
  }
  settings.forEach((setting, index) => {
    const row = document.createElement("div");
    row.className = "menu-setting";
    row.setAttribute("role", "group");
    const label = document.createElement("span");
    label.id = `room-setting-${index}`;
    label.textContent = setting.label;
    row.setAttribute("aria-labelledby", label.id);
    row.append(label);
    const buttons = setting.options.map((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-option";
      button.textContent = option.label;
      button.dataset.value = option.value;
      button.onclick = () => {
        setting.choose(option.value);
        for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === setting.value()));
      };
      return button;
    });
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.value === setting.value()));
    row.append(...buttons);
    rows.append(row);
  });
}

/** The radio's front: a speaker grille, and a dial window with its needle. */
function radioFront(): HTMLCanvasElement {
  const [cv, g] = canvas(512, 310);
  g.fillStyle = "#3b2515";
  g.fillRect(0, 0, 512, 310);
  // The grille cloth, with gold slats across it.
  g.fillStyle = "#6e5a3c";
  g.beginPath();
  g.roundRect(30, 30, 290, 250, 30);
  g.fill();
  g.strokeStyle = "#c9a45c";
  g.lineWidth = 7;
  for (let x = 60; x < 300; x += 32) {
    g.beginPath();
    g.moveTo(x, 44);
    g.lineTo(x, 266);
    g.stroke();
  }
  // The dial window.
  g.fillStyle = "#f2c46b";
  g.beginPath();
  g.roundRect(345, 40, 140, 120, 14);
  g.fill();
  g.fillStyle = "#3b2515";
  g.font = "700 17px 'Public Sans', sans-serif";
  g.textAlign = "center";
  for (let i = 0; i < 5; i++) g.fillRect(360 + i * 27, 120, 3, 22);
  g.fillText("FM  ·  AM", 415, 80);
  g.fillStyle = "#b3261e";
  g.fillRect(412, 96, 4, 52);
  return cv;
}

let built = false;
function buildRadio() {
  if (built) return;
  built = true;
  const { x, z, width, height, depth } = RADIO;
  const radio = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wood);
  body.position.y = height / 2;
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(width - 0.1, height - 0.12),
    new THREE.MeshStandardMaterial({
      map: texture(radioFront()),
      roughness: 0.6,
      emissive: 0x332008,
      emissiveIntensity: 0.6,
    }),
  );
  front.position.set(0, height / 2, depth / 2 + 0.003);
  radio.add(body, front);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.35, metalness: 0.7 });
  for (const dx of [0.42, 0.72]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.1, 18), brass);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(dx, 0.22, depth / 2 + 0.05);
    radio.add(knob);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.6, 6), brass);
  antenna.position.set(-0.55, height + 0.7, -0.15);
  antenna.rotation.z = 0.45;
  radio.add(antenna);
  radio.position.set(x, ROOM.SHELF_TOP, z);
  radio.rotation.y = -0.12;
  // With the shelf, on its soft layer: the shelf's depth of field takes it too, and it is sharp when the camera is here.
  radio.traverse((o) => {
    o.castShadow = true;
    o.layers.set(BACKDROP);
  });
  scene.add(radio);
}

export const settingsPlace: Place = {
  id: "settings",
  label: "Settings",
  line: "Sound, and which side the card panel sits",
  panel,
  ready: () => true,
  view(out) {
    const { x, z, height } = RADIO;
    setPose(out, [x - 2.2, ROOM.SHELF_TOP + 2.6, z + 8.4], [x - 0.3, ROOM.SHELF_TOP + height * 0.5, z], 34, [8, 32], 0);
    fitNarrow(out, camera.aspect, 1.1, 0.6);
  },
  build() {
    buildRadio();
    return Promise.resolve();
  },
  enter: paint,
  leave() {},
  back: () => false,
  step() {},
};

/** The radio is part of the room's furniture: it stands from the start. */
export const furnishSettings = buildRadio;
