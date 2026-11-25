/**
 * Black Panther's deck audit: every card of his Protection starter deck that Spider-Man's audit doesn't already cover,
 * played on the 3D table's model and checked for what the table shows (beats, prompts, targets, labels). His 15 cards
 * (01040–01049), his obligation (Affairs of State, 01155) and his nemesis set (01156–01159). The eight Protection
 * cards are `deck-audit-protection.test.ts`'s; the 11 basic cards are Spider-Man's audit's.
 */
import { expect, test } from "vitest";
import * as engine from "@mc/engine";
import {
  beat,
  codeOf,
  engageMinion,
  handOf,
  inPlay,
  nemesisInPlay,
  patchByCode,
  Player,
  scenarioOf,
  villainPhase,
  villainPhaseDeals,
  type Id,
  type Setup,
} from "./deck-audit-driver.js";

/** Answer Foresight's search (the first upgrade offered, or `pick` by name) so the turn can start. */
function foresight(p: Player, pick?: string) {
  const choice = p.snap.setup ? p.snap.choice : null;
  if (!choice) return p;
  const option = choice.options.find((o) => o.label === pick) ?? choice.options[0]!;
  p.run(() => p.battle.chooseMany([option.id]));
  return p;
}

const scenario = (...steps: Setup[]) => foresight(scenarioOf({ hero: "black-panther" }, ...steps));

/** Put cards from his deck or hand into the discard pile. */
const discardOf =
  (...codes: string[]): Setup =>
  (state) => {
    const p = state.players[0]!;
    let { hand, deck, discard } = p;
    for (const code of codes) {
      const id = [...hand, ...deck].find((i) => codeOf(state, i) === code && !discard.includes(i)) as Id | undefined;
      if (!id) throw Error(`no ${code} to discard`);
      hand = hand.filter((i) => i !== id);
      deck = deck.filter((i) => i !== id);
      discard = [...discard, id];
    }
    return { ...state, players: [{ ...p, hand, deck, discard }] };
  };

const mainThreat = (p: Player) => p.snap.enemyCards.find((c) => c.type === "main_scheme")!.threat!;

/** Play Wakanda Forever! and answer its order question in the order given (by upgrade name), then any target. */
function wakandaForever(p: Player, order: string[], target?: string) {
  p.mark();
  p.play("Wakanda Forever!", { pay: ["Energy"] });
  const choice = p.snap.choice;
  if (choice?.ordered) {
    const ids = order.map((name) => choice.options.find((o) => o.label === name)!.id);
    expect(p.run(() => p.battle.chooseMany(ids))).toBe(true);
  }
  for (let i = 0; i < 4 && p.snap.choice; i++) {
    const option = p.snap.choice.options.find((o) => o.label === target) ?? p.snap.choice.options[0]!;
    p.run(() => p.battle.chooseMany([option.id]));
  }
}

// 01040 Black Panther / T'Challa ---------------------------------------------------------------------------------------

test("01040b Foresight: before the first turn T'Challa searches his deck for one of his four upgrades, in its words", () => {
  const p = scenarioOf({ hero: "black-panther" });
  const choice = p.snap.choice!;
  expect(p.snap.setup).toBe(true);
  expect(p.snap.hero.name).toBe("T'Challa");
  expect(choice.prompt).toBe("Foresight: search your deck for a Black Panther upgrade and add it to your hand");
  expect(choice.options.map((o) => o.label).sort()).toEqual([
    "Energy Daggers",
    "Panther Claws",
    "Tactical Genius",
    "Vibranium Suit",
  ]);
  const hand = p.snap.hand.length;
  p.run(() => p.battle.chooseMany([choice.options.find((o) => o.label === "Panther Claws")!.id]));
  expect(p.snap.setup).toBe(false);
  expect(p.snap.turn).toBe("player");
  expect(p.snap.hand).toHaveLength(hand + 1);
  expect(p.card("Panther Claws").playable).toBe(true);
});

test("01040a identity: T'Challa changes to Black Panther and back; Retaliate 1 hits Rhino when he attacks him", () => {
  const p = scenario(villainPhaseDeals());
  expect(p.snap.heroActions.find((a) => a.kind === "changeForm")?.label).toBe("Change to Black Panther");
  p.form();
  expect(p.snap.hero.name).toBe("Black Panther");
  const asked = villainPhase(p);
  void asked;
  const retaliate = beat(p, (b) => b.hit?.source === p.snap.hero.id && b.hit.target === p.snap.villain.id);
  expect(retaliate).toBeGreaterThanOrEqual(0);
  expect(p.beats[retaliate]!.hit!.amount).toBe(1);
});

