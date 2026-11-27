/**
 * The Green Goblin pack's A Mess of Things and Running Interference modular sets on the 3D table, card by card: A Mess of
 * Things (02037), Scorpion (02038), Gang-Up (02039), Tail Sweep (02040), Running Interference (02046), Tombstone (02047),
 * All Tied Up (02048) and Media Coverage (02049). Each is dealt into Mutagen Formula (Spider-Man against Green Goblin,
 * both modules added) and made to happen the way a game would make it happen (revealed in the villain phase in either
 * form, boosted, attacking, its Action used from the table), and checked twice: what the engine did (threat, damage,
 * statuses, where the cards went) and what the table shows for it (beats, the question's words, the card's action).
 *
 * Where the table or the engine gets one wrong, the test stays as `test.fails` under a `// BUG:` comment. The whole
 * pack's sweep is `deck-audit-goblin-sweep.test.ts`.
 */
import { expect, test } from "vitest";
import {
  engageMinion,
  handOf,
  inPlay,
  patchByCode,
  patchCard,
  scenarioOf,
  stack,
  villainPhase,
  type Choice,
  type Player,
  type Setup,
} from "./deck-audit-driver.js";
import type { BattleBeat, BattleCard } from "./model.js";

const deal = (...steps: Setup[]) =>
  scenarioOf(
    { hero: "spider-man", villain: "mutagen-formula", modules: ["a_mess_of_things", "running_interference"], seed: 75 },
    ...steps,
  );

/**
 * All Tied Up as the villain's boost card: it prints no boost icon and no Boost ability, so Green Goblin's activation
 * changes nothing a test is about (the sweep's notes). Gang-Up (1 icon, no Boost ability) when All Tied Up is under test.
 */
const QUIET = "02048";
const ONE_ICON = "02039";

const STUNNED = { stunned: 1, confused: 0, tough: 0 };
const TOUGH = { stunned: 0, confused: 0, tough: 1 };
/** Green Goblin and the Goblin Thrall Mutagen Formula's setup engages are stunned: their round-1 attacks fizzle. */
const quietEnemies = [patchByCode("villain", { statuses: STUNNED }), patchCard("02024", { statuses: STUNNED })];

// Hands, by printed code: their resources are what the test is about.
const SWK = "01005"; // Swinging Web Kick: [mental]
const BACKFLIP = "01003"; // Backflip: [physical]
/** Six [energy] cards: no [mental] and no [physical] in the hand (Peter Parker's Scientist still makes a [mental]). */
const ENERGY_HAND = ["01065", "01059", "01002", "01060", "01063", "01007"];
/** Swinging Web Kick, Backflip and four [energy] cards (six: Peter Parker's hand size, so the end of turn draws none). */
const MENTAL_PHYSICAL_HAND = [SWK, BACKFLIP, "01065", "01059", "01002", "01060"];

const engine = (p: Player) => p.battle.game;
const heroInstance = (p: Player) => engine(p).instances[engine(p).players[0]!.identity.instanceId]!;
const status = (p: Player, which: "stunned" | "tough") => heroInstance(p).statuses[which] ?? 0;
const heroAttachments = (p: Player) => heroInstance(p).attachments.map(String);
const enemy = (p: Player, name: string) => p.snap.enemyCards.find((c) => c.name === name);
const threatOn = (p: Player, name: string) => enemy(p, name)?.threat ?? null;
const mainScheme = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!;
const marker = (card: BattleCard, name: string) => card.markers.find((m) => m.name === name)?.count ?? 0;
const canChangeForm = (p: Player) => p.snap.heroActions.some((a) => a.kind === "changeForm");

/** The index of the first beat matching, asserted to exist so a later "after it" can't pass on -1. */
function at(p: Player, label: string, f: (b: BattleBeat) => boolean, from = 0): number {
  const i = p.beats.findIndex((b, n) => n >= from && f(b));
  expect(i, `beat missing: ${label}\n${p.beats.map((b) => b.text).join(" | ")}`).toBeGreaterThanOrEqual(0);
  return i;
}
const revealOf = (p: Player, name: string) =>
  at(p, `reveal ${name}`, (b) => b.reveal?.name === name && !b.reveal.boost);
const since = (p: Player, from: number) => p.beats.slice(from);
const hitsOn = (beats: BattleBeat[], target: string, source?: string) =>
  beats.filter((b) => b.hit?.target === target && (source === undefined || b.hit.source === source));
const stunBeat = (id: string) => (b: BattleBeat) =>
  b.statusChange?.id === id && b.statusChange.name === "stunned" && b.statusChange.delta === 1;

/**
 * End the turn and play out the villain phase like `villainPhase`, keeping every question whole. `answer` picks for a
 * question (undefined: the driver's default); attacks go undefended; the end of turn's discard keeps `keep`.
 */
