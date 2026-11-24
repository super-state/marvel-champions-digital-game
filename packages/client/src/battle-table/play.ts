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
  /** The damage an ally takes for using that power (consequential damage); 0 for anything else. */
  consequentialDamage(id: string, power: "attack" | "thwart"): number;
  /** The player's current form and hand size (the hand limit at the end of the turn). */
  playerFacts(): { form: "hero" | "alterEgo"; handSize: number };
  /** Any card's name as it shows now, wherever it is (a revealed treachery on its way to the discard included). */
  cardName(id: string): string;
  /** A card ability that pays, by card and ability ("Peter Parker — Scientist"); null for a card from the hand. */
  sourceName(sourceId: string, cardId: string): string | null;
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

/** The dev server's websocket as a page sees it (`import.meta.hot`): just what remote play uses. */
export interface RemoteChannel {
  on(event: "battle-play:call", listener: (data: { id: string; call: string; move: string | null }) => void): void;
  send(event: "battle-play:result", data: { id: string; text: string }): void;
}

/**
 * Remote play (`vite-battle-play.ts`): answer the dev server's calls with this page's player, so Claude can play a
 * table shown where its browser tools can't reach (Surf's Games bubble). Only a page opened with `?remote` listens.
 */
export function answerRemote(player: Player, channel: RemoteChannel): void {
  channel.on("battle-play:call", async ({ id, call, move }) => {
    let text: string;
    try {
      if (call === "moves")
        text = player
          .moves()
          .map((m) => `${m.n}. ${m.label}`)
          .join("\n");
      else if (call === "wait") text = await player.wait();
      else if (call === "play") {
        const which = (move ?? "").trim();
        text = await player.play(/^\d+$/.test(which) ? Number(which) : which);
      } else text = player.look();
    } catch (error) {
      text = `The page could not run ${call}: ${error instanceof Error ? error.message : String(error)}`;
    }
    channel.send("battle-play:result", { id, text });
  });
}

const HERO_ONLY = /\bHero (?:Action|Interrupt|Response|Resource)\b|\bHero form only\b/i;
const ALTER_EGO_ONLY = /\bAlter-Ego (?:Action|Interrupt|Response|Resource)\b|\bAlter-Ego form only\b/i;

/**
 * A card whose abilities work in one form only ("Hero Interrupt", "Alter-Ego Action", "Hero form only"), read from
 * its rules text so it holds for every card: which form, and whether that is the form the player is in now. The table
 * already refuses the wrong form; this only says so in words, so a player reading the text plans with it.
 */
export function formOnlyNote(
  facts: string,
  form: "hero" | "alterEgo",
  /** Where the card is: an event in the hand, another card in the hand (it stays in play), or a card in play. */
  spot: "eventInHand" | "cardInHand" | "inPlay" = "eventInHand",
): string | null {
  const hero = HERO_ONLY.test(facts);
  const alterEgo = ALTER_EGO_ONLY.test(facts);
  if (hero === alterEgo) return null;
  const needs = hero ? "hero" : "alterEgo";
  const words = hero ? "hero form only" : "alter-ego form only";
  if (needs === form) return words;
  if (spot === "inPlay") return `${words}: not usable now`;
  // "Hero form only" on the card itself keeps it in the hand; "Hero Resource:" or "Alter-Ego Action:" on a card that
  // stays in play only limits its ability, so it can still be played now (Web-Shooter, Aunt May).
  if (spot === "cardInHand" && !/\b(?:Hero|Alter-Ego) form only\b/i.test(facts))
    return `its ability is ${words}; the card can still be played now`;
  return `${words}: not usable now, except to pay with`;
}

/**
 * A move that a status card will cancel: an attack while the one making it is stunned, a thwart while it is confused
 * (Rules Reference v1.8, as the engine has it). Said on the move itself, so it can't be missed when choosing.
 */
export function statusWarning(statuses: ReadonlySet<string>, move: "attack" | "thwart" | null): string | null {
  if (move === "attack" && statuses.has("stunned")) return "stunned: this only discards the stun";
  if (move === "thwart" && statuses.has("confused")) return "confused: this only discards the confusion";
  return null;
}

