import rooftop from "../art/tabletop/rooftop.webp?url";
import concreteBreach from "../art/tabletop/mats/concrete-breach.webp?url";
import sonicVault from "../art/tabletop/mats/sonic-vault.webp?url";
import machineFoundry from "../art/tabletop/mats/machine-foundry.webp?url";
import crimsonCitadel from "../art/tabletop/mats/crimson-citadel.webp?url";
import desertRuins from "../art/tabletop/mats/desert-ruins.webp?url";
import orbitalDock from "../art/tabletop/mats/orbital-dock.webp?url";
import glacialOutpost from "../art/tabletop/mats/glacial-outpost.webp?url";
import tidalTemple from "../art/tabletop/mats/tidal-temple.webp?url";
import neonBackstreet from "../art/tabletop/mats/neon-backstreet.webp?url";
import astralSanctum from "../art/tabletop/mats/astral-sanctum.webp?url";

export type MatId =
  | "night"
  | "rhino"
  | "klaw"
  | "ultron"
  | "all-villains"
  | "black-panther"
  | "captain-marvel"
  | "aspect-protection"
  | "aspect-justice"
  | "spider-man"
  | "all-villains-expert";

export interface MatLook {
  readonly id: MatId;
  readonly name: string;
  /** The achievement reward that earns it, or null for the default mat. */
  readonly reward: string | null;
  readonly artwork: string;
  readonly base: string;
  /** The back of the cloth, visible when the mat unrolls from a campaign box. */
  readonly back: string;
  readonly artOpacity: number;
  /** The wash from the far (villain) edge to the near (player) edge. */
  readonly wash: readonly [string, string, string];
  readonly weave: string;
  readonly stitch: string;
  readonly swatch: string;
}

function illustratedMat(
  id: MatId,
  name: string,
  reward: string,
  artwork: string,
  base: string,
  accent: string,
): MatLook {
  return {
    id,
    name,
    reward,
    artwork,
    base,
    back: base,
    artOpacity: 0.87,
    wash: ["rgba(0, 0, 0, .04)", "rgba(0, 0, 0, .12)", "rgba(0, 0, 0, .36)"],
    weave: "rgba(210, 210, 210, .045)",
    stitch: accent + "80",
    swatch: accent,
  };
}

export const MATS: readonly MatLook[] = [
  {
    id: "night",
    name: "Night city",
    reward: null,
    artwork: rooftop,
    base: "#1a293b",
    back: "#152032",
    artOpacity: 0.67,
    wash: ["rgba(15, 31, 54, .09)", "rgba(11, 27, 49, .24)", "rgba(6, 16, 29, .77)"],
    weave: "rgba(193, 210, 215, .047)",
    stitch: "rgba(167, 184, 186, .5)",
    swatch: "#1a293b",
  },
  illustratedMat("rhino", "Concrete Breach", "mat:rhino", concreteBreach, "#18201a", "#798249"),
  illustratedMat("klaw", "Sonic Vault", "mat:klaw", sonicVault, "#21131c", "#9b465e"),
  illustratedMat("ultron", "Machine Foundry", "mat:ultron", machineFoundry, "#211812", "#b56f37"),
  illustratedMat("all-villains", "Crimson Citadel", "mat:all-villains", crimsonCitadel, "#211416", "#aa483f"),
  illustratedMat("black-panther", "Desert Ruins", "mat:black-panther", desertRuins, "#241b13", "#ab7849"),
  illustratedMat("captain-marvel", "Orbital Dock", "mat:captain-marvel", orbitalDock, "#14192c", "#5c68a7"),
  illustratedMat("aspect-protection", "Glacial Outpost", "mat:aspect-protection", glacialOutpost, "#132735", "#5b9ab6"),
  illustratedMat("aspect-justice", "Tidal Temple", "mat:aspect-justice", tidalTemple, "#122826", "#4c9985"),
  illustratedMat("spider-man", "Neon Backstreet", "mat:spider-man", neonBackstreet, "#1b162e", "#9053af"),
  illustratedMat(
    "all-villains-expert",
    "Astral Sanctum",
    "mat:all-villains-expert",
    astralSanctum,
    "#201520",
    "#9f7298",
  ),
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
