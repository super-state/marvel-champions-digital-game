/**
 * Every hero in the game, for the hero shelf at the bench (`decks.ts`): one deck box each, in release order, grouped by
 * the release they came in. Only the heroes the table can deal (`HEROES` in `model.ts`) are lit; the rest stand greyed
 * out, to show the whole game the room is growing towards.
 *
 * A plain list rather than a read of `@mc/content`, so the room doesn't pull every pack's cards into the table's first
 * load. `hero-catalogue.test.ts` checks it against `@mc/content`'s hero identities, so a hero ingested later fails the
 * test until it is added here. `code` is the identity card's id (its scan is `/card-art/bundles/cards/<code>.png`);
 * `aspect` is the aspect of the hero's starter deck ("pool" for Deadpool's), or null where the data has no starter deck.
 */

export interface ShelfRelease {
  readonly id: string;
  readonly name: string;
}

export interface ShelfHero {
  readonly code: string;
  readonly name: string;
  readonly alterEgo: string;
  readonly release: string;
  readonly aspect: string | null;
}

/** The releases in the order they came out: the Core Set, wave 1's hero packs, then each campaign box and its heroes. */
export const SHELF_RELEASES: readonly ShelfRelease[] = [
  { id: "core", name: "Core Set" },
  { id: "wave1", name: "Wave 1" },
  { id: "cycle1", name: "The Rise of Red Skull" },
  { id: "cycle3", name: "The Galaxy's Most Wanted" },
  { id: "cycle4", name: "The Mad Titan's Shadow" },
  { id: "cycle5", name: "Sinister Motives" },
  { id: "cycle6", name: "Mutant Genesis" },
  { id: "cycle7", name: "NeXt Evolution" },
  { id: "cycle8", name: "Age of Apocalypse" },
  { id: "cycle9", name: "Agents of S.H.I.E.L.D." },
  { id: "cycle10", name: "Civil War" },
  { id: "cycle11", name: "Fear No Evil" },
];

