import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { arrangeScene, sceneNames, sceneVillain } from "./debug-scenes.js";
import { BattleModel, EITHER_OTHERWISE, EITHER_SPEND, type BattleSnapshot } from "./model.js";

type Beat = BattleSnapshot["beats"][number];

/**
 * End the turn and answer every question until the hero's turn: every beat shown, and every question asked on the
 * way. `prefer` picks an option by its label where one matches; otherwise the last option (or none).
 */
function throughVillainPhase(battle: BattleModel, prefer: RegExp | null = null) {
  const beats: Beat[] = [];
  const asked: string[] = [];
  expect(battle.endTurn()).toBe(true);
  beats.push(...battle.snapshot().beats);
  for (let i = 0; i < 40; i++) {
    const view = battle.snapshot();
    if (view.outcome || (view.turn === "player" && !view.choice)) break;
    const options = view.choice?.options ?? [];
    if (view.choice) asked.push(`${view.choice.prompt} [${options.map((o) => o.label).join(" | ")}]`);
    const wanted = prefer ? options.find((o) => prefer.test(o.label)) : undefined;
    const picked =
      (wanted ? battle.choose(wanted.id) : false) ||
      (view.choice && view.choice.min > 1
        ? battle.chooseMany(options.slice(0, view.choice.min).map((o) => o.id))
        : false) ||
      battle.choose(options.at(-1)?.id ?? null) ||
      battle.choose(null);
    expect(picked, JSON.stringify(view.choice)).toBe(true);
    beats.push(...battle.snapshot().beats);
  }
  return { beats, asked, texts: beats.map((beat) => beat.text).filter(Boolean) };
}

function deal(scene: string, seed = 7): BattleModel {
  const battle = new BattleModel();
  battle.reset({ villain: "ultron", seed, arrange: arrangeScene(scene)! });
  return battle;
}

const drones = (view: BattleSnapshot) => view.enemyCards.filter((card) => card.drone);

/** Ultron's dev scenes (`/battle/?scene=ultron…`) must deal on any shuffle: the cards under the Drones vary by seed. */
describe("Ultron's dev scenes", () => {
  const ultron = sceneNames().filter((name) => sceneVillain(name) === "ultron");

  test("there are scenes for Ultron", () => {
    expect(ultron.length).toBeGreaterThanOrEqual(12);
  });

  // Twenty deals of a crowded scene take a while on a busy PC: a minute and a half, not the default thirty seconds.
  test.each(ultron)("%s deals on twenty different shuffles", { timeout: 90_000 }, (name) => {
    for (let seed = 1; seed <= 20; seed++) {
      const view = deal(name, seed).snapshot();
      expect(view.villain.name).toBe("Ultron");
      expect(view.turn).toBe("player");
      // Setup's own Drone is always there, on the villain's side and never among the player's cards.
      expect(drones(view).length).toBeGreaterThanOrEqual(1);
      expect(view.inPlay.some((card) => card.drone)).toBe(false);
    }
  });

  // What each scene shows, in words, for reading while building (ULTRON_SCENES_REPORT=<file>).
  test.runIf(process.env.ULTRON_SCENES_REPORT)("report", () => {
    const lines: string[] = [];
    for (const name of ultron) {
      const battle = deal(name);
      const view = battle.snapshot();
      lines.push(`\n===== ${name}`);
      lines.push(
        `villain ${view.villain.name} ${view.villainHp}hp ${JSON.stringify(view.villain.markers)} | hero ${view.hero.name} ${view.heroHp}hp`,
      );
      for (const card of view.enemyCards)
        lines.push(
          `  enemy ${card.name} (${card.type}${card.attachedTo ? ", attached" : ""}) hp=${card.hp ?? "-"} threat=${card.threat ?? "-"}/${card.threatTarget ?? "-"} ${JSON.stringify(card.markers)} actions=${JSON.stringify(battle.fieldActions(card.id).map((a) => a.label))}`,
        );
      lines.push(`  heroActions ${JSON.stringify(view.heroActions.map((a) => a.label))}`);
      if (view.heroActions.some((a) => a.kind === "basicThwart")) {
        battle.heroAction("basicThwart");
        const pick = battle.snapshot().choice;
        lines.push(`  thwart -> ${pick ? pick.options.map((o) => o.label).join(" | ") : "(went straight through)"}`);
        if (pick) battle.cancel();
        else battle.undo();
      }
      const { beats, asked } = throughVillainPhase(battle, /Drone/);
      for (const beat of beats) if (beat.text) lines.push(`  beat ${beat.text}${beat.droneIn ? "  [droneIn]" : ""}`);
      for (const question of asked) lines.push(`  asked ${question}`);
      const after = battle.snapshot();
      lines.push(
        `  after: drones=${drones(after).length} deck=${after.deckCount} discard=${after.discard.length} main=${after.enemyCards.find((c) => c.type === "main_scheme")?.name} ${after.enemyCards.find((c) => c.type === "main_scheme")?.threat}`,
      );
    }
    writeFileSync(process.env.ULTRON_SCENES_REPORT!, lines.join("\n"));
  });
});

