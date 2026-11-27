/**
 * The Green Goblin pack's encounter cards on the 3D table: a sweep. Each of the 38 encounter-deck cards of its six sets
 * (Risky Business, Mutagen Formula, Goblin Gimmicks, A Mess of Things, Power Drain, Running Interference) is revealed in
 * a villain phase, with the hero in hero form and in alter-ego form, and played out with the questions answered as a
 * player would. The driver's watch fails the file on anything happening that the table doesn't show (`shown-check.ts`)
 * and on a question it can only show plainly (`question-check.ts`); here each card must also be seen: a beat names it.
 *
 * What each card does is `deck-audit-goblin.test.ts`'s, card by card. This sweep is the safety net under it: the table
 * copes with every card, whichever form the hero is in.
 */
import { expect, test } from "vitest";
import { WAVE1_CARDS } from "@mc/content";
import { scenarioOf, stack, villainPhase, type Setup } from "./deck-audit-driver.js";
import type { ModuleId, VillainId } from "./model.js";

/** The sets and where each is dealt: its own scenario, or Mutagen Formula with the module added. */
const SETS: readonly { set: string; villain: VillainId; module?: ModuleId }[] = [
  { set: "risky_business", villain: "risky-business" },
  { set: "mutagen_formula", villain: "mutagen-formula" },
  { set: "goblin_gimmicks", villain: "mutagen-formula", module: "goblin_gimmicks" },
  { set: "a_mess_of_things", villain: "mutagen-formula", module: "a_mess_of_things" },
  { set: "power_drain", villain: "risky-business", module: "power_drain" },
  { set: "running_interference", villain: "mutagen-formula", module: "running_interference" },
];

/** The cards of a set that go in the encounter deck (not the villain, main scheme or Criminal Enterprise). */
const deckCards = (set: string) =>
  WAVE1_CARDS.filter(
    (card) =>
      "encounterSetIds" in card &&
      (card.encounterSetIds as readonly string[]).includes(set) &&
      !["villain", "main_scheme", "environment"].includes(card.type),
  );

/**
 * The boost card dealt to the villain before the card under test: All Tied Up, which prints no boost icon and no Boost
 * ability, so the villain's activation changes nothing the test is about. Running Interference is added for it.
 */
const QUIET_BOOST = "02048";

const games = SETS.flatMap(({ set, villain, module }) =>
  deckCards(set).flatMap((card) =>
    (["hero", "alterEgo"] as const).map((form) => ({
      code: card.id as string,
      name: card.name,
      set,
      villain,
      modules: [
        ...new Set<ModuleId>([
          module ?? (villain === "risky-business" ? "power_drain" : "goblin_gimmicks"),
          "running_interference",
        ]),
      ],
      form,
    })),
  ),
);

test("the sweep covers all 38 encounter-deck cards of the pack's six sets", () => {
  expect(new Set(games.map((g) => g.code)).size).toBe(38);
});

test.each(games)("$code $name ($set), hero in $form form", ({ code, name, villain, modules, form }) => {
  // Norman Osborn never attacks (an infamy counter goes on Criminal Enterprise instead), so with the hero in hero form
  // in Risky Business no boost card is dealt and the card under test is the first off the deck.
  const boosted = !(villain === "risky-business" && form === "hero") && code !== QUIET_BOOST;
  const steps: Setup[] = [boosted ? stack(QUIET_BOOST, code) : stack(code)];
  const p = scenarioOf({ hero: "spider-man", villain, modules, seed: 75 }, ...steps);
  if (form === "hero") p.form();
  villainPhase(p);
  const seen = p.beats.some((beat) => JSON.stringify(beat).includes(name));
  expect(seen, `no beat names ${name}: ${p.beats.map((b) => b.text).join(" | ")}`).toBe(true);
});
