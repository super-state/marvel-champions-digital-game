/**
 * Fuzz driver for the 3D battle table (Spider-Man vs Rhino).
 *
 * It plays whole games through BattleModel's public API only, and only with gestures that `main.ts` really offers:
 * hand cards that are `playable`, the hero menu (`heroActions`), `fieldActions` on visible cards while it is the
 * player's turn, End Turn when `canEndTurn`, payment sources that are `available` and displayable
 * (`resourcePieceId`), trigger offers answered yes/no in order (`answerOffer`), the defend question
 * (`defenseQuestionDecline`), option buttons for cards that are not `onTable` and card clicks for the rest.
 * Mirrors main.ts: pick(), choiceView() and answerOffer(), pay()/cancel(), render().
 *
 * Nothing here changes engine, card or model code. A move the model accepts but the UI cannot reach is not a way
 * forward, so stuck detection counts only UI-reachable gestures.
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import * as engine from "@mc/engine";
import {
  BattleModel,
  HEROES,
  type BattleBeat,
  type BattleSnapshot,
  type DealOptions,
  type HeroId,
  type VillainId,
} from "./model.js";

type Snap = BattleSnapshot;
type Choice = NonNullable<Snap["choice"]>;
type Payment = NonNullable<Snap["payment"]>;
type Source = Payment["sources"][number];
type Policy = "random" | "aggressive" | "defender" | "decliner" | "careful";

const POLICIES: readonly Policy[] = ["random", "aggressive", "defender", "decliner", "careful"];
// 15 deals keep the unit run quick; FUZZ_GAMES=250 is the deep run (15,000 moves clean on 2026-11-19).
const GAME_COUNT = Number(process.env.FUZZ_GAMES ?? 15);
const MAX_MOVES = 400;
/** Seeds for the broad loop. Seed 75 is the table's own deal; the rest vary the shuffle. */
const FUZZ_SEEDS: readonly number[] = Array.from({ length: GAME_COUNT }, (_, i) => (i === 0 ? 75 : 1000 + i * 37));
/** Klaw's deals: fewer in the unit run (KLAW_FUZZ_GAMES=250 for the deep one). */
const KLAW_SEEDS: readonly number[] = Array.from(
  { length: Number(process.env.KLAW_FUZZ_GAMES ?? 10) },
  (_, i) => 2000 + i * 41,
);

/** Ultron's deals (ULTRON_FUZZ_GAMES=250 for the deep run). */
const ULTRON_SEEDS: readonly number[] = Array.from(
  { length: Number(process.env.ULTRON_FUZZ_GAMES ?? 10) },
  (_, i) => 3000 + i * 43,
);

/**
 * The heroes after Spider-Man, each dealt against each villain in turn from their own seeds. A hero added to `HEROES`
 * gets a line here. `HERO_FUZZ_GAMES=250` is the deep run (each hero); `CAPTAIN_MARVEL_FUZZ_GAMES` and the like set
 * one hero's count (0 leaves that hero out).
 */
const HERO_SEEDS: readonly { hero: HeroId; first: number; env: string }[] = [
  { hero: "captain-marvel", first: 4000, env: "CAPTAIN_MARVEL_FUZZ_GAMES" },
  { hero: "she-hulk", first: 6000, env: "SHE_HULK_FUZZ_GAMES" },
];
const HERO_GAMES = HERO_SEEDS.flatMap(({ hero, first, env }) =>
  Array.from({ length: Number(process.env[env] ?? process.env.HERO_FUZZ_GAMES ?? 9) }, (_, i) => ({
    hero,
    seed: first + i * 47,
    i,
  })),
);
const VILLAIN_ROTA: readonly VillainId[] = ["rhino", "klaw", "ultron"];

/**
 * Free Play's deals: Expert, and the two modules no villain recommends, in turn against each villain and with each hero
 * (FREE_PLAY_FUZZ_GAMES=250 for the deep run).
 */
const FREE_PLAY_SEEDS: readonly number[] = Array.from(
  { length: Number(process.env.FREE_PLAY_FUZZ_GAMES ?? 10) },
  (_, i) => 5000 + i * 53,
);
const FREE_PLAY_ROTA: readonly Pick<DealOptions, "difficulty" | "modules">[] = [
  { difficulty: "expert" },
  { modules: ["legions_of_hydra"] },
  { modules: ["the_doomsday_chair"] },
  { difficulty: "expert", modules: ["legions_of_hydra"] },
  { difficulty: "expert", modules: ["the_doomsday_chair"] },
];

/**
 * Failure kinds already reported and reproduced below as test.fails(...). The broad loop records these instead of
 * throwing, so the file stays green; any other failure kind fails the loop. Remove an entry once its repro starts
 * passing (test.fails will say so).
 */
const KNOWN_FAILURE_KINDS: ReadonlySet<string> = new Set<string>([]);

// ---------------------------------------------------------------------------------------------------------------
// Plumbing: seed spy and engine-state spy (diagnostics only, never used to choose moves).
// ---------------------------------------------------------------------------------------------------------------

let dealSeed: number | null = null;
let lastEngineState: engine.GameState | undefined;
const realCreate = engine.createGame;
const realLegal = engine.legalActions;

beforeAll(() => {
  vi.spyOn(engine, "createGame").mockImplementation(((...args: Parameters<typeof engine.createGame>) => {
    const [config, ...rest] = args;
    return realCreate(dealSeed === null ? config : { ...config, seed: dealSeed }, ...rest);
  }) as typeof engine.createGame);
  vi.spyOn(engine, "legalActions").mockImplementation(((...args: Parameters<typeof engine.legalActions>) => {
    lastEngineState = args[0];
    return realLegal(...args);
  }) as typeof engine.legalActions);
});
afterAll(() => {
  vi.restoreAllMocks();
});

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------------------------

interface Finding {
  kind: string;
  seed: number;
  policy: Policy;
  move: number;
  /** Stable text used to de-duplicate the same problem across games. */
  key: string;
  detail: string;
}