/**
 * End the turn and answer questions the way `throughVillainPhase` does until one whose prompt matches `prompt` is
 * asked; returns the beats seen on the way, and stops with that question still open.
 */
function untilAsked(battle: BattleModel, prompt: RegExp): Beat[] {
  const beats: Beat[] = [];
  expect(battle.endTurn()).toBe(true);
  beats.push(...battle.snapshot().beats);
  for (let i = 0; i < 40; i++) {
    const view = battle.snapshot();
    if (view.choice && prompt.test(view.choice.prompt)) return beats;
    expect(view.outcome, "the game ended before the question came").toBeNull();
    expect(view.turn === "player" && !view.choice, "the hero's turn came back before the question").toBe(false);
    const options = view.choice?.options ?? [];
    const picked =
      (view.choice && view.choice.min > 1
        ? battle.chooseMany(options.slice(0, view.choice.min).map((o) => o.id))
        : false) ||
      battle.choose(options.at(-1)?.id ?? null) ||
      battle.choose(null);
    expect(picked, JSON.stringify(view.choice)).toBe(true);
    beats.push(...battle.snapshot().beats);
  }
  throw Error(`never asked ${prompt}`);
}

const idOf = (beats: readonly Beat[], name: string) => beats.find((beat) => beat.reveal?.name === name)?.reveal?.id;
const mainScheme = (view: BattleSnapshot) => view.enemyCards.find((card) => card.type === "main_scheme")!;

/**
 * The rules these protect (card text from packages/content/raw/marvelcdb/core.json):
 * - Ultron Drones (01140): a facedown Drone minion has base SCH 1, ATK 1, 1 hit point; after one is defeated, the card
 *   goes to its owner's discard pile. FFG ruling 26 Jan 2026 #5 (docs/rulings/marvel-champions-rulings-post-rrg-1-7.md):
 *   "The facedown side of a Drone minion essentially does not matter as that side is not in play"; FFG ruling 29 Nov
 *   2023 #118 (docs/rulings/post-rrg-1-5/07-november-2023.md): defeated Drones may be looked at as they go to the
 *   discard pile. Our reading of the two together: the table names the card under a Drone only once it is defeated.
 *   (RRG 1.8 "Discard" p. 16 is cited from model.ts; the page was not re-checked against the PDF.)
 * - Ultron (I) (01134): "After Ultron attacks you, choose to either place 1 threat on the main scheme or put the top
 *   card of your deck into play facedown, engaged with you as a Drone minion."
 */