function phase(
  p: Player,
  answer: (c: Choice) => string[] | undefined = () => undefined,
  keep: string[] = [],
  defend: (c: Choice) => string = () => "decline",
) {
  const asked: Choice[] = [];
  p.mark();
  p.end();
  p.drive({
    defend,
    keep,
    pick: (c) => {
      asked.push(c);
      if (c.defense) return [defend(c)];
      if (c.discardFromHand || c.mulligan) return undefined;
      if (c.ordered) return c.options.map((o) => o.id);
      return answer(c);
    },
  });
  return asked;
}
const optionsNamed = (c: Choice, ...labels: (string | RegExp)[]) =>
  labels.map((label) => {
    const o = c.options.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)));
    if (!o) throw Error(`no option ${String(label)} in ${c.options.map((x) => x.label).join(", ")}`);
    return o.id;
  });
/** Tombstone's question: a pick among hand cards that isn't the end of turn's discard. */
const tombstoneQuestion = (asked: Choice[]) =>
  asked.find((c) => !c.discardFromHand && !c.defense && c.options.some((o) => o.label === "Backflip"));

// =====================================================================================================================
// 02037 A Mess of Things (side scheme, 2 starting threat, hazard icon, 2 boost icons)
// =====================================================================================================================

test("02037 A Mess of Things: revealed with no one stunned, it holds only its 2 starting threat", () => {
  const p = deal(stack(QUIET, "02037"));
  villainPhase(p);
  const reveal = revealOf(p, "A Mess of Things");
  expect(p.beats[reveal]!.reveal!.whenRevealed).toBe(true);
  expect(threatOn(p, "A Mess of Things")).toBe(2);
  expect(enemy(p, "A Mess of Things")!.type).toBe("side_scheme");
  // Its starting threat lands as a beat of its own; nothing more follows with no stunned friendly character.
  const threat = since(p, reveal).filter((b) => b.threat?.scheme === enemy(p, "A Mess of Things")!.id);
  expect(threat.map((b) => b.threat!.to)).toEqual([2]);
});

test("02037 A Mess of Things: +2 threat for the stunned alter-ego (stunned in alter-ego form counts)", () => {
  const p = deal(stack(QUIET, "02037"), patchByCode("hero", { statuses: STUNNED }));
  villainPhase(p);
  const reveal = revealOf(p, "A Mess of Things");
  const id = enemy(p, "A Mess of Things")!.id;
  // "Place 2 additional threat here for each stunned friendly character": 2 starting + 2 for Peter Parker.
  expect(threatOn(p, "A Mess of Things")).toBe(4);
  expect(
    since(p, reveal)
      .filter((b) => b.threat?.scheme === id)
      .map((b) => [b.threat!.delta, b.threat!.to]),
  ).toEqual([
    [2, 2],
    [2, 4],
  ]);
  expect(marker(p.snap.hero, "stunned")).toBe(1);
});

test("02037 A Mess of Things: a stunned ally counts too (2 + 2 for the hero + 2 for Jessica Jones)", () => {
  const p = deal(
    stack(QUIET, "02037"),
    inPlay("01059"),
    patchCard("01059", { statuses: STUNNED }),
    patchByCode("hero", { statuses: STUNNED }),
  );
  villainPhase(p);
  const reveal = revealOf(p, "A Mess of Things");
  expect(threatOn(p, "A Mess of Things")).toBe(6);
  const id = enemy(p, "A Mess of Things")!.id;
  expect(since(p, reveal).some((b) => b.threat?.scheme === id && b.threat.delta === 4 && b.threat.to === 6)).toBe(true);
});

test("02037 A Mess of Things: as Green Goblin's boost card it adds its 2 boost icons to his scheme", () => {
  const p = deal(stack("02037", QUIET));
  villainPhase(p);
  const flip = at(p, "boost flipped", (b) => b.reveal?.name === "A Mess of Things" && !!b.reveal.boost);
  expect(p.beats[flip]!.reveal!.boost!.icons).toBe(2);
  // Green Goblin's 1 SCH + 2 boost icons: 3 threat on the main scheme.
  const sum = at(p, "the scheme's sum", (b) => b.text === "1 SCH · 2 boost · 3 threat", flip);
  at(p, "3 threat placed", (b) => b.actor === p.snap.villain.id && b.threat?.delta === 3, sum);
  // A boost card is not revealed: it never comes into play as a side scheme.
  expect(enemy(p, "A Mess of Things")).toBeUndefined();
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("A Mess of Things");
});

test("02037 A Mess of Things: its hazard icon deals one more encounter card in the next villain phase", () => {
  // Round 1 reveals it; round 2 deals two cards (both Media Coverage, which change nothing here).
  const p = deal(stack(QUIET, "02037", ONE_ICON, "02049", "02049"));
  villainPhase(p);
  expect(enemy(p, "A Mess of Things")).toBeDefined();
  villainPhase(p);
  // RRG v1.8 "Hazard Icon": for each hazard icon in play, deal 1 additional encounter card.
  const deals = p.beats.filter((b) => !!b.encounterDeal && !b.boostFor);
  expect(deals).toHaveLength(2);
  expect(p.beats.filter((b) => b.reveal?.name === "Media Coverage" && !b.reveal.boost)).toHaveLength(2);
  expect(heroAttachments(p)).toHaveLength(2);
});

