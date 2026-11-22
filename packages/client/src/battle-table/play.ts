/**
 * The play hook: lets Claude (or a script) play the 3D table the way a person does, through the page.
 *
 *   __battlePlay.look()        the table in words, and the numbered moves open now
 *   __battlePlay.play(n)       make move n (or the move whose words are given), wait for the table to settle, look
 *   __battlePlay.wait()        wait for the table to settle (the villain phase, a card in flight), then look
 *
 * Every move presses the same thing a click does: a button in the turn bar, a card on the table, a power in a card's
 * menu (`main.ts` hands those over in `PlayHooks`). So the cards fly and the sounds play as they would for a person,
 * and no rule lives here: the engine decides what each move does. The move list mirrors what the table offers at
 * this moment, as the controller does (`pad/controller.ts`).
 *
 * Driven through Surf: `browser_evaluate` with `await __battlePlay.play(3)`. Only on the dev server.
 */
import type { BattleCard, BattleSnapshot } from "./model.js";

type Source = NonNullable<BattleSnapshot["payment"]>["sources"][number];

/** A button in the turn bar, as `main.ts` builds it (`DockView`). */
export interface PlayButton {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick(): void;
}

/** The turn bar's current question, as `main.ts` builds it. */
export interface PlayDock {
  title: string;
  eyebrow?: { text: string } | null;
  help?: string | null;
  options?: readonly (PlayButton & { id: string; detail?: string | null })[];
  meter?: { paid: number; required: number } | null;
  primary?: PlayButton | null;
  secondary?: PlayButton | null;
}

/** What the hook reads and presses on the table (`main.ts`). */
export interface PlayHooks {
  state(): BattleSnapshot;
  dock(): PlayDock;
  /** The table is playing something out (the villain phase, a card in flight, discards landing). */
  busy(): boolean;
  /** The bar's double-click guard has passed since its question appeared. */
  settled(): boolean;
  /** Click a card on the table. */
  pick(id: string): void;
  /** Select or unselect a way to pay. */
  toggle(sourceId: string): void;
  /** Use a power or ability from a card's menu (the hero's menu for the hero). */
  useAction(id: string, kind: string): void;
  fieldActions(id: string): readonly { kind: string; label: string }[];
  /** The hero's and cards' menus could open now. */
  powersReady(): boolean;
  /** The "Defend?" yes/no is up (a defender is picked on the table only after "Defend"). */
  defenseAsked(): boolean;
  /** The cards picked so far in a pick-several question (mulligan, discard, choose up to N). */
  picked(): ReadonlySet<string>;
  cardFacts(id: string): string;
  /** The game's story so far, oldest first: the lines the turn bar's feed shows. */
  history(): readonly string[];
  /** A revealed encounter card held up to be read (the villain phase waits on its Continue): that card. */
  reading(): string | null;
  /** Press that Continue. */
  doneReading(): void;
}

export interface PlayMove {
  n: number;
  /** What the move does, as the table says it. */
  label: string;
  run(): void;
}