/** What each status card does, as the Rules Reference (v1.8) and the engine have it. */
const STATUS_RULES: Readonly<Record<string, string>> = {
  stunned: "Stunned: its next attack (an attack event or ability too) does nothing except discard the stun.",
  confused:
    "Confused: its next thwart (a thwart event or ability too), or an enemy's next scheme, does nothing except discard the confusion.",
  tough: "Tough: the next damage dealt to it is prevented, and the tough card is discarded.",
};

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
  const name = (id: string | null) => (id ? (cardById(id)?.name ?? hooks.cardName(id)) : "");

  const STAT_NAMES: ReadonlySet<string> = new Set(["THW", "ATK", "DEF", "SCH", "REC", "HP"]);

  function cardLine(card: BattleCard, extra: string[] = []): string {
    const bits = [...extra];
    if (card.hp !== undefined) bits.push(`${card.hp} HP left`);
    if (card.threat !== null) bits.push(`threat ${card.threat}${card.threatTarget ? `/${card.threatTarget}` : ""}`);
    if (card.threatLock) bits.push(`locked: ${card.threatLock}`);
    // A stat modifier reads as one ("+10 HP" from The "Immortal" Klaw, "+1 ATK" from Sonic Converter), not as a count.
    for (const marker of card.markers)
      bits.push(
        STAT_NAMES.has(marker.name)
          ? `${marker.count > 0 ? "+" : ""}${marker.count} ${marker.name}`
          : `${marker.name} ${marker.count}`,
      );
    if (card.exhausted) bits.push("exhausted");
    const facts = hooks.cardFacts(card.id);
    const state = hooks.state();
    const inHand = state.hand.some((c) => c.id === card.id);
    const formNote =
      card.id === state.hero.id
        ? null
        : formOnlyNote(
            facts,
            hooks.playerFacts().form,
            inHand ? (card.type === "event" ? "eventInHand" : "cardInHand") : "inPlay",
          );
    if (formNote) bits.push(formNote);
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
      // Two cards of the same name in one question (two Hydra Mercenaries): told apart by what's left of them.
      const named = new Map<string, number>();
      for (const option of choice.options)
        if (option.cardId) named.set(name(option.cardId), (named.get(name(option.cardId)) ?? 0) + 1);
      const tell = (cardId: string) => {
        const card = cardById(cardId);
        return (named.get(name(cardId)) ?? 0) > 1 && card?.hp !== undefined ? ` (${card.hp} HP left)` : "";
      };
      for (const option of choice.options) {
        if (!option.cardId || listed.has(option.id) || cards.has(option.cardId)) continue;
        cards.add(option.cardId);
        const several = choice.max > 1 || choice.discardFromHand || choice.mulligan;
        out.push({
          label: several
            ? `${picked.has(option.id) ? "Unpick" : "Pick"} ${name(option.cardId)}`
            : choice.defense
              ? `Defend with ${name(option.cardId)}`
              : `Choose ${option.label}${tell(option.cardId)}`,
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
      const statusesOf = (card: BattleCard) =>
        new Set(card.markers.filter((m) => m.count > 0).map((m) => m.name.toLowerCase()));
      const heroStatuses = statusesOf(state.hero);
      const warn = (statuses: ReadonlySet<string>, move: "attack" | "thwart" | null) => {
        const warning = statusWarning(statuses, move);
        return warning ? ` — ${warning}` : "";
      };
      const kindOfText = (text: string) =>
        /\((?:[^)]*\b)?attack\b/i.test(text) ? "attack" : /\((?:[^)]*\b)?thwart\b/i.test(text) ? "thwart" : null;
      const kindOfLabel = (label: string) =>
        /^attack$/i.test(label) ? "attack" : /^thwart$/i.test(label) ? "thwart" : null;
      for (const card of state.hand)
        if (card.playable && !card.requiresHeroForm)
          out.push({
            label:
              `Play ${card.name}${card.cost !== null ? ` (cost ${card.cost})` : ""}` +
              (card.type === "event" ? warn(heroStatuses, kindOfText(hooks.cardFacts(card.id))) : ""),
            run: () => hooks.pick(card.id),
          });
      for (const action of state.heroActions)
        out.push({
          label: `${state.hero.name}: ${action.label}${warn(heroStatuses, kindOfLabel(action.label))}`,
          run: () => hooks.useAction(state.hero.id, action.kind),
        });
      // Encounter cards can carry a player's action too (Klaw's Sonic Converter: pay to discard it).
      // An ally pays for its own attack or thwart in damage (the small number beside the stat): said on the move when
      // that damage is the ally's last hit points (Jessica Jones on 1 thwarted and was lost, 2026-11-24).
      const costs = (card: BattleCard, label: string) => {
        const power = kindOfLabel(label);
        const damage = power ? hooks.consequentialDamage(card.id, power) : 0;
        if (!damage || card.hp === undefined) return "";
        return damage >= card.hp
          ? ` — takes ${damage} damage for it: this defeats ${card.name}`
          : ` — takes ${damage} damage for it`;
      };
      for (const card of [...state.inPlay, ...state.enemyCards])
        for (const action of hooks.fieldActions(card.id))
          out.push({
            label: `${card.name}: ${action.label}${warn(statusesOf(card), kindOfLabel(action.label))}${costs(card, action.label)}`,
            run: () => hooks.useAction(card.id, action.kind),
          });
    }

    for (const button of [dock.primary, dock.secondary])
      if (button && !button.disabled) out.push({ label: button.label, run: button.onClick });

    return out.map((move, i) => ({ ...move, n: i + 1 }));
  }

  function payLabel(source: Source): string {
    const icons = source.icons.length ? ` [${source.icons.join(" ")}]` : "";
    const named = source.kind === "resourceAbility" ? hooks.sourceName(source.id, source.cardId) : null;
    return `${named ?? source.label}${icons}`;
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
    const phase = state.choice?.mulligan
      ? "setup, mulligan"
      : state.turn === "player"
        ? "your turn"
        : state.turn === "enemy"
          ? "villain phase"
          : state.turn === "ending"
            ? "end of your turn"
            : "finished";
    const player = hooks.playerFacts();
    lines.push(
      `Round ${state.round}, ${phase}. You are in ${player.form === "hero" ? "hero" : "alter-ego"} form. ` +
        `Deck ${state.deckCount} cards, encounter deck ${state.encounterCount}.`,
    );
    lines.push("", "Villain side:", cardLine(state.villain, [`${state.villainHp} HP`]));
    for (const card of state.enemyCards) lines.push(cardLine(card, [card.type.replace(/_/g, " ")]));
    lines.push("", "Your side:", cardLine(state.hero, [`${state.heroHp} HP`]));
    for (const card of state.inPlay) lines.push(cardLine(card, [card.type.replace(/_/g, " ")]));
    const over = state.hand.length - player.handSize;
    lines.push(
      "",
      `Hand (${state.hand.length}; hand size ${player.handSize}` +
        `${over > 0 ? `: ${over} to discard at the end of your turn unless you use them` : ""}):`,
    );
    for (const card of state.hand)
      lines.push(
        cardLine(card, [
          ...(card.cost !== null ? [`cost ${card.cost}`] : []),
          card.type.replace(/_/g, " "),
          ...(card.playable ? ["playable"] : []),
        ]),
      );
    if (state.discard.length) lines.push(`Your discard pile: ${state.discard.map((c) => c.name).join(", ")}`);

    const statuses = new Set(
      [state.villain, ...state.enemyCards, state.hero, ...state.inPlay].flatMap((card) =>
        card.markers.filter((marker) => marker.count > 0).map((marker) => marker.name.toLowerCase()),
      ),
    );
    const rules = [...statuses].flatMap((status) => (STATUS_RULES[status] ? [`  ${STATUS_RULES[status]}`] : []));
    if (rules.length) lines.push("", "Statuses in play:", ...rules);

    const dock = hooks.dock();
    lines.push("");
    const read = hooks.reading();
    if (read)
      lines.push(
        `Revealed, to read:`,
        cardById(read) ? cardLine(cardById(read)!) : `- ${name(read)}: ${hooks.cardFacts(read)}`,
      );
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