// =====================================================================================================================
// 02038 Scorpion (minion, quickstrike, 3 ATK / 3 SCH / 7 HP; Forced Response: after he attacks and damages, stun)
// =====================================================================================================================

test("02038 Scorpion: revealed while you're Spider-Man, quickstrike attacks at once, and the damage stuns you", () => {
  const p = deal(stack(QUIET, "02038"));
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Scorpion");
  const scorpion = enemy(p, "Scorpion")!;
  const hero = p.snap.hero.id;
  expect(p.beats[reveal]!.reveal!.quick).toBe(true);
  expect(scorpion.type).toBe("minion");
  // RRG v1.8 "Quickstrike": after he engages a player in hero form, he attacks that player.
  const aim = at(p, "Scorpion aims", (b) => b.attackAim?.source === scorpion.id && b.attackAim.target === hero, reveal);
  expect(p.beats[aim]!.activity).toBe("Quickstrike: Scorpion attacks");
  const hit = at(p, "Scorpion's hit", (b) => b.hit?.source === scorpion.id && b.hit.target === hero, aim);
  expect(p.beats[hit]!.hit!.amount).toBe(3);
  at(p, "stunned by Scorpion", stunBeat(hero), hit);
  expect(status(p, "stunned")).toBe(1);
  expect(marker(p.snap.hero, "stunned")).toBe(1);
});

test("02038 Scorpion: revealed while you're Peter Parker, he engages you and makes no attack", () => {
  const p = deal(stack(QUIET, "02038"));
  villainPhase(p);
  const reveal = revealOf(p, "Scorpion");
  const scorpion = enemy(p, "Scorpion")!;
  expect(engine(p).instances[scorpion.id]!.engagedWith).toBe(engine(p).players[0]!.playerId);
  expect(since(p, reveal).some((b) => b.attackAim?.source === scorpion.id)).toBe(false);
  expect(hitsOn(since(p, reveal), p.snap.hero.id)).toEqual([]);
  expect(status(p, "stunned")).toBe(0);
});

test("02038 Scorpion: an attack that deals no damage (Tough takes it) stuns no one", () => {
  // A stunned Green Goblin makes no attack, so he is dealt no boost card: Scorpion is the first card off the deck.
  const p = deal(stack("02038"), patchByCode("hero", { statuses: TOUGH }), ...quietEnemies);
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Scorpion");
  const scorpion = enemy(p, "Scorpion")!;
  const hit = at(p, "Tough takes the hit", (b) => b.hit?.source === scorpion.id && !!b.hit.tough, reveal);
  expect(p.beats[hit]!.hit!.amount).toBe(0);
  // "After Scorpion attacks and damages a character": no damage, so no stun.
  expect(since(p, hit).some(stunBeat(p.snap.hero.id))).toBe(false);
  expect(status(p, "stunned")).toBe(0);
  expect(heroInstance(p).damage).toBe(0);
});

test("02038 Scorpion: an ally who defends and survives his damage is the one stunned", () => {
  // She-Hulk with Hulk (5 hit points) in play: Scorpion's 3 damage leaves him standing. "Stun that character": the
  // damaged character, not the player.
  const p = scenarioOf(
    { hero: "she-hulk", villain: "mutagen-formula", modules: ["a_mess_of_things", "running_interference"], seed: 75 },
    stack("02038"),
    inPlay("01050"),
    ...quietEnemies,
  );
  p.form();
  const offer = p.snap.choice?.offers?.[0];
  if (offer) p.run(() => p.battle.chooseMany([]));
  const hulk = p.card("Hulk", "inPlay").id;
  phase(p, undefined, [], (c) => c.options.find((o) => o.cardId === hulk)?.id ?? "decline");
  const reveal = revealOf(p, "Scorpion");
  const scorpion = enemy(p, "Scorpion")!.id;
  const hit = at(p, "Scorpion hits Hulk", (b) => b.hit?.source === scorpion && b.hit.target === hulk, reveal);
  expect(p.beats[hit]!.hit!.amount).toBe(3);
  at(p, "Hulk is stunned", stunBeat(hulk), hit);
  expect(engine(p).instances[hulk]!.statuses.stunned).toBe(1);
  expect(marker(p.card("Hulk", "inPlay"), "stunned")).toBe(1);
  expect(status(p, "stunned")).toBe(0);
});

// =====================================================================================================================
// 02039 Gang-Up (treachery; Alter-Ego: surge; Hero: the villain and each minion engaged with you attack you)
// =====================================================================================================================

test("02039 Gang-Up (alter-ego): the table says which half applies, it surges, and another card is dealt", () => {
  const p = deal(stack(QUIET, "02039", "02049"));
  villainPhase(p);
  const reveal = revealOf(p, "Gang-Up");
  expect(p.beats[reveal]!.reveal!.applies).toEqual({ form: "Alter-Ego", text: "This card gains surge." });
  const surge = at(p, "Gang-Up surges", (b) => b.surge === p.beats[reveal]!.reveal!.id, reveal);
  at(p, "the surge's deal", (b) => !!b.encounterDeal, surge);
  revealOf(p, "Media Coverage");
  // No attack in alter-ego form.
  expect(since(p, reveal).some((b) => !!b.attackAim)).toBe(false);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Gang-Up");
});