export const SHELF_HEROES: readonly ShelfHero[] = [
  { code: "01001a", name: "Spider-Man", alterEgo: "Peter Parker", release: "core", aspect: "justice" },
  { code: "01010a", name: "Captain Marvel", alterEgo: "Carol Danvers", release: "core", aspect: "leadership" },
  { code: "01019a", name: "She-Hulk", alterEgo: "Jennifer Walters", release: "core", aspect: "aggression" },
  { code: "01029a", name: "Iron Man", alterEgo: "Tony Stark", release: "core", aspect: "aggression" },
  { code: "01040a", name: "Black Panther", alterEgo: "T'Challa", release: "core", aspect: "protection" },
  { code: "03001a", name: "Captain America", alterEgo: "Steve Rogers", release: "wave1", aspect: "leadership" },
  { code: "04001a", name: "Hawkeye", alterEgo: "Clint Barton", release: "cycle1", aspect: "leadership" },
  { code: "04031a", name: "Spider-Woman", alterEgo: "Jessica Drew", release: "cycle1", aspect: "aggression" },
  { code: "05001a", name: "Ms. Marvel", alterEgo: "Kamala Khan", release: "wave1", aspect: "protection" },
  { code: "06001a", name: "Thor", alterEgo: "Odinson", release: "wave1", aspect: "aggression" },
  { code: "08001a", name: "Black Widow", alterEgo: "Natasha Romanoff", release: "wave1", aspect: "justice" },
  { code: "09001a", name: "Doctor Strange", alterEgo: "Stephen Strange", release: "wave1", aspect: "protection" },
  { code: "10001a", name: "Hulk", alterEgo: "Bruce Banner", release: "wave1", aspect: "aggression" },
  { code: "12001a", name: "Ant-Man", alterEgo: "Scott Lang", release: "cycle1", aspect: "leadership" },
  { code: "13001a", name: "Wasp", alterEgo: "Nadia Van Dyne", release: "cycle1", aspect: "aggression" },
  { code: "14001a", name: "Quicksilver", alterEgo: "Pietro Maximoff", release: "cycle1", aspect: "protection" },
  { code: "15001a", name: "Scarlet Witch", alterEgo: "Wanda Maximoff", release: "cycle1", aspect: "justice" },
  { code: "16001a", name: "Groot", alterEgo: "Groot", release: "cycle3", aspect: "protection" },
  { code: "16029a", name: "Rocket Raccoon", alterEgo: "Rocket Raccoon", release: "cycle3", aspect: "aggression" },
  { code: "17001a", name: "Star-Lord", alterEgo: "Peter Quill", release: "cycle3", aspect: "leadership" },
  { code: "18001a", name: "Gamora", alterEgo: "Gamora", release: "cycle3", aspect: "aggression" },
  { code: "19001a", name: "Drax", alterEgo: "Drax", release: "cycle3", aspect: "protection" },
  { code: "20001a", name: "Venom", alterEgo: "Flash Thompson", release: "cycle3", aspect: "justice" },
  { code: "21001a", name: "Spectrum", alterEgo: "Monica Rambeau", release: "cycle4", aspect: "leadership" },
  { code: "21031a", name: "Adam Warlock", alterEgo: "Adam Warlock", release: "cycle4", aspect: "aggression" },
  { code: "22001a", name: "Nebula", alterEgo: "Nebula", release: "cycle4", aspect: "justice" },
  { code: "23001a", name: "War Machine", alterEgo: "James Rhodes", release: "cycle4", aspect: "leadership" },
  { code: "25001a", name: "Valkyrie", alterEgo: "Brunnhilde", release: "cycle4", aspect: "aggression" },
  { code: "26001a", name: "Vision", alterEgo: "Vision", release: "cycle4", aspect: "protection" },
  { code: "27001a", name: "Ghost-Spider", alterEgo: "Gwen Stacy", release: "cycle5", aspect: "protection" },
  { code: "27030a", name: "Spider-Man", alterEgo: "Miles Morales", release: "cycle5", aspect: "justice" },
  { code: "28001a", name: "Nova", alterEgo: "Sam Alexander", release: "cycle5", aspect: "aggression" },
  { code: "29001a", name: "Ironheart", alterEgo: "Riri Williams", release: "cycle5", aspect: "leadership" },
  { code: "30001a", name: "Spider-Ham", alterEgo: "Peter Porker", release: "cycle5", aspect: "justice" },
  { code: "31001a", name: "SP//dr Suit", alterEgo: "Peni Parker", release: "cycle5", aspect: "protection" },
  { code: "32001a", name: "Colossus", alterEgo: "Piotr Rasputin", release: "cycle6", aspect: "protection" },
  { code: "32030a", name: "Shadowcat", alterEgo: "Kitty Pryde", release: "cycle6", aspect: "aggression" },
  { code: "33001a", name: "Cyclops", alterEgo: "Scott Summers", release: "cycle6", aspect: "leadership" },
  { code: "34001a", name: "Phoenix", alterEgo: "Jean Grey", release: "cycle6", aspect: "justice" },
  { code: "35001a", name: "Wolverine", alterEgo: "Logan", release: "cycle6", aspect: "aggression" },
  { code: "36001a", name: "Storm", alterEgo: "Ororo Munroe", release: "cycle6", aspect: "leadership" },
  { code: "37001a", name: "Gambit", alterEgo: "Remy LeBeau", release: "cycle6", aspect: "justice" },
  { code: "38001a", name: "Rogue", alterEgo: "Anna Marie", release: "cycle6", aspect: "protection" },
  { code: "40001a", name: "Cable", alterEgo: "Nathan Summers", release: "cycle7", aspect: "leadership" },
  { code: "40037a", name: "Domino", alterEgo: "Neena Thurman", release: "cycle7", aspect: "justice" },
  { code: "41001a", name: "Psylocke", alterEgo: "Betsy Braddock", release: "cycle7", aspect: "justice" },
  { code: "42001a", name: "Angel", alterEgo: "Warren Worthington III", release: "cycle7", aspect: "protection" },
  { code: "43001a", name: "X-23", alterEgo: "Laura Kinney", release: "cycle7", aspect: "aggression" },
  { code: "44001a", name: "Deadpool", alterEgo: "Wade Wilson", release: "cycle7", aspect: "pool" },
  { code: "45001a", name: "Bishop", alterEgo: "Lucas Bishop", release: "cycle8", aspect: "leadership" },
  { code: "45030a", name: "Magik", alterEgo: "Illyana Rasputin", release: "cycle8", aspect: "aggression" },
  { code: "46001a", name: "Iceman", alterEgo: "Bobby Drake", release: "cycle8", aspect: "aggression" },
  { code: "47001a", name: "Jubilee", alterEgo: "Jubilation Lee", release: "cycle8", aspect: "justice" },
  { code: "48001a", name: "Nightcrawler", alterEgo: "Kurt Wagner", release: "cycle8", aspect: "protection" },
  { code: "49001a", name: "Magneto", alterEgo: "Erik Lehnsherr", release: "cycle8", aspect: "leadership" },
  { code: "50001a", name: "Maria Hill", alterEgo: "Maria Hill", release: "cycle9", aspect: "leadership" },
  { code: "50034a", name: "Nick Fury", alterEgo: "Nick Fury", release: "cycle9", aspect: "justice" },
  { code: "51001a", name: "Black Panther", alterEgo: "Shuri", release: "cycle9", aspect: "justice" },
  { code: "52001a", name: "Silk", alterEgo: "Cindy Moon", release: "cycle9", aspect: "protection" },
  { code: "53001a", name: "Falcon", alterEgo: "Sam Wilson", release: "cycle9", aspect: "leadership" },
  { code: "54001a", name: "Winter Soldier", alterEgo: "Bucky Barnes", release: "cycle9", aspect: "aggression" },
  { code: "56001a", name: "Tigra", alterEgo: "Greer Nelson", release: "cycle10", aspect: "aggression" },
  { code: "56029a", name: "Hulkling", alterEgo: "Teddy Altman", release: "cycle10", aspect: "protection" },
  { code: "58001a", name: "Wonder Man", alterEgo: "Simon Williams", release: "cycle10", aspect: "justice" },
  { code: "59001a", name: "Hercules", alterEgo: "Hercules", release: "cycle10", aspect: "leadership" },
  { code: "60001a", name: "Daredevil", alterEgo: "Matt Murdock", release: "cycle11", aspect: "justice" },
  { code: "60037a", name: "Echo", alterEgo: "Maya Lopez", release: "cycle11", aspect: "protection" },
  { code: "61001a", name: "Jessica Jones", alterEgo: "Jessica Jones", release: "cycle11", aspect: "justice" },
  { code: "62001a", name: "Luke Cage", alterEgo: "Luke Cage", release: "cycle11", aspect: "leadership" },
  { code: "63001a", name: "Elektra", alterEgo: "Elektra Natchios", release: "cycle11", aspect: null },
  { code: "64001a", name: "Iron Fist", alterEgo: "Danny Rand", release: "cycle11", aspect: null },
];
