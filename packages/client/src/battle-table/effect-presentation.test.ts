import { expect, test, vi } from "vitest";
import * as engine from "@mc/engine";
import { BattleModel } from "./model.js";

function arrange(
  state: engine.GameState,
  handCode: string,
  encounterCodes: string[],
  engage = false,
): engine.GameState {
  const player = state.players[0]!;
  const event = [...player.deck, ...player.hand].find((id) => state.instances[id]?.cardId === handCode)!;
  const piles = engine.activeEncounterDeck(state);
  const top = encounterCodes.map((code) => piles.deck.find((id) => state.instances[id]?.cardId === code)!);
  const minion = engage ? top.shift() : null;
  const deck = [...top, ...piles.deck.filter((id) => id !== minion && !top.includes(id))];
  return {
    ...state,
    players: [
      {
        ...player,
        hand: [...new Set([...player.hand, event])],
        deck: player.deck.filter((id) => id !== event),
        playArea: minion ? [...player.playArea, minion] : player.playArea,
      },
    ],
    instances: minion
      ? { ...state.instances, [minion]: { ...state.instances[minion]!, faceup: true, engagedWith: player.playerId } }
      : state.instances,
    encounterDecks: { ...state.encounterDecks, [engine.activeEncounterDeckId(state)]: { ...piles, deck } },
  };
}

function scenario(setup: (state: engine.GameState) => engine.GameState) {
  const create = engine.createGame;
  const mock = vi.spyOn(engine, "createGame").mockImplementationOnce((...args) => {
    const result = create(...args);
    return result.ok ? { ...result, state: setup(result.state) } : result;
  });
  const battle = new BattleModel();
  try {
    battle.reset();
  } finally {
    mock.mockRestore();
  }
  return battle;
}

test("Rhino advances on the table before revealing his side scheme", () => {
  const battle = scenario((s) => {
    const id = s.villains[0]!.instanceId;
    return { ...s, instances: { ...s.instances, [id]: { ...s.instances[id]!, damage: 13 } } };
  });
  battle.heroAction("changeForm");
  const before = battle.snapshot();
  expect(battle.heroAction("basicAttack")).toBe(true);
  const after = battle.snapshot();
  expect(after.villain.id).toBe(before.villain.id);
  expect(after.villain.art).not.toBe(before.villain.art);
  expect(after.villainHp).toBe(15);
  expect(after.encounterDiscard.some((c) => c.id === after.villain.id)).toBe(false);
  const transition = after.beats.findIndex((b) => b.villainStage === 2);
  expect(transition).toBeGreaterThan(after.beats.findIndex((b) => b.hit));
  expect(after.beats[transition]?.defeat).toBe("Rhino · Stage 1 defeated");
  expect(after.beats.some((b) => b.reveal?.id === after.villain.id)).toBe(false);
  const scheme = after.enemyCards.find((c) => c.type === "side_scheme")!;
  expect(scheme.threat).toBe(3);
  expect(after.beats.findIndex((b) => b.reveal?.id === scheme.id)).toBeGreaterThan(transition);
});

test("Tough absorbs Spider-Man's hit at contact before he exhausts", () => {
  const battle = scenario((s) => {
    const id = s.villains[0]!.instanceId;
    const villain = s.instances[id]!;
    return { ...s, instances: { ...s.instances, [id]: { ...villain, statuses: { ...villain.statuses, tough: 1 } } } };
  });
  battle.heroAction("changeForm");
  const before = battle.snapshot();
  expect(battle.heroAction("basicAttack")).toBe(true);
  const after = battle.snapshot();
  expect(after.villainHp).toBe(before.villainHp);
  expect(after.villain.markers.some((m) => m.name === "tough")).toBe(false);
  const contacts = after.beats.filter((b) => b.hit);
  expect(contacts.map((b) => b.hit)).toEqual([
    { source: before.hero.id, target: before.villain.id, amount: 0, tough: true },
  ]);
  expect(after.beats.indexOf(contacts[0]!)).toBeLessThan(after.beats.findIndex((b) => b.turned?.exhausted));
});