interface GameResult {
  seed: number;
  policy: Policy;
  moves: number;
  rounds: number;
  stage: number;
  coverage: Record<string, number>;
  reason: string;
  ended: "win" | "loss" | "cap" | "aborted";
  failures: Finding[];
  notes: Finding[];
  trace: string[];
  ms: number;
  firstHand: string;
}

function engineDiag(): string {
  const p = lastEngineState?.pendingChoice;
  if (!p) return "engine.pendingChoice=none";
  return `engine.pendingChoice.prompt.kind=${p.prompt.kind} min=${p.minSelections} max=${p.maxSelections} options=${p.options.length}`;
}
const pendingKind = () => lastEngineState?.pendingChoice?.prompt.kind ?? null;

function describeChoice(ch: Choice | null): string {
  if (!ch) return "choice=null";
  return `choice{prompt="${ch.prompt}" min=${ch.min} max=${ch.max} cancel=${ch.canCancel} skip=${ch.canSkip} discardFromHand=${ch.discardFromHand} offers=${ch.offers?.length ?? 0} defense=${!!ch.defense} options=[${ch.options
    .map((o) => `${o.id}:${o.label}:${o.cardId ?? "-"}`)
    .join(" | ")}]}`;
}
function describePayment(p: Payment | null): string {
  if (!p) return "payment=null";
  return `payment{subject=${p.subject.name} required=${p.required} paid=${p.paid} canPay=${p.canPay} ability=${p.ability} sources=[${p.sources
    .map(
      (s) =>
        `${s.id}:${s.label}:${s.kind}:${s.icons.join("")}${s.available ? "" : ":unavailable"}${s.selected ? ":sel" : ""}`,
    )
    .join(" | ")}]}`;
}

// ---------------------------------------------------------------------------------------------------------------
// UI mirrors
// ---------------------------------------------------------------------------------------------------------------

const onTable = (s: Snap, id: string | null) =>
  !!id && [s.hero, s.villain, ...s.enemyCards, ...s.inPlay, ...s.hand].some((c) => c.id === id);

/** main.ts defenseQuestionDecline(): the Defend? yes/no question exists when there are defenders and a decline. */
function defenseDecline(ch: Choice | null) {
  if (!ch?.defense || !ch.options.some((o) => o.cardId)) return undefined;
  return ch.options.find((o) => !o.cardId);
}

/** main.ts resourcePieceId(). */
function pieceId(s: Snap, p: Payment, source: Source): string {
  if (source.kind === "handCard") return source.cardId;
  const onBoard = s.inPlay.some((c) => c.id === source.cardId && c.showAsFullCard);
  const same = p.sources.filter((o) => o.cardId === source.cardId);
  return onBoard && same.length === 1 ? source.cardId : `ability:${source.id}`;
}

/** Can the player actually click this payment source on the table? (render() abilityCards + synchronizeLabels). */
function sourceReachable(s: Snap, p: Payment, source: Source): boolean {
  const id = pieceId(s, p, source);
  // pick() uses find(), so only the first source mapped to a piece can ever be toggled.
  if (p.sources.find((o) => pieceId(s, p, o) === id) !== source) return false;
  if (source.kind === "handCard") return s.hand.some((c) => c.id === source.cardId);
  if (id === source.cardId) return s.inPlay.some((c) => c.id === source.cardId);
  return [s.hero, ...s.inPlay, ...s.hand].some((c) => c.id === source.cardId);
}

// ---------------------------------------------------------------------------------------------------------------
// Snapshot checks
// ---------------------------------------------------------------------------------------------------------------

function stable(s: Snap): string {
  const ids = (list: readonly { id: string }[]) => list.map((c) => c.id).sort();
  return JSON.stringify({
    hand: ids(s.hand),
    inPlay: ids(s.inPlay),
    enemy: ids(s.enemyCards),
    discard: ids(s.discard),
    encDiscard: ids(s.encounterDiscard),
    heroHp: s.heroHp,
    villainHp: s.villainHp,
    round: s.round,
    turn: s.turn,
    deck: s.deckCount,
    enc: s.encounterCount,
    outcome: s.outcome?.result ?? null,
    heroExhausted: s.hero.exhausted,
    choice: s.payment
      ? "payment"
      : s.choice?.canCancel
        ? "target"
        : s.choice
          ? `${s.choice.prompt}|${s.choice.options.map((o) => o.id).join(",")}`
          : null,
  });
}

function signature(s: Snap): string {
  return JSON.stringify(s, (key, value) =>
    key === "beats" || key === "drawn" || key === "art" || key === "reverseArt" ? undefined : value,
  );
}

function beatIds(b: BattleBeat): [string, string][] {
  const out: [string, string | null | undefined][] = [
    ["actor", b.actor],
    ["discardEvent", b.discardEvent],
    ["enemyActivation", b.enemyActivation],
    ["interrupt", b.interrupt],
    ["deflection.card", b.deflection?.card],
    ["modifier.id", b.modifier?.id],
    ["attackAim.source", b.attackAim?.source],
    ["attackAim.target", b.attackAim?.target],
    ["turned.id", b.turned?.id],
    ["encounterDeal", b.encounterDeal],
    ["defeatedCard", b.defeatedCard],
    ["droneIn.card", b.droneIn?.card.id],
    ["reveal.id", b.reveal?.id],
    ["reveal.boost.enemy", b.reveal?.boost?.enemy],
    ["activate.card", b.activate?.card],
    ["threat.scheme", b.threat?.scheme],
    ["hit.source", b.hit?.source],
    ["hit.target", b.hit?.target],
    ["statusChange.id", b.statusChange?.id],
    ...(b.draw ?? []).map((id): [string, string] => ["draw", id]),
  ];
  return out.filter((e): e is [string, string] => !!e[1]);
}

// ---------------------------------------------------------------------------------------------------------------
// The game driver
// ---------------------------------------------------------------------------------------------------------------

interface Gesture {
  desc: string;
  weight: number;
  run: () => boolean;
}

