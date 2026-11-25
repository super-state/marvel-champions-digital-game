/**
 * The playmats: today's night-city cloth, and one for each villain beaten (the first rewards, `docs/project/room-plan.md`
 * "Achievements, stats and rewards"). Each villain's mat is earned by the achievement whose reward is `mat:<villain>`
 * (`record/achievements.ts`); the trophy cabinet (`room/places/trophies.ts`) offers the ones earned and remembers the
 * choice here, on this device. `matPrint` (`table.ts`) draws whichever is chosen, for the table and for the mat that
 * rolls out from the campaign box, and draws it again when the choice changes.
 *
 * Our own design, drawn by code: the same rooftop picture today's mat uses, recoloured, with a pattern of the
 * villain's own (Rhino's cracked concrete, Klaw's sound waves, Ultron's circuitry), kept as dark as today's so the
 * cards, plates and pills on it read the same.
 */

export type MatId = "night" | "rhino" | "klaw" | "ultron";

export interface MatLook {
  readonly id: MatId;
  readonly name: string;
  /** The achievement reward that earns it (`mat:rhino`); null for the mat everyone has. */
  readonly reward: string | null;
  /** The cloth under everything, and the back of the cloth (the roll as it unrolls from the box). */
  readonly base: string;
  readonly back: string;
  /** How strongly the rooftop picture shows, the colour it is dyed, and how strongly. */
  readonly art: number;
  readonly dye: string | null;
  readonly dyeStrength: number;
  /** The wash from the far (villain) edge to the near (player) edge: three stops, rgba. */
  readonly wash: readonly [string, string, string];
  /** The woven lines across the cloth, and the stitches round the edge. */
  readonly weave: string;
  readonly stitch: string;
  /** The villain's own pattern, faint, in this colour. */
  readonly pattern: "none" | "cracks" | "waves" | "circuits";
  readonly ink: string;
  /** A swatch colour for the chooser. */
  readonly swatch: string;
}

export const MATS: readonly MatLook[] = [
  {
    id: "night",
    name: "Night city",
    reward: null,
    base: "#1a293b",
    back: "#152032",
    art: 0.67,
    dye: null,
    dyeStrength: 0,
    wash: ["rgba(15, 31, 54, .09)", "rgba(11, 27, 49, .24)", "rgba(6, 16, 29, .77)"],
    weave: "rgba(193, 210, 215, .047)",
    stitch: "rgba(167, 184, 186, .5)",
    pattern: "none",
    ink: "",
    swatch: "#1a293b",
  },
  {
    id: "rhino",
    name: "Rhino",
    reward: "mat:rhino",
    base: "#18201a",
    back: "#121a13",
    art: 0.5,
    dye: "#4b5a45",
    dyeStrength: 0.8,
    wash: ["rgba(20, 30, 20, .12)", "rgba(16, 24, 16, .3)", "rgba(8, 12, 8, .8)"],
    weave: "rgba(200, 214, 190, .045)",
    stitch: "rgba(159, 194, 90, .55)",
    pattern: "cracks",
    ink: "rgba(159, 194, 90, .1)",
    swatch: "#4b5a45",
  },
  {
    id: "klaw",
    name: "Klaw",
    reward: "mat:klaw",
    base: "#150b1d",
    back: "#100816",
    art: 0.45,
    dye: "#4a1c62",
    dyeStrength: 0.5,
    wash: ["rgba(40, 12, 50, .12)", "rgba(28, 8, 38, .3)", "rgba(12, 4, 18, .8)"],
    weave: "rgba(226, 196, 232, .045)",
    stitch: "rgba(226, 54, 75, .55)",
    pattern: "waves",
    ink: "rgba(226, 54, 75, .15)",
    swatch: "#5a2177",
  },
  {
    id: "ultron",
    name: "Ultron",
    reward: "mat:ultron",
    base: "#211812",
    back: "#19110c",
    art: 0.5,
    dye: "#8a4b22",
    dyeStrength: 0.72,
    wash: ["rgba(44, 24, 10, .12)", "rgba(32, 18, 8, .3)", "rgba(14, 8, 4, .8)"],
    weave: "rgba(240, 210, 180, .045)",
    stitch: "rgba(255, 138, 42, .55)",
    pattern: "circuits",
    ink: "rgba(255, 138, 42, .09)",
    swatch: "#8a4b22",
  },
];

export const DEFAULT_MAT: MatId = "night";
const KEY = "battle-mat";
/** Fired on the window when the chosen mat changes, so a mat already drawn is drawn again. */
export const MAT_CHANGED = "battle-mat-changed";

export const matLook = (id: string | null | undefined): MatLook => MATS.find((m) => m.id === id) ?? MATS[0]!;

/** The mat chosen on this device (the default until one is chosen). */
export function chosenMat(): MatId {
  try {
    return matLook(localStorage.getItem(KEY)).id;
  } catch {
    return DEFAULT_MAT;
  }
}

/** Chooses a mat and draws it again wherever one is drawn. Whether it is earned is the cabinet's to check. */
export function chooseMat(id: MatId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private windows may refuse storage: the choice lasts this visit only.
    fallback = id;
  }
  dispatchEvent(new Event(MAT_CHANGED));
}
let fallback: MatId | null = null;
/** The chosen mat, with a choice a private window couldn't store. */
export const currentMat = (): MatId => fallback ?? chosenMat();