test("a lethal villain attack ends the battle without starting a hero phase", () => {
  const battle = scenario((s) => {
    const hero = s.players[0]!.identity.instanceId;
    return { ...s, instances: { ...s.instances, [hero]: { ...s.instances[hero]!, damage: 9 } } };
  });
  expect(battle.heroAction("changeForm")).toBe(true);
  expect(battle.endTurn()).toBe(true);
  for (let i = 0; i < 15; i++) {
    const choice = battle.snapshot().choice;
    if (!choice) break;
    const picks = choice.defense ? ["decline"] : choice.options.slice(0, choice.min).map((option) => option.id);
    expect(battle.chooseMany(picks)).toBe(true);
  }
  const defeated = battle.snapshot();
  expect(defeated.outcome).toEqual({ result: "loss", reason: "allPlayersDefeated" });
  expect(defeated.heroHp).toBe(0);
  expect(defeated.beats.some((beat) => beat.phase === "hero")).toBe(false);
  const hit = defeated.beats.findIndex((beat) => beat.hit?.target === defeated.hero.id && beat.hit.amount > 0);
  expect(hit).toBeGreaterThanOrEqual(0);
  expect(defeated.beats.findIndex((beat) => beat.gameEnded)).toBeGreaterThan(hit);
});

test("Spider-Tracer reports its missing host while it is still in hand", () => {
  const battle = scenario((s) => arrange(s, "01007", []));
  const tracer = battle.snapshot().hand.find((c) => c.name === "Spider-Tracer")!;
  expect(tracer.playable).toBe(false);
  expect(tracer.reason).toMatch(/host/i);
  expect(battle.pick(tracer.id)).toBe(false);
  expect(battle.snapshot().payment).toBeNull();
});

test("Spider-Tracer stays visible on its engaged minion", () => {
  const battle = scenario((s) => arrange(s, "01007", ["01110"], true));
  const tracer = battle.snapshot().hand.find((c) => c.name === "Spider-Tracer")!;
  expect(battle.isTargetedAttachment(tracer.id)).toBe(true);
  expect(battle.pick(tracer.id)).toBe(true);
  const resource = battle.snapshot().payment!.sources.find((s) => s.kind === "handCard")!;
  battle.toggle(resource.id);
  expect(battle.pay()).toBe(true);
  expect(battle.snapshot().enemyCards).toContainEqual(
    expect.objectContaining({
      id: tracer.id,
      attachedTo: battle.snapshot().enemyCards.find((c) => c.type === "minion")!.id,
    }),
  );
});

test.each([1, 2])("Helicarrier pays the full Spider-Tracer cost with %i eligible minions", (count) => {
  const battle = scenario((s) => {
    const first = arrange(s, "01007", ["01110"], true);
    return count === 2 ? arrange(first, "01007", ["01110"], true) : first;
  });
  const hand = battle.snapshot().hand;
  const carrier = hand.find((c) => c.name === "Helicarrier")!;
  const tracer = hand.find((c) => c.name === "Spider-Tracer")!;
  expect(battle.pick(carrier.id)).toBe(true);
  for (const label of ["Strength", "Jessica Jones"])
    battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === label)!.id);
  expect(battle.pay()).toBe(true);
  expect(battle.fieldAction(carrier.id, battle.fieldActions(carrier.id)[0]!.kind)).toBe(true);
  const before = battle.snapshot();
  expect(before.hand.find((c) => c.id === tracer.id)).toMatchObject({ cost: 0, playable: true });
  expect(battle.pick(tracer.id)).toBe(true);
  const chosen = before.enemyCards.filter((c) => c.type === "minion").at(-1)!;
  if (count === 2) {
    const target = battle.snapshot().choice!.options.find((o) => o.cardId === chosen.id)!;
    expect(battle.choose(target.id)).toBe(true);
  }
  const after = battle.snapshot();
  expect(after.payment).toBeNull();
  expect(after.discard.map((c) => c.id)).toEqual(before.discard.map((c) => c.id));
  expect(after.enemyCards.find((c) => c.id === tracer.id)?.attachedTo).toBe(chosen.id);
});