test("02039 Gang-Up (hero): Green Goblin (with a boost card) and each engaged minion attack you, Scorpion stuns", () => {
  // Everyone's own round-1 attack is spent on a stun, so the hits after the reveal are Gang-Up's alone.
  const p = deal(
    stack("02039", QUIET),
    engageMinion("02038"),
    patchCard("02038", { statuses: STUNNED }),
    ...quietEnemies,
  );
  p.form();
  const asked = phase(p);
  const reveal = revealOf(p, "Gang-Up");
  expect(p.beats[reveal]!.reveal!.applies).toEqual({
    form: "Hero",
    text: "The villain and each minion engaged with you attacks you.",
  });
  const hero = p.snap.hero.id;
  const goblin = p.snap.villain.id;
  const thrall = enemy(p, "Goblin Thrall")!.id;
  const scorpion = enemy(p, "Scorpion")!.id;
  const after = since(p, reveal);
  // RRG v1.8 "Activation": an attack a card causes is an activation, so the villain is dealt a boost card for it.
  const villainAim = at(p, "Green Goblin aims", (b) => b.attackAim?.source === goblin, reveal);
  at(p, "his boost card", (b) => b.boostFor === goblin && !!b.encounterDeal, villainAim);
  expect(after.filter((b) => !!b.attackAim).map((b) => b.attackAim!.source)).toEqual([goblin, thrall, scorpion]);
  // Green Goblin 2 ATK + 0 boost icons, the Thrall 1, Scorpion 3.
  expect(hitsOn(after, hero).map((b) => b.hit!.amount)).toEqual([2, 1, 3]);
  expect(heroInstance(p).damage).toBe(6);
  expect(after.some(stunBeat(hero))).toBe(true);
  expect(status(p, "stunned")).toBe(1);
  // "Minion activations in the order of your choice" (RRG v1.8 "Activation").
  expect(asked.some((c) => c.prompt === "Order the enemies")).toBe(true);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Gang-Up");
});

// BUG: a card makes Scorpion attack (Gang-Up), but the table labels the attack "Quickstrike: Scorpion attacks": any
// attack by a minion whose text has Quickstrike gets that label (model.ts, the held aim). Table bug (wrong words).
test("02039 Gang-Up (hero): Scorpion's attack is not labelled as his Quickstrike", () => {
  const p = deal(
    stack("02039", QUIET),
    engageMinion("02038"),
    patchCard("02038", { statuses: STUNNED }),
    ...quietEnemies,
  );
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Gang-Up");
  const scorpion = enemy(p, "Scorpion")!.id;
  const aim = at(p, "Scorpion aims", (b) => b.attackAim?.source === scorpion, reveal);
  expect(p.beats[aim]!.activity).not.toMatch(/Quickstrike/);
});

// =====================================================================================================================
// 02040 Tail Sweep (treachery: Scorpion attacks your hero; if no attack was made, you are stunned. Boost: stunned)
// =====================================================================================================================

test("02040 Tail Sweep (hero, no Scorpion in play): no attack is made, so you are stunned", () => {
  const p = deal(stack(QUIET, "02040"));
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Tail Sweep");
  expect(p.beats[reveal]!.reveal!.whenRevealed).toBe(true);
  const stun = at(p, "stunned", stunBeat(p.snap.hero.id), reveal);
  at(p, "Tail Sweep discarded", (b) => !!b.encounterResolved, stun);
  expect(since(p, reveal).some((b) => !!b.attackAim)).toBe(false);
  expect(status(p, "stunned")).toBe(1);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Tail Sweep");
});

test("02040 Tail Sweep (hero, Scorpion engaged): Scorpion attacks your hero, and his damage stuns you", () => {
  const p = deal(stack("02040"), engageMinion("02038"), ...quietEnemies, patchCard("02038", { statuses: STUNNED }));
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Tail Sweep");
  const scorpion = enemy(p, "Scorpion")!.id;
  const hero = p.snap.hero.id;
  at(p, "Scorpion aims", (b) => b.attackAim?.source === scorpion && b.attackAim.target === hero, reveal);
  expect(hitsOn(since(p, reveal), hero, scorpion).map((b) => b.hit!.amount)).toEqual([3]);
  expect(heroInstance(p).damage).toBe(3);
  // An attack was made, so Tail Sweep's own stun doesn't happen: the one stun is Scorpion's Forced Response.
  expect(since(p, reveal).filter(stunBeat(hero))).toHaveLength(1);
  expect(status(p, "stunned")).toBe(1);
});

