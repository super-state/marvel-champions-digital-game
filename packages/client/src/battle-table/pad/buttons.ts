/**
 * The standard gamepad layout's buttons and sticks, and what each button does while a trigger is held.
 *
 * The 3D table's own copy of what it uses from the old 2D game's `src/view/gamepad.ts` and
 * `src/view/pad-layer-bindings.ts` (the classic board's map, `docs/controller-support.md` decision 9), so the table keeps
 * its controller when the old game goes.
 */

/**
 * Indices from the Web Gamepad API's "standard" layout, which browsers map the overwhelming majority of controllers
 * onto: face buttons 0-3 (bottom, right, left, top), bumpers 4-5, triggers 6-7, View / Menu 8-9, stick presses 10-11,
 * the D-pad 12-15 and the pad's own home / guide / PS button 16 (browsers often keep it for themselves; never bound).
 */
export const GAMEPAD_BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  view: 8,
  menu: 9,
  l3: 10,
  r3: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  home: 16,
} as const;

/** The standard layout's stick axes: left stick X/Y, right stick X/Y, each -1 (left/up) to 1 (right/down). */
export const GAMEPAD_AXIS = { leftX: 0, leftY: 1, rightX: 2, rightY: 3 } as const;

export type PadLayer = "lt" | "rt";

export type LayerActionId =
  | "attack"
  | "thwart"
  | "recover"
  | "changeForm"
  | "undo"
  | "endTurn"
  | "ability1"
  | "ability2"
  | "ability3"
  | "ability4"
  | "pagePrevious"
  | "pageNext";

/** The standard-layout index of each trigger, for the glyph that says which one to hold. */
export const LAYER_TRIGGER_INDEX: Readonly<Record<PadLayer, number>> = { lt: 6, rt: 7 };

/** Abilities shown per page: the four face buttons. */
export const ABILITIES_PER_PAGE = 4;

/** Face and bumper positions a layer binds, in the order the sheet lists them. */
export const LAYER_BUTTONS: Readonly<Record<PadLayer, readonly (readonly [number, LayerActionId])[]>> = {
  lt: [
    [0, "attack"],
    [2, "thwart"],
    [3, "recover"],
    [1, "changeForm"],
    [4, "undo"],
    [5, "endTurn"],
  ],
  rt: [
    [0, "ability1"],
    [2, "ability2"],
    [3, "ability3"],
    [1, "ability4"],
    [4, "pagePrevious"],
    [5, "pageNext"],
  ],
};

/** The action a button means while `layer` is held, from the press's standard-layout index (after the swap). */
export function layerActionOf(layer: PadLayer, meaningIndex: number): LayerActionId | null {
  return LAYER_BUTTONS[layer].find(([index]) => index === meaningIndex)?.[1] ?? null;
}

/** The ability's slot (0-3) an action is, or null when it is not an ability action. */
export function abilitySlotOf(action: LayerActionId): number | null {
  const slot = (["ability1", "ability2", "ability3", "ability4"] as const).indexOf(action as "ability1");
  return slot < 0 ? null : slot;
}
