/** Home groups destinations by what the player came to do. */
export const HOME_SECTIONS = ["play", "library", "records"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];
export type HomeDestination =
  | "new-game"
  | "campaign"
  | "civil-war"
  | "how-to-play"
  | "decks"
  | "extras"
  | "mod-store"
  | "past-games"
  | "trophies"
  | "stats";

export function homeDestinations(section: HomeSection, civilWar = false): readonly HomeDestination[] {
  switch (section) {
    case "play":
      return ["new-game", "campaign", ...(civilWar ? (["civil-war"] as const) : []), "how-to-play"];
    case "library":
      return ["decks", "extras", "mod-store"];
    case "records":
      return ["past-games", "stats", "trophies"];
  }
}