// BUG: Scorpion's attack is labelled "Quickstrike: Scorpion attacks" though Tail Sweep makes it. Table bug (words).
test("02040 Tail Sweep (hero, Scorpion engaged): Scorpion's attack is not labelled as his Quickstrike", () => {
  const p = deal(stack("02040"), engageMinion("02038"), ...quietEnemies, patchCard("02038", { statuses: STUNNED }));
  p.form();
  villainPhase(p);
  const reveal = revealOf(p, "Tail Sweep");
  const scorpion = enemy(p, "Scorpion")!.id;
  const aim = at(p, "Scorpion aims", (b) => b.attackAim?.source === scorpion, reveal);
  expect(p.beats[aim]!.activity).not.toMatch(/Quickstrike/);
});

test("02040 Tail Sweep (alter-ego, no Scorpion): the table says no hero can be attacked, and you are stunned", () => {
  const p = deal(stack(QUIET, "02040"));
  villainPhase(p);
  const reveal = revealOf(p, "Tail Sweep");
  expect(p.beats[reveal]!.reveal!.noHeroToAttack).toEqual({ instead: "You are stunned." });
  at(p, "stunned", stunBeat(p.snap.hero.id), reveal);
  expect(status(p, "stunned")).toBe(1);
});

// BUG: "Scorpion attacks your hero" with the player in alter-ego form. RRG v1.8 "Form, Change Form": "While a player is
// in alter-ego form, card abilities that interact with their hero do not interact with their identity", so no attack
// is made and "you are stunned" (the FAQ's Counterspell ruling is the same reading; I See You's "attacks you" is the
// contrast). The table says so on the reveal (noHeroToAttack), but the engine has Scorpion attack Peter Parker for 3
// (the script's `enemyAttack(SCORPION, { against: you })`). Engine bug; the table then shows an attack it said can't
// happen.
test.fails("02040 Tail Sweep (alter-ego, Scorpion engaged): Scorpion can't attack Peter Parker; you are stunned", () => {
  const p = deal(stack(QUIET, "02040"), engageMinion("02038"));
  villainPhase(p);
  const reveal = revealOf(p, "Tail Sweep");
  expect(p.beats[reveal]!.reveal!.noHeroToAttack).toEqual({ instead: "You are stunned." });
  expect(status(p, "stunned")).toBe(1);
  expect(hitsOn(since(p, reveal), p.snap.hero.id)).toEqual([]);
  expect(heroInstance(p).damage).toBe(0);
});

test("02040 Tail Sweep: as Green Goblin's boost card, its Boost stuns you", () => {
  const p = deal(stack("02040", QUIET));
  villainPhase(p);
  const flip = at(p, "boost flipped", (b) => b.reveal?.name === "Tail Sweep" && !!b.reveal.boost);
  expect(p.beats[flip]!.reveal!.boost!.icons).toBe(0);
  at(p, "Boost: you are stunned", stunBeat(p.snap.hero.id), flip);
  expect(status(p, "stunned")).toBe(1);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Tail Sweep");
});

// =====================================================================================================================
// 02046 Running Interference (side scheme, 1 per player starting threat, crisis icon; When Revealed: spend
// [mental][physical] or place 2 threat here)
// =====================================================================================================================

test("02046 Running Interference: the question names both halves; paying [mental][physical] keeps the 2 threat off", () => {
  const p = deal(stack(QUIET, "02046"), handOf(...MENTAL_PHYSICAL_HAND));
  const asked = phase(p, (c) => {
    if (c.eitherOr === "choose") return optionsNamed(c, /^Spend/);
    if (c.eitherOr === "spend") return optionsNamed(c, "Swinging Web Kick", "Backflip");
    return undefined;
  });
  const choose = asked.find((c) => c.eitherOr === "choose")!;
  expect(choose.sourceTitle).toBe("Running Interference · When Revealed");
  expect(choose.options.map((o) => o.label)).toEqual(["Spend 1 mental, 1 physical", "Place 2 threat here"]);
  const reveal = revealOf(p, "Running Interference");
  // Starting threat 1 per player; nothing more once paid.
  expect(threatOn(p, "Running Interference")).toBe(1);
  const paid = at(p, "the paid cards leave the hand", (b) => !!b.handDiscard, reveal);
  expect(p.beats[paid]!.handDiscard).toHaveLength(2);
  expect(p.snap.discard.map((c) => c.name).sort()).toEqual(["Backflip", "Swinging Web Kick"]);
});

test("02046 Running Interference: choosing the threat puts 2 more on it (3), and the hand is kept", () => {
  const p = deal(stack(QUIET, "02046"), handOf(...MENTAL_PHYSICAL_HAND));
  phase(p, (c) => (c.eitherOr === "choose" ? optionsNamed(c, "Place 2 threat here") : undefined));
  const reveal = revealOf(p, "Running Interference");
  const id = enemy(p, "Running Interference")!.id;
  expect(
    since(p, reveal)
      .filter((b) => b.threat?.scheme === id)
      .map((b) => [b.threat!.delta, b.threat!.to]),
  ).toEqual([
    [1, 1],
    [2, 3],
  ]);
  expect(threatOn(p, "Running Interference")).toBe(3);
  expect(p.snap.hand.map((c) => c.name)).toEqual(expect.arrayContaining(["Swinging Web Kick", "Backflip"]));
});