function playGame(
  seed: number,
  policy: Policy,
  villain: VillainId = "rhino",
  hero: HeroId = "spider-man",
  encounter: Pick<DealOptions, "difficulty" | "modules"> = {},
): GameResult {
  const started = performance.now();
  const rnd = mulberry(seed * 7919 + POLICIES.indexOf(policy) * 104729 + 13);
  const chance = (p: number) => rnd() < p;
  const int = (n: number) => Math.floor(rnd() * n);
  const shuffled = <T>(list: readonly T[]): T[] => {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  };

  const failures: Finding[] = [];
  const notes: Finding[] = [];
  const trace: string[] = [];
  let move = 0;
  let aborted = false;
  let maxRound = 0;
  let maxStage = 1;
  const coverage: Record<string, number> = {};
  let reason = "";

  const add = (list: Finding[], kind: string, key: string, detail: string) =>
    list.push({ kind, seed, policy, move, key, detail: `${detail} [trace tail: ${trace.slice(-8).join(" > ")}]` });
  const fail = (kind: string, key: string, detail: string) => add(failures, kind, key, detail);
  const note = (kind: string, key: string, detail: string) => add(notes, kind, key, detail);

  dealSeed = seed;
  const model = new BattleModel();
  const frame = (e: unknown) => {
    const stack = e instanceof Error ? (e.stack ?? "") : "";
    return (
      stack
        .split("\n")
        .find((l) => /battle-table[\\/](model|main)\.ts/.test(l))
        ?.trim() ??
      stack.split("\n")[1]?.trim() ??
      ""
    );
  };
  /** Run one model call; an exception is a failure, recorded with the top model.ts frame. */
  const guard = <T>(label: string, fn: () => T): { ok: true; value: T } | { ok: false } => {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      fail(
        "exception",
        `${label}:${message.slice(0, 90)}`,
        `${label} threw "${message}" at ${frame(e)}; ${engineDiag()}`,
      );
      return { ok: false };
    }
  };

  let firstHand = "";
  const reset = guard("reset()", () => model.reset({ hero, villain, ...encounter }));
  if (!reset.ok) return result("aborted");
  firstHand = model
    .snapshot()
    .hand.map((c) => c.name)
    .join(",");

  const snap = (): Snap | null => {
    const r = guard("snapshot()", () => model.snapshot());
    return r.ok ? r.value : null;
  };

  function result(ended: GameResult["ended"]): GameResult {
    return {
      seed,
      policy,
      moves: move,
      coverage,
      rounds: maxRound,
      stage: maxStage,
      reason,
      ended,
      failures,
      notes,
      trace,
      ms: performance.now() - started,
      firstHand,
    };
  }

  // Per-snapshot oddities ("flag anything odd"): recorded as notes, never thrown.
  function inspectSnapshot(s: Snap) {
    const zones: [string, readonly { id: string }[]][] = [
      ["hand", s.hand],
      ["inPlay", s.inPlay],
      ["enemyCards", s.enemyCards],
      ["discard", s.discard],
      ["encounterDiscard", s.encounterDiscard],
      ["hero", [s.hero]],
      ["villain", [s.villain]],
    ];
    const seen = new Map<string, string>();
    for (const [zone, list] of zones)
      for (const c of list) {
        const prior = seen.get(c.id);
        if (prior)
          note(
            "card-in-two-zones",
            `${prior}+${zone}`,
            `card ${c.id} is in both ${prior} and ${zone}; ${engineDiag()}`,
          );
        else seen.set(c.id, zone);
      }
    if (s.heroHp < 0 || s.villainHp < 0 || s.enemyCards.some((c) => (c.hp ?? 0) < 0))
      note(
        "negative-hp",
        s.enemyCards
          .filter((c) => (c.hp ?? 0) < 0)
          .map((c) => c.name)
          .join("+") || "hero-or-villain",
        `heroHp=${s.heroHp} villainHp=${s.villainHp} enemies=${s.enemyCards.map((c) => `${c.name}(${c.id}):${c.hp}`).join(", ")} markers=${JSON.stringify(s.enemyCards.filter((c) => (c.hp ?? 0) < 0).map((c) => c.markers))}; ${engineDiag()}; engine zones=${s.enemyCards
          .filter((c) => (c.hp ?? 0) < 0)
          .map(
            (c) =>
              JSON.stringify(lastEngineState ? engine.locateCard(lastEngineState, c.id as engine.InstanceId) : "?") +
              ":dmg=" +
              (lastEngineState?.instances[c.id as engine.InstanceId]?.damage ?? "?"),
          )
          .join(",")}`,
      );
    for (const c of [s.hero, s.villain, ...s.inPlay, ...s.enemyCards, ...s.hand])
      for (const m of c.markers)
        if (m.count < 0 && !["thw", "atk", "def", "sch", "rec", "HP"].includes(m.name))
          note("negative-marker", `${c.name}:${m.name}`, `${c.name} has marker ${m.name}=${m.count}`);
    if (s.hero.threat !== null && s.hero.threat < 0) note("negative-threat", "hero", "hero threat < 0");
    if (s.turn === "finished" && s.outcome === null)
      note("finished-without-outcome", "x", "turn finished, outcome null");
    inspectDrones(s);
    const known = new Set<string>([
      ...zones.flatMap(([, list]) => list.map((c) => c.id)),
      ...s.facedownEncounters,
      ...(s.choiceSource ? [s.choiceSource] : []),
    ]);
    for (const b of s.beats)
      for (const [field, id] of beatIds(b))
        // A card tucked facedown under a scheme (Highway Robbery) is hidden on purpose: its host shows a count.
        if (!known.has(id) && !isTucked(id))
          note(
            "beat-orphan",
            field,
            `beat "${b.text}" ${field}=${id} is on no zone of the table; ${engineDiag()}; engine zone=${orphanZone(id)}`,
          );
  }

  // Ultron's Drones: a player's card in play facedown is a minion on the villain's side called "Drone". Nothing the
  // table is told (a card, a beat, a question) names the card under it while it is facedown, every Drone is seen
  // coming into play, and every Drone that goes is seen going.
  let dronesBefore: Set<string> | null = null;
  function inspectDrones(s: Snap) {
    const st = lastEngineState;
    if (!st) return;
    const facedown = new Set<string>(
      st.players.flatMap((p) => p.playArea).filter((id) => st.instances[id]?.facedownAs?.kind === "minion"),
    );
    // A name the table may say anyway: another copy of the card that is faceup somewhere out of the decks.
    const visibleNames = new Set(
      Object.keys(st.instances)
        .filter((id) => {
          const zone = engine.locateCard(st, id as engine.InstanceId)?.kind;
          return !facedown.has(id) && zone !== undefined && zone !== "deck" && zone !== "encounterDeck";
        })
        .map((id) => engine.cardOf(st, id as engine.InstanceId)?.name),
    );
    for (const b of s.beats) {
      if (b.droneIn) coverage["drone:in"] = (coverage["drone:in"] ?? 0) + 1;
      if (b.droneWas) coverage["drone:defeated"] = (coverage["drone:defeated"] ?? 0) + 1;
    }
    for (const id of facedown) {
      const shown = s.enemyCards.find((c) => c.id === id);
      const zone = s.inPlay.some((c) => c.id === id) ? "inPlay" : s.hand.some((c) => c.id === id) ? "hand" : "nowhere";
      if (!shown) fail("drone-misplaced", zone, `facedown Drone ${id} is not on the villain's side (${zone})`);
      else if (shown.name !== "Drone" || shown.type !== "minion" || shown.cost !== null || shown.hp === undefined)
        fail("drone-leak", "card", `Drone ${id} shows as ${JSON.stringify({ ...shown, art: undefined })}`);
      else if (!/stand-ins\//.test(shown.art)) fail("drone-leak", "art", `Drone ${id} shows art ${shown.art}`);
      const hidden = engine.cardOf(st, id as engine.InstanceId)?.name;
      // A copy of the card named as it was discarded faceup earlier in the move (Invasive AI's discard), shuffled back
      // in with the discard pile when the deck ran out: the discard was public, and which Drone is which is not told.
      // Only that discard's own beat is let off; every other beat still counts.
      const millsIt = (b: BattleBeat) =>
        !!b.milled?.some((other) => engine.cardOf(st, other as engine.InstanceId)?.name === hidden);
      const toldNow = JSON.stringify([s.beats.filter((b) => !millsIt(b)), s.choice, s.enemyCards, s.inPlay, s.payment]);
      // The whole name, not part of a longer title ("Energy" inside "Energy Channel" is not Energy).
      const named =
        !!hidden &&
        new RegExp(
          `(?<![\\w-])${JSON.stringify(hidden)
            .slice(1, -1)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-]| [A-Z])`,
        ).test(toldNow);
      if (hidden && !visibleNames.has(hidden) && named)
        fail(
          "drone-leak",
          "name",
          `"${hidden}" is facedown as a Drone but the table was told its name; ${engineDiag()}`,
        );
      const facts = model.cardFacts(id);
      if (hidden && facts.includes(hidden)) fail("drone-leak", "facts", `cardFacts names ${hidden}`);
    }
    if (dronesBefore) {
      for (const id of facedown)
        if (!dronesBefore.has(id) && !s.beats.some((b) => b.droneIn?.card.id === id))
          fail(
            "drone-unseen",
            "in",
            `Drone ${id} came into play with no beat; beats: ${s.beats.map((b) => b.text).join(" | ")}`,
          );
      for (const id of dronesBefore)
        if (!facedown.has(id) && !s.beats.some((b) => (b.defeatedCard === id && b.droneWas) || b.leftPlay === id))
          fail(
            "drone-unseen",
            "out",
            `Drone ${id} left play with no beat; beats: ${s.beats.map((b) => b.text).join(" | ")}`,
          );
    }
    dronesBefore = facedown;
  }

  // ---- payment -------------------------------------------------------------------------------------------------
  function handlePayment(s0: Snap): boolean {
    const startKind = pendingKind();
    const ctx = `${describePayment(s0.payment)}; ${engineDiag()}`;

    const closed = () => {
      const s = snap();
      return !!s && !s.payment;
    };
    const tryCancel = (): boolean => {
      guard("cancel()", () => model.cancel());
      return closed();
    };

    if (policy === "random" && chance(0.08)) {
      trace.push("cancel payment");
      if (!tryCancel()) {
        // Window payments cannot be cancelled when the engine requires a payment (chooseMany([]) is refused).
        note("window-payment-cancel-refused", startKind ?? "?", `Cancel is a no-op: ${ctx}`);
      } else return true;
    }

    const toggleAndCheck = (id: string): boolean => {
      const before = snap();
      const wasSelected = before?.payment?.sources.find((x) => x.id === id)?.selected;
      const r = guard("toggle()", () => model.toggle(id));
      if (!r.ok) return false;
      const after = snap();
      const now = after?.payment?.sources.find((x) => x.id === id)?.selected;
      if (now === wasSelected)
        fail(
          "payment-toggle-ignored",
          `${startKind}`,
          `toggle(${id}) of an available, reachable source did not change its selection; ${describePayment(after?.payment ?? null)}; ${engineDiag()}`,
        );
      return true;
    };

    const attempt = (order: (sources: Source[]) => Source[], stopEarly: boolean): boolean => {
      // Clear previous selections first.
      let s = snap();
      for (const src of s?.payment?.sources.filter((x) => x.selected) ?? []) toggleAndCheck(src.id);
      for (let guardRail = 0; guardRail < 40; guardRail++) {
        s = snap();
        if (!s?.payment) return false;
        if (s.payment.canPay && (stopEarly || !chance(0.15))) return true;
        const next = order(
          s.payment.sources.filter((x) => !x.selected && x.available && sourceReachable(s!, s!.payment!, x)),
        )[0];
        if (!next) return !!s.payment.canPay;
        if (!toggleAndCheck(next.id)) return false;
      }
      return false;
    };

    const orders: ((sources: Source[]) => Source[])[] = [
      (list) => shuffled(list),
      (list) => [...list].sort((a, b) => b.icons.length - a.icons.length),
      (list) => [...list].sort((a, b) => a.icons.length - b.icons.length),
      ...Array.from({ length: 12 }, () => (list: Source[]) => shuffled(list)),
    ];
    let complete = false;
    for (let i = 0; i < orders.length && !complete; i++) {
      complete = attempt(orders[i]!, i > 0);
      if (!snap()?.payment) return true;
    }
    if (complete) {
      const s = snap();
      const before = s?.payment;
      let paid = false;
      const r = guard("pay()", () => model.pay());
      if (r.ok) paid = r.value;
      if (r.ok && !paid)
        fail(
          "payment-pay-refused",
          `${startKind}`,
          `canPay was true but pay() returned false; ${describePayment(before ?? null)}; ${engineDiag()}`,
        );
      if (paid) return true;
      // The throw / refusal means the engine refused a source the UI offered. Recover by cancelling.
      if (!tryCancel()) {
        fail("payment-stuck", "pay-then-cancel", `pay failed and Cancel did not close the payment; ${ctx}`);
        return false;
      }
      return true;
    }
    fail(
      "payment-uncompletable",
      `${startKind ?? "ui-payment"}:${s0.payment?.subject.name}`,
      `no combination of reachable available sources reaches canPay; ${ctx}`,
    );
    if (!tryCancel()) {
      fail("payment-stuck", "uncompletable-then-cancel", `payment cannot be completed and Cancel does nothing; ${ctx}`);
      return false;
    }
    return true;
  }

  // ---- choices -------------------------------------------------------------------------------------------------
  let offerRefusals = 0;
  function preferred(s: Snap, ch0: Choice): Choice["options"][number][] {
    const safe = policy === "careful" ? ch0.options.filter((o) => !/damage/i.test(o.label)) : [];
    const ch = safe.length ? { ...ch0, options: safe } : ch0;
    if (policy === "aggressive" || policy === "careful") {
      const enemies = new Set([s.villain.id, ...s.enemyCards.filter((c) => c.type === "minion").map((c) => c.id)]);
      const hit = ch.options.filter((o) => o.cardId && enemies.has(o.cardId));
      const villain = hit.filter((o) => o.cardId === s.villain.id);
      if (villain.length) return villain;
      if (hit.length) return hit;
    }
    return ch.options;
  }

  function answerChoice(s: Snap): boolean {
    const ch = s.choice!;
    const ctx = `${describeChoice(ch)}; ${engineDiag()}`;
    const choose = (id: string | null, label: string): boolean => {
      const r = guard(label, () => model.choose(id));
      if (!r.ok) return false;
      if (!r.value) fail("choose-refused", `${pendingKind()}:${label}`, `${label}(${id}) returned false; ${ctx}`);
      return r.value;
    };
    const chooseMany = (ids: string[], label: string): boolean => {
      const r = guard(label, () => model.chooseMany(ids));
      return r.ok && r.value;
    };

    // Targeting a basic attack / thwart / attachment host (model.#targetPick): Cancel is always shown.
    if (ch.canCancel) {
      if (!ch.options.length || chance(0.08)) {
        if (!ch.options.length)
          fail("choice-unsatisfiable", "target-pick-empty", `target pick offers no target; ${ctx}`);
        trace.push("cancel target pick");
        guard("cancel()", () => model.cancel());
        return !!snap() && !snap()!.choice?.canCancel;
      }
      const pool = preferred(s, ch);
      const pick = pool[int(pool.length)]!;
      trace.push(`target ${pick.label}`);
      if (!choose(pick.id, "choose()")) {
        guard("cancel()", () => model.cancel());
        return false;
      }
      return true;
    }

    // Trigger offers: yes/no in order, stop at max, then chooseMany(accepted) (main.ts showOffer).
    if (ch.offers?.length) {
      if (ch.offers.length < ch.min) {
        fail("choice-unsatisfiable", "offers<min", `only ${ch.offers.length} offers shown but min=${ch.min}; ${ctx}`);
        return false;
      }
      const decideYes = () =>
        offerRefusals > 0 ? true : policy === "decliner" ? false : policy === "random" ? chance(0.5) : true;
      const accepted: string[] = [];
      for (let i = 0; i < ch.offers.length; i++) {
        if (decideYes()) accepted.push(ch.offers[i]!.id);
        if (!(i + 1 < ch.offers.length && accepted.length < ch.max)) break;
      }
      trace.push(`offers accept=${accepted.length}/${ch.offers.length}`);
      if (chooseMany(accepted, "chooseMany(offers)")) {
        offerRefusals = 0;
        return true;
      }
      if (!snap()) return false;
      offerRefusals++;
      note(
        "offers-refused-and-restarted",
        `${pendingKind()}`,
        `answers [${accepted.length} accepted] were refused (min=${ch.min}); the dialog silently restarts; ${ctx}`,
      );
      if (offerRefusals > 2) {
        fail("choice-unsatisfiable", "offers-never-accepted", `accepting every offer is still refused; ${ctx}`);
        return false;
      }
      return true;
    }

    // Defend? question (main.ts showChoice).
    const decline = defenseDecline(ch);
    if (decline && ch.defense) {
      const yes = policy === "decliner" ? false : policy === "defender" || policy === "careful" ? true : chance(0.5);
      const defenders = ch.options.filter((o) => o.cardId);
      if (!yes) {
        trace.push("do not defend");
        return choose(decline.id, "choose(decline)");
      }
      const pick = defenders[int(defenders.length)]!;
      if (!onTable(s, pick.cardId))
        fail("choice-unreachable", "defender-offtable", `defender ${pick.label} is not on the table; ${ctx}`);
      trace.push(`defend with ${pick.label}`);
      return choose(pick.id, "choose(defender)");
    }

    // Everything else. An option is reachable as a button (not on the table) or by clicking its card (on the table).
    const multiple = ch.discardFromHand || ch.max > 1;
    const options = ch.options;
    if (!multiple) {
      const skip = ch.canSkip && (policy === "decliner" || chance(0.2) || options.length === 0);
      if (skip) {
        trace.push("skip");
        return choose(null, "choose(null)");
      }
      if (!options.length) {
        fail("choice-unsatisfiable", `${pendingKind()}:no-options`, `min=${ch.min} but no options are shown; ${ctx}`);
        return false;
      }
      const pool = preferred(s, ch);
      const pick = pool[int(pool.length)]!;
      trace.push(`choose ${pick.label}`);
      return choose(pick.id, "choose()");
    }
    if (options.length < ch.min) {
      fail(
        "choice-unsatisfiable",
        `${pendingKind()}:min>options`,
        `min=${ch.min} but only ${options.length} options; ${ctx}`,
      );
      return false;
    }
    const top = Math.min(ch.max, options.length);
    const k = policy === "decliner" ? ch.min : ch.min + int(top - ch.min + 1);
    let picks = shuffled(options)
      .slice(0, k)
      .map((o) => o.id);
    // A spend that can be declined (Sonic Boom) goes through only with picks that pay it, as on the table, where its
    // Spend button stays disabled: picks that don't are declined instead.
    if (model.spendPays(picks) === false) picks = [];
    trace.push(`choose ${picks.length} of ${options.length}`);
    if (chooseMany(picks, "chooseMany()")) return true;
    fail(
      "choose-refused",
      `${pendingKind()}:chooseMany`,
      `chooseMany(${picks.length} of min=${ch.min} max=${ch.max}) refused; ${ctx}`,
    );
    return false;
  }

  // ---- gestures on the player's turn ----------------------------------------------------------------------------
  const banned = new Set<string>();
  let turnGestures = 0;

  function gestures(s: Snap): Gesture[] {
    const out: Gesture[] = [];
    const aggressive = policy === "aggressive" || policy === "careful";
    const refused = (desc: string, what: string) =>
      fail(
        "gesture-refused",
        `${what}:${desc.replace(/\d+/g, "#")}`,
        `${desc} returned false although the UI offered it; ${engineDiag()}`,
      );
    for (const c of s.hand) {
      if (!c.playable || c.requiresHeroForm) continue;
      out.push({
        desc: `play ${c.name} (${c.id})`,
        weight: aggressive ? 4 : 1,
        run: () => {
          const r = guard("pick()", () => model.pick(c.id));
          if (r.ok && !r.value) refused(`pick(${c.name})`, "pick");
          return r.ok && r.value;
        },
      });
    }
    if (s.turn === "player") {
      for (const a of s.heroActions) {
        const peterToHero = a.kind === "changeForm" && HEROES.some((hero) => a.label === `Change to ${hero.name}`);
        out.push({
          desc: `hero ${a.kind}`,
          weight:
            policy === "careful"
              ? a.kind === "basicRecover"
                ? s.heroHp <= 12
                  ? 7
                  : 0.3
                : a.kind === "basicThwart"
                  ? 8
                  : a.kind === "basicAttack"
                    ? 5
                    : peterToHero
                      ? 3
                      : s.heroHp <= 8
                        ? 3
                        : 0.4
              : aggressive
                ? a.kind === "basicAttack"
                  ? 8
                  : peterToHero
                    ? 6
                    : a.kind === "changeForm"
                      ? 0.2
                      : 1
                : 1,
          run: () => {
            const r = guard("heroAction()", () => model.heroAction(a.kind));
            if (r.ok && !r.value) refused(`heroAction(${a.kind})`, "hero");
            return r.ok && r.value;
          },
        });
      }
      const fieldIds = [s.villain, ...s.enemyCards, ...s.inPlay, ...s.hand].map((c) => c.id);
      for (const id of new Set(fieldIds)) {
        const actions = model.fieldActions(id);
        for (const a of actions)
          out.push({
            desc: `field ${id} ${a.kind}`,
            weight:
              policy === "careful"
                ? a.kind === "basicThwart"
                  ? 7
                  : 2
                : aggressive
                  ? a.kind === "basicAttack"
                    ? 4
                    : 2
                  : 1,
            run: () => {
              const r = guard("fieldAction()", () => model.fieldAction(id, a.kind));
              if (r.ok && !r.value) refused(`fieldAction(${id},${a.kind})`, "field");
              return r.ok && r.value;
            },
          });
      }
      // The hero's menu shows `heroActions`: the identity's own abilities (Rechannel, Commander) must be among them.
      const missing = model.fieldActions(s.hero.id).filter((a) => !s.heroActions.some((h) => h.kind === a.kind));
      if (missing.length)
        fail(
          "hero-field-actions-unreachable",
          missing.map((a) => a.kind).join(","),
          `fieldActions(hero) has ${missing.map((a) => a.label).join(", ")} that the hero menu (heroActions) leaves out`,
        );
    }
    if (s.canEndTurn)
      out.push({
        desc: "end turn",
        weight: aggressive ? 0.3 : 0.8,
        run: () => {
          const r = guard("endTurn()", () => model.endTurn());
          if (r.ok && !r.value) refused("endTurn()", "end");
          return r.ok && r.value;
        },
      });
    return out;
  }

  // ---- main loop ------------------------------------------------------------------------------------------------
  let anchor = "";
  let lastSig = "";
  let stall = 0;
  let finalUndos = 0;
  let outcome: GameResult["ended"] = "cap";
  for (; move < MAX_MOVES; move++) {
    const s = snap();
    if (!s) return result("aborted");
    maxRound = Math.max(maxRound, s.round);
    for (const b of s.beats) maxStage = Math.max(maxStage, b.villainStage ?? 1);
    if (s.outcome) reason = `${(s.outcome as { reason?: string }).reason ?? s.outcome.result}`;
    inspectSnapshot(s);
    if (s.turn === "finished") {
      outcome = s.outcome?.result === "win" ? "win" : "loss";
      break;
    }
    const sig = signature(s);
    stall = sig === lastSig ? stall + 1 : 0;
    lastSig = sig;
    if (stall > 25) {
      fail(
        "no-progress",
        "stall",
        `25 gestures without any visible change; ${describeChoice(s.choice)}; ${describePayment(s.payment)}; ${engineDiag()}`,
      );
      aborted = true;
      break;
    }
    const kind = pendingKind();
    const covKey = s.payment
      ? `payment:${kind ?? "ui"}`
      : s.choice?.canCancel
        ? "targetPick"
        : s.choice
          ? `choice:${kind}${s.choice.offers?.length ? ":offers" : ""}${s.choice.defense ? ":defense" : ""}`
          : `turn:${s.turn}`;
    coverage[covKey] = (coverage[covKey] ?? 0) + 1;
    const windowPayment = !!s.payment && (kind === "payForCard" || kind === "payForAbility");
    if (!(s.payment && !windowPayment) && !s.choice?.canCancel) anchor = stable(s);
    const undoable = model.canUndo && !(s.payment && !windowPayment) && !s.choice?.canCancel;
    void undoable;

    let progressed = true;
    if (s.payment) progressed = handlePayment(s);
    else if (s.choice) progressed = answerChoice(s);
    else {
      if (s.turn !== "player") turnGestures = 0;
      const all = gestures(s).filter((g) => !banned.has(`${sig}|${g.desc}`));
      if (turnGestures > 12) {
        const end = all.find((g) => g.desc === "end turn");
        if (end) all.splice(0, all.length, end);
      }
      if (!all.length) {
        fail(
          "stuck",
          `${s.turn}:${pendingKind()}`,
          `no payment, no choice, End Turn ${s.canEndTurn ? "enabled" : "disabled"} and nothing playable or usable (turn=${s.turn} round=${s.round}); ${describeChoice(s.choice)}; ${engineDiag()}; hand=[${s.hand.map((c) => `${c.name}${c.playable ? "*" : ""}`).join(", ")}] heroActions=[${s.heroActions.map((a) => a.kind)}]`,
        );
        aborted = true;
        break;
      }
      let roll = rnd() * all.reduce((t, g) => t + g.weight, 0);
      let chosen = all[all.length - 1]!;
      for (const g of all) {
        roll -= g.weight;
        if (roll <= 0) {
          chosen = g;
          break;
        }
      }
      trace.push(chosen.desc);
      turnGestures++;
      progressed = chosen.run();
      if (!progressed) banned.add(`${sig}|${chosen.desc}`);
      if (chosen.desc === "end turn") turnGestures = 0;
    }
    const failuresBefore = failures.length;
    const after = snap();
    if (!after) return result("aborted");
    void failuresBefore;
    if (failures.some((f) => f.kind === "payment-stuck")) {
      aborted = true;
      break;
    }
    if (failures.filter((f) => f.kind === "exception").length > 4) {
      aborted = true;
      break;
    }

    // undo() after a committed move must return a coherent snapshot (the UI allows it with no payment open and no
    // cancellable target pick; Undo is also available on the game-over screen).
    if (after.beats !== s.beats && model.canUndo && !after.payment && !after.choice?.canCancel) {
      if (chance(0.1) || (after.turn === "finished" && finalUndos < 12)) {
        if (after.turn === "finished") finalUndos++;
        const expected = s.payment && !windowPayment ? anchor : s.choice?.canCancel ? anchor : stable(s);
        const undone = guard("undo()", () => model.undo());
        if (undone.ok) {
          const back = snap();
          if (!undone.value)
            fail("undo-incoherent", "undo-false", "undo() returned false right after a committed move");
          else if (back) {
            if (stable(back) !== expected)
              fail(
                "undo-incoherent",
                "undo-mismatch",
                `after undo the snapshot differs from before the move.\n  before=${expected}\n  after =${stable(back)}`,
              );
            inspectSnapshot(back);
            if (back.hand.map((c) => c.id).join() !== s.hand.map((c) => c.id).join() && !s.payment && !s.choice)
              note("undo-hand-order", "order", "hand order differs after undo");
          }
        }
        trace.push("undo");
      }
    }
  }
  return result(aborted ? "aborted" : outcome);
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------

const results: GameResult[] = [];

test("the seed spy changes the deal, and a seed replays identically", () => {
  const first = (seed: number) => {
    dealSeed = seed;
    const m = new BattleModel();
    m.reset();
    return m
      .snapshot()
      .hand.map((c) => c.id + c.name)
      .join(",");
  };
  expect(first(1)).not.toBe(first(2));
  expect(first(1001)).toBe(first(1001));
  const a = playGame(1037, "random");
  const b = playGame(1037, "random");
  expect(a.trace).toEqual(b.trace);
  expect(a.trace.length).toBeGreaterThan(5);
});

test.each(
  FUZZ_SEEDS.map((seed, i) => ({ seed, policy: POLICIES[i % POLICIES.length]! })).filter(
    (g) => !process.env.FUZZ_ONLY || String(g.seed) === process.env.FUZZ_ONLY,
  ),
)(
  "fuzz game seed $seed ($policy)",
  ({ seed, policy }) => {
    const game = playGame(seed, policy);
    results.push(game);
  },
  60_000,
);

test.each(
  KLAW_SEEDS.map((seed, i) => ({ seed, policy: POLICIES[i % POLICIES.length]! })).filter(
    (g) => !process.env.FUZZ_ONLY || String(g.seed) === process.env.FUZZ_ONLY,
  ),
)(
  "fuzz game against Klaw, seed $seed ($policy)",
  ({ seed, policy }) => {
    const game = playGame(seed, policy, "klaw");
    results.push(game);
  },
  60_000,
);

test.each(
  ULTRON_SEEDS.map((seed, i) => ({ seed, policy: POLICIES[i % POLICIES.length]! })).filter(
    (g) => !process.env.FUZZ_ONLY || String(g.seed) === process.env.FUZZ_ONLY,
  ),
)(
  "fuzz game against Ultron, seed $seed ($policy)",
  ({ seed, policy }) => {
    const game = playGame(seed, policy, "ultron");
    results.push(game);
  },
  60_000,
);

test.each(
  HERO_GAMES.map(({ hero, seed, i }) => ({
    hero,
    seed,
    policy: POLICIES[i % POLICIES.length]!,
    villain: VILLAIN_ROTA[i % VILLAIN_ROTA.length]!,
  })).filter((g) => !process.env.FUZZ_ONLY || String(g.seed) === process.env.FUZZ_ONLY),
)(
  "fuzz game as $hero against $villain, seed $seed ($policy)",
  ({ hero, seed, policy, villain }) => {
    const game = playGame(seed, policy, villain, hero);
    results.push(game);
  },
  60_000,
);

test.each(
  FREE_PLAY_SEEDS.map((seed, i) => ({
    seed,
    policy: POLICIES[i % POLICIES.length]!,
    villain: VILLAIN_ROTA[i % VILLAIN_ROTA.length]!,
    hero: HEROES[Math.floor(i / VILLAIN_ROTA.length) % HEROES.length]!.id,
    encounter: FREE_PLAY_ROTA[i % FREE_PLAY_ROTA.length]!,
    label: JSON.stringify(FREE_PLAY_ROTA[i % FREE_PLAY_ROTA.length]),
  })).filter((g) => !process.env.FUZZ_ONLY || String(g.seed) === process.env.FUZZ_ONLY),
)(
  "fuzz game in Free Play ($label) as $hero against $villain, seed $seed ($policy)",
  ({ seed, policy, villain, hero, encounter }) => {
    const game = playGame(seed, policy, villain, hero, encounter);
    results.push(game);
  },
  60_000,
);

test("fuzz summary: no failure kinds outside the known set", () => {
  const byKind = new Map<string, Finding[]>();
  for (const g of results) for (const f of g.failures) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f]);
  const distinct = new Map<string, Finding & { count: number }>();
  for (const f of [...byKind.values()].flat()) {
    const k = `${f.kind}|${f.key}`;
    const prev = distinct.get(k);
    if (prev) prev.count++;
    else distinct.set(k, { ...f, count: 1 });
  }
  const noteMap = new Map<string, Finding & { count: number }>();
  for (const g of results)
    for (const f of g.notes) {
      const k = `${f.kind}|${f.key}`;
      const prev = noteMap.get(k);
      if (prev) prev.count++;
      else noteMap.set(k, { ...f, count: 1 });
    }
  const outcomes: Record<string, number> = {};
  const coverage: Record<string, number> = {};
  for (const g of results) for (const [k, v] of Object.entries(g.coverage)) coverage[k] = (coverage[k] ?? 0) + v;
  for (const g of results) outcomes[g.ended] = (outcomes[g.ended] ?? 0) + 1;
  const moves = results.reduce((t, g) => t + g.moves, 0);
  const lines = [
    `COVERAGE ${JSON.stringify(coverage)}`,
    ...results.map(
      (g) =>
        `GAME seed=${g.seed} ${g.policy} moves=${g.moves} rounds=${g.rounds} stage=${g.stage} ${g.ended} ${g.reason}`,
    ),
    `games=${results.length} moves=${moves} ms=${Math.round(results.reduce((t, g) => t + g.ms, 0))} outcomes=${JSON.stringify(outcomes)} distinctDeals=${new Set(results.map((g) => g.firstHand)).size}`,
    ...[...distinct.values()].map(
      (f) => `FAIL ${f.kind} x${f.count} first seed=${f.seed} (${f.policy}) move=${f.move}: ${f.detail}`,
    ),
    ...[...noteMap.values()].map((f) => `NOTE ${f.kind} x${f.count} first seed=${f.seed} move=${f.move}: ${f.detail}`),
  ];
  if (process.env.FUZZ_REPORT) writeFileSync(process.env.FUZZ_REPORT, lines.join("\n"));
  const unknown = [...distinct.values()].filter((f) => !KNOWN_FAILURE_KINDS.has(f.kind));
  expect(
    unknown.map((f) => `${f.kind} x${f.count} seed=${f.seed} (${f.policy}) move=${f.move}: ${f.detail}`),
    lines.join("\n"),
  ).toEqual([]);
});