test("Spider-Tracer can attach after Spider-Man attacks and interrupts only the attached minion's defeat", () => {
  const battle = scenario((s) => {
    const ready = arrange(s, "01007", ["01110"], true);
    const scheme = ready.mainScheme.instanceId;
    return { ...ready, instances: { ...ready.instances, [scheme]: { ...ready.instances[scheme]!, threat: 4 } } };
  });
  const opening = battle.snapshot();
  const tracer = opening.hand.find((c) => c.name === "Spider-Tracer")!;
  const minion = opening.enemyCards.find((c) => c.type === "minion")!;
  const hero = opening.hero.id;
  battle.heroAction("changeForm");
  expect(battle.heroAction("basicAttack")).toBe(true);
  const rhino = battle.snapshot().choice!.options.find((o) => o.cardId === opening.villain.id)!;
  expect(battle.choose(rhino.id)).toBe(true);
  expect(battle.snapshot().hero).toMatchObject({ id: hero, exhausted: true });
  expect(battle.pick(tracer.id)).toBe(true);
  const spend = (name: string) => battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === name)!.id);
  spend("Jessica Jones");
  expect(battle.pay()).toBe(true);
  expect(battle.snapshot().enemyCards.find((c) => c.type === "main_scheme")?.threat).toBe(4);
  expect(battle.snapshot().enemyCards.find((c) => c.id === tracer.id)?.attachedTo).toBe(minion.id);
  const kick = battle.snapshot().hand.find((c) => c.name === "Swinging Web Kick")!;
  expect(battle.pick(kick.id)).toBe(true);
  spend("Strength");
  spend("Helicarrier");
  expect(battle.pay()).toBe(true);
  expect(battle.choose(battle.snapshot().choice!.options.find((o) => o.cardId === minion.id)!.id)).toBe(true);
  expect(battle.snapshot().beats.find((beat) => beat.defeatedCard === minion.id)).toMatchObject({ text: "" });
  expect(battle.snapshot().enemyCards.find((c) => c.type === "main_scheme")?.threat).toBe(1);
  expect(battle.snapshot().discard.map((c) => c.id)).toContain(tracer.id);
});

test("Emergency is played and discarded and Jessica reacts to the side scheme reveal", () => {
  const battle = scenario((s) => arrange(s, "01085", ["01186", "01109"]));
  const opening = battle.snapshot();
  const emergency = opening.hand.find((c) => c.name === "Emergency")!;
  const jessica = opening.hand.find((c) => c.name === "Jessica Jones")!;
  battle.pick(jessica.id);
  for (const name of ["Strength", "Helicarrier"])
    battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === name)!.id);
  expect(battle.pay()).toBe(true);
  battle.endTurn();
  const beats = [...battle.snapshot().beats];
  for (let i = 0; i < 15; i++) {
    const c = battle.snapshot().choice;
    if (!c) break;
    const activate = !c.discardFromHand && c.options.find((o) => o.cardId === emergency.id);
    expect(
      battle.chooseMany(
        activate
          ? [activate.id]
          : c.options
              .filter((o) => o.cardId !== emergency.id)
              .slice(0, c.min)
              .map((o) => o.id),
      ),
    ).toBe(true);
    beats.push(...battle.snapshot().beats);
  }
  expect(battle.snapshot().hand.map((c) => c.id)).not.toContain(emergency.id);
  expect(battle.snapshot().discard.map((c) => c.id)).toContain(emergency.id);
  const activation = beats.findIndex((b) => b.activate?.card === emergency.id);
  expect(activation).toBeGreaterThanOrEqual(0);
  const interrupt = beats.findIndex((b) => b.interrupt === emergency.id);
  expect(interrupt).toBeGreaterThan(activation);
  expect(beats.findIndex((b) => b.discardEvent === emergency.id)).toBeGreaterThan(interrupt);
  const reveal = beats.findIndex((b) => b.reveal?.name === "Bomb Scare");
  expect(reveal).toBeGreaterThanOrEqual(0);
  expect(beats.findIndex((b) => b.modifier?.id === jessica.id && b.modifier.count === 1)).toBeGreaterThan(reveal);
  expect(battle.snapshot().inPlay.find((c) => c.id === jessica.id)?.markers).toContainEqual({ name: "THW", count: 1 });
});

test("two Backflips are offered separately and the chosen copy deflects the incoming damage before discard", () => {
  const battle = scenario((s) => {
    const ready = arrange(s, "01003", ["01186", "01109"]);
    const player = ready.players[0]!;
    const second = player.deck.find((id) => ready.instances[id]?.cardId === "01003")!;
    return {
      ...ready,
      players: [{ ...player, hand: [...player.hand, second], deck: player.deck.filter((id) => id !== second) }],
    };
  });
  battle.heroAction("changeForm");
  battle.endTurn();
  const beats = [];
  let chosen = "",
    declined = "";
  for (let i = 0; i < 20; i++) {
    const c = battle.snapshot().choice;
    if (!c) break;
    const flips = c.offers?.filter((o) => o.question.includes("Backflip")) ?? [];
    const picks = flips.length
      ? [flips[1]!.id]
      : c.defense
        ? ["decline"]
        : c.options
            .filter((o) => !o.label.includes("Backflip"))
            .slice(0, c.min)
            .map((o) => o.id);
    if (flips.length) {
      expect(flips).toHaveLength(2);
      chosen = flips[1]!.cardId;
      declined = flips[0]!.cardId;
    }
    expect(battle.chooseMany(picks)).toBe(true);
    beats.push(...battle.snapshot().beats);
    if (chosen) break;
  }
  expect(chosen).toBeTruthy();
  const activate = beats.findIndex((b) => b.activate?.card === chosen);
  const block = beats.findIndex((b) => b.deflection?.card === chosen && b.deflection.amount > 0);
  expect(activate).toBeGreaterThanOrEqual(0);
  expect(block).toBeGreaterThan(activate);
  expect(beats.findIndex((b) => b.discardEvent === chosen)).toBeGreaterThan(block);
  expect(battle.snapshot().hand.map((c) => c.id)).toContain(declined);
  expect(battle.snapshot().heroHp).toBe(10);
});