describe("Ultron on the table (seed 7 unless a test says otherwise)", () => {
  test("ultrondrones: a Drone is a 1-hit-point minion called Drone, and nothing names the card under it until it is defeated", () => {
    const battle = deal("ultrondrones");
    const view = battle.snapshot();
    const out = drones(view);
    // Setup's Drone plus the scene's three.
    expect(out).toHaveLength(4);
    for (const drone of out) {
      expect(drone).toMatchObject({ name: "Drone", type: "minion", hp: 1, cost: null, drone: true });
      expect(drone.art).toContain("/stand-ins/");
      expect(battle.cardFacts(drone.id)).toContain("SCH 1 ATK 1");
    }
    expect(view.inPlay.some((card) => card.drone || card.name === "Drone")).toBe(false);
    expect(view.hand.some((card) => card.drone || card.name === "Drone")).toBe(false);
    expect(view.discard).toHaveLength(0);

    // Everything the table could show about the Drones before the attack: their cards, facts and target labels.
    const target = out.at(-1)!;
    const shown = [JSON.stringify(out), ...out.map((drone) => battle.cardFacts(drone.id))];
    expect(battle.heroAction("basicAttack")).toBe(true);
    const pick = battle.snapshot().choice!;
    shown.push(JSON.stringify(pick.options));
    const option = pick.options.find((o) => o.cardId === target.id)!;
    expect(option.label).toBe("Drone");
    expect(battle.choose(option.id)).toBe(true);

    const after = battle.snapshot();
    expect(after.discard).toHaveLength(1);
    const was = after.discard[0]!.name;
    const defeated = after.beats.find((beat) => beat.defeatedCard === target.id);
    expect(defeated).toMatchObject({
      droneWas: was,
      text: `Drone defeated: it was ${was}, now in your discard pile`,
    });
    // The scene's three Drones hide these (debug-scenes.ts); setup's hides a card that varies by seed.
    for (const text of shown)
      for (const hidden of new Set([was, "Swinging Web Kick", "Black Cat", "Web-Shooter"]))
        expect(text).not.toContain(hidden);
    expect(drones(after)).toHaveLength(3);
  });

  test("ultronattack: after Ultron attacks, Drone or threat; the Drone leaves the deck on its own beat", () => {
    const battle = deal("ultronattack");
    const ultron = battle.snapshot().villain.id;
    untilAsked(battle, /^Choose one$/);
    const choice = battle.snapshot().choice!;
    expect(choice.options.map((o) => o.label)).toEqual([
      "Place 1 threat on the main scheme",
      "Put the top card of your deck into play as a Drone minion",
    ]);
    // Issue 210 (a player's report, 2026-11-26): the main scheme the threat would go on is named as a card the
    // question changes, so the table keeps it and its threat in focus while asking.
    const mainScheme = battle.snapshot().enemyCards.find((card) => card.type === "main_scheme")!;
    expect(choice.affects).toEqual([mainScheme.id]);
    const before = drones(battle.snapshot()).length;
    expect(battle.choose(choice.options.find((o) => /Drone/.test(o.label))!.id)).toBe(true);
    const view = battle.snapshot();
    const arrived = view.beats.filter((beat) => beat.droneIn);
    expect(arrived).toHaveLength(1);
    expect(arrived[0]!.droneIn).toMatchObject({ from: "deck", source: ultron, deckCount: view.deckCount });
    expect(arrived[0]!.droneIn!.card).toMatchObject({ name: "Drone", drone: true });
    expect(drones(view)).toHaveLength(before + 1);
  });

  test("ultronboost: Android Efficiency's boost names itself and asks its either-or in two steps", () => {
    // Adam, 2026-11-25: the question read "Villain phase" and he looked for it on Ultron's own text; then: "split like
    // any other question card ... if they choose resource it should reveal on the board anything ... they can use as
    // resources and then if they back out or cancel it takes them to the choice again".
    const battle = deal("ultronboost");
    const beats = untilAsked(battle, /^Choose one$/);
    let choice = battle.snapshot().choice!;
    expect(choice.sourceTitle).toBe("Android Efficiency · Boost");
    expect(choice.eitherOr).toBe("choose");
    expect(choice.options).toEqual([
      { id: EITHER_SPEND, label: "Spend 1 energy", cardId: null },
      {
        id: EITHER_OTHERWISE,
        label: "Put the top card of the deck into play facedown, engaged with you as a Drone minion",
        cardId: null,
      },
    ]);
    // The boost card turned over during the attack is the one asking: the table holds it up while it does.
    const boost = beats.find((beat) => beat.reveal?.boost)?.reveal;
    expect(boost?.name).toBe("Android Efficiency");
    expect(battle.snapshot().choiceSource).toBe(boost!.id);
    // The first step already names the cards that could pay, so the table keeps them readable (issue 217).
    const payers = choice.payers;

    // "Spend 1 energy": the cards that can pay are the picks, and it can be backed out of.
    expect(battle.choose(EITHER_SPEND)).toBe(true);
    choice = battle.snapshot().choice!;
    expect(choice).toMatchObject({ eitherOr: "spend", prompt: "Spend 1 energy", canCancel: true, spend: true });
    expect(choice.options.length).toBeGreaterThan(0);
    expect(choice.options.every((option) => option.cardId)).toBe(true);
    expect(payers).toEqual(choice.options.map((option) => option.cardId));
    expect(battle.snapshot().choiceSource).toBe(boost!.id);
    battle.cancel();
    expect(battle.snapshot().choice?.eitherOr).toBe("choose");

    // The other half: a Drone comes off the top of the deck.
    const before = drones(battle.snapshot()).length;
    expect(battle.choose(EITHER_OTHERWISE)).toBe(true);
    expect(battle.snapshot().beats.some((beat) => beat.droneIn?.from === "deck")).toBe(true);
    expect(drones(battle.snapshot())).toHaveLength(before + 1);
  });

  test("ultronattack: choosing threat puts no Drone in from Ultron and the main scheme gains that 1 threat", () => {
    const drone = deal("ultronattack");
    throughVillainPhase(drone, /Drone/);
    const threat = deal("ultronattack");
    const ultron = threat.snapshot().villain.id;
    const { beats } = throughVillainPhase(threat, /threat/);
    // Drone Factory comes up later in this phase and brings its own Drone; only Ultron's is ruled out.
    expect(beats.some((beat) => beat.droneIn?.source === ultron)).toBe(false);
    expect(mainScheme(threat.snapshot()).threat).toBe(mainScheme(drone.snapshot()).threat! + 1);
  });

  test("ultronnorad: The Crimson Cowl turns over to Assault on NORAD, and a Drone follows (01137 When Revealed)", () => {
    const battle = deal("ultronnorad");
    const { beats } = throughVillainPhase(battle);
    const advance = beats.findIndex((beat) => beat.schemeAdvance);
    expect(beats[advance]?.schemeAdvance).toMatchObject({
      from: "The Crimson Cowl",
      to: "Assault on NORAD",
      stage: 2,
    });
    const drone = beats.findIndex((beat, i) => i > advance && beat.droneIn);
    expect(drone).toBeGreaterThan(advance);
    expect(beats[drone]!.droneIn!.source).toBe(beats[advance]!.schemeAdvance!.scheme);
  });

  test("ultronassault: Assault on NORAD asks for 2 threat or a Drone (01138)", () => {
    const { asked } = throughVillainPhase(deal("ultronassault"));
    expect(asked).toContain(
      "Choose one [Place 2 threat here | Put the top card of your deck into play as a Drone minion]",
    );
  });

  test("ultronassault: Assault on NORAD's own question names the scheme as the card it changes", () => {
    const battle = deal("ultronassault");
    untilAsked(battle, /^Choose one$/);
    const view = battle.snapshot();
    const norad = view.enemyCards.find((card) => card.type === "main_scheme")!;
    expect(view.choice!.options.map((o) => o.label)).toContain("Place 2 threat here");
    expect(view.choice!.affects).toEqual([norad.id]);
  });

  test("ultroncountdown: Countdown to Oblivion's threat is locked, and the hero's Thwart goes to Drone Factory", () => {
    // 01139: "Threat cannot be removed from this scheme." RRG 1.8 "Target" (p. 43): no target for a thwart.
    const battle = deal("ultroncountdown");
    const view = battle.snapshot();
    const countdown = view.enemyCards.find((card) => card.name === "Countdown to Oblivion")!;
    const factory = view.enemyCards.find((card) => card.name === "Drone Factory")!;
    expect(countdown.type).toBe("main_scheme");
    expect(countdown.threatLock).toBe("Threat cannot be removed from this scheme");
    expect(factory.threatLock).toBeUndefined();
    // A side scheme can still be thwarted, so the hero's menu has nothing to explain.
    expect(battle.heroNotes()).toEqual([]);
    expect(battle.heroAction("basicThwart")).toBe(true);
    const pick = battle.snapshot().choice;
    if (pick) {
      expect(pick.options.some((o) => o.cardId === countdown.id)).toBe(false);
      battle.choose(pick.options.find((o) => o.cardId === factory.id)!.id);
    }
    const after = battle.snapshot();
    expect(after.enemyCards.find((card) => card.id === factory.id)!.threat).toBe(factory.threat! - 1);
    expect(after.enemyCards.find((card) => card.id === countdown.id)!.threat).toBe(countdown.threat);
  });

  test("ultrongear: Upgraded Drones and Program Transmitter can be paid off; Drones get +1 ATK and +1 HP", () => {
    // 01142 "Spend [energy][mental][physical] → discard this card"; 01141 "Exhaust your hero and spend [mental][mental]".
    const battle = deal("ultrongear");
    const view = battle.snapshot();
    const card = (name: string) => view.enemyCards.find((c) => c.name === name)!;
    expect(battle.fieldActions(card("Upgraded Drones").id).map((a) => a.label)).toEqual([
      "Discard it: spend energy, mental, physical",
    ]);
    expect(battle.fieldActions(card("Program Transmitter").id).map((a) => a.label)).toEqual([
      "Discard it: exhaust your hero, spend 2 mental",
    ]);
    expect(drones(view).length).toBeGreaterThan(0);
    for (const drone of drones(view)) {
      expect(drone.hp).toBe(2);
      expect(drone.markers).toEqual(
        expect.arrayContaining([
          { name: "ATK", count: 1 },
          { name: "HP", count: 1 },
        ]),
      );
    }
  });

  test("ultronarmor: Vibranium Armor and Concussion Blasters; attacking Ultron draws a retaliate hit, then tough", () => {
    // 01152 "After the villain takes damage, give it a tough status card"; 01153 "The villain gains retaliate 1".
    const battle = deal("ultronarmor");
    const view = battle.snapshot();
    const card = (name: string) => view.enemyCards.find((c) => c.name === name)!;
    expect(battle.fieldActions(card("Vibranium Armor").id).map((a) => a.label)).toEqual([
      "Discard it: exhaust your hero, spend 2 physical",
    ]);
    expect(battle.fieldActions(card("Concussion Blasters").id).map((a) => a.label)).toEqual([
      "Discard it: exhaust your hero, spend 2 energy",
    ]);
    const ultron = view.villain.id;
    const hero = view.hero.id;
    expect(battle.heroAction("basicAttack")).toBe(true);
    if (battle.snapshot().choice) expect(battle.choose(ultron)).toBe(true);
    const after = battle.snapshot();
    expect(after.villainHp).toBe(view.villainHp - 2);
    expect(after.beats.some((b) => b.hit?.source === ultron && b.hit.target === hero && b.hit.amount === 1)).toBe(true);
    expect(after.heroHp).toBe(view.heroHp - 1);
    expect(after.beats.some((b) => b.statusChange?.name === "tough" && b.statusChange.id === ultron)).toBe(true);
    expect(after.villain.markers).toContainEqual({ name: "tough", count: 1 });
  });

  test("ultronswarm: Swarm Attack makes each Drone engaged with the hero attack (01147)", () => {
    const battle = deal("ultronswarm");
    const start = drones(battle.snapshot()).length;
    const { beats } = throughVillainPhase(battle, /Drone/);
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Swarm Attack");
    expect(reveal).toBeGreaterThan(-1);
    const inPlay = start + beats.slice(0, reveal).filter((beat) => beat.droneIn).length;
    const end = beats.findIndex((beat, i) => i > reveal && (beat.reveal || beat.leftPlay || beat.phase));
    const attackers = beats
      .slice(reveal, end)
      .filter((beat) => beat.hit && beat.text.startsWith("Drone deals"))
      .map((beat) => beat.hit!.source);
    expect(new Set(attackers).size).toBe(inPlay);
    expect(attackers).toHaveLength(inPlay);
  });

  test("ultronswarmalterego: in alter-ego no Drone attacks, and a Drone comes off the deck instead (01147, issue 222)", () => {
    const battle = deal("ultronswarmalterego");
    const { beats } = throughVillainPhase(battle, /Drone/);
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Swarm Attack");
    expect(reveal).toBeGreaterThan(-1);
    const end = beats.findIndex((beat, i) => i > reveal && (beat.reveal || beat.leftPlay || beat.phase));
    const swarm = beats.slice(reveal, end);
    expect(swarm.filter((beat) => beat.hit)).toEqual([]);
    expect(swarm.filter((beat) => beat.droneIn?.from === "deck")).toHaveLength(1);
  });

  test("ultronrepair: Repair Sequence heals Ultron 2 for each Drone engaged (01146)", () => {
    const battle = deal("ultronrepair");
    const start = drones(battle.snapshot()).length;
    const ultron = battle.snapshot().villain.id;
    const { beats } = throughVillainPhase(battle, /Drone/);
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Repair Sequence");
    expect(reveal).toBeGreaterThan(-1);
    // At seed 7 The Crimson Cowl completes first and brings a Drone of its own, so count the Drones at the reveal.
    const engaged = start + beats.slice(0, reveal).filter((beat) => beat.droneIn).length;
    const heal = beats.slice(reveal).find((beat) => beat.statusChange?.id === ultron);
    expect(heal?.statusChange).toEqual({ id: ultron, name: "damage", delta: -2 * engaged });
  });

  test("ultronrage: Rage of Ultron discards one card off the deck for each damage its attack dealt (01145)", () => {
    const battle = deal("ultronrage");
    const ultron = battle.snapshot().villain.id;
    const hero = battle.snapshot().hero.id;
    const { beats } = throughVillainPhase(battle, /Drone/);
    const reveal = beats.findIndex((beat) => beat.reveal?.name === "Rage of Ultron");
    expect(reveal).toBeGreaterThan(-1);
    const milled = beats.findIndex((beat, i) => i > reveal && beat.milled);
    expect(milled).toBeGreaterThan(reveal);
    const dealt = beats
      .slice(reveal, milled)
      .filter((beat) => beat.hit?.source === ultron && beat.hit.target === hero)
      .reduce((sum, beat) => sum + beat.hit!.amount, 0);
    expect(dealt).toBeGreaterThan(0);
    expect(beats[milled]!.milled).toHaveLength(dealt);
  });

  // Spider-Sense resolves in the middle of Rage of Ultron's attack: the discard is still Rage of Ultron's.
  test("ultronrage: the cards Rage of Ultron discards say Rage of Ultron discarded them", () => {
    const battle = deal("ultronrage");
    const { beats } = throughVillainPhase(battle, /Drone/);
    const rage = idOf(beats, "Rage of Ultron");
    const milled = beats.find((beat, i) => i > beats.findIndex((b) => b.reveal?.id === rage) && beat.milled);
    expect(milled?.millSource?.card).toBe(rage);
  });

  test("ultroninvasive: Invasive AI discards the top 3 cards of the deck (01149)", () => {
    const battle = deal("ultroninvasive");
    const { beats } = throughVillainPhase(battle, /Drone/);
    const invasive = idOf(beats, "Invasive AI");
    const milled = beats.find((beat) => beat.milled && beat.millSource?.card === invasive);
    expect(milled?.milled).toHaveLength(3);
  });

  test("ultronfactory: Drone Factory brings one Drone and Ultron's Imperative two, each seen arriving (01148, 01150)", () => {
    const battle = deal("ultronfactory");
    const { beats } = throughVillainPhase(battle, /Drone/);
    const factory = idOf(beats, "Drone Factory");
    const imperative = idOf(beats, "Ultron's Imperative");
    expect(factory && imperative).toBeTruthy();
    const from = (id: string | undefined) => beats.filter((beat) => beat.droneIn && beat.droneIn.source === id);
    expect(from(factory)).toHaveLength(1);
    expect(from(imperative)).toHaveLength(2);
    // Each Drone leaves the deck one card at a time.
    const counts = beats.filter((beat) => beat.droneIn).map((beat) => beat.droneIn!.deckCount);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBe(counts[i - 1]! - 1);
  });

  test("ultronefficiency: Android Efficiency's boost asks to spend an energy or take a Drone (01144a)", () => {
    const { asked } = throughVillainPhase(deal("ultronefficiency"), /Drone/);
    expect(
      asked.some((q) =>
        q.startsWith(
          "Choose one [Spend 1 energy | Put the top card of the deck into play facedown, engaged with you as a Drone minion]",
        ),
      ),
    ).toBe(true);
  });

  test("ultronadvanced: defeating Advanced Ultron Drone puts the top card of the deck in as a Drone (01143)", () => {
    // "Forced Interrupt: When Advanced Ultron Drone is defeated…": the Drone arrives as it is defeated, so its beat
    // comes between the killing hit and the defeat beat.
    const battle = deal("ultronadvanced");
    const view = battle.snapshot();
    const advanced = view.enemyCards.find((card) => card.name === "Advanced Ultron Drone")!;
    const before = drones(view).length;
    expect(battle.heroAction("basicAttack")).toBe(true);
    const pick = battle.snapshot().choice;
    if (pick) expect(battle.choose(pick.options.find((o) => o.cardId === advanced.id)!.id)).toBe(true);
    const after = battle.snapshot();
    const hit = after.beats.findIndex((beat) => beat.hit?.target === advanced.id);
    const drone = after.beats.findIndex((beat) => beat.droneIn);
    const defeat = after.beats.findIndex((beat) => beat.defeatedCard === advanced.id);
    expect(hit).toBeGreaterThan(-1);
    expect(defeat).toBeGreaterThan(-1);
    expect(drone).toBeGreaterThan(hit);
    expect(after.beats[drone]!.droneIn!.source).toBe(advanced.id);
    expect(after.enemyCards.some((card) => card.id === advanced.id)).toBe(false);
    expect(drones(after)).toHaveLength(before + 1);
  });
});

