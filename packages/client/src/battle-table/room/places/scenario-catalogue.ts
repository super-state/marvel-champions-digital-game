/**
 * Every box with scenarios in it, for the scenario shelf (`scenario-shelf.ts`): the Core Set, each campaign box, and
 * each scenario pack, in the order they came out, with the scenarios inside each and the villain card that fronts
 * it. Taken from `@mc/content`'s packs and scenarios (`scenario-catalogue.test.ts` checks it still matches them):
 * a box is "big" (the Core Set and the campaign boxes, four or more scenarios) or "small" (a scenario pack). The
 * scan is the villain card's file under the card art's `bundles/cards/`.
 */

export type BoxSize = "big" | "small";

export interface ShelfScenario {
  /** `@mc/content`'s scenario id (`rhino`). */
  readonly id: string;
  readonly name: string;
  /** The villain card that fronts it. */
  readonly villain: string;
  readonly scan: string | null;
}

export interface ShelfProduct {
  /** `@mc/content`'s pack code (`core`, `trors`). */
  readonly code: string;
  readonly name: string;
  readonly cycle: string;
  readonly released: string;
  readonly size: BoxSize;
  readonly scenarios: readonly ShelfScenario[];
}

export const SHELF_PRODUCTS: readonly ShelfProduct[] = [
  {
    code: "core",
    name: "Core Set",
    cycle: "core",
    released: "2019-11-01",
    size: "big",
    scenarios: [
      { id: "rhino", name: "Rhino", villain: "01094", scan: "01094.png" },
      { id: "klaw", name: "Klaw", villain: "01113", scan: "01113.png" },
      { id: "ultron", name: "Ultron", villain: "01134", scan: "01134.png" },
    ],
  },
  {
    code: "gob",
    name: "Green Goblin",
    cycle: "wave1",
    released: "2019-12-20",
    size: "small",
    scenarios: [
      { id: "risky-business", name: "Risky Business", villain: "02001a", scan: "02001a.png" },
      { id: "mutagen-formula", name: "Mutagen Formula", villain: "02014", scan: "02014.png" },
    ],
  },
  {
    code: "twc",
    name: "The Wrecking Crew",
    cycle: "wave1",
    released: "2020-02-07",
    size: "small",
    scenarios: [{ id: "breakout", name: "Breakout", villain: "07002", scan: "07002.png" }],
  },
  {
    code: "trors",
    name: "The Rise of Red Skull",
    cycle: "cycle1",
    released: "2020-09-04",
    size: "big",
    scenarios: [
      { id: "crossbones", name: "Crossbones", villain: "04058", scan: "04058.png" },
      { id: "absorbing-man", name: "Absorbing Man", villain: "04076", scan: "04076.png" },
      { id: "taskmaster", name: "Taskmaster", villain: "04093", scan: "04093.png" },
      { id: "zola", name: "Zola", villain: "04109", scan: "04109.png" },
      { id: "red-skull", name: "Red Skull", villain: "04125", scan: "04125.png" },
    ],
  },
  {
    code: "toafk",
    name: "The Once and Future Kang",
    cycle: "cycle1",
    released: "2020-10-02",
    size: "small",
    scenarios: [{ id: "kang", name: "Kang", villain: "11001", scan: "11001.png" }],
  },
  {
    code: "gmw",
    name: "Galaxy's Most Wanted",
    cycle: "cycle3",
    released: "2021-04-02",
    size: "big",
    scenarios: [
      { id: "brotherhood-of-badoon", name: "Brotherhood of Badoon", villain: "16058", scan: "16058.png" },
      { id: "infiltrate-the-museum", name: "Infiltrate the Museum", villain: "16070", scan: "16070.png" },
      { id: "escape-the-museum", name: "Escape the Museum", villain: "16080a", scan: "16080a.png" },
      { id: "nebula", name: "Nebula", villain: "16088", scan: "16088.png" },
      { id: "ronan-the-accuser", name: "Ronan the Accuser", villain: "16103", scan: "16103.png" },
    ],
  },
  {
    code: "mts",
    name: "The Mad Titan's Shadow",
    cycle: "cycle4",
    released: "2021-10-29",
    size: "big",
    scenarios: [
      { id: "ebony-maw", name: "Ebony Maw", villain: "21071", scan: "21071.png" },
      { id: "tower-defense", name: "Tower Defense", villain: "21092", scan: "21092.png" },
      { id: "thanos", name: "Thanos", villain: "21111", scan: "21111.png" },
      { id: "hela", name: "Hela", villain: "21136a", scan: "21136a.png" },
      { id: "loki", name: "Loki", villain: "21160", scan: "21160.png" },
    ],
  },
  {
    code: "hood",
    name: "The Hood",
    cycle: "cycle4",
    released: "2021-11-26",
    size: "small",
    scenarios: [{ id: "the-hood", name: "The Hood", villain: "24001", scan: "24001.png" }],
  },
  {
    code: "sm",
    name: "Sinister Motives",
    cycle: "cycle5",
    released: "2022-04-08",
    size: "big",
    scenarios: [
      { id: "sandman", name: "Sandman", villain: "27061", scan: "27061.png" },
      { id: "venom", name: "Venom", villain: "27073", scan: "27073.png" },
      { id: "mysterio", name: "Mysterio", villain: "27084", scan: "27084.png" },
      { id: "sinister-six", name: "The Sinister Six", villain: "27094", scan: "27094.png" },
      { id: "venom-goblin", name: "Venom Goblin", villain: "27113", scan: "27113.png" },
    ],
  },
  {
    code: "mut_gen",
    name: "Mutant Genesis",
    cycle: "cycle6",
    released: "2022-09-30",
    size: "big",
    scenarios: [
      { id: "sabretooth", name: "Sabretooth", villain: "32060", scan: "32060.png" },
      { id: "project-wideawake", name: "Project Wideawake", villain: "32084", scan: "32084.png" },
      { id: "master-mold", name: "Master Mold", villain: "32109", scan: "32109.png" },
      { id: "mansion-attack", name: "Mansion Attack", villain: "32121a", scan: "32121a.png" },
      { id: "magneto", name: "Magneto", villain: "32138", scan: "32138.png" },
    ],
  },
  {
    code: "mojo",
    name: "MojoMania",
    cycle: "cycle6",
    released: "2022-11-11",
    size: "small",
    scenarios: [
      { id: "magog", name: "MaGog", villain: "39001a", scan: "39001a.png" },
      { id: "spiral", name: "Spiral", villain: "39012a", scan: "39012a.png" },
      { id: "mojo", name: "Mojo", villain: "39022", scan: "39022.png" },
    ],
  },
  {
    code: "next_evol",
    name: "NeXt Evolution",
    cycle: "cycle7",
    released: "2023-08-18",
    size: "big",
    scenarios: [
      { id: "morlock-siege", name: "Morlock Siege", villain: "40070a", scan: "40070a.png" },
      { id: "on-the-run", name: "On the Run", villain: "40070a", scan: "40070a.png" },
      { id: "juggernaut", name: "Juggernaut", villain: "40118", scan: "40118.png" },
      { id: "mister-sinister", name: "Mister Sinister", villain: "40136", scan: "40136.png" },
      { id: "stryfe", name: "Stryfe", villain: "40163", scan: "40163.png" },
    ],
  },
  {
    code: "aoa",
    name: "Age of Apocalypse",
    cycle: "cycle8",
    released: "2024-03-29",
    size: "big",
    scenarios: [
      { id: "unus", name: "Unus", villain: "45059", scan: "45059.png" },
      { id: "four-horsemen", name: "Four Horsemen", villain: "45081a", scan: "45081a.png" },
      { id: "apocalypse", name: "Apocalypse", villain: "45101a", scan: "45101a.png" },
      { id: "dark-beast", name: "Dark Beast", villain: "45118", scan: "45118.png" },
      { id: "en-sabah-nur", name: "En Sabah Nur", villain: "45184a", scan: "45184a.png" },
    ],
  },
  {
    code: "aos",
    name: "Agents of S.H.I.E.L.D.",
    cycle: "cycle9",
    released: "2025-03-07",
    size: "big",
    scenarios: [
      { id: "black-widow", name: "Black Widow", villain: "50064", scan: "50064.png" },
      { id: "batroc", name: "Batroc", villain: "50086a", scan: "50086a.png" },
      { id: "modok", name: "M.O.D.O.K.", villain: "50103a", scan: "50103a.png" },
      { id: "thunderbolts", name: "Thunderbolts", villain: "50129a", scan: "50129a.png" },
      { id: "baron-zemo", name: "Baron Zemo", villain: "50165a", scan: "50165a.png" },
    ],
  },
  {
    code: "tt",
    name: "Trickster Takeover",
    cycle: "cycle9",
    released: "2025-08-15",
    size: "small",
    scenarios: [
      { id: "enchantress", name: "Enchantress", villain: "55001", scan: "55001.png" },
      { id: "god-of-lies", name: "God of Lies", villain: "55029a", scan: "55029a.png" },
    ],
  },
  {
    code: "cw",
    name: "Civil War",
    cycle: "cycle10",
    released: "2025-10-17",
    size: "big",
    scenarios: [
      { id: "registration-iron-man", name: "Registration: Iron Man", villain: "56059", scan: "56059.png" },
      { id: "registration-captain-marvel", name: "Registration: Captain Marvel", villain: "56092", scan: "56092.png" },
      { id: "resistance-captain-america", name: "Resistance: Captain America", villain: "56137", scan: "56137.png" },
      { id: "resistance-spider-woman", name: "Resistance: Spider-Woman", villain: "56168", scan: "56168.png" },
    ],
  },
  {
    code: "synthezoid",
    name: "Synthezoid Smackdown",
    cycle: "cycle10",
    released: "2025-12-05",
    size: "small",
    scenarios: [
      { id: "registration-she-hulk", name: "Registration: She-Hulk", villain: "57001", scan: "57001.png" },
      { id: "resistance-vision", name: "Resistance: Vision", villain: "57040", scan: "57040.png" },
    ],
  },
  {
    code: "fne",
    name: "Fear No Evil",
    cycle: "cycle11",
    released: "2026-07-24",
    size: "big",
    scenarios: [
      { id: "art-museum-heist", name: "Art Museum Heist", villain: "60086", scan: "60086.png" },
      { id: "the-getaway", name: "The Getaway", villain: "60086", scan: "60086.png" },
      { id: "protection-racket", name: "Protection Racket", villain: "60086", scan: "60086.png" },
      { id: "the-raft-breakout", name: "The Raft Breakout", villain: "60086", scan: "60086.png" },
      { id: "stop-the-presses", name: "Stop the Presses!", villain: "60086", scan: "60086.png" },
      { id: "kingpin", name: "Kingpin", villain: "60159a", scan: "60159a.png" },
    ],
  },
  {
    code: "shadowland",
    name: "Shadowland",
    cycle: "cycle11",
    released: "2026-10-16",
    size: "small",
    scenarios: [
      { id: "shadows-in-the-night", name: "Shadows in the Night", villain: "65012a", scan: "65012a.png" },
      { id: "shadow-labyrinth", name: "Shadow Labyrinth", villain: "65037", scan: "65037.png" },
      { id: "heart-of-shadow", name: "Heart of Shadow", villain: "65057", scan: "65057.png" },
    ],
  },
];