test("Surveillance Team can exhaust and spend a snoop counter to remove threat", () => {
  const battle = scenario((s) => {
    const ready = arrange(s, "01064", []);
    const scheme = ready.mainScheme.instanceId;
    return { ...ready, instances: { ...ready.instances, [scheme]: { ...ready.instances[scheme]!, threat: 3 } } };
  });
  const team = battle.snapshot().hand.find((c) => c.name === "Surveillance Team")!;
  expect(battle.pick(team.id)).toBe(true);
  battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === "Strength")!.id);
  expect(battle.pay()).toBe(true);
  const action = battle.fieldActions(team.id)[0];
  expect(action).toBeDefined();
  expect(battle.fieldAction(team.id, action!.kind)).toBe(true);
  expect(battle.snapshot().inPlay.find((c) => c.id === team.id)).toMatchObject({
    exhausted: true,
    markers: [{ name: "snoop", count: 2 }],
  });
  expect(battle.snapshot().enemyCards.find((c) => c.type === "main_scheme")?.threat).toBe(2);
  expect(battle.fieldActions(team.id)).toEqual([]);
});

test("Tenacity lets the player choose its physical payment before readying Spider-Man", () => {
  const battle = scenario((s) => arrange(s, "01093", []));
  const tenacity = battle.snapshot().hand.find((c) => c.name === "Tenacity")!;
  expect(tenacity.showAsFullCard).toBe(true);
  battle.heroAction("changeForm");
  battle.heroAction("basicAttack");
  expect(battle.pick(tenacity.id)).toBe(true);
  for (const label of ["Jessica Jones", "Helicarrier"])
    battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === label)!.id);
  expect(battle.pay()).toBe(true);
  const action = battle.fieldActions(tenacity.id)[0];
  expect(action).toBeDefined();
  expect(battle.fieldAction(tenacity.id, action!.kind)).toBe(true);
  const payment = battle.snapshot().payment!;
  expect(payment.outstanding).toEqual(["1 physical"]);
  const energy = payment.sources.find((s) => s.label === "Heroic Intuition")!;
  expect(energy.available).toBe(false);
  battle.toggle(energy.id);
  expect(battle.snapshot().payment).toMatchObject({ paid: 0, canPay: false });
  battle.cancel();
  expect(battle.snapshot().hero.exhausted).toBe(true);
  expect(battle.fieldAction(tenacity.id, action!.kind)).toBe(true);
  battle.toggle(battle.snapshot().payment!.sources.find((s) => s.label === "Strength")!.id);
  expect(battle.pay()).toBe(true);
  expect(battle.snapshot().hero.exhausted).toBe(false);
  expect(battle.snapshot().discard.map((c) => c.id)).toContain(tenacity.id);
});

test("Web-Shooter has a full card while passive Heroic Intuition is tucked", () => {
  const battle = scenario((s) => arrange(s, "01008", []));
  const { hand } = battle.snapshot();
  const shooter = hand.find((card) => card.name === "Web-Shooter")!;
  expect(shooter.showAsFullCard).toBe(true);
  expect(hand.find((card) => card.name === "Heroic Intuition")?.showAsFullCard).toBe(false);
  expect(battle.heroAction("changeForm")).toBe(true);
  expect(battle.pick(shooter.id)).toBe(true);
  battle.toggle(battle.snapshot().payment!.sources.find((source) => source.label === "Heroic Intuition")!.id);
  expect(battle.pay()).toBe(true);
  expect(battle.snapshot().inPlay.find((card) => card.id === shooter.id)).toMatchObject({
    showAsFullCard: true,
    markers: [{ name: "web", count: 3 }],
  });
});