describe("setup notes", () => {
  test("Ultron's setup says the environment and the first Drone came into play", () => {
    const battle = new BattleModel();
    battle.reset({ villain: "ultron", seed: 7, mulligan: true });
    expect(battle.setupNotes).toEqual([
      "Setup: Ultron Drones comes into play",
      "Setup: the top card of your deck goes into play facedown as a Drone minion",
    ]);
  });

  test("Klaw's name Defense Network; Rhino's are empty", () => {
    const klaw = new BattleModel();
    klaw.reset({ villain: "klaw", seed: 7, mulligan: true });
    expect(klaw.setupNotes.some((note) => note.includes("Defense Network"))).toBe(true);
    const rhino = new BattleModel();
    rhino.reset({ villain: "rhino", seed: 7, mulligan: true });
    expect(rhino.setupNotes).toEqual([]);
  });
});

/**
 * RRG 1.8 "Player Elimination": the eliminated player's hand, deck and cards in play are removed; with no player left
 * the game is lost. ultrongear at seed 7 with the Drone always chosen: Ultron, three Drones and Assault defeat
 * Spider-Man in the first villain phase.
 */
describe("the hero is defeated in the villain phase (ultrongear, seed 7)", () => {
  const lastHit = (beats: readonly Beat[], hero: string) =>
    beats.map((beat) => beat.hit?.target === hero).lastIndexOf(true);

  test("the game is lost", () => {
    const battle = deal("ultrongear");
    const hero = battle.snapshot().hero.id;
    const { beats } = throughVillainPhase(battle, /Drone/);
    expect(battle.snapshot().outcome).toMatchObject({ result: "loss" });
    expect(lastHit(beats, hero)).toBeGreaterThan(-1);
  });

  // An eliminated player's hand, deck and cards in play are cleared away: that is not played out card by card.
  test("nothing is discarded from the hand or the deck after the hero's last hit", () => {
    const battle = deal("ultrongear");
    const hero = battle.snapshot().hero.id;
    const { beats } = throughVillainPhase(battle, /Drone/);
    const after = beats.slice(lastHit(beats, hero) + 1);
    expect(after.filter((beat) => beat.milled || beat.handDiscard).map((beat) => beat.text)).toEqual([]);
  });
});