test("02046 Running Interference: its crisis icon locks the main scheme's threat while it is in play", () => {
  const p = deal(stack(QUIET, "02046"));
  expect(mainScheme(p).threatLock).toBeUndefined();
  phase(p, (c) => (c.eitherOr === "choose" ? optionsNamed(c, "Place 2 threat here") : undefined));
  // RRG v1.8 "Crisis Icon": player cards cannot remove threat from the main scheme.
  expect(mainScheme(p).threatLock).toBe(
    "Crisis: no threat comes off the main scheme while Running Interference is in play",
  );
});

test("02046 Running Interference: thwarted to 0 it leaves play, and the main scheme's lock goes with it", () => {
  const p = deal(stack(QUIET, "02046"), handOf(...MENTAL_PHYSICAL_HAND));
  phase(p, (c) => {
    if (c.eitherOr === "choose") return optionsNamed(c, /^Spend/);
    if (c.eitherOr === "spend") return optionsNamed(c, "Swinging Web Kick", "Backflip");
    return undefined;
  });
  expect(threatOn(p, "Running Interference")).toBe(1);
  p.form();
  p.mark();
  expect(p.run(() => p.battle.heroAction("basicThwart"))).toBe(true);
  // The crisis icon keeps the main scheme out of the thwart's targets.
  const targets = p.snap.choice?.options.map((o) => o.label) ?? [];
  expect(targets).not.toContain(mainScheme(p).name);
  if (p.snap.choice) p.choose({ label: "Running Interference" });
  // Spider-Man's 1 THW removes its last threat: a side scheme with no threat is defeated (RRG v1.8 "Side Schemes").
  at(p, "threat comes off", (b) => b.threat?.delta === -1);
  expect(enemy(p, "Running Interference")).toBeUndefined();
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Running Interference");
  expect(mainScheme(p).threatLock).toBeUndefined();
});

// BUG: with no [physical] anywhere (six [energy] cards; Peter Parker's Scientist makes only a [mental]) the table
// still offers "Spend 1 mental, 1 physical" as if it could be paid. The outcome is right (2 threat go on it), but the
// question offers a half that can't be done. Table bug (a confusing prompt): an unpayable half should not be offered
// (or the threat placed without asking).
test.fails("02046 Running Interference: with no [physical] to spend, the spend half isn't offered", () => {
  const p = deal(stack(QUIET, "02046"), handOf(...ENERGY_HAND));
  const asked = phase(p, (c) => (c.eitherOr === "choose" ? optionsNamed(c, "Place 2 threat here") : undefined));
  expect(threatOn(p, "Running Interference")).toBe(3);
  const offered = asked.find((c) => c.eitherOr === "choose")?.options.map((o) => o.label) ?? [];
  expect(offered).not.toContain("Spend 1 mental, 1 physical");
});

// =====================================================================================================================
// 02047 Tombstone (minion, 3 ATK; Forced Response: after he attacks and damages you, discard a [mental] or
// [physical] resource from your hand, if able)
// =====================================================================================================================

test("02047 Tombstone: his attack damages you and asks for a [mental] or [physical] card, only those offered", () => {
  const p = deal(stack("02049"), engageMinion("02047"), handOf(...MENTAL_PHYSICAL_HAND), ...quietEnemies);
  p.form();
  // Spider-Man's hand size is 5: the end of turn's discard keeps the two cards Tombstone can take.
  const asked = phase(
    p,
    (c) => (c.options.some((o) => o.label === "Backflip") ? optionsNamed(c, "Backflip") : undefined),
    ["Swinging Web Kick", "Backflip"],
  );
  const tombstone = enemy(p, "Tombstone")!.id;
  const hero = p.snap.hero.id;
  const hit = at(p, "Tombstone's hit", (b) => b.hit?.source === tombstone && b.hit.target === hero);
  expect(p.beats[hit]!.hit!.amount).toBe(3);
  const question = tombstoneQuestion(asked)!;
  expect(question.options.map((o) => o.label).sort()).toEqual(["Backflip", "Swinging Web Kick"]);
  expect([question.min, question.max]).toEqual([1, 1]);
  const gone = at(p, "the discard", (b) => !!b.handDiscard, hit);
  expect(p.beats[gone]!.handDiscard).toHaveLength(1);
  expect(p.snap.discard.map((c) => c.name)).toContain("Backflip");
  expect(p.snap.hand.map((c) => c.name)).toContain("Swinging Web Kick");
});

// BUG: Tombstone's question reads only "Choose cards", with no source line: nothing says it is Tombstone's Forced
// Response or that the picked card will be discarded. Table bug (a confusing prompt).
test.fails("02047 Tombstone: the question says it is Tombstone's and that the card is discarded", () => {
  const p = deal(stack("02049"), engageMinion("02047"), handOf(...MENTAL_PHYSICAL_HAND), ...quietEnemies);
  p.form();
  const asked = phase(p, undefined, ["Swinging Web Kick", "Backflip"]);
  const question = tombstoneQuestion(asked)!;
  expect(question.sourceTitle ?? "").toMatch(/Tombstone/);
  expect(question.prompt).toMatch(/discard/i);
});