// Wakanda Forever! and his four upgrades -------------------------------------------------------------------------------

test("01043 Wakanda Forever!: the order of his upgrades' Specials is asked by name, as buttons; the last step is doubled", () => {
  const p = scenario(
    inPlay("01046"),
    inPlay("01047"),
    inPlay("01048"),
    handOf("01043a", "01088", "01089"),
    engageMinion("01110"),
    patchByCode("scheme", { threat: 4 }),
  );
  p.form();
  p.mark();
  p.play("Wakanda Forever!", { pay: ["Energy"] });
  const order = p.snap.choice!;
  expect(order.prompt).toBe("Order these abilities");
  expect(order.ordered).toBe(true);
  expect(order.options.map((o) => o.label).sort()).toEqual(["Energy Daggers", "Panther Claws", "Tactical Genius"]);
  // Tucked under the hero, the upgrades are no cards to click: the order is picked on buttons.
  expect(order.options.every((o) => o.cardId === null)).toBe(true);
  const id = (name: string) => order.options.find((o) => o.label === name)!.id;
  p.run(() => p.battle.chooseMany([id("Energy Daggers"), id("Tactical Genius"), id("Panther Claws")]));
  // Panther Claws last: its 4 damage; the target is asked (Rhino or the Bomber, already hit by the Daggers).
  const target = p.snap.choice!;
  p.run(() => p.battle.chooseMany([target.options.find((o) => o.label === "Rhino")!.id]));
  expect(beat(p, (b) => b.text === "Energy Daggers deals 1 damage to Rhino")).toBeGreaterThanOrEqual(0);
  expect(beat(p, (b) => b.hit?.target === p.snap.villain.id && b.hit.amount === 4)).toBeGreaterThanOrEqual(0);
  expect(mainThreat(p)).toBe(3);
  expect(p.snap.villainHp).toBe(14 - 1 - 4);
  // Energy Daggers hits each enemy engaged with him too: the Bomber (2 HP) is down to 1.
  expect(p.card("Hydra Bomber", "enemyCards").hp).toBe(1);
});

test("01049 Vibranium Suit: as the last step it moves 2 of his damage onto an enemy", () => {
  const p = scenario(inPlay("01049"), handOf("01043a", "01088"), patchByCode("hero", { damage: 3 }));
  p.form();
  const hp = p.snap.heroHp;
  wakandaForever(p, ["Vibranium Suit"], "Rhino");
  expect(p.snap.heroHp).toBe(hp + 2);
  expect(p.snap.villainHp).toBe(12);
});

test("01046–01049 his upgrades sit tucked under him, with no menu of their own (their Specials are Wakanda Forever!'s)", () => {
  const p = scenario(inPlay("01046"), inPlay("01047"), inPlay("01048"), inPlay("01049"));
  p.form();
  for (const name of ["Energy Daggers", "Panther Claws", "Tactical Genius", "Vibranium Suit"]) {
    const card = p.card(name, "inPlay");
    expect(card.type).toBe("upgrade");
    expect(card.showAsFullCard).toBe(false);
    expect(p.battle.fieldActions(card.id)).toEqual([]);
  }
});

// His ally, events, support and resource -------------------------------------------------------------------------------

test("01041 Shuri: after she enters play she searches the deck for an upgrade, asked in the card's words", () => {
  const p = scenario(handOf("01041", "01088", "01089", "01090"));
  p.mark();
  p.play("Shuri", { pay: ["Strength"] });
  const offer = p.snap.choice!;
  expect(offer.offers![0]!.question).toBe("Respond with Shuri?");
  p.run(() => p.battle.chooseMany([offer.offers![0]!.id]));
  const search = p.snap.choice!;
  expect(search.prompt).toBe("Search your deck for an upgrade and add it to your hand");
  expect(search.options.length).toBeGreaterThan(1);
  const pick = search.options[0]!;
  const hand = p.snap.hand.length;
  p.run(() => p.battle.chooseMany([pick.id]));
  expect(p.snap.hand).toHaveLength(hand + 1);
  expect(p.snap.hand.map((c) => c.name)).toContain(pick.label);
});