// Found playing a whole game against Ultron (2026-11-24).
describe("what the first game against Ultron showed", () => {
  test("ultronroom: a reaction to a Drone's defeat asks about the Drone, not the card it turned out to be", () => {
    const battle = deal("ultronroom");
    const drone = drones(battle.snapshot())[0]!;
    expect(battle.heroAction("basicAttack")).toBe(true);
    expect(battle.choose(drone.id)).toBe(true);
    const view = battle.snapshot();
    const was = view.beats.find((beat) => beat.defeatedCard === drone.id)?.droneWas;
    expect(was).toBeTruthy();
    expect(view.choice?.prompt).toMatch(/^The Drone was defeated/);
    expect(view.choice?.prompt).not.toContain(was!);
  });

  test("ultrondeck: a Drone that takes the deck's last card is seen going before the deck is made again", () => {
    const battle = deal("ultrondeck");
    expect(battle.snapshot().deckCount).toBe(1);
    expect(battle.endTurn()).toBe(true);
    const beats: Beat[] = [...battle.snapshot().beats];
    for (let i = 0; i < 40; i++) {
      const view = battle.snapshot();
      if (view.outcome || (view.turn === "player" && !view.choice)) break;
      const choice = view.choice!;
      // Keep the whole hand at the end of the turn, so nothing is drawn and the deck still holds its one card.
      const done = choice.discardFromHand
        ? battle.chooseMany([])
        : battle.choose(choice.options.at(-1)?.id ?? null) || battle.choose(null);
      expect(done, JSON.stringify(choice)).toBe(true);
      beats.push(...battle.snapshot().beats);
    }
    const last = beats.findIndex((beat) => beat.droneIn?.deckCount === 0);
    const reset = beats.findIndex((beat) => beat.deckReset !== undefined);
    expect(last).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(last);
    // The encounter card dealt for running out follows the reset, and the next Drone comes off the new deck.
    expect(beats.findIndex((beat, i) => i > reset && beat.penalty)).toBeGreaterThan(reset);
    const next = beats.find((beat, i) => i > reset && beat.droneIn);
    expect(next?.droneIn?.deckCount).toBe(beats[reset]!.deckReset! - 1);
  });

  test("an ally's own attack or thwart costs it damage, which the play hook can warn about", () => {
    const battle = deal("ultrondrones");
    const jessica = battle.snapshot().inPlay.find((card) => card.name === "Jessica Jones")!;
    expect(battle.consequentialDamage(jessica.id, "attack")).toBe(1);
    expect(battle.consequentialDamage(jessica.id, "thwart")).toBe(1);
    expect(battle.consequentialDamage(battle.snapshot().hero.id, "attack")).toBe(0);
    expect(battle.consequentialDamage(drones(battle.snapshot())[0]!.id, "attack")).toBe(0);
  });
});