test("02047 Tombstone: with no [mental] or [physical] card in hand, nothing is discarded and nothing is asked", () => {
  const p = deal(stack("02049"), engageMinion("02047"), handOf(...ENERGY_HAND), ...quietEnemies);
  p.form();
  const asked = phase(p);
  const tombstone = enemy(p, "Tombstone")!.id;
  const hit = at(p, "Tombstone's hit", (b) => b.hit?.source === tombstone);
  expect(p.beats[hit]!.hit!.amount).toBe(3);
  expect(since(p, hit).some((b) => !!b.handDiscard)).toBe(false);
  const hand = new Set(p.snap.hand.map((c) => c.id));
  expect(asked.filter((c) => !c.discardFromHand && c.options.some((o) => hand.has(o.cardId ?? "")))).toEqual([]);
  // The end of turn discarded 1 of the 6 (hand size 5); Tombstone took nothing.
  expect(p.snap.discard).toHaveLength(1);
});

// =====================================================================================================================
// 02048 All Tied Up (attachment to your identity: cannot ready or change form; Action: spend [mental][physical] to
// discard it)
// =====================================================================================================================

test("02048 All Tied Up: revealed, it attaches to Peter Parker, who can no longer change form", () => {
  const p = deal(stack(ONE_ICON, "02048"), handOf(...MENTAL_PHYSICAL_HAND));
  expect(canChangeForm(p)).toBe(true);
  villainPhase(p);
  revealOf(p, "All Tied Up");
  const [tied] = heroAttachments(p);
  expect(engine(p).instances[tied!]!.cardId).toBe("02048");
  expect(engine(p).instances[tied!]!.attachedTo).toBe(p.snap.hero.id);
  expect(canChangeForm(p)).toBe(false);
  expect(p.battle.heroAction("changeForm")).toBe(false);
  expect(p.snap.hero.name).toBe("Peter Parker");
});

// BUG: All Tied Up on the hero is in no list the table draws: the snapshot leaves encounter attachments on the identity
// out of `inPlay` (only player cards are tucked under the hero) and out of `enemyCards` (only the player's play area,
// the villain and the villain area are looked at). The player can't see why the form change is gone, nor click the
// card for its Action. Table bug.
test("02048 All Tied Up: the table shows it on the hero", () => {
  const p = deal(stack(ONE_ICON, "02048"));
  villainPhase(p);
  const shown = [...p.snap.enemyCards, ...p.snap.inPlay].find((c) => c.name === "All Tied Up");
  expect(shown?.attachedTo).toBe(p.snap.hero.id);
});

test("02048 All Tied Up: its Action spends [mental][physical], discards it, and the form change comes back", () => {
  const p = deal(stack(ONE_ICON, "02048"), handOf(...MENTAL_PHYSICAL_HAND));
  villainPhase(p);
  const [tied] = heroAttachments(p);
  const actions = p.battle.fieldActions(tied!);
  expect(actions.map((a) => a.label)).toEqual(["Discard it: spend mental, physical"]);
  p.mark();
  expect(p.run(() => p.battle.fieldAction(tied!, actions[0]!.kind))).toBe(true);
  const payment = p.snap.payment!;
  expect(payment.subject.name).toBe("All Tied Up");
  expect([...(payment.outstanding ?? [])].sort()).toEqual(["1 mental", "1 physical"]);
  // Only the [mental] and [physical] cards can pay it.
  expect(payment.sources.filter((s) => s.available && s.kind === "handCard").map((s) => s.label)).toEqual([
    "Swinging Web Kick",
    "Backflip",
  ]);
  p.spend("Swinging Web Kick", "Backflip");
  expect(p.run(() => p.battle.pay())).toBe(true);
  at(p, "All Tied Up is discarded", (b) => b.leftPlay === tied);
  expect(heroAttachments(p)).toEqual([]);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("All Tied Up");
  expect(canChangeForm(p)).toBe(true);
  p.form();
  expect(p.snap.hero.name).toBe("Spider-Man");
});

test("02048 All Tied Up: on Spider-Man, he can't change back, and once exhausted he doesn't ready", () => {
  // Round 1 Spider-Man is tied up; round 2 he attacks (exhausting); round 3 he is still exhausted.
  const p = deal(stack(ONE_ICON, "02048", "02049", "02049"));
  p.form();
  villainPhase(p);
  expect(heroAttachments(p).map((id) => engine(p).instances[id]!.cardId)).toEqual(["02048"]);
  expect(canChangeForm(p)).toBe(false);
  expect(p.snap.hero.exhausted).toBe(false);
  // A basic attack (the Goblin Thrall's guard keeps it off Green Goblin).
  expect(p.run(() => p.battle.heroAction("basicAttack"))).toBe(true);
  if (p.snap.choice) p.choose({ label: "Goblin Thrall" });
  expect(p.snap.hero.exhausted).toBe(true);
  villainPhase(p);
  expect(p.snap.round).toBe(3);
  expect(p.snap.turn).toBe("player");
  // "Attached character cannot ready": the end of the player phase readied nothing.
  expect(p.snap.hero.exhausted).toBe(true);
  expect(heroInstance(p).exhausted).toBe(true);
  expect(p.snap.heroActions.some((a) => a.kind === "basicAttack")).toBe(false);
});