test("01042 Ancestral Knowledge: as T'Challa, he picks up to 3 cards of his discard pile to shuffle back in", () => {
  const p = scenario(handOf("01042", "01088"), discardOf("01089", "01090", "01086", "01087"));
  const deck = p.snap.deckCount;
  p.mark();
  p.play("Ancestral Knowledge", { pay: ["Energy"] });
  const pick = p.snap.choice!;
  expect(pick.prompt).toBe("Choose up to 3 different cards in your discard pile and shuffle them into your deck");
  expect(pick.max).toBe(3);
  const ids = pick.options.slice(0, 3).map((o) => o.id);
  p.run(() => p.battle.chooseMany(ids));
  expect(p.snap.deckCount).toBe(deck + 3);
});

test("01045 The Golden City: as T'Challa, exhaust it to draw 2", () => {
  const p = scenario(inPlay("01045"));
  const city = p.card("The Golden City", "inPlay");
  const [action] = p.battle.fieldActions(city.id);
  expect(action).toMatchObject({ exhausts: true });
  expect(action!.label).toMatch(/draw 2/i);
  const hand = p.snap.hand.length;
  p.mark();
  p.run(() => p.battle.fieldAction(city.id, action!.kind));
  expect(p.snap.hand).toHaveLength(hand + 2);
  expect(beat(p, (b) => b.draw?.length === 2)).toBeGreaterThanOrEqual(0);
});

test("01044 Vibranium: a resource card that pays two of any kind", () => {
  const p = scenario(handOf("01044", "01041"));
  expect(p.card("Vibranium").playable).toBe(false);
  p.battle.pick(p.card("Shuri").id);
  const source = p.snap.payment!.sources.find((s) => s.label === "Vibranium")!;
  expect(source.icons).toEqual(["wild", "wild"]);
});

// His obligation and nemesis set ---------------------------------------------------------------------------------------

test("01155 Affairs of State as T'Challa: exhausting him removes it from the game", () => {
  const p = scenario(villainPhaseDeals("01155"));
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => l.startsWith("Exhaust")));
  const question = asked.find((a) => a.source?.startsWith("Affairs of State"))!;
  expect(question.labels[0]).toBe("Exhaust T'Challa → remove this obligation from the game");
  expect(p.snap.hero.exhausted).toBe(true);
  expect(p.beats.find((b) => b.text === "Affairs of State is removed from the game")?.removedFromGame).toBe(true);
});

test("01155 Affairs of State: or he discards one of his Black Panther upgrades, picked by name", () => {
  const p = scenario(inPlay("01046"), inPlay("01047"), villainPhaseDeals("01155"));
  const asked = villainPhase(p, (labels) => labels.findIndex((l) => !l.startsWith("Exhaust")));
  expect(asked.some((a) => a.labels.includes("Energy Daggers") && a.labels.includes("Panther Claws"))).toBe(true);
  expect(p.snap.inPlay.filter((c) => c.type === "upgrade")).toHaveLength(1);
  expect(p.snap.encounterDiscard.map((c) => c.name)).toContain("Affairs of State");
});

test("01157 Killmonger: Black Panther's upgrades can't damage him (Panther Claws' last step leaves him whole)", () => {
  const p = scenario(nemesisInPlay("01157"), inPlay("01047"), handOf("01043a", "01088"));
  p.form();
  const killmonger = p.card("Killmonger", "enemyCards");
  wakandaForever(p, ["Panther Claws"], "Killmonger");
  expect(p.card("Killmonger", "enemyCards").hp).toBe(killmonger.hp);
});

test("01158 Heart-Shaped Herb: Rhino and his engaged minions get tough, shown, and it surges", () => {
  const p = scenario(engageMinion("01110"), villainPhaseDeals("01158"));
  villainPhase(p);
  expect(p.snap.villain.markers).toContainEqual({ name: "tough", count: 1 });
  expect(p.card("Hydra Bomber", "enemyCards").markers).toContainEqual({ name: "tough", count: 1 });
  expect(p.beats.some((b) => b.text === "Heart-Shaped Herb surges")).toBe(true);
});

test("01159 Ritual Combat: the choice of damage to him or threat on the main scheme is asked in words", () => {
  const p = scenario(villainPhaseDeals("01159"));
  const asked = villainPhase(p);
  const question = asked.find((a) => a.source?.startsWith("Ritual Combat"));
  expect(question, JSON.stringify(asked)).toBeDefined();
  expect(question!.labels.join(" | ")).toMatch(/damage/i);
  expect(question!.labels.join(" | ")).toMatch(/threat/i);
});

void engine;