describe("Ultron's second stage, and the win", () => {
  test("ultronstage: Ultron (II) puts a Drone into play as he attacks and hits harder for each, until the attack ends", () => {
    const battle = deal("ultronstage");
    expect(battle.heroAction("basicAttack")).toBe(true);
    if (battle.snapshot().choice) battle.choose(battle.snapshot().villain.id);
    // Standard mode: Ultron (I) then Ultron (II), 22 hit points.
    expect(battle.snapshot().villainHp).toBe(22);
    const ultron = battle.snapshot().villain.id;
    const { beats } = throughVillainPhase(battle, /Drone|Spider-Sense|^Defend$/);
    const arrives = beats.findIndex((beat) => beat.droneIn?.source === ultron);
    const stronger = beats.findIndex((beat) => beat.modifier?.id === ultron && beat.modifier.name === "ATK");
    const hit = beats.findIndex((beat) => beat.hit?.source === ultron);
    const back = beats.findIndex(
      (beat, i) => i > stronger && beat.modifier?.id === ultron && beat.modifier.name === "ATK" && !beat.modifier.count,
    );
    expect(arrives).toBeGreaterThan(-1);
    // The Drone is seen arriving, then the bonus it gives (+1 ATK for each Drone engaged), then the attack lands.
    expect(stronger).toBeGreaterThan(arrives);
    expect(beats[stronger]!.modifier!.count).toBe(
      drones(battle.snapshot()).length >= 3 ? 3 : beats[stronger]!.modifier!.count,
    );
    expect(hit).toBeGreaterThan(stronger);
    expect(back).toBeGreaterThan(hit);
    expect(battle.snapshot().villain.markers.some((marker) => marker.name === "ATK")).toBe(false);
  });

  test("ultronnorad: the deck count a Drone leaves behind allows for cards drawn earlier in the same move", () => {
    const battle = deal("ultronnorad");
    const before = battle.snapshot().deckCount;
    expect(battle.endTurn()).toBe(true);
    const choice = battle.snapshot().choice!;
    expect(choice.discardFromHand).toBe(true);
    // Two cards discarded at the end of the turn are two cards drawn, then the villain phase makes a Drone.
    expect(battle.chooseMany(choice.options.slice(0, 2).map((option) => option.id))).toBe(true);
    const view = battle.snapshot();
    expect(view.beats.find((beat) => beat.draw)?.draw).toHaveLength(2);
    expect(view.beats.find((beat) => beat.droneIn)?.droneIn?.deckCount).toBe(before - 3);
    expect(view.deckCount).toBe(before - 3);
  });

  test("ultronfinish: Ultron (I) falls, then all of Ultron (II) in one turn, and the game is won at stage two", () => {
    const battle = deal("ultronfinish");
    const view = () => battle.snapshot();
    const card = (name: string) => {
      const found = [...view().hand, ...view().inPlay].find((c) => c.name === name);
      if (!found) throw Error(`no ${name}`);
      return found;
    };
    const attack = (who: string) => {
      const done =
        who === "Spider-Man" ? battle.heroAction("basicAttack") : battle.fieldAction(card(who).id, "basicAttack");
      expect(done, `${who} attacks`).toBe(true);
      if (view().choice) expect(battle.choose(view().villain.id), `${who} at Ultron`).toBe(true);
    };
    const kick = (pay: string[]) => {
      expect(battle.pick(card("Swinging Web Kick").id)).toBe(true);
      if (view().choice && !view().payment) expect(battle.choose(view().villain.id)).toBe(true);
      for (const label of pay) {
        const source = view().payment!.sources.find((s) => s.label.startsWith(label) && !s.selected && s.available);
        expect(source, `${label} in ${JSON.stringify(view().payment!.sources.map((s) => s.label))}`).toBeDefined();
        battle.toggle(source!.id);
      }
      expect(battle.pay(), "pay for the Kick").toBe(true);
      if (view().choice) expect(battle.choose(view().villain.id)).toBe(true);
    };

    expect(view().villainHp).toBe(1);
    attack("Black Cat");
    expect(view().villainHp).toBe(22);
    expect(view().beats.some((beat) => beat.villainStage === 2)).toBe(true);
    attack("Spider-Man");
    kick(["Energy", "Web-Shooter"]);
    kick(["Strength", "Web-Shooter"]);
    expect(view().villainHp).toBe(4);
    attack("Jessica Jones");
    expect(view().outcome).toBeNull();
    attack("Daredevil");
    // Standard mode ends at Ultron (II): no third stage comes up.
    expect(view().outcome).toMatchObject({ result: "win" });
    expect(view().beats.some((beat) => beat.villainStage === 3)).toBe(false);
  });
});