function isTucked(id: string): boolean {
  const st = lastEngineState;
  return !!st && engine.locateCard(st, id as engine.InstanceId)?.kind === "tucked";
}

function orphanZone(id: string): string {
  const st = lastEngineState;
  if (!st) return "?";
  const zone = engine.locateCard(st, id as engine.InstanceId);
  const name = engine.cardOf(st, id as engine.InstanceId)?.name ?? "?";
  if (zone?.kind !== "tucked") return `${JSON.stringify(zone)} (${name})`;
  const host = zone.hostInstanceId as engine.InstanceId;
  return `${JSON.stringify(zone)} (${name}) host=${engine.cardOf(st, host)?.name} hostType=${engine.cardOf(st, host)?.type} hostZone=${JSON.stringify(engine.locateCard(st, host))}`;
}

// Oddity, not a crash: a card drawn this move ends up tucked under a side scheme in the villain area and appears on
// no zone of the table (not in snapshot().hand / inPlay / enemyCards). Seed 2258, policy "careful", move ~109.
// Passes while the oddity exists; when it starts failing, the snapshot now shows the card, so delete this test.
// Seed 2258: Highway Robbery tucks a just-drawn card facedown. It leaves every zone on purpose; the scheme counts it.
test("a drawn card tucked under a side scheme is not an orphan beat (seed 2258, careful)", () => {
  const game = playGame(2258, "careful");
  const orphan = game.notes.find((n) => n.kind === "beat-orphan" && n.key === "draw");
  expect(orphan?.detail).toBeUndefined();
});