// =====================================================================================================================
// 02049 Media Coverage (attachment to your identity: each When Revealed you reveal resolves 1 more time; Alter-Ego
// Action: spend [mental] to discard it)
// =====================================================================================================================

test("02049 Media Coverage: revealed, it attaches to your identity", () => {
  const p = deal(stack(QUIET, "02049"));
  villainPhase(p);
  revealOf(p, "Media Coverage");
  const [media] = heroAttachments(p);
  expect(engine(p).instances[media!]!.cardId).toBe("02049");
  expect(engine(p).instances[media!]!.attachedTo).toBe(p.snap.hero.id);
});

// BUG: Media Coverage's reveal beat says `whenRevealed: true` (the table flashes for a When Revealed about to fire):
// its text only quotes the words ("Resolve each "When Revealed" ability ...") and it has no When Revealed of its own.
// Table bug (`/\bWhen Revealed\b/` over the card's text in model.ts).
test.fails("02049 Media Coverage: its reveal doesn't flash for a When Revealed it doesn't have", () => {
  const p = deal(stack(QUIET, "02049"));
  villainPhase(p);
  expect(p.beats[revealOf(p, "Media Coverage")]!.reveal!.whenRevealed).toBe(false);
});

// BUG: like All Tied Up, Media Coverage on the identity is in neither `inPlay` nor `enemyCards`: the table never shows
// it, so its Alter-Ego Action can't be reached by clicking it. Table bug.
test("02049 Media Coverage: the table shows it on the hero", () => {
  const p = deal(stack(QUIET, "02049"));
  villainPhase(p);
  const shown = [...p.snap.enemyCards, ...p.snap.inPlay].find((c) => c.name === "Media Coverage");
  expect(shown?.attachedTo).toBe(p.snap.hero.id);
});

test("02049 Media Coverage: the next When Revealed resolves twice (A Mess of Things: 2 + 2 + 2 for a stunned hero)", () => {
  const p = deal(stack(ONE_ICON, "02049", QUIET, "02037"), patchByCode("hero", { statuses: STUNNED }));
  villainPhase(p);
  expect(heroAttachments(p)).toHaveLength(1);
  villainPhase(p);
  const reveal = revealOf(p, "A Mess of Things");
  const id = enemy(p, "A Mess of Things")!.id;
  expect(
    since(p, reveal)
      .filter((b) => b.threat?.scheme === id)
      .map((b) => b.threat!.to),
  ).toEqual([2, 4, 6]);
  expect(threatOn(p, "A Mess of Things")).toBe(6);
});

test("02049 Media Coverage: Running Interference's question is asked twice; refused both times, 1 + 2 + 2 threat", () => {
  const p = deal(stack(QUIET, "02049", ONE_ICON, "02046"), handOf(...MENTAL_PHYSICAL_HAND));
  villainPhase(p);
  const asked = phase(p, (c) => (c.eitherOr === "choose" ? optionsNamed(c, "Place 2 threat here") : undefined));
  expect(asked.filter((c) => c.eitherOr === "choose")).toHaveLength(2);
  expect(threatOn(p, "Running Interference")).toBe(5);
});

test("02049 Media Coverage: the Alter-Ego Action is offered as Peter Parker, not as Spider-Man", () => {
  const p = deal(stack(QUIET, "02049"), handOf(...MENTAL_PHYSICAL_HAND));
  villainPhase(p);
  const [media] = heroAttachments(p);
  expect(p.battle.fieldActions(media!).map((a) => a.label)).toEqual(["Discard it: spend mental"]);
  p.form();
  expect(p.snap.hero.name).toBe("Spider-Man");
  expect(p.battle.fieldActions(media!)).toEqual([]);
});

test("02049 Media Coverage: spending a [mental] discards it", () => {
  const p = deal(stack(QUIET, "02049"), handOf(...MENTAL_PHYSICAL_HAND));
  villainPhase(p);
  const [media] = heroAttachments(p);
  const [action] = p.battle.fieldActions(media!);
  p.mark();
  expect(p.run(() => p.battle.fieldAction(media!, action!.kind))).toBe(true);
  expect(p.snap.payment!.outstanding).toEqual(["1 mental"]);
  expect(p.snap.payment!.sources.find((s) => s.label === "Backflip")!.available).toBe(false);
  p.spend("Swinging Web Kick");
  expect(p.run(() => p.battle.pay())).toBe(true);
  at(p, "Media Coverage is discarded", (b) => b.leftPlay === media);
  expect(heroAttachments(p)).toEqual([]);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Media Coverage");
  expect(p.snap.discard.map((c) => c.name)).toContain("Swinging Web Kick");
});