export interface Player {
  look(): string;
  moves(): readonly { n: number; label: string }[];
  play(move: number | string): Promise<string>;
  wait(): Promise<string>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPlayer(hooks: PlayHooks): Player {
  /** How much of the story `look` has already told. */
  let told = 0;

  function cardById(id: string | null): BattleCard | undefined {
    const state = hooks.state();
    return [
      state.hero,
      state.villain,
      ...state.enemyCards,
      ...state.inPlay,
      ...state.hand,
      ...state.encounterDiscard,
      ...state.discard,
    ].find((c) => c.id === id);
  }
  const name = (id: string | null) => cardById(id)?.name ?? id ?? "";

  function cardLine(card: BattleCard, extra: string[] = []): string {
    const bits = [...extra];
    if (card.hp !== undefined) bits.push(`${card.hp} HP left`);
    if (card.threat !== null) bits.push(`threat ${card.threat}${card.threatTarget ? `/${card.threatTarget}` : ""}`);
    for (const marker of card.markers) bits.push(`${marker.name} ${marker.count}`);
    if (card.exhausted) bits.push("exhausted");
    const facts = hooks.cardFacts(card.id);
    return `- ${card.name}${bits.length ? ` (${bits.join(", ")})` : ""}${facts ? `: ${facts}` : ""}`;
  }

  function buildMoves(): PlayMove[] {
    const state = hooks.state();
    const out: Omit<PlayMove, "n">[] = [];
    const read = hooks.reading();
    if (read) return [{ n: 1, label: `Continue (after reading ${name(read)})`, run: hooks.doneReading }];
    if (hooks.busy()) return [];
    const dock = hooks.dock();

    // Paying: each way to pay that can be picked, then the bar's Pay / Cancel.
    if (state.payment) {
      for (const source of state.payment.sources) {
        if (!source.available) continue;
        out.push({
          label: `${source.selected ? "Unselect" : "Pay with"} ${payLabel(source)}`,
          run: () => hooks.toggle(source.id),
        });
      }
    }

    // A question about cards on the table: those cards are picked on the table, the rest are buttons in the bar.
    const choice = state.choice;
    if (choice && !state.payment && !choice.offers?.length && !(choice.defense && hooks.defenseAsked())) {
      const listed = new Set((dock.options ?? []).map((option) => option.id));
      const picked = hooks.picked();
      const cards = new Set<string>();
      for (const option of choice.options) {
        if (!option.cardId || listed.has(option.id) || cards.has(option.cardId)) continue;
        cards.add(option.cardId);
        const several = choice.max > 1 || choice.discardFromHand || choice.mulligan;
        out.push({
          label: several
            ? `${picked.has(option.id) ? "Unpick" : "Pick"} ${name(option.cardId)}`
            : choice.defense
              ? `Defend with ${name(option.cardId)}`
              : `Choose ${option.label}`,
          run: () => hooks.pick(option.cardId!),
        });
      }
    }

    // The bar's own buttons.
    for (const option of dock.options ?? [])
      if (!option.disabled)
        out.push({
          label: `${option.pressed ? "Unpick" : "Choose"} ${option.label}${option.detail ? ` (${option.detail})` : ""}`,
          run: option.onClick,
        });

    // Your turn: play a card from your hand, or use a power.
    if (hooks.powersReady()) {
      for (const card of state.hand)
        if (card.playable && !card.requiresHeroForm)
          out.push({
            label: `Play ${card.name}${card.cost !== null ? ` (cost ${card.cost})` : ""}`,
            run: () => hooks.pick(card.id),
          });
      for (const action of state.heroActions)
        out.push({
          label: `${state.hero.name}: ${action.label}`,
          run: () => hooks.useAction(state.hero.id, action.kind),
        });
      for (const card of state.inPlay)
        for (const action of hooks.fieldActions(card.id))
          out.push({ label: `${card.name}: ${action.label}`, run: () => hooks.useAction(card.id, action.kind) });
    }

    for (const button of [dock.primary, dock.secondary])
      if (button && !button.disabled) out.push({ label: button.label, run: button.onClick });

    return out.map((move, i) => ({ ...move, n: i + 1 }));
  }

  function payLabel(source: Source): string {
    const icons = source.icons.length ? ` [${source.icons.join(" ")}]` : "";
    return `${source.label}${icons}`;
  }

  function look(): string {
    const state = hooks.state();
    const lines: string[] = [];
    const story = hooks.history();
    if (told > story.length) told = 0;
    const fresh = story.slice(told);
    told = story.length;
    if (fresh.length) lines.push("What happened:", ...fresh.map((line) => `  ${line}`), "");

    if (state.outcome)
      lines.push(`GAME OVER: ${state.outcome.result === "win" ? "you won" : "you lost"} (${state.outcome.reason}).`);
    const phase =
      state.turn === "player"
        ? "your turn"
        : state.turn === "enemy"
          ? "villain phase"
          : state.turn === "ending"
            ? "end of your turn"
            : "finished";
    lines.push(
      `Round ${state.round}, ${phase}. Deck ${state.deckCount} cards, encounter deck ${state.encounterCount}.`,
    );
    lines.push("", "Villain side:", cardLine(state.villain, [`${state.villainHp} HP`]));
    for (const card of state.enemyCards) lines.push(cardLine(card, [card.type.replace(/_/g, " ")]));
    lines.push("", "Your side:", cardLine(state.hero, [`${state.heroHp} HP`]));
    for (const card of state.inPlay) lines.push(cardLine(card, [card.type.replace(/_/g, " ")]));
    lines.push("", `Hand (${state.hand.length}):`);
    for (const card of state.hand)
      lines.push(
        cardLine(card, [
          ...(card.cost !== null ? [`cost ${card.cost}`] : []),
          card.type.replace(/_/g, " "),
          ...(card.playable ? ["playable"] : []),
        ]),
      );
    if (state.discard.length) lines.push(`Your discard pile: ${state.discard.map((c) => c.name).join(", ")}`);

    const dock = hooks.dock();
    lines.push("");
    const read = hooks.reading();
    if (read)
      lines.push(`Revealed, to read:`, cardById(read) ? cardLine(cardById(read)!) : `- ${hooks.cardFacts(read)}`);
    if (!read && hooks.busy()) lines.push("The table is playing something out: call wait().");
    else {
      const asked = [dock.eyebrow?.text, dock.title].filter(Boolean).join(": ");
      lines.push(`Turn bar: ${asked}${dock.meter ? ` (paid ${dock.meter.paid} of ${dock.meter.required})` : ""}`);
      if (dock.help) lines.push(dock.help);
      if (state.choice?.explanation) lines.push(state.choice.explanation);
      const moves = buildMoves();
      lines.push("Moves:", ...moves.map((move) => `  ${move.n}. ${move.label}`));
    }
    return lines.join("\n");
  }

  /** Until nothing is playing out and the bar has held the same question for a moment (60 s at most). */
  async function wait(): Promise<string> {
    const until = performance.now() + 60_000;
    let last = "";
    let calm = 0;
    while (performance.now() < until) {
      await sleep(150);
      if (hooks.reading()) break;
      if (hooks.busy() || !hooks.settled()) {
        calm = 0;
        continue;
      }
      const now = JSON.stringify([hooks.dock().title, buildMoves().map((m) => m.label)]);
      calm = now === last ? calm + 1 : 0;
      last = now;
      if (calm >= 3) break;
    }
    return look();
  }

  async function play(which: number | string): Promise<string> {
    const moves = buildMoves();
    const move =
      typeof which === "number"
        ? moves.find((m) => m.n === which)
        : (moves.find((m) => m.label.toLowerCase() === which.toLowerCase()) ??
          moves.find((m) => m.label.toLowerCase().includes(which.toLowerCase())));
    if (!move) return `No move ${JSON.stringify(which)} now.\n\n${look()}`;
    move.run();
    return `You: ${move.label}\n\n${await wait()}`;
  }

  return {
    look,
    moves: () => buildMoves().map(({ n, label }) => ({ n, label })),
    play,
    wait,
  };
}
