import { statHue } from "../tokens.js";
import { searchQuestion } from "./search-question.js";
// The game's printed symbols as letters (resource icons in a spend's bar and on the cards picked to pay it).
import "../fonts/champions-icons.css";
import "./design.css";
import "./battle.css";
import { padActive, startController } from "./pad/controller.js";
import { besideSpot, dockSpot } from "./dock-spot.js";
import { whileStillThere } from "./beat-order.js";
import { handBetweenBeats } from "./hand-flow.js";
import { nextOfferIndex } from "./offer-queue.js";
import { cardPlaces, pickOrder } from "./pick-order.js";
import { holdsEncounter, revealWindowFor, type Reaction } from "./reveal-hold.js";
import { arrangeScene, sceneVillain } from "./debug-scenes.js";
import { sfx, type SoundName } from "./sound.js";
import { icon, RESOURCE_ICON, type IconName } from "./icons.js";
import { BattleModel, DRONE_NAME, isVillainId, VILLAINS, type BattleCard, type VillainId } from "./model.js";
import { answerRemote, createPlayer, type Player, type RemoteChannel } from "./play.js";
import { pictureOf, retryFailedPictures } from "./picture-retry.js";
import {
  addRecordButton,
  finishGame,
  lockReason,
  playerReady,
  shelfDrawn,
  shelfStale,
  startGame,
  type GameHandle,
} from "./test-site/player.js";
import { spreadPlates, type Obstacle, type Plate, type PlateShift } from "./plate-spread.js";
import { installReport } from "./report/report.js";
import { installPatchNotesButton, offerPatchNotes } from "./patch-notes/patch-notes.js";
import { momentOf } from "./report/capture.js";
import { eventLook, offerDoes, spotOf, waitsOnDock, type GlowTone, type Spot } from "./spotlight.js";
import {
  BattleTable,
  ACTIVATION_MS,
  INTERRUPT_MS,
  SHINE_MS,
  EXHAUST_MS,
  READY_MS,
  HIT_CONTACT_MS,
  isTuckedUpgrade,
  SPEND_GLYPH,
} from "./table.js";

type Snapshot = ReturnType<BattleModel["snapshot"]>;
type Beat = Snapshot["beats"][number];
type Choice = NonNullable<Snapshot["choice"]>;
type Payment = NonNullable<Snapshot["payment"]>;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing battle element ${id}`);
  return node as T;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Every button answers a click with a squash, a spring back and a ring of light (design.css `.btn[data-pressed]`),
// restarted on each click so quick repeated presses each show.
document.addEventListener(
  "click",
  (event) => {
    const button = (event.target as Element | null)?.closest?.(".btn");
    if (!(button instanceof HTMLElement)) return;
    button.removeAttribute("data-pressed");
    void button.offsetWidth;
    button.setAttribute("data-pressed", "");
    window.setTimeout(() => button.removeAttribute("data-pressed"), 450);
  },
  true,
);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const model = new BattleModel();
const stage = element("stage");
const orderLayer = element("order-badges");
const boardLabels = element("board-labels");
const labelClips = [boardLabels];
const anchors = element("anchors");
const rail = element("rail");
const boardViewport = element("board-viewport");
const gameOver = element<HTMLDialogElement>("game-over");
const gameOverUndo = element<HTMLButtonElement>("game-over-undo");
const tryAgain = element<HTMLButtonElement>("try-again");
const preview = element<HTMLImageElement>("preview");
const decision = element("decision");
const choiceShade = element("choice-shade");
const focusBlur = element("focus-blur");
/** A revealed encounter card waiting on Continue: the table blurs around it. */
let revealFocus: string | null = null;
/** Cards turned up off the top of the deck (Black Cat's discard): the table blurs around them while they are dealt with. */
let rowFocus: string[] = [];
/** A question answered only in the dock ("Choose one"): the table blurs, all but the card asking it, if on the table. */
let dockFocus: { keep: string | null } | null = null;
const defenseShade = document.querySelector<SVGSVGElement>("#defense-shade")!;
const abilityGlow = document.querySelector<SVGSVGElement>("#ability-glow")!;
const abilityOutlines = document.querySelector<SVGGElement>("#ability-outlines")!;
const defenderCutouts = document.querySelector<SVGGElement>("#defender-cutouts")!;
const plateCutouts = document.querySelector<SVGGElement>("#plate-cutouts")!;
const reticle = element("attack-reticle");
// The phase banner runs right across the window, over the sidebar too, so it lives on the page, not in the table.
document.body.append(element("phase-banner"));
const pendingMark = element("pending-mark");
let aimTarget: string | null = null;
/** The enemy whose attack is under way, from its aim until the attack resolves. */
let attacker: string | null = null;
let heldEncounter: string | null = null;
/** The held encounter card is up because a card can interrupt its reveal (Enhanced Spider-Sense): passed, it fires. */
let revealWindowHeld: string | null = null;
/** A held card let go as new beats arrive: it plays out (When Revealed, then away) before them. */
let releaseHeld: string | null = null;
/** A revealed card whose own question was just answered, standing aside: it fires before the answer's beats play. */
let answeredHeld: string | null = null;
/** Revealed cards whose When Revealed fired before their question was asked (a search), so it isn't fired again. */
const firedBeforeAsking = new Set<string>();
/** The reveal of the card held up, kept for moves whose own beats don't carry it (paying for a reaction to it). */
let heldReveal: Beat["reveal"] = undefined;
/** How long the table takes to darken where it fades in (`.fade-in` in battle.css). */
const SPOT_FADE_MS = 700;
/** What the table is darkened around right now (`spotlight.ts`). */
let spot: Spot | null = null;
let markKey = "";
/** Facedown boost cards beside their enemies, each with a "Boost" tag until an activation turns it up. */
const boostTags = new Map<string, HTMLElement>();
const instruction = element("instruction");
const restart = element<HTMLButtonElement>("reset");
const gameMenu = element<HTMLDialogElement>("menu");
const menuButton = element<HTMLButtonElement>("menu-button");
const pile = element<HTMLButtonElement>("discard-label");
const discardFan = element("discard-fan");
const pileCount = element("discard-count");
const encounterPile = element<HTMLButtonElement>("encounter-discard");
const encounterLabel = element("encounter-label");
const deckLabel = element("deck-label");
const deckCount = element("deck-count");
const dock = element("dock");
const dockTitle = element("dock-title");
/** Whose move it is, at a glance: your shield in blue, the enemy's mask in red, at the start of the turn bar. */
const turnMark = element("turn-mark");
const dockEyebrow = element("dock-eyebrow");
const dockOptions = element("dock-options");
const dockFeed = element("dock-feed");
const dockMeter = element("dock-meter");
const dockNeed = element("dock-need");
const dockPrimary = element<HTMLButtonElement>("dock-primary");
const dockSecondary = element<HTMLButtonElement>("dock-secondary");
const dockActions = dock.querySelector<HTMLElement>(".dock-actions")!;
const arena = document.querySelector<HTMLElement>(".arena")!;
const playfield = document.querySelector<HTMLElement>(".playfield")!;
/** Wider screens: Undo and End Turn keep the bottom corners, and the bar floats up only to say something. */
const turnCorner = element("turn-corner");
const railTurn = element("rail-turn");
const undoCorner = element("undo-corner");
const endTurnButton = element<HTMLButtonElement>("end-turn");
const railToggle = element<HTMLButtonElement>("rail-toggle");
const hoverPicture = element<HTMLImageElement>("hover-card");
const hoverNotes = element("hover-notes");
const previewNotes = element("preview-notes");

/** What each status card does, in the Rules Reference's terms (v1.8: Tough, Stunned, Confused). */
const STATUS_NOTES: Record<string, { title: string; text: string }> = {
  tough: { title: "Tough", text: "The next time this character would take damage, discard Tough instead: no damage." },
  stunned: { title: "Stunned", text: "The next time this character would attack, discard Stunned instead: no attack." },
  confused: {
    title: "Confused",
    text: "The next time this character would thwart or scheme, discard Confused instead: it doesn't happen.",
  },
};

/** Under a card's picture, a note for each status it has, saying what that status does (Adam, 2026-11-23). */
function paintStatusNotes(box: HTMLElement, card: { markers?: readonly { name: string; count: number }[] } | null) {
  const notes = (card?.markers ?? []).filter((m) => m.count > 0 && STATUS_NOTES[m.name]);
  box.replaceChildren(
    ...notes.map(({ name }) => {
      const note = make("div", "status-note");
      const text = make("span", "");
      text.append(make("b", "", STATUS_NOTES[name]!.title), ` · ${STATUS_NOTES[name]!.text}`);
      note.append(icon(name as IconName), text);
      return note;
    }),
  );
  box.hidden = !notes.length;
  return notes.length > 0;
}
const pinnedCard = element("pinned-card");
const pinnedPicture = pinnedCard.querySelector("img")!;
// A card picture that fails to load is asked for again a little later, as the table's own cards are.
for (const image of [preview, hoverPicture, pinnedPicture, element<HTMLImageElement>("game-over-art")])
  retryFailedPictures(image);
/** The card pinned at the table's side with a right-click (`pinCard`). */
let pinnedId: string | null = null;
/** Wider than a phone: the hand sinks, the turn corner shows and the card panel can fold away. */
const roomy = matchMedia("(min-width: 741px)");
const roundLabel = element("round-label");
const undoButton = element<HTMLButtonElement>("undo");
const turnStatus = element("turn-status");
const choicePicks = new Set<string>();
let table: BattleTable | undefined;
let state: Snapshot;
let staged: BattleCard | null = null;
/**
 * A card played in answer to a moment goes to whatever that moment is happening to: the scheme about to get threat
 * (Great Responsibility), the hero about to take damage (Backflip), the treachery being revealed, the enemy about to
 * activate. The rule is the reaction window's own subject, so it holds for every card, not one by one. Threat stopped
 * at a scheme that the card turns into damage is shown turning into a damage token and flying to the hero.
 */
let reacting: Reaction | null = null;
/** A targeted attachment (Spider-Tracer) staged while its host is chosen: it waits over the villain's side. */
let stagedAttachment: string | null = null;
const readReveal = element<HTMLButtonElement>("read-reveal");
const revealHint = element("reveal-hint");
let readingCard: string | null = null;
let menuCard: string | null = null;
let actionCard: string | null = null;
const moveViews = new WeakMap<
  Snapshot["beats"],
  {
    staged: BattleCard | null;
    reveal: Beat["reveal"];
    aim: string | null;
    reacting?: Reaction | null;
    /** Revealed cards standing aside by the villain while they resolve (Assault during its attack). */
    parked?: { id: string; name: string; art: string; landscape: boolean }[];
  }
>();
/** How each revealed encounter card was shown, so Undo can stand a parked one back up by the villain. */
const parkedViews = new Map<string, { id: string; name: string; art: string; landscape: boolean }>();
let presented: Snapshot["beats"] | undefined;
let presenting = false;
let flying = false;
let discarding = false;
let discardOpen = false;
let viewingEncounterDiscard = false;
const viewedPile = () => (viewingEncounterDiscard ? state.encounterDiscard : state.discard);
const labels = new Map<string, HTMLButtonElement>();
/** Hand cards the player's own payment or discard already flew to the pile, so their beat doesn't fly them again. */
const preAnimated = new Set<string>();

// Pile labels and the dock's quiet buttons carry the same symbols as the rest of the table.
deckLabel.prepend(icon("deck", "Your deck"));
encounterLabel.prepend(icon("deck", "Encounter deck"));
pile.prepend(icon("discard"));
encounterPile.prepend(icon("discard"));
undoButton.prepend(icon("undo"));
restart.prepend(icon("mulligan"));
menuButton.append(icon("menu"));

type ResourceSource = Payment["sources"][number];
function resourcePieceId(source: ResourceSource) {
  if (source.kind === "handCard") return source.cardId;
  const onBoard = state.inPlay.some((card) => card.id === source.cardId && card.showAsFullCard);
  const options = state.payment?.sources.filter((option) => option.cardId === source.cardId);
  return onBoard && options?.length === 1 ? source.cardId : `ability:${source.id}`;
}
let displayedHand: BattleCard[] = [];

function cards() {
  return [
    state.hero,
    state.villain,
    ...state.enemyCards,
    ...displayedHand,
    ...state.inPlay,
    ...state.discard,
    ...state.encounterDiscard,
    // Last: a card on its way to the hand (Black Cat's pick-up) is named before it gets there.
    ...state.hand,
    // Cards a question found in a deck or discard pile: named, and read when pointed at in the bar.
    ...(state.choice?.searched?.map((found) => found.card) ?? []),
  ];
}

/**
 * The facedown Drones on the table (Ultron's): each is "Drone" in every line until its defeat has played out, though
 * by the end of a move it may already lie faceup in the discard pile under its own name.
 */
let droneIds = new Set<string>();
/** The beats still to play after the one playing now (empty outside a move). */
let beatsToCome: readonly Beat[] = [];

/**
 * The threat a scheme shows as it arrives mid-move: the snapshot holds its threat once the whole move is done, so a
 * scheme revealed with threat still to come (Drone Factory's starting 4, then 1 per Drone) would land with all of it
 * and the chips the beats add would already be there (Adam, 2026-11-25: 7 chips at once while it said +4, then +3).
 * It shows what it had before the first threat beat still to come for it.
 */
function threatOnArrival<T extends { id: string; threat: number | null }>(card: T): T {
  if (card.threat === null) return card;
  const first = beatsToCome.find((beat) => beat.threat?.scheme === card.id)?.threat;
  return first ? { ...card, threat: Math.max(0, first.to - first.delta) } : card;
}

function nameOf(id: string | null | undefined): string {
  if (!id) return "";
  if (droneIds.has(id)) return DRONE_NAME;
  return (cards().find((card) => card.id === id) ?? (staged?.id === id ? staged : undefined))?.name ?? "";
}

function resourceText(icons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of icons) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} ${type}`).join(" + ");
}

function resourcePips(icons: readonly string[]): HTMLElement {
  const pips = make("span", "pips");
  for (const type of icons) {
    const pip = make("span", "pip");
    pip.dataset.resource = type;
    pip.append(icon(RESOURCE_ICON[type] ?? "wild"));
    pips.append(pip);
  }
  return pips;
}

// ── The turn dock ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The dock is the one place the game talks to the player: what is happening, what it is asking, and the buttons
 * that answer. The button that moves the game on is always the gold one in the bottom-right corner.
 */
interface DockButton {
  label: string;
  icon?: IconName;
  disabled?: boolean;
  /** Pulse: the game is waiting on exactly this. */
  attention?: boolean;
  /** The End Turn button: on a wider screen it lives in the turn corner, so the bar leaves its own copy out. */
  endTurn?: boolean;
  onClick(): void;
}
interface DockOption {
  id: string;
  label: string;
  detail?: string | null;
  icon?: IconName | null;
  pressed?: boolean;
  /** Where this pick stands in an ordered question: 1 goes first (`pick-order.ts`). */
  order?: number;
  onClick(): void;
}
/** A card in the bar's row of searched cards: its picture, and which pile it was found in. */
interface DockCard {
  /** The option it answers. */
  id: string;
  cardId: string;
  name: string;
  art: string;
  from: string;
  pressed: boolean;
  order?: number;
  onClick(): void;
}
interface DockView {
  tone: "hero" | "villain";
  /** True while the game waits for the player's answer. */
  asking: boolean;
  eyebrow?: { text: string; icon?: IconName; tone?: "villain" | "hero" | "reaction" | "threat" } | null;
  /** Which question the bar asks; a new one flips the bar in and arms the double-click guard. */
  question?: string;
  title: string;
  help?: string | null;
  options?: readonly DockOption[];
  /** Cards offered from a deck or discard pile, laid out face up to read before choosing (`BattleChoice.searched`). */
  cards?: readonly DockCard[];
  meter?: { paid: number; required: number; balance: string } | null;
  /** The symbols a spend asks for, each lit once the picks pay it (`BattleModel.spendMeter`). */
  need?: readonly { type: string; paid: boolean }[] | null;
  primary?: DockButton | null;
  secondary?: DockButton | null;
  /** Nothing to say or answer: on a wider screen the bar folds away and End Turn waits in the turn corner. */
  idle?: boolean;
}

/** When the bar's current question appeared: its buttons wait out a double-click on the button that brought it. */
let questionAt = 0;
let lastQuestion = "";
const QUESTION_GUARD_MS = 380;
const settled = () => performance.now() - questionAt >= QUESTION_GUARD_MS;
function paintButton(button: HTMLButtonElement, spec: DockButton | null | undefined) {
  button.hidden = !spec;
  if (!spec) return;
  const key = `${spec.icon ?? ""}|${spec.label}`;
  if (button.dataset.key !== key) {
    button.dataset.key = key;
    button.replaceChildren(...(spec.icon ? [icon(spec.icon)] : []), make("span", "", spec.label));
  }
  button.disabled = !!spec.disabled;
  button.toggleAttribute("data-attention", !!spec.attention);
  button.toggleAttribute("data-end-turn", !!spec.endTurn);
  button.onclick = (event) => {
    if (!button.disabled && (event.detail === 0 || settled())) spec.onClick();
  };
}

/**
 * The bar's row of searched cards (Masters of Mayhem's Masters of Evil minions, a search of the player's own deck):
 * each card face up with the pile it came from. Pointing at one (or focusing it) shows it full size, as a table card
 * does; pressing it picks it, and the bar's Confirm takes it (Adam, 2026-11-25: "had the list of names but couldn't
 * preview the cards to know what they did"). The buttons are kept from paint to paint, so the one under the pointer
 * or the keyboard stays put.
 */
const dockCards = make("div", "dock-cards");
dockCards.setAttribute("role", "group");
dockCards.setAttribute("aria-label", "Cards to choose from");
dockCards.hidden = true;
element("dock-options").before(dockCards);
function paintDockCards(list: readonly DockCard[]) {
  dockCards.hidden = !list.length;
  const keep = new Set(list.map((card) => card.id));
  for (const button of [...dockCards.children] as HTMLElement[])
    if (!keep.has(button.dataset.option ?? "")) button.remove();
  list.forEach((card, i) => {
    let button = dockCards.querySelector<HTMLButtonElement>(`[data-option="${CSS.escape(card.id)}"]`);
    if (!button) {
      button = make("button", "dock-card");
      button.type = "button";
      button.dataset.option = card.id;
      // Not `data-card`: that names a card on the table, which the controller steers to by its place there.
      button.dataset.found = card.cardId;
      const picture = make("img", "");
      picture.alt = "";
      picture.draggable = false;
      button.append(picture);
      button.onpointerenter = (event) => {
        if (event.pointerType !== "touch") hoverCard(card.cardId);
      };
      button.onpointerleave = () => hoverCard(null);
      // The keyboard or a controller arriving on a card reads it; the bar focusing its first card for a mouse does not.
      button.onfocus = () => {
        if (padActive() || button!.matches(":focus-visible")) hoverCard(card.cardId);
      };
      button.onblur = () => hoverCard(null);
    }
    button.onclick = (event) => {
      if (!discarding && !presenting && (event.detail === 0 || settled())) card.onClick();
    };
    const picture = button.querySelector("img")!;
    if (picture.getAttribute("src") !== card.art) picture.src = card.art;
    button.setAttribute("aria-pressed", String(card.pressed));
    button.setAttribute("aria-label", `${card.name}, from ${card.from.toLowerCase()}`);
    button.querySelector(".pick-order")?.remove();
    if (card.order !== undefined) button.append(orderBadge(card.order));
    if (dockCards.children[i] !== button) dockCards.insertBefore(button, dockCards.children[i] ?? null);
  });
}

/** The picked card of a one-card search, until Confirm: a press only picks it, so it can be read first. */
let searchPick: { choice: string; option: string } | null = null;
function searchPicked(choice: Choice): string | null {
  return searchPick?.choice === choice.id && choice.options.some((option) => option.id === searchPick!.option)
    ? searchPick.option
    : null;
}

/** Where on screen each card just taken from a search was, so it flies from there onto the table (Adam, 2026-11-25). */
let foundAt = new Map<string, DOMRect>();
function markFound(option: string) {
  const button = [...dockCards.children].find((node) => (node as HTMLElement).dataset.option === option);
  const art = button?.querySelector("img");
  const id = (button as HTMLElement | undefined)?.dataset.found;
  foundAt = id && art ? new Map([[id, art.getBoundingClientRect()]]) : new Map();
}

/** Paint the turn bar; true when it now asks a question it was not asking before. */
function paintDock(view: DockView): boolean {
  dock.dataset.tone = view.tone;
  const side = view.tone === "hero" || view.tone === "villain" ? view.tone : null;
  turnMark.hidden = !side;
  if (side && turnMark.dataset.side !== side) {
    turnMark.dataset.side = side;
    turnMark.replaceChildren(icon(side));
  }
  dock.toggleAttribute("data-asking", view.asking);
  // A search lays its cards out full size: the bar opens into a panel in the middle of the table (`.dock[data-search]`).
  dock.toggleAttribute("data-search", !!view.cards?.length);
  // On a wider screen the bar shows only when there is something to press: a question, Continue, Play again. What
  // the game is doing (the villain phase, an ability resolving) plays out on the table and goes in the log.
  const pressable = [view.primary, view.secondary].some((button) => button && !button.endTurn && !button.disabled);
  const folded = !!view.idle || (!view.asking && !pressable && !view.options?.length);
  dock.toggleAttribute("data-idle", folded);
  // A revealed card's Continue moves nothing: the table stays still around the card, the bar fitting under it.
  table?.setQuestion(!folded && roomy.matches && !revealFocus);
  // The turn corner's End Turn answers only while nothing else is asked; the bar's own copy is the phone's.
  const ending = view.idle && view.primary?.endTurn ? view.primary : null;
  endTurnButton.disabled = !ending || !!ending.disabled;
  // Folding away with the keyboard on it (Enter on Keep hand): the keyboard goes on to End Turn, or else Undo. A
  // controller's focus goes back to the hand instead (`controller.ts`): a second A must never end the turn.
  if (folded && roomy.matches && dock.contains(document.activeElement) && !padActive())
    (endTurnButton.disabled ? undoButton : endTurnButton).focus({ preventScroll: true });
  const eyebrow = view.eyebrow;
  dockEyebrow.hidden = !eyebrow;
  if (eyebrow) {
    dockEyebrow.replaceChildren(...(eyebrow.icon ? [icon(eyebrow.icon)] : []), make("span", "", eyebrow.text));
    if (eyebrow.tone) dockEyebrow.dataset.tone = eyebrow.tone;
    else delete dockEyebrow.dataset.tone;
  }
  const key = `${view.title}|${eyebrow?.text ?? ""}`;
  // Picking cards for a mulligan changes the title, not the question; two offers of the same card are two questions.
  let asked = false;
  if (view.asking) {
    const question = view.question ?? key;
    asked = question !== lastQuestion;
    lastQuestion = question;
  }
  if (asked) {
    questionAt = performance.now();
    // The bar turns over like a card to a new question, so it never reads as the button just pressed. Only its
    // turn is animated, never its opacity, so a bar told to wait (the mulligan, until the dealt cards land) stays
    // hidden through it.
    if (!reducedMotion())
      dock.animate(
        [
          { transform: "perspective(700px) rotateX(-78deg)" },
          { transform: "perspective(700px) rotateX(9deg)", offset: 0.68 },
          { transform: "none" },
        ],
        { duration: 360, easing: "cubic-bezier(.2,.8,.3,1)" },
      );
  }
  dockTitle.textContent = view.title;
  dockTitle.toggleAttribute("data-long", isSentence(view.title));
  instruction.textContent = view.help ?? "";
  instruction.hidden = !view.help;
  dockMeter.hidden = !view.meter;
  if (view.meter) {
    const { paid, required, balance } = view.meter;
    element("payment-total").textContent = `${paid}/${required}`;
    dockMeter.querySelector<HTMLElement>(".meter-track span")!.style.transform =
      `scaleX(${required ? Math.min(1, paid / required) : 1})`;
    element("payment-balance").textContent = balance;
  }
  dockNeed.hidden = !view.need?.length;
  dockNeed.replaceChildren(
    ...(view.need ?? []).map(({ type, paid }) => {
      const pip = make("span", "pip need-pip");
      pip.dataset.resource = type === "any" ? "any" : type;
      pip.toggleAttribute("data-paid", paid);
      // The symbol as printed on the cards (the Champions icon font), so the bar and the cards look alike.
      const glyph = SPEND_GLYPH[type];
      pip.append(glyph ? make("span", "need-glyph", glyph) : icon("wild"));
      return pip;
    }),
  );
  dockNeed.setAttribute(
    "aria-label",
    (view.need ?? [])
      .map(({ type, paid }) => `${type === "any" ? "any resource" : type}: ${paid ? "paid" : "needed"}`)
      .join(", "),
  );
  const focusedOption = dockOptions.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.option
    : undefined;
  dockOptions.hidden = !view.options?.length;
  // An even grid: up to three side by side, four as two by two, more in rows of three.
  const optionCount = view.options?.length ?? 0;
  dockOptions.style.setProperty("--columns", String(optionCount === 4 ? 2 : Math.min(3, Math.max(1, optionCount))));
  dockOptions.replaceChildren(
    ...(view.options ?? []).map((option) => {
      const button = make("button", "btn btn-secondary btn-option");
      button.type = "button";
      button.dataset.option = option.id;
      if (option.pressed !== undefined) button.setAttribute("aria-pressed", String(option.pressed));
      if (option.order !== undefined) button.append(orderBadge(option.order, false));
      else if (option.icon) button.append(icon(option.icon));
      button.append(make("span", "", option.label));
      if (option.detail) button.append(make("small", "", option.detail));
      button.onclick = (event) => {
        if (!discarding && !presenting && (event.detail === 0 || settled())) option.onClick();
      };
      return button;
    }),
  );
  if (focusedOption)
    dockOptions
      .querySelector<HTMLElement>(`[data-option="${CSS.escape(focusedOption)}"]`)
      ?.focus({ preventScroll: true });
  paintDockCards(view.cards ?? []);
  paintButton(dockPrimary, view.primary);
  paintButton(dockSecondary, view.secondary);
  paintFeed();
  // A new question takes the keyboard focus so it is read out and answerable from the keyboard.
  const pressing = [dock, turnCorner, railTurn, undoCorner].some((home) => home.contains(document.activeElement));
  if (asked && !presenting && !pressing) {
    const first = view.options?.length
      ? dockOptions.querySelector<HTMLElement>("button")
      : view.cards?.length
        ? dockCards.querySelector<HTMLElement>("button")
        : null;
    (first ?? dockTitle).focus({ preventScroll: true });
  }
  placeDock();
  return asked;
}

/** What just happened, newest first, so a fast villain phase can be followed. */
interface FeedLine {
  text: string;
  icon: IconName;
  tone?: "villain" | "hero" | "damage" | "threat" | "heal" | undefined;
}
let feed: FeedLine[] = [];
/** The whole story, oldest first, for the play hook (`play.ts`): the player's moves and every beat the game played. */
const story: string[] = [];
function pushFeed(line: FeedLine) {
  if (!line.text || feed[0]?.text === line.text) return;
  feed = [line, ...feed].slice(0, 6);
}
function paintFeed() {
  dockFeed.replaceChildren(
    ...feed.map((line) => {
      const item = make("li", "");
      if (line.tone) item.dataset.tone = line.tone;
      item.append(icon(line.icon), make("span", "", line.text));
      return item;
    }),
  );
}

/** The player's own moves go in the log beside the game's, so the turn reads as one story. */
function say(text: string) {
  pushFeed({ text, icon: "action", tone: "hero" });
  paintFeed();
  story.push(text);
}

/** A short message over the table, for a move that couldn't be made. */
function toast(text: string) {
  const refusal = element("play-refusal");
  refusal.getAnimations().forEach((a) => a.cancel());
  refusal.textContent = text;
  refusal.hidden = false;
  refusal.animate([{ opacity: 1 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: 3600 }).onfinish = () => {
    refusal.hidden = true;
  };
}

/** A symbol for a printed option ("Take 2 damage", "Place 1 threat…"), so choices read at a glance. */
function optionIcon(label: string): IconName | null {
  const text = label.toLowerCase();
  // An either-or's "Spend 1 energy" half: the resource it asks for (several kinds read as wild).
  const spend = /^spend (.+)$/.exec(text)?.[1];
  if (spend) {
    const kinds = [...new Set(spend.match(/\b(energy|mental|physical)\b/g) ?? [])] as IconName[];
    return kinds.length === 1 ? kinds[0]! : "wild";
  }
  if (/\bheal/.test(text)) return "heal";
  // A card off the player's deck becoming a Drone (Ultron, Assault on NORAD, Android Efficiency).
  if (/\bdrone\b/.test(text)) return "deck";
  if (/remove .*threat|thwart/.test(text)) return "thwart";
  if (/threat/.test(text)) return "threat";
  if (/deal .*damage|attack/.test(text)) return "attack";
  if (/damage/.test(text)) return "damage";
  if (/draw/.test(text)) return "draw";
  if (/discard/.test(text)) return "discard";
  if (/stun/.test(text)) return "stunned";
  if (/confus/.test(text)) return "confused";
  if (/tough/.test(text)) return "tough";
  if (/exhaust/.test(text)) return "exhaust";
  return null;
}

/**
 * A dock title long enough to be a sentence ("Spend 1 energy, or put the top card of the deck into play facedown…")
 * is set in the regular weight: bold suits "Pay 2" or "Victory" but is too much over two lines (Adam, 2026-11-25).
 */
function isSentence(title: string) {
  return title.length > 40;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function paymentView(payment: Payment): DockView {
  const left = payment.required - payment.paid;
  return {
    tone: "hero",
    asking: true,
    eyebrow: { text: payment.subject.name, icon: "action", tone: "hero" },
    title: payment.required ? `Pay ${payment.required}` : payment.ability ? "Use it?" : "Play it?",
    meter: payment.required
      ? {
          paid: payment.paid,
          required: payment.required,
          // Only what the count can't say: a resource type still owed, or an overspend.
          balance: payment.outstanding?.length
            ? `Need ${payment.outstanding.join(" + ")}`
            : left < 0
              ? `${-left} extra`
              : "",
        }
      : null,
    secondary: { label: "Cancel", disabled: discarding, onClick: cancel },
    primary: {
      label: payment.ability ? "Use" : "Play",
      icon: "next",
      disabled: !payment.canPay || discarding,
      attention: payment.canPay,
      onClick: pay,
    },
  };
}

type TriggerChoice = Choice;
let triggerChoice: TriggerChoice | null = null;
let defenderSelection: TriggerChoice | null = null;
function defenseQuestionDecline(choice: TriggerChoice | null) {
  if (!choice?.defense || choice === defenderSelection || !choice.options.some((option) => option.cardId)) return;
  return choice.options.find((option) => !option.cardId);
}

let offerIndex = 0;
let acceptedOffers: string[] = [];

function syncOffer(choice: TriggerChoice) {
  if (triggerChoice === choice) return;
  triggerChoice = choice;
  offerIndex = 0;
  acceptedOffers = [];
}

function answerOffer(yes: boolean) {
  const choice = triggerChoice;
  if (!choice?.offers || discarding || presenting) return;
  const offer = choice.offers[offerIndex]!;
  if (yes) acceptedOffers.push(offer.id);
  if (yes && choice.event?.subject)
    reacting = {
      card: offer.cardId,
      subject: choice.event.subject,
      kind: choice.event.kind,
      amount: choice.event.amount ?? 1,
    };
  // One question per card: a later copy comes up again only if the engine offers the window again (`offer-queue.ts`).
  offerIndex = nextOfferIndex(
    choice.offers.map((o) => nameOf(o.cardId)),
    offerIndex,
  );
  if (offerIndex < choice.offers.length && acceptedOffers.length < choice.max) {
    render();
    return;
  }
  const picks = acceptedOffers;
  triggerChoice = null;
  act(() => {
    model.chooseMany(picks);
  });
}

function defend(choice: TriggerChoice) {
  const defenders = choice.options.filter((option) => option.cardId);
  if (defenders.length === 1) {
    choose(defenders[0]!.id);
    return;
  }
  defenderSelection = choice;
  render();
}

function choiceView(choice: Choice): DockView {
  const tone = state.turn === "enemy" ? "villain" : "hero";
  if (choice.offers?.length) {
    syncOffer(choice);
    const offer = choice.offers[offerIndex]!;
    const card = nameOf(offer.cardId);
    const interrupt = /^interrupt/i.test(offer.question);
    // "Interrupt with Spider-Sense?": the button names the ability, the eyebrow says what kind of reaction it is.
    const ability = / with ([^?]+)\?$/.exec(offer.question)?.[1] ?? card;
    const look = choice.event ? eventLook(choice.event, state) : null;
    return {
      tone,
      asking: true,
      // What is happening comes first ("The Break-In! is about to get 1 threat"); the title asks what to do about it.
      eyebrow: {
        text: choice.prompt,
        icon: look?.icon ?? (interrupt ? "energy" : "response"),
        tone: look?.glow === "threat" ? "threat" : look?.glow === "attack" ? "villain" : "reaction",
      },
      title: offer.effect ? capitalize(offerDoes(offer.effect)) + "?" : offer.question,
      secondary: { label: "Pass", onClick: () => answerOffer(false) },
      primary: {
        label: ability ? `Use ${ability}` : "Use it",
        icon: interrupt ? "energy" : "response",
        attention: true,
        onClick: () => answerOffer(true),
      },
    };
  }
  const decline = defenseQuestionDecline(choice);
  if (choice.defense) {
    const defenders = choice.options.filter((option) => option.cardId);
    const eyebrow = { text: `${choice.defense.attacker} attacks`, icon: "attack" as const, tone: "villain" as const };
    const declineOption = choice.options.find((option) => !option.cardId);
    if (decline) {
      return {
        tone: "villain",
        asking: true,
        eyebrow,
        title: defenders.length === 1 ? `Defend with ${nameOf(defenders[0]!.cardId)}?` : "Defend?",
        secondary: { label: "Don’t defend", onClick: () => choose(decline.id) },
        primary: { label: "Defend", icon: "tough", attention: true, onClick: () => defend(choice) },
      };
    }
    return {
      tone: "villain",
      asking: true,
      eyebrow,
      title: defenders.length ? "Choose a defender" : "No defender",
      secondary: declineOption
        ? { label: defenders.length ? "Don’t defend" : "Continue", onClick: () => choose(declineOption.id) }
        : null,
    };
  }
  const n = choicePicks.size;
  if (choice.mulligan) {
    return {
      tone: "hero",
      asking: true,
      eyebrow: { text: "Mulligan", icon: "mulligan", tone: "hero" },
      title: n ? `Swap ${plural(n, "card")}` : "Keep your hand?",
      primary: {
        label: n ? `Mulligan ${n}` : "Keep hand",
        icon: n ? "mulligan" : "check",
        disabled: discarding,
        attention: true,
        onClick: confirmChoice,
      },
    };
  }
  if (choice.discardFromHand) {
    const forced = choice.min > 0;
    return {
      tone: "hero",
      asking: true,
      eyebrow: { text: forced ? "Hand limit" : "End of turn", icon: "discard", tone: "hero" },
      title: forced ? `Discard ${choice.min}` : "Discard any?",
      primary: {
        label: n ? `Discard ${n}` : forced ? `Pick ${choice.min}` : "Keep hand",
        icon: n || forced ? "discard" : "check",
        disabled: n < choice.min || discarding,
        attention: n >= choice.min,
        onClick: confirmChoice,
      },
    };
  }
  const multiple = choice.max > 1;
  // Cards found in a deck or discard pile are laid out as cards in the bar, not buttons with their names.
  const searched = new Map((choice.searched ?? []).map((found) => [found.id, found]));
  const listed = choice.options.filter(
    (option) => (!onTable(option.cardId) || actionCard === option.cardId) && !searched.has(option.cardId ?? ""),
  );
  const searchCards = choice.options.filter((option) => searched.has(option.cardId ?? ""));
  const picked = searchCards.length && !multiple ? searchPicked(choice) : null;
  const source =
    choice.sourceTitle?.replace(/ · When Revealed$/, "") ??
    (nameOf(state.choiceSource) ||
      // A revealed card standing aside beside the villain while it asks (Sonic Boom) is in none of the zones.
      parkedViews.get(state.choiceSource ?? "")?.name ||
      (state.turn === "enemy" ? "Villain phase" : state.turn === "ending" ? "End of turn" : staged?.name || ""));
  // A search's question says only what to choose, and at most one plain line on where the card goes
  // (`searchQuestion`; Adam, 2026-11-25).
  const asked = choice.searched?.length ? searchQuestion(choice.prompt, choice.max) : null;
  const heading = asked?.title ?? (/^choose one[.:]?$/i.test(choice.prompt.trim()) ? "Choose one" : choice.prompt);
  // An either-or spend's second step: the cards that pay it are picked, and Back returns to its two halves.
  const spending = choice.eitherOr === "spend";
  const paysSpend = model.spendPays([...choicePicks]) !== false;
  const spendMeter = spending ? model.spendMeter([...choicePicks]) : null;
  const order = pickOrder(choice, choicePicks);
  return {
    tone,
    asking: true,
    eyebrow: source
      ? {
          text: source,
          icon: state.turn === "enemy" ? "forced" : "action",
          tone: state.turn === "enemy" ? "villain" : "hero",
        }
      : null,
    title: heading,
    need: spendMeter?.need ?? null,
    // Guard keeping the villain out of reach says so under the question (`BattleChoice.guard`).
    help: choice.guard ? (choice.explanation ?? null) : (asked?.help ?? null),
    options: listed.map((option) => ({
      id: option.id,
      label: option.label,
      icon: optionIcon(option.label),
      ...(multiple ? { pressed: choicePicks.has(option.id) } : {}),
      ...(order.has(option.id) ? { order: order.get(option.id)! } : {}),
      onClick: () => selectChoice(option.id),
    })),
    cards: searchCards.map((option) => {
      const found = searched.get(option.cardId!)!;
      return {
        id: option.id,
        cardId: found.id,
        name: found.card.name,
        art: found.card.art,
        from: found.from,
        pressed: multiple ? choicePicks.has(option.id) : picked === option.id,
        ...(order.has(option.id) ? { order: order.get(option.id)! } : {}),
        onClick: () => {
          sfx.play("select");
          selectChoice(option.id);
        },
      };
    }),
    primary:
      !multiple && searchCards.length
        ? {
            // One card from a search: pressing a card picks it (so it can be read first); this takes it.
            // Always "Confirm": the picked card shows itself, and the button keeps its size (Adam, 2026-11-25).
            label: "Confirm",
            icon: "check",
            disabled: !picked || discarding,
            attention: !!picked,
            onClick: () => {
              if (!picked) return;
              searchPick = null;
              markFound(picked);
              choose(picked);
            },
          }
        : multiple
          ? {
              // An either-or payment ("Spend 1 physical, or put the top card of the deck into play ... as a Drone
              // minion?"): the button says which half pressing it now takes, where a bare "Confirm" with nothing picked
              // hid that it means the "or".
              label: spending ? "Spend" : n ? `Confirm ${n}` : "Confirm",
              icon: "next",
              // A spend that can be declined goes through only once the picks pay it: picks that don't would be taken
              // as not spending, with the "or" happening anyway (Sonic Boom exhausting everyone, the cards kept).
              // Declining is the first step's other button, so nothing picked spends nothing here.
              disabled: n < choice.min || discarding || !paysSpend || (spending && n === 0),
              attention: n >= choice.min && paysSpend && (!spending || n > 0),
              onClick: confirmChoice,
            }
          : null,
    secondary: choice.canCancel
      ? { label: spending ? "Back" : "Cancel", onClick: cancel }
      : !multiple && choice.canSkip
        ? { label: choice.decline ?? "Skip", onClick: () => choose(null) }
        : null,
  };
}

function dockView(): DockView {
  const villain = state.turn === "enemy";
  if (state.outcome) {
    const won = state.outcome.result === "win";
    return {
      tone: won ? "hero" : "villain",
      asking: false,
      eyebrow: null,
      title: won ? "Victory" : "Defeat",
      primary: { label: won ? "Play again" : "Try again", icon: "mulligan", onClick: start },
    };
  }
  if (discardOpen) {
    return {
      tone: villain ? "villain" : "hero",
      asking: false,
      eyebrow: null,
      title: `${viewingEncounterDiscard ? "Encounter discard" : "Discard pile"} · ${viewedPile().length}`,
      primary: { label: "Close", onClick: () => setDiscardOpen(false) },
    };
  }
  if (state.payment)
    return {
      ...paymentView(state.payment),
      question: `pay:${state.payment.subject.id}`,
    };
  if (state.choice) {
    const view = choiceView(state.choice);
    // After choiceView, which moves to the next offer: each offer, and choosing among defenders, is its own question.
    const step = state.choice.offers?.length ? offerIndex : defenderSelection === state.choice ? "defenders" : "";
    return { ...view, question: `${state.choice.id}:${step}` };
  }
  if (state.turn === "player") {
    return {
      tone: "hero",
      asking: false,
      eyebrow: null,
      title: "Your turn",
      idle: true,
      primary: {
        label: "End Turn",
        icon: "next",
        disabled: !state.canEndTurn || flying || discarding || discardOpen,
        endTurn: true,
        onClick: endTurn,
      },
    };
  }
  return {
    tone: villain ? "villain" : "hero",
    asking: false,
    title: villain ? "Villain phase" : "End of turn",
    primary: { label: "End Turn", icon: "next", disabled: true, endTurn: true, onClick: () => undefined },
  };
}

// ── Reading cards ─────────────────────────────────────────────────────────────────────────────────────────────────
let hoveredCard: string | null = null;
/** The card the table (or a nameplate) says the pointer is on, and whether the pointer is in the open card menu. */
let pointedCard: string | null = null;
let overMenu = false;
function hoverCard(id: string | null) {
  // A soft tick as the pointer comes onto a new card, one for the hand and one for the table (Adam, 2026-11-24).
  if (id && id !== pointedCard) sfx.play(inHand(id) ? "hover-hand" : "hover-table");
  if (id !== pointedCard) {
    if (id && state.choice?.guard?.blocked.includes(id)) showGuardHint(id, true);
    else dropGuardHint();
  }
  pointedCard = id;
  showHovered();
}
/**
 * The card being read: the one pointed at, or the card whose menu is open while the pointer is in that menu, so
 * moving from Peter Parker onto his Flip button keeps his picture up until the pointer leaves both.
 */
let hoverGrace = 0;
function showHovered() {
  const next = pointedCard ?? (overMenu && menuCard ? menuCard : null);
  clearTimeout(hoverGrace);
  // Crossing the gap between a card and its open menu lets go only after a moment, so the picture doesn't blink.
  if (!next && menuCard && hoveredCard === menuCard) {
    hoverGrace = window.setTimeout(() => {
      hoveredCard = null;
      paintReading();
      placeHoverCard();
      if (!readingCard) inspect(null);
    }, 220);
    return;
  }
  hoveredCard = next;
  paintReading();
  placeHoverCard();
  if (!readingCard) inspect(hoveredCard);
}
decision.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch") return;
  overMenu = true;
  showHovered();
});
decision.addEventListener("pointerleave", () => {
  overMenu = false;
  // A frame later, so a pointer going straight back onto the card is seen there first and the picture stays put.
  requestAnimationFrame(() => {
    if (!overMenu) showHovered();
  });
});
// The keyboard's or a controller's focus in the menu keeps the card's picture up the same way.
decision.addEventListener("focusin", () => {
  overMenu = true;
  showHovered();
});
decision.addEventListener("focusout", (event) => {
  if (decision.contains(event.relatedTarget as Node | null)) return;
  overMenu = false;
  requestAnimationFrame(() => {
    if (!overMenu) showHovered();
  });
});

/**
 * Open the card reader wide over the table's edge for a landscape card (a scheme), or close it back to the sidebar.
 * Both ways it slides: the reader's width eases, and the card inside it grows or settles back with it.
 */
let readerSlide: Animation | null = null;
function setWidePreview(wide: boolean) {
  const reader = element("reader");
  const opening = wide && !rail.hasAttribute("data-wide-preview");
  const closing = !wide && rail.hasAttribute("data-wide-preview") && !readerSlide?.id;
  if (!opening && !closing) {
    // Hovering back onto a scheme while the reader is closing: open it again from where it is.
    if (wide && readerSlide?.id === "closing") {
      readerSlide.cancel();
      readerSlide = null;
    }
    return;
  }
  const from = reader.getBoundingClientRect().width;
  readerSlide?.cancel();
  readerSlide = null;
  if (opening) {
    rail.setAttribute("data-wide-preview", "");
    if (reducedMotion()) return;
    const to = reader.getBoundingClientRect().width;
    readerSlide = reader.animate([{ width: `${from}px` }, { width: `${to}px` }], {
      duration: 240,
      easing: "cubic-bezier(.2,.8,.3,1)",
    });
    readerSlide.onfinish = () => (readerSlide = null);
    return;
  }
  if (reducedMotion()) {
    rail.removeAttribute("data-wide-preview");
    return;
  }
  const to = rail.getBoundingClientRect().width;
  const slide = reader.animate([{ width: `${from}px` }, { width: `${to}px` }], {
    duration: 200,
    easing: "cubic-bezier(.4,0,.6,1)",
    // Held at the narrow width until the reader is back in the sidebar, so it never flicks wide for a frame.
    fill: "forwards",
  });
  slide.id = "closing";
  readerSlide = slide;
  slide.onfinish = () => {
    rail.removeAttribute("data-wide-preview");
    slide.cancel();
    readerSlide = null;
  };
}

function showPreview(card: Pick<BattleCard, "art" | "name" | "landscape">, expand: boolean) {
  setWidePreview(expand && card.landscape);
  if (pictureOf(preview.getAttribute("src") ?? "") !== card.art) preview.src = card.art;
  preview.alt = card.name;
  preview.hidden = false;
}

function inspect(id: string | null) {
  if (discarding) return;
  const card = cards().find((item) => item.id === id) ?? state.payment?.subject;
  if (card?.art) {
    showPreview(card, card.id === hoveredCard || card.id === heldEncounter);
    // The notes follow the picture: the panel keeps showing the last card read after the pointer leaves it.
    paintStatusNotes(previewNotes, "markers" in card ? card : null);
  } else if (!heldEncounter) setWidePreview(false);
}

function setDiscardOpen(open: boolean, encounter = viewingEncounterDiscard) {
  if (
    presenting ||
    (discardOpen === open && viewingEncounterDiscard === encounter) ||
    (open && (flying || discarding || state.payment || !(encounter ? state.encounterDiscard : state.discard).length))
  )
    return;
  const restoreFocus = discardFan.contains(document.activeElement);
  viewingEncounterDiscard = encounter;
  discardOpen = open;
  render();
  inspect(viewedPile().at(-1)?.id ?? null);
  if (!open && restoreFocus) (encounter ? encounterPile : pile).focus({ preventScroll: true });
}

function onTable(id: string | null) {
  return (
    !!id &&
    [state.hero, state.villain, ...state.enemyCards, ...state.inPlay, ...state.hand].some(
      (card) => card.id === id && card.id !== staged?.id,
    )
  );
}
const formFlash = element("form-flash");
const formHint = element("form-hint");

function clearFormHint() {
  for (const node of [formFlash, formHint]) {
    node.getAnimations().forEach((a) => a.cancel());
    node.hidden = true;
  }
}

let hintCardId = "";
function showPlayHint(id: string, message: string, showMask = false) {
  hintCardId = id;
  formHint.querySelector("span")!.textContent = message;
  formHint.querySelector("svg")!.style.display = showMask ? "" : "none";
  clearFormHint();
  formFlash.hidden = formHint.hidden = false;
  placeLabels();
  const reduced = reducedMotion();
  formFlash.animate([{ opacity: 0.48 }, { opacity: 0 }], { duration: reduced ? 150 : 520 }).onfinish = () => {
    formFlash.hidden = true;
  };
  const rise = reduced ? "none" : "translateY(-18px)";
  formHint.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 1, transform: rise, offset: 0.75 },
      { opacity: 0, transform: rise },
    ],
    { duration: 1500, easing: "ease-out" },
  ).onfinish = () => {
    formHint.hidden = true;
  };
}

// ── Picking cards ─────────────────────────────────────────────────────────────────────────────────────────────────
function pick(id: string) {
  if (flying || discarding || presenting || state.choice?.offers?.length) return;
  if (
    state.choice?.defense &&
    (defenseQuestionDecline(state.choice) || !state.choice.options.some((option) => option.cardId === id))
  )
    return;
  const choosingCard = state.choice?.options.some((option) => option.cardId === id);
  if (!state.payment && !choosingCard && state.encounterDiscard.some((c) => c.id === id)) {
    if (discardOpen) inspect(id);
    else setDiscardOpen(true, true);
    return;
  }
  if (state.discard.some((card) => card.id === id) && !state.payment && (discardOpen || !choosingCard)) {
    if (discardOpen) inspect(id);
    else setDiscardOpen(true, false);
    return;
  }
  if (discardOpen) return;
  inspect(id);
  if (state.payment) {
    const source = state.payment.sources.find((item) => resourcePieceId(item) === id);
    if (source) toggle(source.id);
    return;
  }
  if (state.choice) {
    if (state.choice.guard?.blocked.includes(id)) {
      sfx.play("error");
      guardHintAt = 0;
      showGuardHint(id);
      return;
    }
    const targets = state.choice.options.filter((option) => option.cardId === id);
    if (targets.length === 1) {
      sfx.play("select");
      selectChoice(targets[0]!.id);
    } else if (targets.length > 1) {
      actionCard = id;
      render();
    }
    return;
  }
  if (
    state.turn === "player" &&
    (id === state.hero.id || model.fieldActions(id).length || state.inPlay.some((c) => c.id === id && c.exhausted))
  ) {
    menuCard = menuCard === id ? null : id;
    render();
    return;
  }
  menuCard = null;
  const card = state.hand.find((item) => item.id === id);
  if (!card) return;
  element("play-refusal").hidden = true;
  if (card.requiresHeroForm) {
    sfx.play("error");
    showPlayHint(state.hero.id, "Hero form required", true);
    return;
  }
  if (!card.playable) {
    sfx.play("error");
    showPlayHint(card.id, card.reason || "This card cannot be played now.");
    return;
  }
  clearFormHint();
  stagedAttachment = model.isTargetedAttachment(card.id) ? card.id : null;
  staged = card;
  flying = true;
  sfx.play("whoosh", { gain: 0.7 });
  render();
}

function landed(id: string) {
  if (!flying || staged?.id !== id) return;
  flying = false;
  beginPlay(staged);
}

function beginPlay(card: BattleCard) {
  // A card played from the hand on its own answers no moment.
  reacting = null;
  act(() => {
    if (!model.pick(card.id)) {
      staged = null;
      sfx.play("error");
      const refusal = element("play-refusal");
      refusal.getAnimations().forEach((a) => a.cancel());
      refusal.textContent = `${card.name} · ${card.reason || "This card cannot be played now."}`;
      refusal.hidden = false;
      const fade = refusal.animate([{ opacity: 1 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: 4200 });
      fade.onfinish = () => {
        refusal.hidden = true;
      };
      return;
    }
    state = model.snapshot();
    sfx.play("play");
    if (!state.payment && !state.choice) {
      staged = null;
      say(`${card.name} played`);
    }
  });
}

function toggle(id: string) {
  if (!state.payment) return;
  sfx.play("select");
  model.toggle(id);
  render();
}

function act(work: () => void) {
  try {
    work();
  } catch (error) {
    staged = null;
    flying = false;
    toast(error instanceof Error ? error.message : "That can’t be done now.");
  } finally {
    render();
  }
}

/** Set by `cancel` for the render it makes: the beats that follow come out of a called-off payment. */
let paymentCalledOff = false;

function cancel() {
  const returned = staged?.name;
  // A reaction called off goes with its question: what it was about plays out as if passed.
  reacting = null;
  paymentCalledOff = !!state.payment;
  model.cancel();
  staged = null;
  flying = false;
  if (returned) say(`${returned} back to hand`);
  // `present` starts inside this render, so the flag lasts only for the beats the cancel itself set off.
  render();
  paymentCalledOff = false;
}

function pay() {
  const payment = state.payment;
  if (discarding || !payment?.canPay || !table) return;
  const flights = payment.discards;
  if (!model.pay()) return;
  sfx.play("confirm");
  if (flights.length) sfx.play("discard", { delay: 120 });
  // Paid: the bar folds away at once, before the hand settles back down under where it was.
  dock.setAttribute("data-idle", "");
  animateDiscards(flights, "", () => {
    // Keep a resolving event on the mat while the player chooses its target.
    staged = !payment.ability && state.choice && payment.subject.type === "event" ? payment.subject : null;
    // An event announces itself when it resolves; a card that stays on the table gets its own line.
    if (payment.subject.type !== "event") say(`${payment.subject.name} ${payment.ability ? "used" : "played"}`);
  });
}

function closeDecision() {
  decision.hidden = true;
  choiceShade.hidden = true;
  setSpot(null);
}

function animateDiscards(ids: readonly string[], message: string, onComplete: () => void) {
  if (!table) return;
  discarding = true;
  closeDecision();
  restart.disabled = true;
  undoButton.disabled = dockPrimary.disabled = dockSecondary.disabled = endTurnButton.disabled = true;
  anchors.inert = true;
  for (const button of dockOptions.querySelectorAll("button")) button.disabled = true;
  for (const id of ids) {
    preAnimated.add(id);
    const label = labels.get(id);
    if (label) label.hidden = true;
  }
  instruction.textContent = message;
  instruction.hidden = !message;
  table.animateDiscards(ids, () => {
    discarding = false;
    restart.disabled = false;
    anchors.inert = false;
    state = model.snapshot();
    onComplete();
    render();
  });
}

/** A played event whose target the player is still to pick: the choice waiting now is that event's own. */
function awaitsTarget(id: string): boolean {
  return (
    !!state.choice &&
    !state.payment &&
    state.choiceSource === id &&
    state.choice.options.some((option) => option.cardId)
  );
}

function choose(id: string | null) {
  actionCard = null;
  // An event waiting for its target goes onto the card picked first, then does its work there and leaves.
  const target = id ? state.choice?.options.find((option) => option.id === id)?.cardId : undefined;
  if (staged?.type === "event" && target && awaitsTarget(staged.id) && table && !flying) {
    const event = staged.id;
    flying = true;
    // An attack picked onto an enemy (Swinging Web Kick with a minion out) goes onto the hero like any attack, then
    // the hero strikes; it flew onto Rhino and stood there full size (Adam, 2026-11-23).
    const enemy =
      target === state.villain.id ||
      state.enemyCards.some((card) => card.id === target && (card.type === "minion" || card.type === "villain"));
    if (enemy) table.channelEvent(event);
    else table.channelEventTo(event, target);
    void sleep(reducedMotion() ? 0 : 520).then(() => {
      flying = false;
      if (staged?.id === event) resolveChoice(id);
    });
    return;
  }
  resolveChoice(id);
}

function resolveChoice(id: string | null) {
  act(() => {
    if (!model.choose(id)) return;
    state = model.snapshot();
    if (!state.payment && !state.choice) staged = null;
  });
}

/**
 * In a spend's second step the table dims as it does while paying for a card, leaving lit only the cards picked, the
 * cards that would pay a symbol still unlit, and the card asking: a card paying only what is already paid goes dark
 * and can't be picked (Adam, 2026-11-26). Null otherwise.
 */
function spendSources(): string[] | null {
  const choice = state.choice;
  if (choice?.eitherOr !== "spend") return null;
  const meter = model.spendMeter([...choicePicks]);
  if (!meter) return null;
  const lit = choice.options.flatMap((option) =>
    option.cardId && (choicePicks.has(option.id) || meter.useful.has(option.id)) ? [option.cardId] : [],
  );
  if (state.choiceSource) lit.push(state.choiceSource);
  return lit;
}

function selectChoice(id: string) {
  actionCard = null;
  const choice = state.choice;
  if (discarding || !choice) return;
  // A card from a search is only picked here; the bar's Confirm takes it, so it can be read first (`paintDockCards`).
  const cardId = choice.options.find((option) => option.id === id)?.cardId;
  if (choice.max <= 1 && choice.searched?.some((found) => found.id === cardId)) {
    searchPick = { choice: choice.id, option: id };
    render();
    return;
  }
  if (!choice.discardFromHand && !choice.mulligan && choice.max <= 1) {
    choose(id);
    return;
  }
  // A spend takes only a card that pays a symbol still unlit: one more would be spent for nothing (Sonic Boom took six
  // for three; Adam, 2026-11-26).
  const meter = choice.eitherOr === "spend" ? model.spendMeter([...choicePicks]) : null;
  if (!choicePicks.delete(id) && choicePicks.size < choice.max) {
    if (meter && !meter.useful.has(id)) sfx.play("error");
    else choicePicks.add(id);
  }
  render();
}

function confirmChoice() {
  const choice = state.choice;
  const picks = [...choicePicks];
  if (discarding || !choice || !model.chooseMany(picks)) return;
  // A spend paid: its colours and glow come off the cards straight away, not when the phase is over.
  if (choice.eitherOr === "spend") table?.clearSpendMarks();
  const discarded =
    choice.discardFromHand || choice.mulligan
      ? picks.map((id) => choice.options.find((option) => option.id === id)?.cardId ?? id)
      : [];
  choicePicks.clear();
  animateDiscards(discarded, choice.mulligan ? "Swapping cards…" : "Discarding cards…", () => {
    if (choice.mulligan) say(picks.length ? `Swapped ${plural(picks.length, "card")}` : "Hand kept");
  });
}

function endTurn() {
  if (!state.canEndTurn) return;
  sfx.play("confirm");
  act(() => {
    model.endTurn();
  });
}

// ── Nameplates ────────────────────────────────────────────────────────────────────────────────────────────────────
function hpPill(hp: number): HTMLElement {
  const pill = make("span", "stat-pill");
  pill.dataset.kind = "hp";
  pill.append(icon("heart"), make("b", "", String(hp)));
  pill.toggleAttribute("data-low", hp <= 3);
  return pill;
}

/** A guard minion's shield on its plate: while it is engaged, the villain can't be attacked. */
function guardPill(): HTMLElement {
  const pill = make("span", "stat-pill");
  pill.dataset.kind = "guard";
  pill.title = "Guard: while this minion is engaged with you, you can't attack the villain";
  pill.append(icon("guard"));
  return pill;
}

/** Why the villain can't be attacked during a guard pick, in a few words: "Hydra Mercenary has Guard". */
function guardReason(): string {
  const names = (state.choice?.guard?.guards ?? []).map(nameOf);
  const villain = nameOf(state.choice?.guard?.blocked[0] ?? null) || "The villain";
  if (!names.length) return "";
  const who = names.length === 1 ? `${names[0]} has` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} have`;
  return `Can't attack ${villain}: ${who} Guard`;
}

/**
 * The player points at or clicks the villain while guard keeps it out of reach: "Guard" stamped, with its shield, on
 * the minion(s) stopping it (Adam, 2026-11-25: "it says guard over the thing with guard is enough"; no words over the
 * villain). Pointing holds the stamps until the pointer leaves him ("that should stay there while hovered over the
 * card"); a click or a tap stamps them a moment.
 */
let guardHeld: HTMLElement[] = [];
let guardHintAt = 0;
function showGuardHint(villain: string, held = false) {
  const guard = state.choice?.guard;
  if (!guard?.blocked.includes(villain)) return;
  if (!held) {
    // Already held over the minions: they stay as they are.
    if (guardHeld.some((node) => node.isConnected)) return;
    const now = performance.now();
    if (now - guardHintAt < 900) return;
    guardHintAt = now;
    for (const id of guard.guards) stampCard(id, "Guard", "guard");
    return;
  }
  dropGuardHint();
  const anchors = table?.anchors() ?? [];
  for (const id of guard.guards) {
    const anchor = anchors.find((point) => point.id === id);
    if (!anchor) continue;
    const node = make("div", "card-stamp", "Guard");
    node.dataset.tone = "guard";
    node.dataset.card = id;
    node.prepend(icon("guard"));
    node.style.left = anchor.x + "px";
    node.style.top = anchor.y + "px";
    node.style.setProperty("--float-size", Math.round(Math.min(78, Math.max(40, anchor.width * 0.62))) + "px");
    stage.append(node);
    guardHeld.push(node);
    if (!reducedMotion())
      node.animate(
        [
          { transform: "scale(2.4)", opacity: 0 },
          { transform: "scale(.92)", opacity: 1, offset: 0.6 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 300, easing: "cubic-bezier(.2,.8,.3,1)" },
      );
  }
}

/** The held stamps go once the pointer leaves the villain, or the question they explain is over. */
function dropGuardHint() {
  for (const node of guardHeld) node.remove();
  guardHeld = [];
}

/** Guard minions already called out: each is stamped "Guard" once as it comes onto the table. */
const guardsCalled = new Set<string>();
function announceGuards() {
  if (presenting || flying) return;
  const placed = new Set(table?.anchors().map((anchor) => anchor.id) ?? []);
  const now = state.enemyCards.filter((card) => card.guard).map((card) => card.id);
  for (const id of [...guardsCalled]) if (!now.includes(id)) guardsCalled.delete(id);
  for (const id of now) {
    if (guardsCalled.has(id) || !placed.has(id)) continue;
    guardsCalled.add(id);
    stampCard(id, "Guard", "guard");
  }
}

function threatPill(count: number, target: number | null, lock?: string): HTMLElement {
  const pill = make("span", "stat-pill scheme-threat");
  pill.dataset.kind = "threat";
  if (target != null) pill.dataset.target = String(target);
  pill.append(icon("threat"), make("b", "", ""));
  if (target != null) pill.append(make("i", "", `/${target}`));
  // Threat the player can't remove (Countdown to Oblivion; the main scheme under a crisis icon) wears a lock.
  if (lock) {
    pill.dataset.locked = "";
    pill.title = lock;
    pill.append(icon("lock", lock));
  }
  updateThreatLabel(pill, count);
  return pill;
}

function tick(pill: Element) {
  pill.classList.remove("ticked");
  void (pill as HTMLElement).offsetWidth;
  pill.classList.add("ticked");
}

function updateThreatLabel(counter: HTMLElement, count: number) {
  const changed = counter.dataset.count !== undefined && counter.dataset.count !== String(count);
  counter.dataset.count = String(count);
  counter.querySelector("b")!.textContent = String(count);
  const target = Number(counter.dataset.target);
  counter.toggleAttribute("data-near-limit", !!target && count > 0 && count >= target - Math.ceil(target / 4));
  if (changed) tick(counter);
}

function updateHpLabel(label: HTMLButtonElement | undefined, hp: number) {
  if (!label?.dataset.hp) return;
  const previous = label.dataset.hp;
  label.dataset.hp = String(hp);
  const pill = label.querySelector<HTMLElement>('.stat-pill[data-kind="hp"]');
  if (pill) {
    pill.querySelector("b")!.textContent = String(hp);
    pill.toggleAttribute("data-low", hp <= 3);
    if (previous !== String(hp)) tick(pill);
  }
  const description = label.getAttribute("aria-description");
  if (description) label.setAttribute("aria-description", description.replace(`${previous} HP`, `${hp} HP`));
}

function showOutcome(outcome: Snapshot["outcome"]) {
  if (!outcome) {
    if (gameOver.open) gameOver.close();
    return;
  }
  const won = outcome.result === "win";
  let detail = won ? `You defeated ${state.villain.name}.` : "The battle has ended.";
  if (outcome.reason === "mainSchemeCompleted") {
    const scheme = state.enemyCards.find((card) => card.type === "main_scheme");
    detail =
      scheme?.threatTarget != null
        ? `${scheme.name} reached ${scheme.threat} / ${scheme.threatTarget} threat.`
        : "The main scheme reached its threat limit.";
  } else if (outcome.reason === "allPlayersDefeated") {
    detail = `${state.hero.name} was defeated.`;
  }
  // Victory shows the villain stamped out; a loss shows whatever ended the game.
  const scheme = state.enemyCards.find((card) => card.type === "main_scheme");
  const schemeLoss = outcome.reason === "mainSchemeCompleted" && !!scheme;
  const featured = won ? state.villain : schemeLoss ? scheme : state.hero;
  const art = element<HTMLImageElement>("game-over-art");
  const figure = art.closest("figure")!;
  figure.hidden = !featured.art;
  if (featured.art && pictureOf(art.getAttribute("src") ?? "") !== featured.art) art.src = featured.art;
  figure.toggleAttribute("data-landscape", schemeLoss);
  element("game-over-stamp").textContent = won
    ? "Defeated"
    : schemeLoss
      ? "Scheme complete"
      : outcome.reason === "allPlayersDefeated"
        ? "Knocked out"
        : "Defeat";
  element("game-over-kicker").textContent = `${state.hero.name} vs. ${state.villain.name}`;
  // The test site keeps the player's record (test-site/player.ts): this ending, once.
  void finishGame(gameSaved, {
    result: outcome.result === "win" ? "win" : "loss",
    reason: outcome.reason,
    rounds: state.round,
    hero: "Spider-Man",
    deck: ["core-spider-man-justice"],
  });
  element("game-over-title").textContent = won ? "Victory" : "Defeat";
  element("game-over-detail").textContent = detail;
  gameOver.toggleAttribute("data-victory", won);
  gameOverUndo.hidden = !model.canUndo;
  tryAgain.replaceChildren(icon("mulligan"), make("span", "", won ? "Play again" : "Try again"));
  // Never over the campaign shelf: the dialog would sit on top of it with the page underneath untouchable.
  if (!gameOver.open && !shelfUp) {
    if (gameMenu.open) gameMenu.close();
    if (won) throwConfetti();
    sfx.play(won ? "win" : "lose");
    gameOver.showModal();
  }
}

function shakeStage(strength: "light" | "heavy") {
  delete stage.dataset.shake;
  // Restart the animation when two hits land close together.
  void stage.offsetWidth;
  stage.dataset.shake = strength;
  clearTimeout(shakeTimer);
  // Children's animations bubble animationend, so clear on a timer that outlasts the shake and flash.
  shakeTimer = setTimeout(() => delete stage.dataset.shake, 500);
}
let shakeTimer: ReturnType<typeof setTimeout> | undefined;

const CONFETTI = ["#f6c564", "#ff5a4e", "#4fb3ff", "#ffffff", "#7be08f", "#c77dff"];

/**
 * The sounds of cards drawn off the deck: each lifts off 120 ms in, then every 180 ms (`draw`, its marker on the
 * take-off), and lands in the hand about 400 ms later (`draw-land`, its marker on the landing; Adam, 2026-11-24:
 * "a sound where they arrive in the hand").
 */
function playDrawSounds(count: number) {
  for (let i = 0; i < count; i++) {
    sfx.play("draw", { contactIn: 120 + i * 180 });
    sfx.play("draw-land", { contactIn: DRAW_LANDS_MS + i * 180 });
  }
}
/** When a drawn card settles in the hand, from the start of its flight (table.ts, a 560 ms draw that lands at 0.9). */
const DRAW_LANDS_MS = 505;

function throwConfetti() {
  const host = element("outcome-confetti");
  host.replaceChildren();
  if (reducedMotion()) return;
  for (let i = 0; i < 110; i++) {
    const bit = make("i", "confetti-bit");
    // Shot out from the middle, from behind the panel, in every direction but mostly upward (Adam, 2026-11-23).
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
    const reach = 22 + Math.random() * 34;
    bit.style.setProperty("--bx", Math.cos(angle) * reach * 1.25 + "vmin");
    bit.style.setProperty("--by", Math.sin(angle) * reach + "vmin");
    bit.style.setProperty("--drift", (Math.random() - 0.5) * 160 + "px");
    bit.style.setProperty("--spin", (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720) + "deg");
    bit.style.setProperty("--delay", (i < 70 ? Math.random() * 0.15 : 0.35 + Math.random() * 0.25) + "s");
    bit.style.setProperty("--fall", 2.4 + Math.random() * 1.4 + "s");
    bit.style.setProperty("--size", 6 + Math.random() * 7 + "px");
    bit.style.background = CONFETTI[i % CONFETTI.length]!;
    if (i % 3 === 0) bit.style.borderRadius = "50%";
    host.append(bit);
  }
}

/**
 * Dev and tests only: once a move's beats have all played, every health and threat number on the table must already
 * read what the game says. A number that only comes right when the table redraws afterwards was wrong on screen while
 * the beats played (the Ultron report of 2026-11-25: 8/10 shown, 5/10 real). Logged as "[table drift]", which fails
 * every 3D table browser test (`e2e/battle-test.ts`).
 */
function checkShownNumbers() {
  if (!import.meta.env.DEV || discardOpen || studioPlaying) return;
  const wrong: string[] = [];
  for (const card of [state.hero, state.villain, ...state.enemyCards, ...state.inPlay]) {
    const label = labels.get(card.id);
    if (!label?.isConnected) continue;
    const pill = label.querySelector<HTMLElement>(".scheme-threat");
    if (pill && card.threat !== null && Number(pill.dataset.count) !== card.threat)
      wrong.push(`${card.name} shows ${pill.dataset.count} threat, the game has ${card.threat}`);
    const hp = card.id === state.hero.id ? state.heroHp : card.id === state.villain.id ? state.villainHp : card.hp;
    if (label.dataset.hp !== undefined && hp !== undefined && Number(label.dataset.hp) !== hp)
      wrong.push(`${card.name} shows ${label.dataset.hp} HP, the game has ${hp}`);
  }
  if (wrong.length) console.error(`[table drift] ${wrong.join("; ")}`);
}

function synchronizeLabels() {
  const visible = discardOpen
    ? viewedPile()
    : [state.hero, state.villain, ...state.enemyCards, ...displayedHand, ...state.inPlay];
  const places = cardPlaces(state.choice, choicePicks);
  for (const [id, label] of labels) {
    if (!visible.some((c) => c.id === id)) {
      label.remove();
      labels.delete(id);
    }
  }
  for (const card of visible) {
    let label = labels.get(card.id);
    if (!label) {
      label = make("button", "anchor");
      label.type = "button";
      label.dataset.card = card.id;
      label.onclick = () => pick(card.id);
      label.onfocus = () => {
        hoverCard(card.id);
        table?.setHovered(card.id);
      };
      label.onblur = () => {
        hoverCard(null);
        table?.setHovered(null);
      };
      label.onpointerenter = () => hoverCard(card.id);
      label.onpointerleave = () => hoverCard(null);
      labels.set(card.id, label);
    }
    const source = state.payment?.sources.find((s) => resourcePieceId(s) === card.id);
    const target = defenseQuestionDecline(state.choice)
      ? undefined
      : state.choice?.options.find((option) => option.cardId === card.id);
    const handPick = !!(state.choice?.discardFromHand || state.choice?.mulligan) && !!target;
    label.disabled = (!!state.payment && !source?.available) || (!!state.choice?.defense && !target);
    label.toggleAttribute("data-target", !!target);
    // Paying: a badge on a card that isn't paying dims with the table, like its card.
    label.toggleAttribute("data-dimmed", !!state.payment && !source && !displayedHand.some((c) => c.id === card.id));
    label.toggleAttribute(
      "data-tucked",
      ((isTuckedUpgrade(card) && state.inPlay.some((c) => c.id === card.id)) ||
        (!!card.attachedTo && state.enemyCards.some((c) => c.id === card.id))) &&
        !discardOpen &&
        !source &&
        !target,
    );
    label.dataset.spent = String(!!source?.selected);
    const picked = handPick && choicePicks.has(target!.id);
    // An ordered question (Masters of Mayhem's "Order the enemies"): the plate says each pick's place, and the card
    // itself wears it as a number (`placeOrderBadges`).
    const ordering =
      !!state.choice?.ordered &&
      !!target &&
      !handPick &&
      state.choice.options.filter((option) => option.cardId === card.id).length === 1;
    const place = ordering ? places.get(card.id) : undefined;
    if (source || handPick) label.setAttribute("aria-pressed", String(source?.selected ?? picked));
    else if (ordering) label.setAttribute("aria-pressed", String(place !== undefined));
    else label.removeAttribute("aria-pressed");
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    // While a move's beats are still playing, a card keeps the health it shows, as a scheme keeps its threat (below):
    // the snapshot already holds the damage the hits still to come will take off one by one.
    const shownHp = stage.dataset.resolving && label.dataset.hp !== undefined ? Number(label.dataset.hp) : undefined;
    const finalHp = hero ? state.heroHp : enemy ? state.villainHp : card.hp;
    const hp = finalHp !== undefined && shownHp !== undefined ? shownHp : finalHp;
    const inHand = !discardOpen && displayedHand.some((item) => item.id === card.id);
    label.className =
      "anchor" + (discardOpen ? " discard-card" : hero ? " identity" : enemy ? " enemy" : inHand ? " in-hand" : "");
    const layer = discardOpen ? discardFan : inHand ? anchors : boardLabels;
    const description = card.markers.map((m) => `${m.name} ×${m.count}`);
    if (hp !== undefined && !inHand) {
      if (card.exhausted) description.unshift("Exhausted");
      description.unshift(`${hp} HP`);
    }
    if (description.length && layer === boardLabels) label.setAttribute("aria-description", description.join(", "));
    else label.removeAttribute("aria-description");
    if (label.parentElement !== layer) layer.append(label);
    // While a move's beats are still playing, a scheme keeps the threat it shows: the snapshot already holds the threat
    // the beats still to come will add one by one. A Drone arriving mid-way (Ultron) redraws every label, and the
    // threat landing after it was counted twice, 8/10 showing until the move ended at the true 4/10 (a player's
    // report, 2026-11-25).
    // A scheme arriving mid-move has no count yet: it starts from what it had before the threat still to come.
    const shownThreat = stage.dataset.resolving
      ? (label.querySelector<HTMLElement>(".scheme-threat")?.dataset.count ?? threatOnArrival(card).threat ?? undefined)
      : undefined;
    label.replaceChildren();
    // Characters and schemes wear a nameplate; a support or upgrade only does while a question involves it.
    const plated = hp !== undefined || card.threat !== null || !!source || !!target;
    if (inHand || !plated) {
      if (picked) {
        const mulligan = !!state.choice?.mulligan;
        const chip = make("span", "pick-chip");
        chip.append(icon(mulligan ? "mulligan" : "discard"), make("span", "", mulligan ? "Swap" : "Discard"));
        label.append(chip);
      }
    } else {
      // A pick's plate is just the health, threat or shield: the card shows who it is and the dock asks the question
      // (Adam, 2026-11-22: "All the player needs is their health"; 2026-11-25, of whom to attack: "the heart and the
      // guard symbol are enough"). Only a card with nothing else to show (a support, an upgrade) is named.
      if ((source || target) && !handPick && !state.choice?.defense && hp === undefined && card.threat === null)
        label.append(make("span", "plate-name", card.name));
      if (!discardOpen && hp !== undefined) label.append(hpPill(hp));
      if (!discardOpen && card.guard) label.append(guardPill());
    }
    // Picking whom to attack while guard keeps the villain out of reach: the guard minion's shield pulses.
    label.toggleAttribute("data-guarding", !!state.choice?.guard?.guards.includes(card.id));
    // The villain guard protects stays pointable during that pick, to say why it can't be chosen.
    if (state.choice?.guard?.blocked.includes(card.id)) label.setAttribute("aria-description", guardReason());
    if (hp === undefined || discardOpen || inHand) delete label.dataset.hp;
    else label.dataset.hp = String(hp);
    if (card.threat !== null && onTable(card.id))
      label.append(
        threatPill(shownThreat !== undefined ? Number(shownThreat) : card.threat, card.threatTarget, card.threatLock),
      );
    if (
      !inHand &&
      target &&
      !handPick &&
      !state.choice?.offers?.length &&
      !state.choice?.defense &&
      !state.choice?.spend &&
      target.label !== card.name &&
      !target.label.startsWith(card.name + " (")
    )
      label.append(make("span", "resource-value", target.label));
    // A hand card prints its resources in its own corner; only an ability (Peter Parker's Scientist, Web-Shooter)
    // needs the symbol of what it generates spelled out.
    if (source && source.kind === "resourceAbility") {
      const value = make("span", "resource-value");
      value.append(resourcePips(source.icons));
      label.append(value);
    }
    label.setAttribute(
      "aria-label",
      discardOpen
        ? `Inspect ${card.name}`
        : target
          ? `${handPick ? (state.choice?.mulligan ? "Swap" : "Discard") : "Choose"} ${card.name}${place !== undefined ? `, ${ordinal(place)}` : ""}`
          : source
            ? `${source.selected ? "Remove" : "Spend"} ${card.name}, ${resourceText(source.icons)}`
            : card.playable
              ? `Play ${card.name}, cost ${card.cost}`
              : `Inspect ${card.name}`,
    );
  }
}

/** The place a pick stands in an ordered question, as a gold number on its card's plate or its button. */
function orderBadge(place: number, hidden = true) {
  const badge = make("span", "pick-order", String(place));
  if (hidden) badge.setAttribute("aria-hidden", "true");
  return badge;
}

/** 1st, 2nd, 3rd, 4th…: said with a card's name while an ordered question numbers it. */
function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Plates the last question made pickable (gold "Choose" plates) go back to plain ones while the answer plays out. */
function unmarkPicks() {
  for (const label of labels.values()) {
    if (!label.hasAttribute("data-target")) continue;
    label.removeAttribute("data-target");
    label.disabled = false;
    label.querySelectorAll(".plate-name, .resource-value").forEach((part) => part.remove());
  }
  for (const label of labels.values()) label.removeAttribute("data-lit");
}

function updateOutlines(group: SVGGElement, ids: readonly string[], tones?: readonly GlowTone[]) {
  while (group.childElementCount > ids.length) group.lastElementChild!.remove();
  ids.forEach((id, i) => {
    const polygon =
      group.children[i] ?? group.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polygon"));
    polygon.setAttribute("points", table!.cardOutline(id).join(" "));
    const tone = tones?.[i];
    if (tone && tone !== "ability") polygon.setAttribute("data-tone", tone);
    else polygon.removeAttribute("data-tone");
  });
}

/** Holes in the shade over these cards' nameplates, so their health reads at full brightness (`Spot.plates`). */
/** In the table's own coordinates, like the card outlines: a plate is centred under its card (`placeLabels`). */
function updatePlateCutouts(ids: readonly string[], projected: ReturnType<BattleTable["anchors"]>) {
  // A plate that can't be pressed during the question (a hero who isn't a pick yet) fades; these stay at full strength.
  for (const [id, label] of labels) label.toggleAttribute("data-lit", ids.includes(id));
  const boxes = ids.flatMap((id) => {
    const label = labels.get(id);
    const anchor = projected.find((point) => point.id === id);
    if (!anchor || !label?.isConnected || label.parentElement !== boardLabels || !label.childElementCount) return [];
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const shift = plateShifts.get(id);
    return width && height
      ? [
          {
            left: anchor.x + (shift?.dx ?? 0) - width / 2,
            top: anchor.bottom + PLATE_DROP + (shift?.dy ?? 0),
            width,
            height,
          },
        ]
      : [];
  });
  while (plateCutouts.childElementCount > boxes.length) plateCutouts.lastElementChild!.remove();
  boxes.forEach((box, i) => {
    const rect =
      plateCutouts.children[i] ??
      plateCutouts.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "rect"));
    const pad = 3;
    rect.setAttribute("x", String(Math.round(box.left - pad)));
    rect.setAttribute("y", String(Math.round(box.top - pad)));
    rect.setAttribute("width", String(Math.round(box.width + pad * 2)));
    rect.setAttribute("height", String(Math.round(box.height + pad * 2)));
    rect.setAttribute("rx", String(Math.round(box.height / 2 + pad)));
  });
}

/** Threat stopped at a scheme becomes a damage token there, then flies across to the hero who takes it. */
async function convertThreat(scheme: string, target: string, amount: number) {
  const projected = table?.anchors();
  const from = projected?.find((a) => a.id === scheme);
  const to = projected?.find((a) => a.id === target);
  if (!from || !to || reducedMotion()) return;
  const token = make("div", "convert-token");
  token.append(icon("threat"), make("b", "", String(amount)));
  token.style.left = from.x + "px";
  token.style.top = from.y + "px";
  stage.append(token);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Appears as threat on the scheme, turns red, then arcs over to the hero.
  const appear = token.animate(
    [
      { transform: "scale(.3)", opacity: 0 },
      { transform: "scale(1.15)", opacity: 1, offset: 0.6 },
      { transform: "scale(1)", opacity: 1 },
    ],
    { duration: 320, easing: "ease-out" },
  );
  await appear.finished;
  await sleep(160);
  token.dataset.kind = "damage";
  token.replaceChildren(icon("damage"), make("b", "", String(amount)));
  await sleep(260);
  sfx.play("whoosh");
  const fly = token.animate(
    [
      { transform: "translate(0, 0) scale(1)" },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 70}px) scale(1.1)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.85)` },
    ],
    { duration: 520, easing: "cubic-bezier(.45,0,.55,1)", fill: "forwards" },
  );
  await fly.finished;
  token.remove();
}

/** A When Revealed firing: the card rises with a flash, and the dock says what is happening. */
async function whenRevealedFires(
  beat: Beat,
  card: { id: string; name: string; applies?: Applies | undefined; noHeroes?: true | undefined },
  eyebrow = "When Revealed",
) {
  table?.activateWhenRevealed(card.id);
  sfx.play("ability");
  if (card.noHeroes) {
    // It fires, but on no one: say so, or the flash looks like something went missing (Adam, 2026-11-22: Shocker).
    // Stamped on the card itself, because on a wide screen the bar stays folded while the villain side plays.
    stampCard(card.id, "No heroes to hit", "status");
    narrate(
      beat,
      { text: `${card.name}: no heroes to hit`, icon: "forced", tone: "villain" },
      {
        eyebrow: { text: eyebrow, icon: "forced", tone: "villain" },
        title: `${card.name}: no heroes to hit`,
        help: "You're in alter-ego form, so nobody takes damage.",
      },
    );
    await sleep(Math.max(ACTIVATION_MS, 1100));
    return;
  }
  narrate(beat, card.applies ? { text: `${card.name}: ${card.applies.text}`, icon: "forced", tone: "villain" } : null, {
    eyebrow: {
      text: card.applies ? `${eyebrow} (${card.applies.form})` : eyebrow,
      icon: "forced",
      tone: "villain",
    },
    title: card.applies ? `${card.name}: ${card.applies.text}` : card.name,
  });
  await sleep(ACTIVATION_MS);
}

type Applies = NonNullable<NonNullable<Beat["reveal"]>["applies"]>;

/** What the card being read will do, in the turn bar under its name: the half of it that matches the hero's form. */
function appliesHelp(reveal: Beat["reveal"]): string | null {
  const applies = reveal?.applies;
  if (!applies) return null;
  return `You're in ${applies.form === "Hero" ? "hero" : "alter-ego"} form: ${applies.text}`;
}

/**
 * An effect picks cards from the hand at random (Highway Robbery, Eviction Notice): a light hops from card to card,
 * slowing down, and stops on the ones the game picked, which stay lit while `stamp` says where they go. The game
 * has already picked them: this only shows the pick being made, it never picks.
 */
async function pickFromHandAtRandom(beat: Beat, ids: readonly string[], stamp: string) {
  if (!table) return;
  narrate(beat, feedLineOf(beat), {
    eyebrow: { text: "At random", icon: "forced", tone: "villain" },
    title: ids.length > 1 ? `Picking ${ids.length} cards from your hand` : "Picking a card from your hand",
  });
  const pool = displayedHand.map((card) => card.id);
  if (!reducedMotion() && pool.length > ids.length) {
    const hops = 7 + Math.min(4, pool.length);
    let last = "";
    for (let hop = 0; hop < hops; hop++) {
      const choices = pool.filter((id) => id !== last);
      last = choices[Math.floor(Math.random() * choices.length)]!;
      table.spotlightHand([last]);
      await sleep(70 + 230 * (hop / hops) ** 2);
    }
  }
  table.spotlightHand(ids);
  for (const id of ids) stampCard(id, stamp, "surge");
  await sleep(reducedMotion() ? 500 : 900);
}

/** A revealed card held up at full size, the table soft around it, until the player has read it and pressed Continue. */
async function waitToBeRead(beat: Beat, reveal: NonNullable<Beat["reveal"]>) {
  readReveal.setAttribute("aria-label", `Continue after reading ${reveal.name}`);
  readReveal.hidden = false;
  // Known before the bar asks, so its Continue leaves the table where it is.
  revealFocus = reveal.id;
  narrate(beat, null, {
    eyebrow: { text: revealedBy(reveal), icon: "forced", tone: "villain" },
    title: reveal.name,
    help: appliesHelp(reveal),
    primary: { label: "Continue", icon: "next", attention: true, onClick: () => readReveal.click() },
  });
  readReveal.focus({ preventScroll: true });
  table?.holdReveal(true);
  // The table goes soft around the revealed card while it waits to be read.
  focusBlur.hidden = false;
  placeLabels();
  requestAnimationFrame(() => (focusBlur.dataset.ready = ""));
  await new Promise<void>((resolve) => readReveal.addEventListener("click", () => resolve(), { once: true }));
  table?.holdReveal(false);
  revealFocus = null;
  delete focusBlur.dataset.ready;
  focusBlur.hidden = !handQuestion();
  focusBlur.style.clipPath = "";
  revealHint.hidden = readReveal.hidden = true;
  narrate(beat, null);
}

/** How a revealed card is introduced: dealt and turned over, or brought in by another card (your nemesis, by Shadow). */
function revealedBy(reveal: NonNullable<Beat["reveal"]>): string {
  if (!reveal.broughtBy) return "Revealed";
  return reveal.nemesis ? `${reveal.broughtBy} brings in your nemesis` : `${reveal.broughtBy} brings in`;
}

/**
 * A revealed encounter card that is done being read leaves the middle of the table. One that stays in play lands in
 * its place. A treachery whose effect still has something to show (the attack Assault calls, a question it asks, the
 * card its surge deals) stands aside by the villain until its own beat in `upcoming` sends it to the discard pile
 * (RRG 1.8: a treachery is discarded once its When Revealed has resolved). One with nothing left goes there now.
 */
function leaveEncounter(id: string, upcoming: readonly Beat[]): "landed" | "parked" | "retired" {
  const permanent = state.enemyCards.find((c) => c.id === id);
  if (permanent) {
    table?.landEncounter(threatOnArrival(permanent));
    return "landed";
  }
  const leaves = upcoming.findIndex((beat) => beat.encounterResolved === id);
  const discarded = state.encounterDiscard.some((c) => c.id === id);
  // An obligation answered in the turn bar leaves on a beat of its own too, once its answer has played out: to the
  // encounter discard pile, or off the table when it is removed from the game (Eviction Notice).
  const leavesPlay = upcoming.some((beat) => beat.leftPlay === id);
  if (leavesPlay || leaves > 0 || (leaves < 0 && !discarded)) {
    table?.parkEncounter(id);
    return "parked";
  }
  table?.retireEncounter(
    id,
    state.encounterDiscard.find((c) => c.id === id),
  );
  return "retired";
}

/**
 * Cards discarded off the top of the player's deck are seen going: the card whose ability does it fires first (Black
 * Cat's Forced Response), the cards turn up off the deck into a row, the ones its effect keeps (a printed [mental]
 * resource, for Black Cat) rise and glow, and the rest go to the discard pile. The kept ones go to the hand on the
 * `returned` beat that follows.
 */
async function revealMilled(beat: Beat, next: Beat | undefined) {
  const milled = beat.milled!;
  const source = beat.millSource;
  if (source && table?.anchors().some((point) => point.id === source.card)) {
    narrate(beat, null, {
      eyebrow: { text: source.label, icon: "response", tone: "hero" },
      title: nameOf(source.card),
    });
    // Just played (Black Cat): it lands in its place first, then shines as its ability starts. A card already in play
    // fires the way any ability on the table does.
    if (table.landStaged(source.card)) {
      await sleep(reducedMotion() ? 150 : 620);
      table.shinePlayed(source.card);
      sfx.play("ability");
      await sleep(reducedMotion() ? 200 : SHINE_MS);
    } else {
      table.activateWhenRevealed(source.card);
      await sleep(ACTIVATION_MS);
    }
  }
  narrate(beat, feedLineOf(beat));
  const cards = milled.flatMap((id) => {
    const card = state.discard.find((c) => c.id === id) ?? state.hand.find((c) => c.id === id);
    return card ? [card] : [];
  });
  deckCount.textContent = String(Math.max(0, Number(deckCount.textContent) - milled.length));
  if (!table || !cards.length) {
    await sleep(700);
    return;
  }
  // The table goes soft around the cards as they come off the deck, so the eye follows them and nothing else.
  rowFocus = cards.map((card) => card.id);
  focusBlur.dataset.row = "";
  focusBlur.hidden = false;
  table.revealFromDeck(cards);
  cards.forEach((_, i) => sfx.play("flip", { delay: i * 180, gain: 0.8 }));
  placeLabels();
  // Laid out once hidden-at-0 first, so the fade-in runs from the same moment the first card lifts.
  void focusBlur.offsetWidth;
  focusBlur.dataset.ready = "";
  await sleep(reducedMotion() ? 300 : 560 + (cards.length - 1) * 180 + 650);
  const kept = next?.returned?.filter((id) => milled.includes(id)) ?? [];
  if (kept.length) {
    table.pickFromReveal(kept);
    sfx.play("draw");
    for (const id of kept) stampCard(id, "To hand", "boost");
    await sleep(reducedMotion() ? 300 : 900);
  } else if (source?.miss) {
    // None of them is one the effect keeps: say so over the row, so the hand staying as it is reads as nothing found.
    narrate(beat, feedLineOf(beat), {
      eyebrow: { text: nameOf(source.card) || source.label, icon: "response", tone: "hero" },
      title: source.miss,
    });
    stampRow(rowFocus, source.miss);
    await sleep(reducedMotion() ? 500 : 1200);
  }
  const going = milled.filter((id) => !kept.includes(id));
  if (going.length) {
    table.discardFromReveal(going);
    sfx.play("discard");
    await sleep(reducedMotion() ? 200 : 520);
  }
  // The blur fades with the cards still cut out of it, then goes.
  delete focusBlur.dataset.ready;
  await sleep(reducedMotion() ? 0 : 320);
  rowFocus = [];
  delete focusBlur.dataset.row;
  focusBlur.hidden = !handQuestion() && !revealFocus && !dockFocus;
  focusBlur.style.maskImage = focusBlur.style.webkitMaskImage = "";
  // A dock question still waiting keeps its own blur.
  if (dockFocus) focusBlur.dataset.ready = "";
}

/**
 * A question about the hand (the mulligan, the end-of-turn discard): the table softens above the hand while it is
 * answered (Adam, 2026-11-23: the discard should blur like the mulligan).
 */
function handQuestion(): boolean {
  return !!(state.choice?.mulligan || state.choice?.discardFromHand);
}

/** A word stamped across the middle of a row of cards ("No mental resources" over Black Cat's discards). */
function stampRow(ids: readonly string[], text: string) {
  const row = table?.anchors().filter((point) => ids.includes(point.id)) ?? [];
  if (!row.length) return;
  const node = make("div", "card-stamp", text);
  node.dataset.tone = "status";
  node.style.left = row.reduce((sum, point) => sum + point.x, 0) / row.length + "px";
  node.style.top = row.reduce((sum, point) => sum + point.y, 0) / row.length + "px";
  stage.append(node);
  floats.add(node);
  const animation = node.animate(
    reducedMotion()
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
      : [
          { transform: "scale(2.4)", opacity: 0 },
          { transform: "scale(.92)", opacity: 1, offset: 0.12 },
          { transform: "scale(1)", opacity: 1, offset: 0.2 },
          { transform: "scale(1)", opacity: 1, offset: 0.85 },
          { transform: "scale(1.05)", opacity: 0 },
        ],
    { duration: 1500, easing: "cubic-bezier(.2,.8,.3,1)" },
  );
  animation.onfinish = () => {
    node.remove();
    floats.delete(node);
  };
}

/** The attack target fades off once its attack is over. */
function clearAim() {
  if (!aimTarget && reticle.hidden) return;
  aimTarget = null;
  if (reticle.hidden || reducedMotion()) {
    reticle.hidden = true;
    return;
  }
  const fade = reticle.animate([{ opacity: 1 }, { opacity: 0, transform: "scale(0.7)" }], {
    duration: 220,
    easing: "ease-in",
    fill: "forwards",
  });
  fade.onfinish = () => {
    if (!aimTarget) reticle.hidden = true;
    fade.cancel();
  };
}

/** The attack target flies from the attacker onto its target. */
function aimFrom(from: { x: number; y: number } | undefined, to: { x: number; y: number } | undefined) {
  if (!from || !to || reducedMotion()) return;
  reticle.animate(
    [
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(1.45)`, opacity: 0.25 },
      { transform: "translate(0,0) scale(1)", opacity: 1 },
    ],
    { duration: 380, easing: "cubic-bezier(.2,.7,.2,1)" },
  );
}

/** Darken the table around the cards that matter now, or (null) lift the shade. */
/** `fade`: the darkening comes in slowly instead of at once, if the table isn't darkened already. */
function setSpot(next: Spot | null, { fade = false } = {}) {
  const was = spot;
  spot = next?.cutouts.length ? next : null;
  // Set before the shade shows, so its fade plays from the start; kept while it stays up, so it never cuts short.
  if (!was) for (const layer of [defenseShade, abilityGlow]) layer.classList.toggle("fade-in", fade && !!spot);
  defenseShade.toggleAttribute("hidden", !spot);
  if (!spot?.plates) {
    plateCutouts.replaceChildren();
    for (const label of labels.values()) label.removeAttribute("data-lit");
  }
  abilityGlow.toggleAttribute("hidden", !spot?.glow.length);
  const mark = spot?.mark ?? null;
  pendingMark.hidden = !mark;
  const key = mark ? `${mark.kind}|${mark.amount}` : "";
  if (mark && key !== markKey) {
    pendingMark.dataset.kind = mark.kind;
    pendingMark.replaceChildren(
      icon(mark.kind),
      make("b", "", `${mark.kind === "threat" ? "+" : mark.kind === "thwart" ? "−" : ""}${mark.amount}`),
    );
  }
  markKey = key;
}

function tagBoost(id: string) {
  if (boostTags.has(id)) return;
  const tag = make("span", "boost-tag");
  tag.append(icon("boost"), make("span", "", "Boost"));
  boardLabels.append(tag);
  boostTags.set(id, tag);
}

function untagBoost(id: string) {
  boostTags.get(id)?.remove();
  boostTags.delete(id);
}

/**
 * An ordered question (Masters of Mayhem's "Order the enemies"): each picked card on the table wears its place, 1 going
 * first, on its top-left corner, above the shade the question draws over the table. They go as soon as the picks do.
 */
const orderBadges = new Map<string, HTMLElement>();
// The badges sit in the innermost of the clips, inside the layer that keeps them above the question's shade: a clip
// path makes a stacking context of its own, which would sink them under the shade if it were outside.
const orderHost = orderLayer.appendChild(make("div", "label-clip"));
const orderClips = [orderHost];
function placeOrderBadges(projected: ReturnType<BattleTable["anchors"]>, clips: readonly string[]) {
  // The discard pile's fan covers the table: its cards wear no numbers.
  const order = discardOpen ? new Map<string, number>() : cardPlaces(state.choice, choicePicks);
  // Cut out under the cards held in front (the hand, a card being read), as the plates are (`placeLabels`).
  while (orderClips.length < clips.length) {
    const inner = orderClips[orderClips.length - 1]!;
    const outer = make("div", "label-clip");
    inner.before(outer);
    outer.append(inner);
    orderClips.push(outer);
  }
  orderClips.forEach((layer, i) => {
    layer.style.clipPath = clips[i] ?? "";
  });
  for (const [id, badge] of orderBadges)
    if (!order.has(id)) {
      badge.remove();
      orderBadges.delete(id);
    }
  for (const [id, place] of order) {
    const card = projected.find((p) => p.id === id);
    let badge = orderBadges.get(id);
    if (!card) {
      badge?.remove();
      orderBadges.delete(id);
      continue;
    }
    if (!badge) {
      badge = orderBadge(place);
      badge.dataset.card = id;
      orderHost.append(badge);
      orderBadges.set(id, badge);
    }
    badge.textContent = String(place);
    badge.style.setProperty("--size", `${Math.round(Math.min(44, Math.max(24, card.width * 0.26)))}px`);
    badge.style.transform = `translate(${Math.round(card.left)}px,${Math.round(card.top)}px)`;
  }
}

/**
 * A spend's picks and the resource each pays, for the table to tint the card in that colour with the printed symbol on
 * it (`TableCards.spendMarks`), matching the lit symbol in the bar (Adam, 2026-11-26).
 */
function spendMarks(): Record<string, string> | undefined {
  const choice = state.choice;
  const meter = choice?.eitherOr === "spend" ? model.spendMeter([...choicePicks]) : null;
  if (!choice || !meter) return undefined;
  const marks: Record<string, string> = {};
  for (const [optionId, types] of meter.paidBy) {
    const cardId = choice.options.find((option) => option.id === optionId)?.cardId;
    const type = types.find((each) => each !== "any");
    if (cardId && type) marks[cardId] = type;
  }
  return marks;
}

function syncBoostTags() {
  for (const id of [...boostTags.keys()]) if (!state.facedownBoosts.some((boost) => boost.id === id)) untagBoost(id);
  for (const boost of state.facedownBoosts) tagBoost(boost.id);
}

function centerDecisionInViewport() {
  const height = boardViewport.clientHeight;
  decision.style.setProperty("--decision-viewport-center", `${boardViewport.scrollTop + height / 2}px`);
  decision.style.setProperty("--decision-viewport-height", `${height}px`);
}

function placeLabels() {
  if (!table) return;
  // While the table brings its pieces in from the campaign shelf, their counts and health wait to show with them.
  anchors.toggleAttribute("data-entering", table.entering);
  // Intersect the cutouts so even overlapping hand cards hide the label beneath them.
  const clips = table.foregroundCardClips([readingCard, heldEncounter, revealFocus]);
  while (labelClips.length < clips.length) {
    const inner = labelClips[labelClips.length - 1]!;
    const outer = make("div", "label-clip");
    inner.before(outer);
    outer.append(inner);
    labelClips.push(outer);
  }
  labelClips.forEach((layer, i) => {
    layer.style.clipPath = clips[i] ?? "";
  });
  const discard = table.discardAnchor();
  const deck = table.deckAnchor();
  const encounter = table.encounterAnchor();
  const projected = table.anchors();
  // An encounter pile's count is wider than the pile on a small screen: where it would reach over a card on its left
  // (a minion at the end of its row), it steps right, still under its pile and never past the screen's edge (found on
  // a phone against Ultron, 2026-11-24).
  const piled = new Set([...state.encounterDiscard, ...state.discard].map((card) => card.id));
  const clearOfCards = (x: number, top: number, node: HTMLElement) => {
    const half = node.offsetWidth / 2;
    const bottom = top + (node.offsetHeight || 22);
    let at = x;
    for (const card of projected) {
      if (piled.has(card.id) || card.x >= x || card.bottom <= top || card.top >= bottom) continue;
      if (card.right + 2 > at - half) at = card.right + 2 + half;
    }
    return Math.min(at, stage.clientWidth - half - 2);
  };
  const encounterAt = { x: clearOfCards(encounter.x, encounter.bottom + 4, encounterLabel), top: encounter.bottom + 4 };
  encounterLabel.style.transform = `translate(${Math.round(encounterAt.x)}px,${Math.round(encounterAt.top)}px)`;
  deckLabel.style.transform = `translate(${Math.round(deck.x)}px,${Math.round(deck.bottom + 5)}px)`;
  const encounterDiscard = table.encounterDiscardAnchor();
  const encounterDiscardAt =
    discardOpen && viewingEncounterDiscard
      ? null
      : {
          x: clearOfCards(encounterDiscard.x, encounterDiscard.bottom + 4, encounterPile),
          top: encounterDiscard.bottom + 4,
        };
  encounterPile.style.transform = encounterDiscardAt
    ? `translate(${Math.round(encounterDiscardAt.x)}px,${Math.round(encounterDiscardAt.top)}px)`
    : "";
  pile.style.transform =
    discardOpen && !viewingEncounterDiscard
      ? ""
      : `translate(${Math.round(discard.x)}px,${Math.round(discard.bottom + 5)}px)`;
  if (!formHint.hidden || !formFlash.hidden) {
    const hero = projected.find((point) => point.id === hintCardId);
    if (hero) {
      formHint.style.left = hero.x + "px";
      formHint.style.top = hero.y + "px";
      formFlash.style.clipPath = `polygon(${table
        .cardOutline(hero.id)
        .map((point) =>
          point
            .split(" ")
            .map((n) => n + "px")
            .join(" "),
        )
        .join(",")})`;
    }
  }
  if (aimTarget) {
    const target = projected.find((p) => p.id === aimTarget);
    if (target) {
      reticle.style.left = target.x + "px";
      reticle.style.top = target.y + "px";
      reticle.style.width = Math.min(100, Math.max(34, target.width * 0.65)) + "px";
    }
  }
  if (spot) {
    updateOutlines(
      abilityOutlines,
      spot.glow.map((item) => item.id),
      spot.glow.map((item) => item.tone),
    );
    updateOutlines(defenderCutouts, spot.cutouts);
    const marked = spot.mark ? projected.find((p) => p.id === spot!.mark!.id) : undefined;
    if (marked) {
      pendingMark.style.left = marked.x + "px";
      pendingMark.style.top = marked.top + "px";
    }
  }
  // A boost label rides along with its card while the card is held up; it goes when the card leaves.
  for (const [id, burst] of boostBursts) {
    const card = projected.find((p) => p.id === id);
    if (card) placeBoostBurst(burst.node, card);
    else dropBoostBurst(id);
  }
  placeOrderBadges(projected, clips);
  // Klaw's attacks deal him two boost cards, fanned beside him: one tag, on the outermost card, counts them
  // ("Boost ×2"), rather than a tag per card drawn over each other.
  const boostsBy = new Map<string, string[]>();
  for (const boost of state.facedownBoosts) {
    if (!boostTags.has(boost.id) || !projected.some((p) => p.id === boost.id)) continue;
    boostsBy.set(boost.enemy, [...(boostsBy.get(boost.enemy) ?? []), boost.id]);
  }
  for (const [id, tag] of boostTags) {
    const card = projected.find((p) => p.id === id);
    const stack = [...boostsBy.values()].find((ids) => ids.includes(id)) ?? [];
    tag.hidden = !card || stack[stack.length - 1] !== id;
    tag.lastElementChild!.textContent = stack.length > 1 ? `Boost ×${stack.length}` : "Boost";
    // The tag sits on the part of the card showing past its enemy's edge.
    if (card)
      tag.style.transform = `translate(${Math.round(card.right - card.width * 0.32)}px,${Math.round(card.y)}px)`;
  }
  if (!focusBlur.hidden && rowFocus.length) {
    // Everything but the cards in the row, cut out along their outlines. A mask, not a clip path: the cards overlap
    // as they come off the deck, and an even-odd path would blur where two of them cross.
    const { width, height } = focusBlur.getBoundingClientRect();
    const holes = rowFocus
      .map((id) => table!.cardOutline(id))
      .filter((outline) => outline.length)
      .map((outline) => `<polygon points='${outline.join(" ")}'/>`)
      .join("");
    const w = Math.round(width);
    const h = Math.round(height);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><mask id='m'><rect width='${w}' height='${h}' fill='white'/><g fill='black'>${holes}</g></mask><rect width='${w}' height='${h}' mask='url(%23m)'/></svg>`;
    focusBlur.style.clipPath = "";
    focusBlur.style.maskImage = focusBlur.style.webkitMaskImage = `url("data:image/svg+xml,${svg}")`;
    focusBlur.style.maskSize = focusBlur.style.webkitMaskSize = "100% 100%";
  } else if (!focusBlur.hidden && (revealFocus || dockFocus)) {
    const sharp = revealFocus ?? dockFocus?.keep ?? null;
    // Everything but the revealed card (or the card asking the dock's question), cut out along its outline.
    const outline = sharp ? table.cardOutline(sharp) : [];
    const { width, height } = focusBlur.getBoundingClientRect();
    focusBlur.style.maskImage = focusBlur.style.webkitMaskImage = "";
    focusBlur.style.clipPath = outline.length
      ? `path(evenodd, "M0 0 H${Math.round(width)} V${Math.round(height)} H0 Z M${outline.join(" L")} Z")`
      : "";
  } else if (!focusBlur.hidden) {
    focusBlur.style.clipPath = "";
    // Fades out above the hand with no edge to see, measured from where the hand rests, so hovering moves nothing.
    const edge = table.paymentEdge;
    const mask = `linear-gradient(to bottom, #000 ${Math.round(edge - 30)}px, transparent ${Math.round(edge + 90)}px)`;
    focusBlur.style.maskImage = focusBlur.style.webkitMaskImage = mask;
    // Fades in only once the dealt cards have landed in the hand; then it stays, whatever the hand does. While the
    // table is still behind the campaign shelf or bringing its pieces in from it, it waits for the last one to land
    // (Adam, 2026-11-24: the blur came up while cards were still being placed).
    if (shelfUp || table.entering) delete focusBlur.dataset.ready;
    else if (table.handSettled) focusBlur.dataset.ready = "";
  }
  // The mulligan question waits for the dealt cards to land too.
  dock.toggleAttribute(
    "data-waiting",
    !focusBlur.hidden && !revealFocus && !dockFocus && !rowFocus.length && !("ready" in focusBlur.dataset),
  );
  if (heldEncounter && !choiceShade.hidden) {
    const card = projected.find((p) => p.id === heldEncounter);
    if (card)
      choiceShade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${card.left}px ${card.top}px, ${card.right}px ${card.top}px, ${card.right}px ${card.bottom}px, ${card.left}px ${card.bottom}px, ${card.left}px ${card.top}px)`;
  }
  if (readingCard) {
    const card = projected.find((p) => p.id === readingCard);
    if (card) {
      revealHint.style.left = card.x + "px";
      revealHint.style.top = card.bottom + 6 + "px";
    }
  }
  if (menuCard) {
    const hero = projected.find((p) => p.id === menuCard);
    if (hero) {
      // With the card's picture showing beside it, the menu opens over the card toward the other side, so the picture
      // stays where it is and never covers the buttons.
      const side = previewSpot(menuCard)?.side;
      decision.dataset.align = side === "right" ? "end" : side === "left" ? "start" : "";
      decision.style.setProperty(
        "--hero-x",
        (side === "right" ? hero.right : side === "left" ? hero.left : hero.x) + "px",
      );
      decision.style.setProperty("--hero-y", hero.y - (hero.bottom - hero.y) * 0.74 + "px");
    }
  }
  for (const float of floats) {
    const anchor = projected.find((p) => p.id === float.dataset.card);
    if (anchor) {
      float.style.left = anchor.x + "px";
      float.style.top = anchor.y + "px";
    }
  }
  const handIds = new Set(displayedHand.map((card) => card.id));
  const hand = projected.filter((point) => handIds.has(point.id)).sort((a, b) => a.x - b.x);
  const width = hand.reduce(
    (gap, point, index) => (index ? Math.min(gap, point.x - hand[index - 1]!.x - 4) : gap),
    142,
  );
  const placed: { anchor: (typeof projected)[number]; node: HTMLButtonElement; handCard: boolean }[] = [];
  for (const anchor of projected) {
    const node = labels.get(anchor.id);
    if (!node) continue;
    const handCard = !discardOpen && handIds.has(anchor.id);
    const labelWidth = discardOpen
      ? anchor.width * 0.82
      : handCard
        ? Math.max(32, width)
        : anchor.id === state.hero.id || anchor.id === state.villain.id
          ? Math.max(200, anchor.width * 1.3)
          : Math.max(104, anchor.width * 1.25);
    node.style.setProperty("--card-width", `${labelWidth}px`);
    placed.push({ anchor, node, handCard });
  }
  // The piles' counts take part too. The encounter piles' stand at the end of the minions' row and ease aside under
  // their pile (never further right than the screen's edge allows); the player's stay put and the plates beside make way.
  const piles: PileCount[] = [
    {
      node: encounterLabel,
      at: encounterAt,
      left: encounter.left,
      right: Math.min(encounter.right, stage.clientWidth - encounterLabel.offsetWidth / 2 - 2),
    },
    ...(encounterDiscardAt
      ? [
          {
            node: encounterPile,
            at: encounterDiscardAt,
            left: encounterDiscard.left,
            right: Math.min(encounterDiscard.right, stage.clientWidth - encounterPile.offsetWidth / 2 - 2),
          },
        ]
      : []),
    { node: deckLabel, at: { x: deck.x, top: deck.bottom + 5 }, pinned: true },
    { node: pile, at: { x: discard.x, top: discard.bottom + 5 }, pinned: true },
  ];
  plateShifts = discardOpen ? new Map() : spreadTablePlates(placed, projected, piles);
  for (const { node, at } of piles) {
    const shift = plateShifts.get(node.id);
    if (shift) node.style.transform = `translate(${Math.round(at.x + shift.dx)}px,${Math.round(at.top + shift.dy)}px)`;
  }
  for (const { anchor, node, handCard } of placed) {
    // A hand card wears its chip (Spend, Swap, Discard) low on its face; other cards' plates sit under them, eased
    // clear of their neighbours where the cards stand closer than the plates are wide (`plate-spread.ts`).
    const shift = plateShifts.get(anchor.id);
    const x = anchor.x + (shift?.dx ?? 0);
    const y = handCard ? anchor.bottom - 44 : anchor.bottom + PLATE_DROP + (shift?.dy ?? 0);
    node.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
  if (spot) updatePlateCutouts(spot.plates ?? [], projected);
}

/** Where each plate under a card on the table moved to keep clear of its neighbours (`placeLabels`). */
let plateShifts = new Map<string, PlateShift>();
/** How far below its card a plate hangs. */
const PLATE_DROP = 5;

/** A pile's count, under the pile: between `left` and `right` if it may ease aside, `pinned` if it stays put. */
interface PileCount {
  node: HTMLElement;
  at: { x: number; top: number };
  left?: number;
  right?: number;
  pinned?: boolean;
}

/**
 * The plates under the cards on the table that would overlap, and how far each moves to stand clear. Reads every
 * plate's size before any is moved, so the page is laid out once.
 */
function spreadTablePlates(
  placed: readonly { anchor: ReturnType<BattleTable["anchors"]>[number]; node: HTMLButtonElement; handCard: boolean }[],
  projected: ReturnType<BattleTable["anchors"]>,
  piles: readonly PileCount[],
) {
  const handIds = new Set(placed.filter((one) => one.handCard).map((one) => one.anchor.id));
  const plates: Plate[] = placed.flatMap(({ anchor, node, handCard }) => {
    if (handCard || node.parentElement !== boardLabels || !node.childElementCount || node.hasAttribute("data-tucked"))
      return [];
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    if (!width || !height) return [];
    return [
      {
        id: anchor.id,
        x: anchor.x,
        top: anchor.bottom + PLATE_DROP,
        width,
        height,
        cardLeft: anchor.left,
        cardRight: anchor.right,
      },
    ];
  });
  for (const { node, at, left = at.x, right = at.x, pinned = false } of piles) {
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    if (width && height)
      plates.push({ id: node.id, ...at, width, height, cardLeft: left, cardRight: right, keepsLine: true, pinned });
  }
  if (plates.length < 2) return new Map<string, PlateShift>();
  // What a plate stepping off its row must not land on: the other cards on the table and the encounter piles.
  const box = ({ left, right, top, bottom }: Obstacle): Obstacle => ({ left, right, top, bottom });
  const obstacles: Obstacle[] = [
    ...projected.filter((card) => !handIds.has(card.id)).map((card) => ({ ...box(card), id: card.id })),
    box(table!.encounterAnchor()),
    ...(state.encounterDiscard.length ? [box(table!.encounterDiscardAnchor())] : []),
  ];
  return spreadPlates(plates, obstacles);
}

// ── Presenting what happened ─────────────────────────────────────────────────────────────────────────────────────
const PHASE_BANNER_MS = 1500;

function phaseIndicator(phase: "hero" | "villain" | "ending" | "setup", announce = false, round = state?.round ?? 1) {
  if (phase !== "setup") table?.setPhase(phase === "villain" ? "villain" : "hero");
  const title =
    phase === "hero"
      ? "Hero phase"
      : phase === "villain"
        ? "Villain phase"
        : phase === "ending"
          ? "End of turn"
          : "Setup";
  turnStatus.dataset.phase = phase === "villain" ? "villain" : phase === "ending" ? "ending" : "hero";
  turnStatus.replaceChildren(...(phase === "setup" ? [] : [icon(phase === "villain" ? "villain" : "hero")]), title);
  roundLabel.textContent = `Round ${round}`;
  if (announce && phase !== "setup") sweepBanner(title, phase);
}

/** A title swept across the whole table, the way a new phase is announced ("Nemesis cards added" too). */
function sweepBanner(title: string, tone: "hero" | "villain" | "ending") {
  const banner = element("phase-banner");
  banner.dataset.phase = tone;
  const lettering = banner.querySelector("b")!;
  lettering.textContent = title;
  sfx.play("whoosh-big");
  banner.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  banner.animate([{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], {
    duration: PHASE_BANNER_MS,
  });
  if (!reducedMotion()) {
    lettering.animate(
      [
        { transform: "translateX(-100%)", easing: "cubic-bezier(.18,.74,.28,1)" },
        { transform: "translateX(-0.6%)", offset: 0.24, easing: "linear" },
        { transform: "translateX(0.6%)", offset: 0.73, easing: "cubic-bezier(.6,.02,.9,.5)" },
        { transform: "translateX(100%)" },
      ],
      { duration: PHASE_BANNER_MS },
    );
  }
}

function activationRing(id: string) {
  const card = table?.anchors().find((point) => point.id === id);
  if (!card) return;
  const ring = make("div", "activation-ring");
  ring.style.cssText = `left:${card.x}px;top:${card.y}px;width:${card.width}px;`;
  stage.append(ring);
  ring.addEventListener("animationend", () => ring.remove(), { once: true });
}

async function flashDefeatedCard(id: string) {
  sfx.play("defeat");
  const outline = table?.cardOutline(id);
  if (!outline?.length) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("defeat-flash");
  svg.setAttribute("aria-hidden", "true");
  const polygon = document.createElementNS(svg.namespaceURI, "polygon");
  polygon.setAttribute("points", outline.join(" "));
  svg.append(polygon);
  stage.append(svg);
  await svg.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 260, easing: "ease-out" }).finished;
  svg.remove();
}

/** Numbers and stamps that float off a card follow it while it moves. */
const floats = new Set<HTMLElement>();
function floatOver(id: string, node: HTMLElement, duration: number, keyframes: Keyframe[]) {
  const anchor = table?.anchors().find((point) => point.id === id);
  if (!anchor) return;
  node.dataset.card = id;
  node.style.left = anchor.x + "px";
  node.style.top = anchor.y + "px";
  node.style.setProperty("--float-size", Math.round(Math.min(78, Math.max(40, anchor.width * 0.62))) + "px");
  stage.append(node);
  floats.add(node);
  const animation = node.animate(
    reducedMotion() ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }] : keyframes,
    { duration, easing: "cubic-bezier(.2,.8,.3,1)" },
  );
  animation.onfinish = () => {
    node.remove();
    floats.delete(node);
  };
}

function floatNumber(
  id: string,
  kind: "damage" | "heal" | "threat" | "thwart" | "blocked",
  text: string,
  caption?: string,
) {
  const node = make("div", "float-number", text);
  node.dataset.kind = kind;
  if (caption) node.append(make("small", "", caption));
  floatOver(id, node, kind === "damage" ? 1050 : 1250, [
    { transform: "translateY(10px) scale(.3) rotate(-8deg)", opacity: 0 },
    { transform: "translateY(-6px) scale(1.18) rotate(3deg)", opacity: 1, offset: 0.14 },
    { transform: "translateY(-14px) scale(1) rotate(0deg)", opacity: 1, offset: 0.3 },
    { transform: "translateY(-44px) scale(.96)", opacity: 1, offset: 0.78 },
    { transform: "translateY(-60px) scale(.9)", opacity: 0 },
  ]);
}

/** The villain phase's threat step, called out on the scheme before a card gets the chance to interrupt it. */
let threatStepCalled: string | null = null;
async function threatStep(beat: Beat, scheme: string, amount: number) {
  threatStepCalled = scheme;
  narrate(beat, null, {
    eyebrow: { text: "Place threat", icon: "threat", tone: "villain" },
    title: `${nameOf(scheme)} gains threat`,
  });
  setSpot({ glow: [{ id: scheme, tone: "threat" }], cutouts: [scheme], mark: { id: scheme, kind: "threat", amount } });
  placeLabels();
  stampCard(scheme, "Threat");
  await sleep(reducedMotion() ? 500 : 1300);
}

function stampCard(id: string, text: string, tone?: "status" | "confused" | "tough" | "surge" | "boost" | "guard") {
  const node = make("div", "card-stamp", text);
  if (tone) node.dataset.tone = tone;
  if (tone === "guard") node.prepend(icon("guard"));
  floatOver(id, node, 1100, [
    { transform: "scale(2.4)", opacity: 0 },
    { transform: "scale(.92)", opacity: 1, offset: 0.16 },
    { transform: "scale(1)", opacity: 1, offset: 0.26 },
    { transform: "scale(1)", opacity: 1, offset: 0.8 },
    { transform: "scale(1.05)", opacity: 0 },
  ]);
}

/**
 * A turned-up boost card's "+N Boost". It stays on the card, fully shown, the whole time the card is held up, and goes
 * only as the card moves off to the discard pile, rather than fading out first (Adam, 2026-11-22).
 */
const boostBursts = new Map<string, { node: HTMLElement }>();

async function showBoost(reveal: NonNullable<Beat["reveal"]>) {
  const boost = reveal.boost!;
  const projected = table?.anchors();
  const card = projected?.find((p) => p.id === reveal.id);
  if (!card) return;
  dropBoostBurst(reveal.id);
  const burst = make("div", "boost-burst");
  burst.setAttribute("role", "status");
  const marks = make("span", "boost-marks");
  for (let i = 0; i < Math.min(boost.icons, 4); i++) marks.append(icon("boost"));
  burst.append(marks, make("b", "", `+${boost.icons}`), make("span", "", "Boost"));
  stage.append(burst);
  sfx.play("boost");
  boostBursts.set(reveal.id, { node: burst });
  placeBoostBurst(burst, card);
  if (!reducedMotion())
    burst.animate(
      [
        { transform: "scale(.55)", opacity: 0 },
        { transform: "scale(1.18)", opacity: 1, offset: 0.5 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 300, easing: "ease-out" },
    );
  // Held up as long as before; the label goes with the card (dropBoostBurst as it is retired).
  await sleep(reducedMotion() ? 300 : 860);
}

function placeBoostBurst(node: HTMLElement, card: { x: number; width: number; bottom: number }) {
  node.style.left = card.x + card.width * 0.33 + "px";
  node.style.top = card.bottom - card.width * 0.25 + "px";
}

function dropBoostBurst(id: string) {
  const burst = boostBursts.get(id);
  if (!burst) return;
  boostBursts.delete(id);
  if (reducedMotion()) return burst.node.remove();
  burst.node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).onfinish = () =>
    burst.node.remove();
}

/**
 * "+1 card" bursting off the encounter deck, so the extra deal that follows has a cause. The word "Surge" is the
 * surging card's own stamp: said once, on the card causing it, not again on the deck (Adam, 2026-11-22).
 */
async function surgeBurst() {
  const deck = table?.encounterAnchor();
  if (!deck) return;
  const burst = make("div", "surge-burst");
  burst.setAttribute("role", "status");
  burst.append(icon("surge"), make("b", "", "+1 card"));
  sfx.play("surge");
  burst.style.left = deck.x + "px";
  burst.style.top = deck.y + "px";
  stage.append(burst);
  const animation = burst.animate(
    reducedMotion()
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { transform: "scale(.4)", opacity: 0 },
          { transform: "scale(1.15)", opacity: 1, offset: 0.2 },
          { transform: "scale(1)", opacity: 1, offset: 0.35 },
          { transform: "scale(1)", opacity: 1, offset: 0.78 },
          { transform: "scale(1.06) translateY(-10px)", opacity: 0 },
        ],
    { duration: 1100, easing: "ease-out" },
  );
  await animation.finished;
  burst.remove();
}

const STATUS_STAMP: Record<string, ["status" | "confused" | "tough", string]> = {
  stunned: ["status", "Stunned!"],
  confused: ["confused", "Confused!"],
  tough: ["tough", "Tough!"],
};

/** The dock line for a beat: an icon and a tone, so the feed reads at a glance. */
function feedLineOf(beat: Beat): FeedLine | null {
  if (beat.phase || beat.turned || (beat.encounterDeal && !beat.boostFor)) return null;
  if (beat.boostFor) return { text: beat.text, icon: "boost", tone: "villain" };
  if (beat.draw) return { text: `Draw ${plural(beat.draw.length, "card")}`, icon: "draw", tone: "hero" };
  if (beat.handDiscard)
    return {
      text: `Discard ${beat.handDiscard.map(nameOf).filter(Boolean).join(", ") || plural(beat.handDiscard.length, "card")}`,
      icon: "discard",
      tone: beat.enemy ? "villain" : "hero",
    };
  if (beat.returned)
    return {
      text: `${beat.returned.map(nameOf).filter(Boolean).join(", ") || plural(beat.returned.length, "card")} to your hand`,
      icon: "draw",
      tone: "hero",
    };
  if (beat.leftPlay) return { text: beat.text, icon: "discard", tone: beat.enemy ? "villain" : "hero" };
  if (beat.surge)
    return { text: `Surge: ${nameOf(beat.surge) || "another card"} deals one more`, icon: "surge", tone: "villain" };
  if (beat.milled)
    return {
      text: `Discard ${beat.milled.map(nameOf).filter(Boolean).join(", ") || plural(beat.milled.length, "card")} from your deck`,
      icon: "discard",
      tone: "hero",
    };
  if (beat.droneIn) return { text: beat.text, icon: "deck", tone: "villain" };
  if (beat.defeatedCard && beat.droneWas)
    return {
      text: `${DRONE_NAME} defeated: it was ${beat.droneWas}, now in your discard pile`,
      icon: "defeated",
      tone: "hero",
    };
  if (beat.defeatedCard)
    return { text: `${nameOf(beat.defeatedCard) || "A card"} is defeated`, icon: "defeated", tone: "hero" };
  if (beat.defeat) return { text: beat.defeat, icon: "defeated", tone: "hero" };
  if (beat.hit)
    return {
      text: beat.text,
      icon: beat.hit.tough ? "tough" : "damage",
      tone: beat.hit.amount ? "damage" : undefined,
    };
  if (beat.threat)
    return {
      text: beat.text,
      icon: beat.threat.delta > 0 ? "threat" : "thwart",
      tone: beat.threat.delta > 0 ? "threat" : "hero",
    };
  if (beat.statusChange) {
    const { name, delta } = beat.statusChange;
    if (name === "damage" && delta < 0) return { text: beat.text, icon: "heal", tone: "heal" };
    const symbol: IconName = name === "stunned" || name === "confused" || name === "tough" ? name : "forced";
    return { text: beat.text, icon: symbol, tone: beat.enemy ? "villain" : "hero" };
  }
  if (beat.reveal) return { text: beat.text, icon: beat.reveal.boost ? "boost" : "forced", tone: "villain" };
  if (beat.activate) return { text: beat.text, icon: "action", tone: "hero" };
  if (beat.interrupt) return { text: beat.text, icon: "energy", tone: "hero" };
  if (beat.deflection) return { text: beat.text, icon: "tough", tone: "hero" };
  if (beat.attackAim)
    return {
      text: `${nameOf(beat.attackAim.source)} attacks ${nameOf(beat.attackAim.target)}`,
      icon: "attack",
      tone: "villain",
    };
  if (beat.villainStage || beat.villainFlip || beat.schemeAdvance)
    return { text: beat.text, icon: "flip", tone: "villain" };
  if (beat.modifier) return { text: beat.text, icon: "action", tone: beat.enemy ? "villain" : "hero" };
  return beat.text
    ? { text: beat.text, icon: beat.enemy ? "scheme" : "action", tone: beat.enemy ? "villain" : "hero" }
    : null;
}

function narrate(beat: Beat, line: FeedLine | null, extra: Partial<DockView> = {}) {
  const villain = beat.enemy || beat.phase === "villain";
  if (line) pushFeed(line);
  paintDock({
    tone: villain ? "villain" : "hero",
    asking: false,
    eyebrow: {
      text: villain ? beat.activity || "Villain phase" : "Card effect",
      icon: villain ? "scheme" : "action",
      tone: villain ? "villain" : "hero",
    },
    title: line?.text ?? (beat.text || (villain ? "Villain phase" : "Resolving")),
    help: null,
    // Nothing to press while the table plays out a move; the bar keeps its width so it doesn't jump.
    primary: null,
    ...extra,
  });
}

async function present(beats: Snapshot["beats"]) {
  presenting = true;
  closeDecision();
  if (dockFocus || (!focusBlur.hidden && !revealFocus && !rowFocus.length)) {
    // So is a question about the hand (the end-of-turn discard): answered, it goes straight into the villain phase,
    // which played out under the blur because nothing renders until it ends (Adam, 2026-11-23).
    // The question that softened the table is answered: the table comes back into focus for the answer to play out,
    // rather than staying soft with only the card that asked still sharp (Adam, 2026-11-22: Eviction Notice sat above
    // the blur, then the whole table stayed blurred once it had gone).
    dockFocus = null;
    delete focusBlur.dataset.ready;
    focusBlur.style.clipPath = "";
    focusBlur.hidden = !rowFocus.length && !revealFocus;
  }
  const announcement = element("action-beat");
  const impact = element("impact");
  stage.dataset.resolving = "true";
  anchors.inert = true;
  undoButton.disabled = restart.disabled = true;
  const pendingDraws = new Set(beats.flatMap((beat) => beat.draw ?? []));
  // Out of a payment, the table stops dimming for it before playing on. Called off (a reaction cancelled), the hand
  // and staged card go back too; after a real payment the hand has already settled, and the final hand would open a
  // slot for a card still on its way (Black Cat's pick-up), so only the dimming goes.
  if (!state.payment) {
    boardViewport.removeAttribute("data-paying");
    if (paymentCalledOff)
      table?.endPayment(
        state.hand.filter((card) => card.id !== staged?.id && !pendingDraws.has(card.id)),
        staged,
      );
    else table?.clearPaymentDim();
  }
  let spotted = false;
  // The payment screen's stand-ins for resource abilities (Peter Parker's Scientist) are spent by now.
  displayedHand = displayedHand.filter((card) => !card.id.startsWith("ability:"));
  beats = whileStillThere(beats);
  // Encounter cards dealt one after another all stay lit over the shade, not only the latest (Adam, 2026-11-23).
  let dealtLit: string[] = [];
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]!;
    beatsToCome = beats.slice(index + 1);
    if (!beat.encounterDeal) dealtLit = [];
    if (spotted) {
      if (!beat.encounterDeal) setSpot(null);
      spotted = false;
    }
    if (beat.gameEnded) break;
    if (answeredHeld) {
      // The revealed card whose question was just answered: it lands beside the villain first, then fires there,
      // and only then does the answer play out (Adam, 2026-11-22: Peter exhausted while Eviction Notice was still
      // in the air).
      const id = answeredHeld;
      answeredHeld = null;
      // A card whose When Revealed already fired before it asked (a search) doesn't fire a second time.
      if (!firedBeforeAsking.delete(id) && !reducedMotion() && table?.parkedEncounters().includes(id)) {
        await sleep(450);
        // Named as it was revealed: once removed from the game it is in none of the piles the final state lists.
        await whenRevealedFires(beat, { id, name: parkedViews.get(id)?.name ?? nameOf(id) }, "Resolve");
      }
    }
    if (releaseHeld) {
      // The encounter card nobody interrupted: its When Revealed fires where it stands, then it goes.
      const id = releaseHeld;
      releaseHeld = null;
      await whenRevealedFires(beat, {
        id,
        name: nameOf(id),
        applies: heldReveal?.id === id ? heldReveal.applies : undefined,
      });
      letGoOfEncounter(id, beats.slice(index));
      await sleep(reducedMotion() ? 150 : 450);
    }
    if (beat.draw) {
      for (const id of beat.draw) pendingDraws.delete(id);
      displayedHand = handBetweenBeats(displayedHand, state.hand, beats.slice(index + 1), staged?.id ?? null);
      // A later beat still changes the piles (the deck runs out and the discard pile becomes the new deck, Black Cat
      // discards from it): until then the pile stays as it is and the deck just loses what was drawn.
      const pilesLater = beats.slice(index + 1).some((later) => later.deckReset !== undefined || later.milled);
      const deckSize = pilesLater
        ? Math.max(0, Number(deckCount.textContent) - beat.draw.length)
        : state.deckCount + pendingDraws.size;
      table?.showDraw(displayedHand, beat.draw, deckSize, pilesLater ? undefined : state.discard);
      playDrawSounds(beat.draw.length);
      deckCount.textContent = String(deckSize);
      narrate(beat, feedLineOf(beat));
      await sleep(680 + (beat.draw.length - 1) * 180);
      continue;
    }
    if (beat.handDiscard) {
      const fresh = beat.handDiscard.filter((id) => !preAnimated.has(id));
      for (const id of beat.handDiscard) preAnimated.delete(id);
      // Discarded already (a payment's resources fly off when paid): out of the hand being shown all the same.
      displayedHand = displayedHand.filter((card) => fresh.includes(card.id) || !beat.handDiscard!.includes(card.id));
      if (!fresh.length) continue;
      narrate(beat, feedLineOf(beat));
      // Discarded at random (Eviction Notice, The Vulture's Plans): the pick is seen being made first.
      if (beat.random) await pickFromHandAtRandom(beat, fresh, "Discarded at random");
      sfx.play("discard");
      await new Promise<void>((resolve) => (table ? table.animateDiscards(fresh, resolve) : resolve()));
      if (beat.random) table?.spotlightHand([]);
      displayedHand = displayedHand.filter((card) => !fresh.includes(card.id));
      await sleep(240);
      continue;
    }
    if (beat.returned) {
      narrate(beat, feedLineOf(beat));
      displayedHand = handBetweenBeats(displayedHand, state.hand, beats.slice(index + 1), staged?.id ?? null);
      // From where it lies (the row turned up off the deck, the discard pile), not out of the deck like a draw.
      table?.returnToHand(displayedHand, beat.returned, beat.returnedFrom);
      sfx.play("draw");
      await sleep(620);
      continue;
    }
    if (beat.surge) {
      narrate(beat, feedLineOf(beat), { title: "Surge! One more encounter card" });
      stampCard(beat.surge, "Surge!", "surge");
      // The card says why first, then the deck answers with the extra card.
      await sleep(reducedMotion() ? 0 : 450);
      await surgeBurst();
      continue;
    }
    if (beat.tucked) {
      // Highway Robbery: a card is picked from the hand (at random: a light hops across the hand and stops on it),
      // then slides facedown under it, where its back stays showing until When Defeated gives it back.
      const { ids, host } = beat.tucked;
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: "When Revealed", icon: "forced", tone: "villain" },
        title: `${plural(ids.length, "card")} from your hand under ${nameOf(host)}`,
      });
      if (beat.random) await pickFromHandAtRandom(beat, ids, `Under ${nameOf(host)}`);
      displayedHand = displayedHand.filter((card) => !ids.includes(card.id));
      table?.tuckUnder(ids, host, displayedHand);
      sfx.play("deal");
      if (beat.random) table?.spotlightHand([]);
      await sleep(reducedMotion() ? 200 : 760);
      table?.settleStash();
      table?.setUnder(host, beat.tucked.count);
      await sleep(reducedMotion() ? 100 : 300);
      continue;
    }
    if (beat.deckReset !== undefined) {
      // The deck ran out: the discard pile flies back in facedown as the new deck, and an encounter card follows.
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: "Deck ran out", icon: "deck", tone: "villain" },
        title: "Shuffle your discard pile into a new deck",
      });
      table?.shuffleIntoDeck("discard");
      sfx.play("shuffle", { maxMs: 1400 });
      await sleep(reducedMotion() ? 300 : 1300);
      table?.settleStash({ deckCount: beat.deckReset });
      deckCount.textContent = String(beat.deckReset);
      await sleep(reducedMotion() ? 100 : 350);
      continue;
    }
    if (beat.intoEncounterDeck) {
      // Shadow of the Past: the rest of the nemesis set is shown, then shuffled into the encounter deck. That the
      // encounter deck now holds the nemesis's cards is announced across the whole table first, like a new phase.
      if (beat.nemesis) {
        sweepBanner("Nemesis cards added", "villain");
        await sleep(PHASE_BANNER_MS);
      }
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: beat.nemesis ? "Nemesis cards added" : "Encounter deck", icon: "deck", tone: "villain" },
        title: `Shuffle ${beat.intoEncounterDeck.map((card) => card.name).join(", ")} into the encounter deck`,
      });
      table?.showInRow(beat.intoEncounterDeck);
      await sleep(reducedMotion() ? 400 : 1500);
      table?.rowIntoEncounterDeck();
      sfx.play("shuffle", { maxMs: 900 });
      await sleep(reducedMotion() ? 200 : 800);
      const count = element("encounter-count");
      const total = Number(count.textContent) + beat.intoEncounterDeck.length;
      table?.settleStash({ encounterCount: total });
      count.textContent = String(total);
      continue;
    }
    if (beat.encounterReset !== undefined) {
      // The encounter deck ran out: its discard pile flies back in facedown (an acceleration token follows).
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: "Encounter deck ran out", icon: "deck", tone: "villain" },
        title: "Shuffle the encounter discard pile back in",
      });
      table?.shuffleIntoDeck("encounterDiscard");
      sfx.play("shuffle", { maxMs: 1400 });
      await sleep(reducedMotion() ? 300 : 1300);
      table?.settleStash({ encounterCount: beat.encounterReset });
      element("encounter-count").textContent = String(beat.encounterReset);
      continue;
    }
    if (beat.acceleration !== undefined) {
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: "Acceleration", icon: "acceleration", tone: "villain" },
        title: `+1 acceleration token on ${nameOf(beat.actor) || "the main scheme"}`,
      });
      const scheme = cards().find((card) => card.id === beat.actor);
      if (scheme) table?.setModifier(scheme, "acceleration", beat.acceleration);
      sfx.play("threat");
      if (beat.actor) stampCard(beat.actor, "+1 Acceleration", "boost");
      await sleep(reducedMotion() ? 300 : 1000);
      continue;
    }
    if (beat.overkill) {
      narrate(beat, feedLineOf(beat));
      stampCard(beat.overkill.to, "Overkill", "status");
      sfx.play("hit");
      await sleep(reducedMotion() ? 200 : 650);
      continue;
    }
    if (beat.discount) {
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: nameOf(beat.discount.source) || "Discount", icon: "action", tone: "hero" },
        title: `Your next card costs ${beat.discount.amount} less`,
      });
      stampCard(beat.discount.source ?? state.hero.id, `−${beat.discount.amount} cost`, "boost");
      await sleep(reducedMotion() ? 300 : 900);
      continue;
    }
    if (beat.nothingFound) {
      narrate(beat, feedLineOf(beat));
      if (beat.nothingFound.source) stampCard(beat.nothingFound.source, "No target", "status");
      await sleep(reducedMotion() ? 300 : 900);
      continue;
    }
    if (beat.milled) {
      await revealMilled(beat, beats[index + 1]);
      continue;
    }
    if (beat.leftPlay) {
      const id = beat.leftPlay;
      table?.markActor(null);
      narrate(beat, feedLineOf(beat));
      labels.get(id)?.remove();
      labels.delete(id);
      if (beat.removedFromGame) {
        // Removed from the game, it has no pile to go to: it evaporates where it stands (beside the villain, or in
        // its place in play), and nothing more happens until it has gone (Adam, 2026-11-22).
        if (!reducedMotion()) await sleep(200);
        sfx.play("vanish");
        await sleep(table?.evaporate(id) || 240);
        continue;
      }
      const encounter = state.encounterDiscard.find((card) => card.id === id);
      const discarded = encounter ?? state.discard.find((card) => card.id === id);
      // A revealed card still standing aside by the villain (an obligation whose question was just answered) leaves
      // from there to the encounter discard pile.
      if (table?.parkedEncounters().includes(id)) table.retireEncounter(id, encounter);
      else table?.discardDefeatedCard(id, discarded, encounter ? "encounterDiscard" : "discard");
      if (discarded) sfx.play("discard");
      await sleep(discarded ? 560 : 240);
      continue;
    }
    if (beat.schemeAdvance) {
      // The main scheme's stage is completed: stamped, then it turns over to the next stage, its threat starting again.
      const { scheme, from, to, threat, target } = beat.schemeAdvance;
      table?.markActor(scheme);
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: `${from} completed`, icon: "flip", tone: "villain" },
        title: `The main scheme advances: ${to}`,
      });
      stampCard(scheme, "Completed");
      await sleep(reducedMotion() ? 300 : 900);
      const face = state.enemyCards.find((card) => card.id === scheme);
      if (face) table?.turnEnemyCard({ ...face, threat });
      table?.setThreat(scheme, threat);
      sfx.play("flip");
      const counter = labels.get(scheme)?.querySelector<HTMLElement>(".scheme-threat");
      if (counter) counter.replaceWith(threatPill(threat, target, face?.threatLock));
      inspect(scheme);
      await sleep(reducedMotion() ? 300 : 1100);
      continue;
    }
    if (beat.droneIn) {
      // Ultron's Drones: the top card of the player's deck is seen leaving it, back up, and landing in the villain's
      // row as a Drone. The card that made it happen (Ultron, a scheme stage, Android Efficiency) is named above it.
      const { card, from, source, deckCount: left } = beat.droneIn;
      droneIds.add(card.id);
      const arrived = state.enemyCards.find((c) => c.id === card.id) ?? card;
      narrate(beat, feedLineOf(beat), {
        eyebrow: { text: nameOf(source) || beat.activity || "Ultron Drones", icon: "forced", tone: "villain" },
        title:
          from === "discard"
            ? "The top card of your discard pile becomes a Drone"
            : "The top card of your deck becomes a Drone",
      });
      if (source && onTable(source)) table?.markActor(source);
      table?.bringInDrone(arrived, from, left);
      if (from === "deck") deckCount.textContent = String(left);
      sfx.play("deal");
      await sleep(reducedMotion() ? 250 : 980);
      synchronizeLabels();
      placeLabels();
      stampCard(card.id, DRONE_NAME, "boost");
      await sleep(reducedMotion() ? 200 : 620);
      continue;
    }
    if (beat.entersPlay) {
      // Put into play without a reveal (the minion Klaw's main scheme finds): it comes off the encounter pile.
      const card = state.enemyCards.find((c) => c.id === beat.entersPlay);
      narrate(beat, feedLineOf(beat));
      if (card) {
        const from = reducedMotion() ? undefined : foundAt.get(card.id);
        foundAt.delete(card.id);
        table?.bringInEnemy(threatOnArrival(card), from);
        sfx.play("deal");
        await sleep(reducedMotion() ? 200 : 700);
        synchronizeLabels();
        placeLabels();
      }
      continue;
    }
    if (beat.phase) {
      announcement.hidden = true;
      phaseIndicator(beat.phase, true, beat.round);
      if (beat.phase === "hero" || beat.phase === "villain")
        sfx.play(beat.phase === "hero" ? "phase-hero" : "phase-villain", { delay: 120 });
      narrate(beat, null, { title: beat.phase === "hero" ? "Your turn" : "Villain phase", eyebrow: null });
      await sleep(PHASE_BANNER_MS);
      // The villain phase opens with threat on the main scheme. When a card can interrupt it (Great Responsibility),
      // the game stops before the threat lands: the step is still called out first, so the question that follows
      // reads as part of it rather than appearing out of nowhere.
      const pending = state.choice?.event;
      if (
        beat.phase === "villain" &&
        pending?.kind === "placeThreat" &&
        pending.before &&
        pending.subject &&
        !beats.slice(index + 1).some((later) => later.threat)
      ) {
        await threatStep(beat, pending.subject, pending.amount ?? 1);
        spotted = true;
      }
      continue;
    }
    if (beat.defeatedCard) {
      announcement.hidden = true;
      table?.markActor(null);
      const id = beat.defeatedCard;
      narrate(beat, feedLineOf(beat));
      const label = labels.get(id);
      updateHpLabel(label, 0);
      const threat = label?.querySelector<HTMLElement>(".scheme-threat");
      if (threat && threat.dataset.count !== "0") {
        updateThreatLabel(threat, 0);
        table?.setThreat(id, 0);
      }
      stampCard(id, "Defeated");
      await flashDefeatedCard(id);
      await sleep(240);
      label?.remove();
      labels.delete(id);
      const encounter = state.encounterDiscard.find((card) => card.id === id);
      const discarded = encounter ?? state.discard.find((card) => card.id === id);
      if (beat.droneWas) {
        // A defeated Drone turns over where it stands: the card it was all along is seen before it goes to the
        // player's discard pile (RRG 1.8 "Discard": faceup on its owner's pile).
        droneIds.delete(id);
        if (discarded) {
          table?.turnEnemyCard({ ...discarded, type: "minion", landscape: false, markers: [] });
          sfx.play("flip");
          paintDock({
            tone: "hero",
            asking: false,
            eyebrow: { text: `${DRONE_NAME} defeated`, icon: "defeated", tone: "hero" },
            title: `It was ${beat.droneWas}: into your discard pile`,
            help: null,
            primary: null,
          });
          await sleep(reducedMotion() ? 500 : 1150);
        }
      }
      table?.discardDefeatedCard(id, discarded, encounter ? "encounterDiscard" : "discard");
      if (discarded) await sleep(520);
      continue;
    }
    const actor = beat.actor ?? beat.hit?.source ?? beat.reveal?.id ?? null;
    table?.markActor(beat.defeat ? null : actor);
    if (actor && !beat.defeat) inspect(actor);
    const line = feedLineOf(beat);
    if (beat.defeat) {
      announcement.hidden = true;
      narrate(beat, line);
      if (actor) {
        stampCard(actor, "Defeated");
        await flashDefeatedCard(actor);
      }
      announcement.setAttribute("data-defeat", "");
      announcement.replaceChildren(icon("defeated"), make("span", "", beat.defeat));
      announcement.hidden = false;
      shakeStage("heavy");
      sfx.play("boom");
      await sleep(1450);
      announcement.removeAttribute("data-defeat");
      announcement.hidden = true;
      if (!beat.villainStage) continue;
    } else narrate(beat, line);
    if (beat.villainStage || beat.villainFlip) {
      table?.showVillain(state.villain, !!(beat.defeat || beat.villainFlip));
      sfx.play("flip");
      await sleep(360);
      inspect(state.villain.id);
      const label = labels.get(state.villain.id);
      if (label) {
        const name = label.querySelector(".plate-name");
        if (name) name.textContent = state.villain.name;
        updateHpLabel(label, state.villainHp);
      }
      await sleep(460);
      continue;
    }
    if (beat.enemyActivation) {
      const outline = table?.cardOutline(beat.enemyActivation);
      if (outline?.length) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("activation-outline");
        svg.setAttribute("aria-hidden", "true");
        const polygon = document.createElementNS(svg.namespaceURI, "polygon");
        polygon.setAttribute("points", outline.join(" "));
        svg.append(polygon);
        stage.append(svg);
        polygon.animate(
          reducedMotion()
            ? [{ opacity: 0.75 }, { opacity: 0 }]
            : [
                { transform: "scale(1)", opacity: 0.95 },
                { transform: "scale(1.05)", opacity: 0.8, offset: 0.35 },
                { transform: "scale(1.22)", opacity: 0 },
              ],
          { duration: 430, easing: "ease-out" },
        ).onfinish = () => svg.remove();
      }
      // Scheming is called out on the card like an encounter card dealt or threat placed; an attack has its reticle.
      // It also lifts and flashes, so every enemy taking its turn is seen to, even one that places no threat (Adam,
      // 2026-11-24); an attacker rears up for its attack instead.
      if (beat.scheming) {
        stampCard(beat.scheming, "Schemes");
        table?.activateEnemy(beat.scheming);
      }
    }
    if (beat.stunnedAttempt) {
      // It rears up to attack and strains against the stun; it never aims at the hero.
      // No stamp yet: "Stunned!" read as if it had just been stunned. The stun's removal says "Unstunned" (Adam,
      // 2026-11-23).
      table?.windUp(beat.stunnedAttempt, { strain: true });
      sfx.play("whoosh");
    }
    if (beat.attackAim) {
      const { source, target } = beat.attackAim;
      attacker = source;
      table?.windUp(source);
      sfx.play("whoosh");
      await sleep(90);
      const projected = table?.anchors();
      const from = projected?.find((a) => a.id === source);
      const to = projected?.find((a) => a.id === target);
      aimTarget = target;
      reticle.hidden = false;
      placeLabels();
      aimFrom(from, to);
    }
    if (beat.activate) {
      const event = [staged, ...state.discard, ...displayedHand].find((c) => c?.id === beat.activate!.card);
      if (event) {
        staged = event;
        table?.stageEvent(event);
        sfx.play("play");
        displayedHand = displayedHand.filter((c) => c.id !== event.id);
        labels.get(event.id)?.remove();
        labels.delete(event.id);
        await sleep(320);
      }
      activationRing(beat.activate.card);
      await sleep(360);
      if (awaitsTarget(beat.activate.card)) {
        // Its target is still to be picked (First Aid): it waits on the mat, on no one, until the player picks.
        table?.holdEvent(beat.activate.card);
      } else if (reacting?.card === beat.activate.card && reacting.subject !== beat.activate.hero) {
        // It goes to what the moment is happening to (a scheme, a revealed card, an enemy), not onto the hero.
        table?.channelEventTo(beat.activate.card, reacting.subject);
        await sleep(560);
      } else {
        table?.channelEvent(beat.activate.card);
        await sleep(450);
        table?.markActor(beat.activate.hero);
        activationRing(beat.activate.hero);
      }
    }
    if (beat.interrupt) {
      table?.pulseInterrupt(beat.interrupt);
      sfx.play("ability");
      await sleep(INTERRUPT_MS);
      const cancelled = heldEncounter;
      if (cancelled && reacting?.card === beat.interrupt && reacting.subject === cancelled) {
        // The interrupt cancels the card it is held up over: that card flickers out, then goes to its discard pile,
        // and only after that does the event that cancelled it follow it to the player's.
        table?.flickerCancelled(cancelled);
        sfx.play("cancel");
        stampCard(cancelled, "Cancelled");
        await sleep(reducedMotion() ? 300 : 760);
        table?.holdEventHere(beat.interrupt);
        letGoOfEncounter(cancelled, []);
        heldEncounter = revealWindowHeld = null;
        await sleep(reducedMotion() ? 200 : 620);
      }
      continue;
    }
    if (beat.deflection) {
      // The attack still comes in: the attacker charges, and the damage bursts out where it would land before the
      // card knocks it away. The hero dodged, so it neither recoils nor flashes red.
      if (attacker && !reducedMotion()) {
        table?.strike(attacker, state.hero.id, { dodged: true });
        await sleep(HIT_CONTACT_MS);
        clearAim();
      }
      table?.deflectDamage(beat.deflection.card, beat.deflection.amount);
      sfx.play("block");
      floatNumber(beat.deflection.card, "blocked", "Blocked", `${beat.deflection.amount} damage`);
    }
    if (beat.discardEvent) {
      if (reacting?.card === beat.discardEvent) reacting = null;
      const card = state.discard.find((c) => c.id === beat.discardEvent);
      if (card) {
        table?.discardEvent(card);
        sfx.play("discard");
        if (staged?.id === card.id) staged = null;
      }
    }
    if (beat.modifier) {
      const change = beat.modifier;
      const card = [state.hero, state.villain, ...state.inPlay, ...state.enemyCards].find((c) => c.id === change.id);
      if (card) {
        activationRing(card.id);
        table?.setModifier(card, change.name, change.count);
      }
    }
    if (beat.statusChange) {
      const { id, name, delta } = beat.statusChange;
      if (delta > 0) {
        activationRing(id);
        await sleep(200);
      }
      table?.changeStatus(id, name, delta);
      if (name === "damage" && delta < 0) {
        floatNumber(id, "heal", `+${-delta}`, "healed");
        sfx.play("heal");
        const label = labels.get(id);
        if (label?.dataset.hp) updateHpLabel(label, Number(label.dataset.hp) - delta);
        table?.healBurst(id);
      } else if (delta < 0 && name === "stunned") {
        stampCard(id, "Unstunned", "status");
        sfx.play("status");
      } else if (delta > 0 && STATUS_STAMP[name]) {
        const [tone, text] = STATUS_STAMP[name]!;
        stampCard(id, text, tone);
        sfx.play("status");
      }
    }
    if (beat.turned) {
      const turns = [beat.turned];
      if (!beat.turned.exhausted) {
        while (beats[index + 1]?.turned?.exhausted === false) turns.push(beats[++index]!.turned!);
        dockTitle.textContent = turns.length > 1 ? `Ready ${plural(turns.length, "card")}` : beat.text;
        dockTitle.toggleAttribute("data-long", isSentence(dockTitle.textContent));
      }
      table?.turnCards(turns);
      sfx.play("turn");
      await sleep(beat.turned.exhausted ? EXHAUST_MS : READY_MS);
      continue;
    }
    if (beat.encounterDeal) {
      table?.dealEncounter(beat.encounterDeal, beat.boostFor ?? null);
      sfx.play("deal");
      const count = element("encounter-count");
      count.textContent = String(Math.max(0, Number(count.textContent) - 1));
      if (beat.boostFor) {
        // A boost card slides facedown under its enemy carrying its boost tag, which stays until it turns up.
        tagBoost(beat.encounterDeal);
        placeLabels();
        await sleep(reducedMotion() ? 300 : 900);
        continue;
      }
      // The encounter step, called out like the others: the table darkens around the card dealt to the player.
      // The card a run-out deck costs the player says so, not "the encounter step".
      const penalty = !!beat.penalty;
      narrate(
        beat,
        {
          text: penalty ? "Deck ran out: take an encounter card facedown" : "Deal an encounter card",
          icon: "forced",
          tone: "villain",
        },
        {
          eyebrow: { text: penalty ? "Deck ran out" : "Encounter", icon: "forced", tone: "villain" },
          title: penalty ? "Take an encounter card facedown" : "Deal an encounter card",
        },
      );
      dealtLit.push(beat.encounterDeal);
      setSpot({ glow: dealtLit.map((id) => ({ id, tone: "attack" as const })), cutouts: [...dealtLit] });
      spotted = true;
      placeLabels();
      // Stamped on landing, like a boost card.
      await sleep(reducedMotion() ? 120 : 480);
      stampCard(beat.encounterDeal, "Encounter");
      await sleep(reducedMotion() ? 300 : 900);
      continue;
    }
    if (beat.reveal) {
      // Nothing is aimed while a card is revealed, and no target sits over it.
      clearAim();
      untagBoost(beat.reveal.id);
      readingCard = beat.reveal.boost || beat.reveal.quick ? null : beat.reveal.id;
      // A card that will wait for Continue grows to full size while it turns over, not in a jump after.
      const willHold =
        !beat.reveal.boost &&
        !beat.reveal.quick &&
        !state.outcome &&
        !(state.choice?.sourceTitle && state.choiceSource === beat.reveal.id && !state.choice.searched?.length);
      if (willHold) table?.holdReveal(true);
      table?.revealEncounter(beat.reveal);
      sfx.play("flip");
      if (!beat.reveal.boost) parkedViews.set(beat.reveal.id, beat.reveal);
      await sleep(360);
      if (beat.reveal.art) {
        showPreview(beat.reveal, !beat.reveal.boost);
        paintStatusNotes(previewNotes, null);
      }
      if (beat.reveal.boost) {
        await showBoost(beat.reveal);
        dropBoostBurst(beat.reveal.id);
        // A boost that asks a question (Android Efficiency: "spend a [energy] resource or … a Drone minion") stays up,
        // full size with the table dimmed, like a revealed card asking: the player sees why they are asked (Adam,
        // 2026-11-25). Answered, it stands by the villain until the attack is over and it goes to the discard pile.
        if (state.choice?.sourceTitle && state.choiceSource === beat.reveal.id) {
          parkedViews.set(beat.reveal.id, beat.reveal);
          heldReveal = beat.reveal;
          heldEncounter = beat.reveal.id;
          readingCard = null;
          continue;
        }
        table?.retireEncounter(
          beat.reveal.id,
          state.encounterDiscard.find((c) => c.id === beat.reveal!.id),
        );
        continue;
      }
      heldReveal = beat.reveal;
      if (state.choice?.sourceTitle && state.choiceSource === beat.reveal.id) {
        if (state.choice.searched?.length) {
          // A search fills the screen with the cards it finds, so the card it comes from is read and fires first,
          // like any other reveal, and only then is the player asked (Adam, 2026-11-25: Masters of Mayhem's panel
          // came up before the card had been seen).
          await waitToBeRead(beat, beat.reveal);
          await whenRevealedFires(beat, beat.reveal);
          firedBeforeAsking.add(beat.reveal.id);
        }
        heldEncounter = beat.reveal.id;
        readingCard = null;
        continue;
      }
      // A card can interrupt its reveal (Enhanced Spider-Sense): it stays up while the player decides, with no
      // Continue; the question is the next step.
      const revealWindow = state.choice?.event;
      if (revealWindow?.kind === "encounterCardRevealing" && revealWindow.subject === beat.reveal.id) {
        heldEncounter = revealWindowHeld = beat.reveal.id;
        readingCard = null;
        continue;
      }
      if (state.outcome) {
        await sleep(650);
      } else if (beat.reveal.quick) {
        // Cleared first, so a second Hydra Mercenary in a row is announced again.
        const announcer = element("announcer");
        const said = `Revealed ${beat.reveal.name}`;
        announcer.textContent = "";
        setTimeout(() => (announcer.textContent = said), 60);
        // A minion with no When Revealed shows itself, then goes straight to its place: nothing to read out first.
        narrate(beat, null, {
          eyebrow: { text: revealedBy(beat.reveal), icon: "forced", tone: "villain" },
          title: beat.reveal.name,
        });
        await sleep(reducedMotion() ? 700 : beat.reveal.broughtBy ? 1900 : 1150);
      } else await waitToBeRead(beat, beat.reveal);
      readingCard = null;
      setWidePreview(false);
      const permanent = state.enemyCards.find((c) => c.id === beat.reveal!.id);
      if (permanent) {
        table?.landEncounter(threatOnArrival(permanent));
        sfx.play("place");
        if (beat.reveal.whenRevealed && !reducedMotion()) {
          // Lands on the mat first, then its When Revealed fires: it rises with a flash before the effect hits.
          await sleep(520);
          await whenRevealedFires(beat, beat.reveal);
        }
      } else {
        const left = leaveEncounter(beat.reveal.id, beats.slice(index + 1));
        await sleep(450);
        // Standing aside by the villain, it fires there: the attack or effect that follows is plainly its doing.
        if (left === "parked" && beat.reveal.whenRevealed && !reducedMotion())
          await whenRevealedFires(beat, beat.reveal);
      }
    }
    if (beat.encounterResolved) {
      // The treachery has done everything it does: it goes to the encounter discard pile, where it can be seen going.
      const id = beat.encounterResolved;
      if (
        table?.retireEncounter(
          id,
          state.encounterDiscard.find((c) => c.id === id),
        )
      ) {
        narrate(beat, { text: beat.text, icon: "discard", tone: "villain" });
        sfx.play("discard");
        await sleep(reducedMotion() ? 150 : 520);
      }
      continue;
    }
    if (beat.threat) {
      if (beat.enemy && beat.threat.delta > 0) {
        // The scheme's moment: the table darkens around it and its threat shows coming in before it lands.
        const scheme = beat.threat.scheme;
        spotted = true;
        // At the start of the villain phase the table darkens slowly onto the scheme, not all at once (Adam,
        // 2026-11-21: it felt too sudden), and the step waits for the fade.
        const fading = !spot && !reducedMotion();
        setSpot(
          {
            glow: [{ id: scheme, tone: "threat" }],
            cutouts: [scheme],
            mark: { id: scheme, kind: "threat", amount: beat.threat.delta },
          },
          { fade: fading },
        );
        placeLabels();
        // The villain phase's own threat step is stamped like the encounter step, so each step reads as one; once
        // only, so after a question about it (Great Responsibility, passed) the threat just lands.
        const step = beat.activity === "Place threat" && threatStepCalled !== scheme;
        if (step) stampCard(scheme, "Threat");
        threatStepCalled = null;
        await sleep((reducedMotion() ? 260 : step ? 900 : 620) + (fading ? SPOT_FADE_MS * 0.6 : 0));
        setSpot({ glow: [{ id: scheme, tone: "threat" }], cutouts: [scheme] });
      }
      // A scheme just revealed (Highway Robbery's starting threat) may still be flying to its place: the flash waits
      // for it there, rather than going off where it was read, over Rhino and the hero, like a targeting ring.
      for (let waited = 0; table?.flying(beat.threat.scheme) && waited < 1200; waited += 60) await sleep(60);
      activationRing(beat.threat.scheme);
      const counter = labels.get(beat.threat.scheme)?.querySelector<HTMLElement>(".scheme-threat");
      if (counter) {
        // The scheme reads what the move leaves it at after this beat (`to`), never what it showed plus the change: a
        // label redrawn mid-move then can't count the same threat twice.
        const n = beat.threat.to ?? Math.max(0, Number(counter.dataset.count) + beat.threat.delta);
        updateThreatLabel(counter, n);
        table?.setThreat(beat.threat.scheme, n);
      }
      sfx.play(beat.threat.delta > 0 ? "threat" : "thwart");
      floatNumber(
        beat.threat.scheme,
        beat.threat.delta > 0 ? "threat" : "thwart",
        `${beat.threat.delta > 0 ? "+" : "−"}${Math.abs(beat.threat.delta)}`,
        "threat",
      );
    }
    if (beat.hit) {
      // The attack has landed: its target goes.
      clearAim();
      const hitSound = !beat.hit.amount ? "block" : beat.hit.amount >= 4 ? "hit-heavy" : "hit";
      if (reacting?.kind === "placeThreat" && beat.hit.source === reacting.card) {
        // The threat it stopped turns into damage at the scheme and flies to the hero.
        await convertThreat(reacting.subject, beat.hit.target, beat.hit.amount);
        sfx.play(hitSound);
      } else {
        table?.strike(beat.hit.source, beat.hit.target);
        // Asked for as the strike starts: each hit's sync marker (set in the Sound Studio) lands on the contact.
        sfx.play(hitSound, { contactIn: HIT_CONTACT_MS });
        await sleep(HIT_CONTACT_MS);
      }
      if (beat.hit.tough) table?.changeStatus(beat.hit.target, "tough", -1);
      if (beat.hit.amount) {
        shakeStage(beat.hit.amount >= 4 ? "heavy" : "light");
        // A controller feels your side being hit (the hero, or an ally, there or just defeated), as the hit lands.
        const target = beat.hit.target;
        if (target === state.hero.id || [...state.inPlay, ...state.discard].some((card) => card.id === target))
          pad.rumble(0.35 + beat.hit.amount * 0.15);
        table?.changeStatus(beat.hit.target, "damage", beat.hit.amount);
        const label = labels.get(beat.hit.target);
        if (label?.dataset.hp) {
          const remaining = Math.max(0, Number(label.dataset.hp) - beat.hit.amount);
          updateHpLabel(label, remaining);
          if (!remaining && beat.hit.target === state.hero.id && state.outcome?.reason === "allPlayersDefeated") break;
        }
      }
      const anchor = table?.anchors().find((item) => item.id === beat.hit!.target);
      if (anchor) {
        impact.replaceChildren(
          make("span", "impact-number", beat.hit.amount ? `−${beat.hit.amount}` : beat.hit.tough ? "Tough" : "Blocked"),
        );
        if (beat.hit.amount) impact.append(make("small", "", "damage"));
        impact.style.left = anchor.x + "px";
        impact.style.top = anchor.y + "px";
        impact.dataset.blocked = String(!beat.hit.amount);
        impact.style.setProperty("--burst-size", Math.min(190, Math.max(80, anchor.width * 1.15)) + "px");
        impact.hidden = false;
      }
    }
    await sleep(beat.attackAim ? 390 : beat.hit ? 760 : beat.threat ? 820 : 1000);
    impact.hidden = true;
  }
  impact.hidden = true;
  announcement.hidden = true;
  setSpot(null);
  checkShownNumbers();
  beatsToCome = [];
  delete stage.dataset.resolving;
  anchors.inert = false;
  presenting = false;
  render();
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────────────────────────
function letGoOfEncounter(id: string, upcoming: readonly Beat[]) {
  const left = leaveEncounter(id, upcoming);
  table?.holdReveal(false);
  return left;
}

function render() {
  if (presenting) return;
  state = model.snapshot();
  if (!formHint.hidden) clearFormHint();
  if (state.payment || state.choice || state.turn !== "player") element("play-refusal").hidden = true;
  if (heldEncounter && !holdsEncounter(state, reacting, heldEncounter)) {
    // Passed on interrupting its reveal: it stays up for its When Revealed to play out first, with the new beats.
    if (revealWindowHeld === heldEncounter && presented !== state.beats && state.beats.length)
      releaseHeld = heldEncounter;
    else {
      const answered = presented !== state.beats && state.beats.length > 0;
      // Its question answered, it steps aside to stand by the villain while what was chosen plays out.
      if (letGoOfEncounter(heldEncounter, answered ? state.beats : []) === "parked" && answered)
        answeredHeld = heldEncounter;
    }
    revealWindowHeld = null;
    heldEncounter = null;
    inspect(hoveredCard);
  } else if (heldEncounter && revealWindowHeld === heldEncounter && !revealWindowFor(state, reacting, heldEncounter)) {
    // Passed, and the card's When Revealed asks its own question: that question shows it; nothing to fire after.
    revealWindowHeld = null;
  }
  if (!heldEncounter) choiceShade.style.clipPath = "";
  if (!state.choice?.offers?.length) triggerChoice = null;
  if (!state.choice) choicePicks.clear();
  if (defenderSelection !== state.choice) defenderSelection = null;
  const defenseQuestion = !!defenseQuestionDecline(state.choice);
  const defending = !!state.choice?.defense && !defenseQuestion;
  if (state.choice?.defense) aimTarget = state.choice!.defense!.target;
  else if (!state.choice) aimTarget = null;
  // Asked to defend, the target is on the hero being attacked; it flies there from the attacker if it wasn't showing.
  const aimWasHidden = reticle.hidden;
  reticle.hidden = !aimTarget || (!state.choice?.defense && !state.choice?.options.some((o) => o.cardId === aimTarget));
  setSpot(null);
  if (presented !== state.beats) {
    presented = state.beats;
    for (const beat of presented) if (beat.text) story.push(beat.text);
    if (presented.length) {
      // The question is answered: its picks stop glowing now, not once everything it set off has played out.
      unmarkPicks();
      void present(presented);
      return;
    }
  }
  for (const id of table?.parkedEncounters() ?? [])
    if (state.encounterDiscard.some((c) => c.id === id))
      table?.retireEncounter(
        id,
        state.encounterDiscard.find((c) => c.id === id),
      );
  table?.reconcileEncounters([
    ...state.facedownEncounters,
    ...(state.choiceSource ? [state.choiceSource] : []),
    ...(heldEncounter ? [heldEncounter] : []),
    ...(table?.parkedEncounters() ?? []),
  ]);
  // Paying for a reaction is a move of its own that Undo can come back to: it keeps its card and reaction too.
  if (!flying && (!state.payment || model.payingForReaction) && !state.choice?.canCancel) {
    const reveal = heldEncounter
      ? (state.beats.find((b) => b.reveal?.id === heldEncounter)?.reveal ??
        moveViews.get(state.beats)?.reveal ??
        (heldReveal?.id === heldEncounter ? heldReveal : undefined))
      : undefined;
    moveViews.set(state.beats, {
      staged: staged && !state.hand.some((c) => c.id === staged!.id) ? staged : null,
      reveal,
      aim: aimTarget,
      parked: (table?.parkedEncounters() ?? []).flatMap((id) => {
        const shown = parkedViews.get(id);
        return shown ? [shown] : [];
      }),
      reacting: state.payment ? reacting : null,
    });
  }
  const paymentSubject = state.payment?.subject;
  if (paymentSubject && !staged && state.hand.some((card) => card.id === paymentSubject.id)) {
    staged = paymentSubject;
  }
  const abilityCards =
    state.payment?.sources.flatMap((source) => {
      if (source.kind !== "resourceAbility") return [];
      const id = resourcePieceId(source);
      if (id === source.cardId) return [];
      const card = [state.hero, ...state.inPlay, ...state.hand].find((c) => c.id === source.cardId);
      return card ? [{ ...card, id, resourceAbility: true, reverseArt: null }] : [];
    }) ?? [];
  displayedHand = [...abilityCards, ...state.hand.filter((card) => card.id !== staged?.id)];
  droneIds = new Set(state.enemyCards.flatMap((card) => (card.drone ? [card.id] : [])));
  const selected =
    state.payment?.sources.filter((item) => item.selected).map(resourcePieceId) ??
    // In the order picked: the table stacks the last one picked in front (`TableCards.selected`).
    (state.choice
      ? [...choicePicks].flatMap((id) => {
          const cardId = state.choice!.options.find((option) => option.id === id)?.cardId;
          return cardId ? [cardId] : [];
        })
      : null) ??
    [];
  if (state.payment || state.choice || discardOpen || state.turn !== "player") menuCard = null;
  paintReading();
  const spendLit = state.payment ? null : spendSources();
  table?.setCards({
    handPick: !!(state.choice?.discardFromHand || state.choice?.mulligan),
    defending,
    menuCard,
    hero: state.hero,
    villain: state.villain,
    inPlay: state.inPlay,
    enemyCards: state.enemyCards,
    under: state.under,
    discard: state.discard.filter((c) => c.id !== staged?.id),
    deckCount: state.deckCount,
    encounterCount: state.encounterCount,
    encounterDiscard: state.encounterDiscard,
    viewingEncounterDiscard,
    drawn: state.drawn,
    targets:
      state.choice &&
      !defenseQuestion &&
      // An either-or's spend step too: the boost card asking steps aside so every card that can pay shows.
      (state.choice.max <= 1 || state.choice.eitherOr === "spend") &&
      !state.choice.discardFromHand &&
      !state.choice.mulligan
        ? state.choice.options.flatMap((item) =>
            item.cardId && onTable(item.cardId) && (!spendLit || spendLit.includes(item.cardId)) ? [item.cardId] : [],
          )
        : [],
    // A spend's asking card stays clear of every payer, lit or not (`TableCards.asideFor`).
    ...(spendLit && state.choice
      ? {
          asideFor: state.choice.options.flatMap((item) => (item.cardId && onTable(item.cardId) ? [item.cardId] : [])),
        }
      : {}),
    discardOpen,
    hand: displayedHand,
    staged,
    stagedOverEnemies: !!staged && staged.id === stagedAttachment,
    paymentSources: state.payment?.sources.filter((s) => s.available).map(resourcePieceId) ?? spendLit,
    spendMarks: spendMarks(),
    selected,
  });
  table?.markActor(state.choiceSource);
  discardFan.hidden = !discardOpen;
  syncBoostTags();
  synchronizeLabels();
  announceGuards();
  if (!state.choice?.guard) dropGuardHint();
  element("board-viewport").toggleAttribute("data-paying", !!state.payment);
  pile.disabled = !state.discard.length || flying || discarding || !!state.payment;
  pile.setAttribute("aria-expanded", String(discardOpen && !viewingEncounterDiscard));
  encounterPile.setAttribute("aria-expanded", String(discardOpen && viewingEncounterDiscard));
  encounterPile.hidden = !state.encounterDiscard.length;
  encounterPile.disabled = !state.encounterDiscard.length || flying || discarding || !!state.payment;
  element("encounter-discard-count").textContent = String(state.encounterDiscard.length);
  const count = state.discard.length;
  pile.setAttribute("aria-label", `${discardOpen ? "Stack" : "Inspect"} discard pile, ${plural(count, "card")}`);
  pileCount.textContent = String(state.discard.length);
  element("encounter-count").textContent = String(state.encounterCount);
  deckCount.textContent = String(state.deckCount);
  renderCardMenu();
  // While paying for a reaction (Enhanced Spider-Sense) Undo still goes back to its question; paying for a card from
  // the hand has Cancel for that.
  undoButton.disabled =
    !model.canUndo ||
    flying ||
    discarding ||
    (!!state.payment && !model.payingForReaction) ||
    !!state.choice?.canCancel;
  restart.disabled = discarding || !!state.payment;
  if (state.outcome) {
    turnStatus.textContent = state.outcome.result === "win" ? "Victory" : "Defeat";
    turnStatus.dataset.phase = state.outcome.result === "win" ? "hero" : "villain";
  } else
    phaseIndicator(
      state.choice?.mulligan
        ? "setup"
        : state.turn === "enemy"
          ? "villain"
          : state.turn === "ending"
            ? "ending"
            : "hero",
    );
  // A question answered only with the dock's buttons softens the table behind it, so it reads as the game waiting on
  // that answer; the card asking it (or the encounter card held up with it) stays sharp.
  // An either-or's spend step lets the whole table be reached: the hand and the cards in play that can pay.
  const waiting =
    state.choice?.eitherOr !== "spend" && waitsOnDock(state.choice, (id) => onTable(id) && actionCard !== id);
  dockFocus =
    waiting && !revealFocus && !rowFocus.length ? { keep: heldEncounter ?? state.choiceSource ?? null } : null;
  const blurWasHidden = focusBlur.hidden;
  focusBlur.hidden = !handQuestion() && !revealFocus && !dockFocus && !rowFocus.length;
  if (focusBlur.hidden) delete focusBlur.dataset.ready;
  else if (dockFocus && blurWasHidden) requestAnimationFrame(() => dockFocus && (focusBlur.dataset.ready = ""));
  choiceShade.hidden =
    !state.choice || !heldEncounter || !!state.choice.offers?.length || state.choice.eitherOr === "spend";
  const asked = paintDock(dockView());
  // A question about the hand sends a ripple through it, so the eye goes where the answer is.
  if (asked && (state.choice?.discardFromHand || state.choice?.mulligan)) table?.waveHand();
  // A question darkens the table around what it is about: the attacker (red), or what an interrupt would change.
  setSpot(
    clearOfShade(
      spotOf(state.choice, state, {
        offerIndex,
        choosingDefender: !defenseQuestionDecline(state.choice),
        heldEncounter,
      }),
    ),
  );
  // That spotlight shades the table itself, the held card cut out with the cards it asks for (`spotOf`).
  if (spot && heldEncounter && spot.cutouts.includes(heldEncounter)) choiceShade.hidden = true;
  if (state.choice?.defense) inspect(state.choice.defense.attackerId);
  if (state.choice?.offers?.length) inspect(state.choice.offers[offerIndex]?.cardId ?? null);
  placeLabels();
  if (state.choice?.defense && aimWasHidden && !reticle.hidden) {
    const projected = table?.anchors();
    aimFrom(
      projected?.find((a) => a.id === state.choice!.defense!.attackerId),
      projected?.find((a) => a.id === aimTarget),
    );
  }
  showOutcome(state.outcome);
}

/**
 * The cards the player can pick right now, on the table or in the hand: the question's cards and, while paying, the
 * resources that can go in.
 */
function selectableCards(): string[] {
  const ids = new Set<string>();
  const hand = new Set(displayedHand.map((card) => card.id));
  const choice = state.choice;
  if (choice && !defenseQuestionDecline(choice))
    for (const option of choice.options)
      if (option.cardId && (onTable(option.cardId) || hand.has(option.cardId))) ids.add(option.cardId);
  for (const source of state.payment?.sources ?? []) if (source.available) ids.add(resourcePieceId(source));
  return [...ids];
}

/**
 * Nothing the player can pick is ever under the shade (Adam, 2026-11-26: the hand cards that could pay Android
 * Efficiency glowed under the dark): each one is cut out of it, its nameplate kept bright. A held encounter card asking
 * about cards in the hand only still gets its shade, the card and its picks cut out of it, rather than the full-screen
 * one that covers the hand.
 */
function clearOfShade(next: Spot | null): Spot | null {
  const picks = selectableCards();
  if (!picks.length) return next;
  if (!next) {
    if (!heldEncounter || state.choice?.offers?.length) return null;
    return { glow: [{ id: heldEncounter, tone: "attack" }], cutouts: [heldEncounter, ...picks], plates: picks };
  }
  return {
    ...next,
    cutouts: [...new Set([...next.cutouts, ...picks])],
    plates: [...new Set([...(next.plates ?? []), ...picks])],
  };
}

/** The hero's or an ally's own menu, opened by clicking the card: its basic powers and abilities. */
function renderCardMenu() {
  decision.replaceChildren();
  decision.hidden = !menuCard || discardOpen;
  decision.toggleAttribute("data-identity", !!menuCard);
  if (!menuCard) {
    // A hidden menu sends no pointerleave: let go of it here, and of the menu card's picture with it.
    if (overMenu) {
      overMenu = false;
      showHovered();
    }
    return;
  }
  const id = menuCard;
  const card = [state.hero, ...state.inPlay].find((c) => c.id === id);
  const actions = id === state.hero.id ? state.heroActions : model.fieldActions(id);
  if (!actions.length) decision.append(make("p", "menu-note", card?.exhausted ? "Exhausted" : "No actions available"));
  // A power missing for a reason the hero's own card doesn't show (no scheme's threat can be removed) says why.
  if (id === state.hero.id) for (const note of model.heroNotes()) decision.append(make("p", "menu-note", note));
  for (const action of actions) {
    const button = make("button", "btn btn-secondary menu-action");
    button.type = "button";
    button.dataset.power = action.kind;
    if (action.kind === "basicAttack" || action.kind === "basicThwart" || action.kind === "basicRecover") {
      const stat = action.kind === "basicAttack" ? "atk" : action.kind === "basicThwart" ? "thw" : "rec";
      const value = model.basicPower(id, stat);
      const description = `${action.label} with ${card?.name ?? "card"} (${value} ${stat.toUpperCase()})`;
      button.setAttribute("aria-label", description);
      button.title = description;
      button.classList.add("stat-action");
      button.style.setProperty("--stat-color", statHue[stat].css);
      // Drawn like the printed stat on a card: the value in a coloured starburst over a THW/ATK/REC banner.
      button.replaceChildren(make("b", "stat-value", String(value)), make("span", "stat-ribbon", stat.toUpperCase()));
    } else if (action.kind === "changeForm") {
      button.classList.add("form-action");
      button.replaceChildren(icon("flip"), make("span", "", action.label));
    } else if ("exhausts" in action && action.exhausts) {
      const description = `${card?.name ?? "Card"}: ${action.label}`;
      button.setAttribute("aria-label", description);
      button.title = description;
      button.classList.add("exhaust-action");
      button.replaceChildren(icon("exhaust"), make("span", "", action.label));
    } else {
      button.replaceChildren(icon("action"), make("span", "", action.label));
    }
    button.onclick = () => useCardAction(id, action.kind);
    decision.append(button);
  }
  // No close button: a click anywhere else, Escape or a controller's B puts the menu away.
}

/** Use one of a card's own actions: a button in its menu, or a controller's LT / RT combo (`controller.ts`). */
function useCardAction(id: string, kind: string) {
  menuCard = null;
  act(() => {
    if (id === state.hero.id) model.heroAction(kind);
    else model.fieldAction(id, kind);
  });
  inspect(id);
}

/** A controller's LT and RT combos use powers only when the menus that hold them could open. */
function powersReady() {
  return (
    !presenting &&
    !flying &&
    !discarding &&
    !discardOpen &&
    !state.outcome &&
    !state.payment &&
    !state.choice &&
    state.turn === "player"
  );
}

// ── Starting a game ───────────────────────────────────────────────────────────────────────────────────────────────
function seedFromUrl(): number | undefined {
  const seed = Number(new URLSearchParams(location.search).get("seed"));
  return Number.isInteger(seed) && seed > 0 ? seed : undefined;
}

// ── Which villain ─────────────────────────────────────────────────────────────────────────────────────────────────
// The campaign shelf's box is the villain Play deals, and what Try Again deals again; the game in progress keeps its
// own. `?villain=klaw` in the address picks one for that page (tests, scenes, the play hook); otherwise the last
// choice on this device, and Rhino on a first visit.
const villainName = (id: VillainId) => VILLAINS.find((villain) => villain.id === id)!.name;
function initialVillain(): VillainId {
  const asked = new URLSearchParams(location.search).get("villain");
  if (isVillainId(asked)) return asked;
  try {
    const saved = localStorage.getItem("battle-villain");
    if (isVillainId(saved)) return saved;
  } catch {
    // Private windows may refuse storage: Rhino it is.
  }
  return "rhino";
}
let villainChoice: VillainId = initialVillain();
/** The villain of the game on the table. */
let villainDealt: VillainId = villainChoice;

function setVillainChoice(villain: VillainId) {
  villainChoice = villain;
  try {
    localStorage.setItem("battle-villain", villain);
  } catch {
    // The choice just lasts this visit.
  }
  // An address that named a villain follows the choice, so a reload deals the one chosen.
  const params = new URLSearchParams(location.search);
  if (params.has("villain")) {
    params.set("villain", villain);
    history.replaceState(history.state, "", `${location.pathname}?${params.toString()}${location.hash}`);
  }
}

function paintMatchup() {
  const villain = villainName(villainDealt);
  document.title = `Spider-Man vs. ${villain} · Marvel Champions`;
  element("matchup").textContent = `Spider-Man vs. ${villain}`;
  const title = element("menu-title");
  title.replaceChildren(
    "Spider-Man ",
    Object.assign(document.createElement("i"), { textContent: "vs." }),
    ` ${villain}`,
  );
}

/** A game has been dealt in this page, so a `?scene=` set-up has had its turn. */
let sceneDealt = false;
/** The game on the table, as the test site saves it to the player's record (null when nothing is saved). */
let gameSaved: GameHandle | null = null;

function deal() {
  if (gameMenu.open) gameMenu.close();
  lastQuestion = "";
  menuCard = null;
  actionCard = null;
  restart.disabled = true;
  flying = false;
  discardOpen = false;
  choicePicks.clear();
  staged = null;
  heldEncounter = revealWindowHeld = releaseHeld = answeredHeld = null;
  firedBeforeAsking.clear();
  foundAt.clear();
  heldReveal = undefined;
  readingCard = null;
  aimTarget = null;
  reacting = null;
  parkedViews.clear();
  // Every card from the last game leaves the table, even one left standing aside when it ended.
  table?.newGame();
  feed = [];
  paintFeed();
  const seed = seedFromUrl() ?? Math.floor(Math.random() * 2 ** 31) + 1;
  // Dev builds only: `?scene=crowded` skips the mulligan and lays out a busy table for checking the presentation.
  // A set-up is the first game's only: Try again or New game after it starts a real game from the opening (no threat
  // already on the scheme), and the address drops it so a reload does too.
  const params = new URLSearchParams(location.search);
  if (sceneDealt && params.has("scene")) {
    params.delete("scene");
    const query = params.toString();
    history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
  }
  sceneDealt = true;
  // A scene names its own villain (Rhino unless it says Klaw).
  const sceneName = params.get("scene") ?? "";
  const arrange = import.meta.env.DEV ? arrangeScene(sceneName) : undefined;
  const villain = arrange ? sceneVillain(sceneName) : villainChoice;
  model.reset(arrange ? { villain, seed, arrange } : { villain, seed, mulligan: true });
  villainDealt = villain;
  // A set-up or a chosen shuffle is a check, not a game: it never goes on a record.
  gameSaved = arrange || seedFromUrl() !== undefined ? null : startGame(villain);
  paintMatchup();
  // The table opens with what the scenario's setup already did (Ultron's Drones environment and the first Drone off
  // the player's deck): the log says so, so nothing on it is there unexplained.
  for (const note of model.setupNotes) {
    story.push(note);
    pushFeed({ text: note, icon: "deck", tone: "villain" });
  }
  paintFeed();
  state = model.snapshot();
  presented = state.beats;
  if (!table) {
    table = new BattleTable(element("space"), boardViewport, {
      onPick: pick,
      onHover: hoverCard,
      onLanded: landed,
      onDismissDiscard: () => setDiscardOpen(false),
      onDraw: () => {
        placeLabels();
        placeDock();
        placeHoverCard();
      },
      onDiscardLanded: (count) => {
        pileCount.textContent = String(count);
      },
    });
    // Dev builds expose the scene for checking it from the console and from scripted screenshots.
    if (import.meta.env.DEV) (window as unknown as { battleTable?: BattleTable }).battleTable = table;
  }
  if (!roomy.matches)
    table?.setBottomReserve(
      Math.max(0, boardViewport.getBoundingClientRect().bottom - dock.getBoundingClientRect().top),
    );
  // Every picture this game can show starts loading now, so no card turns over black (online they download).
  table?.preload(model.pictures());
  layoutHand();
  render();
  inspect(state.hand.find((card) => card.playable)?.id ?? state.hero.id);
  restart.disabled = false;
  placeLabels();
}

function start() {
  // A new game calls out its guard minions afresh (instance ids repeat from game to game).
  guardsCalled.clear();
  pinCard(null);
  table?.holdReveal(false);
  try {
    deal();
  } catch (error) {
    dockTitle.textContent = error instanceof Error ? error.message : "Could not open the table.";
    restart.disabled = false;
    console.error(error);
  }
}
let dismissTarget: EventTarget | null = null;
// Dismiss on pointer-down, before the canvas or label handles the new click.
document.addEventListener(
  "pointerdown",
  (event) => {
    dismissTarget = null;
    if (!menuCard || !(event.target instanceof Element) || decision.contains(event.target)) return;
    if (event.target.closest(".anchor")?.getAttribute("data-card") === menuCard) return;
    if (event.target.closest("#space") && table?.cardAt(event) === menuCard) return;
    dismissTarget = event.target;
    event.preventDefault();
    event.stopPropagation();
    menuCard = null;
    render();
  },
  true,
);
document.addEventListener(
  "click",
  (event) => {
    if (dismissTarget && dismissTarget === event.target) {
      event.preventDefault();
      event.stopPropagation();
    }
    dismissTarget = null;
  },
  true,
);
undoButton.onclick = () => {
  if (undoButton.disabled || presenting || flying || discarding || !model.undo()) return;
  state = model.snapshot();
  presented = state.beats;
  const view = moveViews.get(state.beats);
  staged = view?.staged ?? null;
  heldEncounter = view?.reveal?.id ?? null;
  reacting = view?.reacting ?? null;
  revealWindowHeld = heldEncounter && revealWindowFor(state, reacting, heldEncounter) ? heldEncounter : null;
  releaseHeld = answeredHeld = null;
  aimTarget = view?.aim ?? null;
  menuCard = actionCard = null;
  discardOpen = false;
  choicePicks.clear();
  table?.reconcileEncounters([]);
  say("Move undone");
  render();
  for (const id of state.facedownEncounters)
    table?.dealEncounter(id, state.facedownBoosts.find((boost) => boost.id === id)?.enemy ?? null);
  for (const card of view?.parked ?? []) {
    table?.revealEncounter(card);
    table?.parkEncounter(card.id);
  }
  if (view?.reveal) {
    // Full size only when it waits on a reaction to its reveal; a card's own question shows it at table size.
    if (revealWindowHeld) table?.holdReveal(true);
    table?.revealEncounter(view.reveal);
  }
  // An event being paid for waits where payments put it, not on the hero.
  if (staged?.type === "event" && !state.payment) {
    if (awaitsTarget(staged.id)) table?.holdEvent(staged.id);
    else table?.channelEvent(staged.id);
  }
  inspect(heldEncounter ?? state.hero.id);
};
// New game goes back to the campaign shelf, to pick a box (Adam, 2026-11-24); Try Again deals the same villain again.
restart.textContent = "New game";
restart.onclick = () => {
  if (gameMenu.open) gameMenu.close();
  void showShelf();
};
menuButton.onclick = () => {
  if (!gameMenu.open) gameMenu.showModal();
};
element<HTMLButtonElement>("menu-resume").onclick = () => gameMenu.close();
// Report a bug, in the menu: the player's words and the moment on the table (report/).
installReport({
  menu: gameMenu,
  capture: () =>
    momentOf(
      {
        snapshot: model.snapshot(),
        state: model.engineState,
        inGame: !shelfUp,
        // 0.2.x deals only Spider-Man, on standard, with each villain's recommended Core Set module.
        hero: "Spider-Man",
        villain: villainName(villainDealt),
        difficulty: "standard",
        modules: [({ rhino: "Bomb Scare", klaw: "Masters of Evil", ultron: "Under Attack" } as const)[villainDealt]],
        seed: model.seed,
        story,
        asking: [dockTitle.textContent, instruction.textContent]
          .map((text) => text?.trim())
          .filter(Boolean)
          .join(" · "),
        version: import.meta.env.VITE_TABLE_VERSION ?? null,
      },
      window,
      document.documentElement.dataset.input ?? "mouse",
    ),
});
// What's new, at the foot of the menu beside Report a bug (patch-notes/).
installPatchNotesButton(gameMenu);
// Which side the card reader and log sit on, remembered on this device.
function setSidebarSide(side: "left" | "right") {
  arena.setAttribute("data-rail", side);
  paintRailToggle();
  for (const button of gameMenu.querySelectorAll<HTMLButtonElement>("[data-side]"))
    button.setAttribute("aria-pressed", String(button.dataset.side === side));
  try {
    localStorage.setItem("battle-sidebar-side", side);
  } catch {
    // Private windows may refuse storage: the choice just lasts this visit.
  }
}
for (const button of gameMenu.querySelectorAll<HTMLButtonElement>("[data-side]"))
  button.onclick = () => setSidebarSide(button.dataset.side === "left" ? "left" : "right");
try {
  setSidebarSide(localStorage.getItem("battle-sidebar-side") === "left" ? "left" : "right");
} catch {
  setSidebarSide("right");
}
// Sound on or off, remembered on this device. Browsers keep audio locked until the player first clicks, taps or
// presses a key, so every such input also unlocks it (and wakes it after the tab was hidden).
function paintSound() {
  for (const button of gameMenu.querySelectorAll<HTMLButtonElement>("[data-sound]"))
    button.setAttribute("aria-pressed", String((button.dataset.sound === "on") === sfx.enabled));
}
for (const button of gameMenu.querySelectorAll<HTMLButtonElement>("[data-sound]"))
  button.onclick = () => {
    sfx.enabled = button.dataset.sound === "on";
    paintSound();
    sfx.play("confirm");
  };
paintSound();
for (const type of ["pointerdown", "keydown", "touchend"] as const)
  addEventListener(type, () => sfx.unlock(), { capture: true, passive: true });
tryAgain.onclick = start;
gameOverUndo.onclick = () => undoButton.click();
gameOver.oncancel = (event) => event.preventDefault();
pile.onclick = () => setDiscardOpen(!discardOpen || viewingEncounterDiscard, false);
encounterPile.onclick = () => setDiscardOpen(!discardOpen || !viewingEncounterDiscard, true);
document.addEventListener(
  "click",
  (event) => {
    if (
      !discardOpen ||
      !(event.target instanceof Element) ||
      event.target.closest(
        "#space, #discard-label, #encounter-discard, #discard-fan, #dock, #turn-corner, #undo-corner, #rail-toggle",
      )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setDiscardOpen(false);
  },
  true,
);
/** Escape, or a controller's B: put away the topmost thing. An open dialog handles its own. */
function back() {
  if (gameMenu.open || gameOver.open) return;
  if (pinnedId) {
    pinCard(null);
    return;
  }
  if (menuCard) {
    menuCard = null;
    render();
    return;
  }
  if (state?.payment && !discarding) {
    cancel();
    return;
  }
  if (discardOpen) {
    setDiscardOpen(false);
    pile.focus({ preventScroll: true });
    return;
  }
  if (state?.choice?.canCancel && !discarding && !presenting) {
    cancel();
    return;
  }
  // Nothing else to put away: the menu (the dialog closes itself on a second Escape).
  gameMenu.showModal();
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || gameMenu.open || gameOver.open) return;
  event.preventDefault();
  back();
});
// ── The turn corner, the card panel and where the bar floats (wider screens) ───────────────────────────────────────
endTurnButton.replaceChildren(icon("next"), make("span", "", "End Turn"));
endTurnButton.onclick = (event) => {
  if (!endTurnButton.disabled && (event.detail === 0 || settled())) endTurn();
};
// While a revealed card waits to be read, the see-through Continue layer lies over the whole page, so the bar's own
// Continue under it never gets a real hover. Light it whenever the pointer is over where it shows.
function mirrorRevealHover(event?: PointerEvent) {
  const box = dockPrimary.getBoundingClientRect();
  const over =
    !!event &&
    !readReveal.hidden &&
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom;
  dockPrimary.toggleAttribute("data-hover", over);
}
readReveal.addEventListener("pointermove", mirrorRevealHover);
readReveal.addEventListener("pointerleave", () => mirrorRevealHover());
readReveal.addEventListener("click", () => mirrorRevealHover());
// Ctrl+Space ends the turn: the same as pressing End Turn, so it does nothing whenever the button is greyed out.
// A Mac names its keys by their symbols (⌃ control, ⌘ command), and its players undo with ⌘Z.
const onMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
endTurnButton.title = onMac ? "End Turn (⌃Space)" : "End Turn (Ctrl+Space)";
document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
  event.preventDefault();
  if (event.repeat || gameMenu.open || gameOver.open || endTurnButton.disabled) return;
  endTurnButton.click();
});
// Enter presses whichever yellow button is on screen: the bar's (Keep hand, Continue, Confirm...) while it is out,
// else the turn corner's End Turn. A choice the keyboard has moved onto in the bar (Pass, an option) keeps Enter for
// itself, and the menu and game-over dialogs keep their own (Enter there presses the button they focus).
const pressable = (button: HTMLButtonElement) => !button.disabled && !button.hidden && button.offsetParent !== null;
function yellowButton(): HTMLButtonElement | null {
  const barOut = !roomy.matches || !dock.hasAttribute("data-idle");
  if (barOut && pressable(dockPrimary)) return dockPrimary;
  if (pressable(endTurnButton)) return endTurnButton;
  return null;
}
let lastEnter: { button: HTMLButtonElement | null; at: number } = { button: null, at: -Infinity };
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
  if (gameMenu.open || gameOver.open) return;
  const focus = document.activeElement as HTMLElement | null;
  if (focus?.matches("input, textarea, select")) return;
  if (focus !== dockPrimary && focus?.closest("#dock") && focus.matches("button:not(:disabled)")) return;
  const button = yellowButton();
  if (!button) return;
  event.preventDefault();
  // A quick second Enter must not land on the button that took the place of the one just pressed (Keep hand, then
  // straight on to End Turn).
  const now = performance.now();
  if (event.repeat || (button !== lastEnter.button && now - lastEnter.at < 500)) return;
  lastEnter = { button, at: now };
  button.click();
});
// Ctrl+Z takes the last move back, as Undo does (on the game-over screen, its Undo last move).
undoButton.title = onMac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)";
document.addEventListener("keydown", (event) => {
  if (event.code !== "KeyZ" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  if ((document.activeElement as HTMLElement | null)?.matches("input, textarea")) return;
  event.preventDefault();
  if (event.repeat || gameMenu.open) return;
  const undo = gameOver.open ? element<HTMLButtonElement>("game-over-undo") : undoButton;
  if (pressable(undo)) undo.click();
});

/**
 * The table sinks the hand on a wider screen. A narrow table (a tablet held upright beside the card panel) has no
 * width to spare beside the corners, so its hand stands whole above them instead of sinking.
 */
let handOverCorner = false;
function layoutHand() {
  handOverCorner = roomy.matches && boardViewport.clientWidth < 720;
  const sunk = roomy.matches && !handOverCorner;
  if (handOverCorner) table?.setBottomReserve(turnCorner.offsetHeight + 16);
  table?.setHandLayout({ sunk });
  placeDock();
}

/**
 * End Turn spans the foot of the card panel while the panel is open on a wider screen, and keeps the table's
 * bottom-right corner while it is folded (Adam, 2026-11-23). On a phone the bar carries it, as before.
 */
let endTurnMove = 0;
function placeEndTurn(sliding = false) {
  const button = element<HTMLButtonElement>("end-turn");
  const home = roomy.matches && !arena.hasAttribute("data-collapsed") ? railTurn : turnCorner;
  const move = ++endTurnMove;
  if (button.parentElement === home) {
    button.style.opacity = "";
    return;
  }
  if (!sliding || reducedMotion()) {
    button.style.transition = button.style.opacity = "";
    home.append(button);
    return;
  }
  // While the card panel slides, End Turn is hidden: moved at once, it rode the widening table and flickered left
  // then right (Adam, 2026-11-23). Once the panel has settled it moves to its new place and fades quickly in.
  button.style.transition = "none";
  button.style.opacity = "0";
  // When the panel's slide has ended (a backstop timer in case the transition never reports, a hidden tab say).
  let settled = false;
  const show = () => {
    arena.removeEventListener("transitionend", ended);
    if (settled || move !== endTurnMove) return;
    settled = true;
    home.append(button);
    void button.offsetWidth;
    button.style.transition = "opacity 140ms ease-out";
    button.style.opacity = "1";
    window.setTimeout(() => {
      if (move === endTurnMove) button.style.transition = button.style.opacity = "";
    }, 160);
  };
  const ended = (event: TransitionEvent) => {
    if (event.target === arena && event.propertyName === "grid-template-columns") show();
  };
  arena.addEventListener("transitionend", ended);
  window.setTimeout(show, RAIL_SLIDE_MS * 3);
}

/** Undo has the bottom-left corner on a wider screen, opposite End Turn; on a phone it sits in the bar. */
function placeUndo() {
  const home = roomy.matches ? undoCorner : dockActions;
  if (undoButton.parentElement !== home) home.prepend(undoButton);
}

// The card panel folds away completely; a card being read then floats over the table's edge instead.
const RAIL_KEY = "battle-sidebar-collapsed";
/** How long the card panel takes to slide open or shut (`.arena`'s grid transition in battle.css). */
const RAIL_SLIDE_MS = 240;
function paintRailToggle() {
  const collapsed = arena.hasAttribute("data-collapsed");
  const left = arena.dataset.rail === "left";
  railToggle.textContent = collapsed
    ? left
      ? "Card panel \u203a"
      : "\u2039 Card panel"
    : left
      ? "\u2039 Hide panel"
      : "Hide panel \u203a";
  railToggle.setAttribute("aria-expanded", String(!collapsed));
  railToggle.setAttribute("aria-label", collapsed ? "Show card panel" : "Hide card panel");
}
function setRailCollapsed(collapsed: boolean, remember = true) {
  arena.toggleAttribute("data-collapsed", collapsed);
  paintRailToggle();
  if (remember)
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? "1" : "0");
    } catch {
      // Private windows may refuse storage: the choice just lasts this visit.
    }
  placeEndTurn(remember);
  layoutHand();
}
placeUndo();
railToggle.onclick = () => setRailCollapsed(!arena.hasAttribute("data-collapsed"));
let railStored: string | null = null;
try {
  railStored = localStorage.getItem(RAIL_KEY);
} catch {
  railStored = null;
}
// Every game starts with the panel folded, the table at full width; hovering a card shows it beside itself (Adam,
// 2026-11-23: "the default load to be with the sidebar collapsed"). Opening it lasts the visit. A touch screen has no
// hover to bring a folded card up, so there it keeps the last choice, open until chosen.
setRailCollapsed(matchMedia("(hover: hover)").matches || (railStored ? railStored === "1" : false), false);

/**
 * A folded card panel floats the card whose menu is open over the table's edge on a touch screen (no hover). A
 * hovered card shows beside itself instead (`placeHoverCard`), or full size in place if it is in the hand.
 */
function paintReading() {
  // Only without a mouse: with one, the card being pointed at already shows beside itself or grows in the hand.
  arena.toggleAttribute("data-reading", !!menuCard && !hoveredCard && touchOnly.matches);
}
const touchOnly = matchMedia("(hover: none)");

/**
 * With the card panel folded, a hovered table card shows full size right beside it (`besideSpot`), following it on
 * every frame the table draws. A hand card needs none: the table grows it where it stands.
 */
/**
 * Right-click a card to pin it full size at the table's side (the card panel's side), to compare others against as
 * they are hovered. Right-clicking it again, its close button or Escape unpins it; another card replaces it.
 */
function pinCard(id: string | null) {
  const card = id
    ? (cards().find((item) => item.id === id) ?? (state.payment?.subject.id === id ? state.payment.subject : undefined))
    : undefined;
  if (!card?.art || id === pinnedId) {
    pinnedId = null;
    pinnedCard.hidden = true;
    placeHoverCard();
    return;
  }
  pinnedId = card.id;
  pinnedPicture.src = card.art;
  pinnedPicture.alt = card.name;
  pinnedCard.toggleAttribute("data-landscape", !!card.landscape);
  pinnedCard.hidden = false;
  if (!reducedMotion()) pinnedCard.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
  placeHoverCard();
}

/** The card is in the hand as the table shows it, a payment's stand-in for a resource ability included. */
function inHand(id: string) {
  return displayedHand.some((card) => card.id === id) || !!state?.hand.some((card) => card.id === id);
}

function placeHoverCard() {
  const preview = hoveredCard ? previewSpot(hoveredCard) : null;
  if (!preview) {
    hoverPicture.hidden = true;
    hoverNotes.hidden = true;
    return;
  }
  const { card, size, spot } = preview;
  // A short fade as it appears or moves on to another card, so it never snaps in from nowhere.
  const shown = pictureOf(hoverPicture.getAttribute("src") ?? "");
  const fresh = hoverPicture.hidden || shown !== card.art;
  if (shown !== card.art) hoverPicture.src = card.art!;
  hoverPicture.alt = card.name;
  if (fresh && !reducedMotion())
    hoverPicture.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "ease-out" });
  hoverPicture.style.width = `${Math.round(size.width)}px`;
  hoverPicture.style.height = `${Math.round(size.height)}px`;
  hoverPicture.style.left = `${Math.round(spot.left)}px`;
  hoverPicture.style.top = `${Math.round(spot.top)}px`;
  hoverPicture.hidden = false;
  if (paintStatusNotes(hoverNotes, card)) {
    hoverNotes.style.width = `${Math.round(Math.max(size.width, 240))}px`;
    hoverNotes.style.left = `${Math.round(spot.left)}px`;
    hoverNotes.style.top = `${Math.round(spot.top + size.height + 8)}px`;
  }
}

/**
 * Where a table card's full-size picture shows while it is hovered (the card panel folded), and on which side of the
 * card: `besideSpot`, clear of a pinned card. The card's own menu opens on the other side, so neither moves the other.
 */
function previewSpot(id: string) {
  const folded = roomy.matches && arena.hasAttribute("data-collapsed");
  // The villain guard keeps out of reach, pointed at while picking whom to attack: its big picture would cover the
  // guard minion's "Guard" call-out, which is what the player needs to see (`showGuardHint`).
  if (state.choice?.guard?.blocked.includes(id)) return null;
  // A searched card is already full size in the search panel: no second picture.
  if (state.choice?.searched?.some((each) => each.id === id)) return null;
  const card = folded && !inHand(id) ? cards().find((item) => item.id === id) : undefined;
  const point = card?.art && table ? table.anchors().find((anchor) => anchor.id === id) : undefined;
  if (!card || !point) return null;
  const field = playfield.getBoundingClientRect();
  const view = stage.getBoundingClientRect();
  const dx = view.left - field.left;
  const dy = view.top - field.top;
  // Half the table's height for an upright card; a scheme lies on its side at the same long edge.
  const long = Math.min(field.height * 0.5, 440);
  const size = card.landscape ? { width: long, height: long / 1.4 } : { width: long / 1.4, height: long };
  // Clear of a pinned card, so the two can be read side by side.
  const pinned = pinnedCard.hidden ? 0 : pinnedCard.offsetWidth + 28;
  const pinnedLeft = arena.dataset.rail === "left";
  // A card attached to an enemy shows on the left, beside its tab, and is placed by its host, which holds still: the
  // tab itself slides out while hovered and would carry the picture with it (Adam, 2026-11-22).
  const host = card.attachedTo && state.enemyCards.some((c) => c.id === id) ? card.attachedTo : null;
  const hostPoint = host ? table!.anchors().find((anchor) => anchor.id === host) : undefined;
  const box = hostPoint ?? point;
  const around = { left: dx + box.left, right: dx + box.right, top: dy + box.top, bottom: dy + box.bottom };
  if (hostPoint) {
    const tabs = state.enemyCards.filter((c) => c.attachedTo === host).length;
    around.left -= hostPoint.width * (0.18 * tabs + 0.1);
  }
  const spot = besideSpot(
    around,
    size,
    { left: pinnedLeft ? pinned : 0, width: field.width - pinned, height: field.height },
    hostPoint ? "left" : "right",
  );
  return { card, size, spot, side: spot.left >= around.right ? ("right" as const) : ("left" as const) };
}

/**
 * Float the bar where `dockSpot` says, on every frame the table draws (so it follows the hand as it rises to be paid
 * from) and whenever the bar changes size. Folding away it keeps its spot, so it fades out where it was.
 */
function placeDock() {
  // The search panel sits in the middle of the table, placed by its own style.
  if (!roomy.matches || !table || dock.hasAttribute("data-search")) {
    for (const property of ["top", "left", "bottom", "translate"]) dock.style.removeProperty(property);
    return;
  }
  if (dock.hasAttribute("data-idle")) return;
  const field = playfield.getBoundingClientRect();
  const view = stage.getBoundingClientRect();
  const spot = dockSpot({
    field: { width: field.width, height: field.height },
    stage: { left: view.left - field.left, top: view.top - field.top, width: view.width },
    // Layout sizes, not the bounding box: the bar turning over to a new question must not shake it.
    bar: { width: dock.offsetWidth, height: dock.offsetHeight },
    handTop: table.handTop.resting,
    // A revealed card stands full size right above the bar: the bar keeps a little air below it.
    below: revealFocus ? table.anchors().find((anchor) => anchor.id === revealFocus)?.bottom : undefined,
  });
  dock.style.left = `${Math.round(spot.left)}px`;
  dock.style.top = `${Math.round(spot.top)}px`;
  dock.style.bottom = "auto";
  dock.style.translate = "none";
}

// Right-click a card (on the table, in the hand or by its nameplate) to pin it; right-click the pin to let it go.
document.addEventListener("contextmenu", (event) => {
  if (!roomy.matches || !(event.target instanceof Element) || gameMenu.open || gameOver.open) return;
  if (event.target.closest("#pinned-card")) {
    event.preventDefault();
    pinCard(null);
    return;
  }
  const plate = event.target.closest<HTMLElement>(".anchor[data-card]");
  const onTable = event.target.closest("#space") ? (table?.cardAt(event as PointerEvent) ?? null) : null;
  const id = plate ? (plate.dataset.card ?? null) : onTable;
  if (!id) return;
  event.preventDefault();
  pinCard(id);
});
pinnedCard.querySelector<HTMLButtonElement>(".pinned-close")!.onclick = () => pinCard(null);
roomy.addEventListener("change", () => {
  placeUndo();
  placeEndTurn();
  layoutHand();
});
new ResizeObserver(layoutHand).observe(turnCorner);
new ResizeObserver(layoutHand).observe(boardViewport);
// On a phone the hand sits just above the turn bar, however tall the bar's current question makes it.
new ResizeObserver(() => {
  const bar = dock.getBoundingClientRect();
  const view = boardViewport.getBoundingClientRect();
  if (!roomy.matches) table?.setBottomReserve(Math.max(0, view.bottom - bar.top));
  placeDock();
}).observe(dock);
boardViewport.addEventListener("scroll", centerDecisionInViewport, { passive: true });
new ResizeObserver(centerDecisionInViewport).observe(boardViewport);

// ── Playing with a controller ─────────────────────────────────────────────────────────────────────────────────────
// The pad presses the same buttons the mouse does; `controller.ts` reads the table through these.
const pad = startController({
  table: () => table,
  back,
  settled,
  busy: () => presenting || flying || discarding,
  zoneOf: (id) =>
    discardOpen || displayedHand.some((card) => card.id === id)
      ? "hand"
      : id === state.hero.id || state.inPlay.some((card) => card.id === id)
        ? "player"
        : id === state.villain.id || state.enemyCards.some((card) => card.id === id)
          ? "villain"
          : null,
  // As `pick` decides: the hero, a card with powers or abilities, and an exhausted card (to say so) open a menu.
  opensMenu: (id) =>
    state.turn === "player" &&
    !state.payment &&
    !state.choice &&
    (id === state.hero.id ||
      model.fieldActions(id).length > 0 ||
      state.inPlay.some((card) => card.id === id && card.exhausted)),
  pin: pinCard,
  pinned: () => pinnedId,
  menuCard: () => menuCard,
  heroId: () => state.hero.id,
  heroActions: () => (powersReady() ? state.heroActions : []),
  fieldActions: () =>
    powersReady()
      ? [...state.inPlay, ...state.enemyCards].flatMap((card) =>
          model
            .fieldActions(card.id)
            .map((action) => ({ cardId: card.id, kind: action.kind, label: `${card.name}: ${action.label}` })),
        )
      : [],
  useAction: useCardAction,
});
// ── The campaign shelf: the table's front door ────────────────────────────────────────────────────────────────────
// The page opens on the campaign shelf (`boxes/boxes.ts`), laid over the table. Play there deals the game here, under
// it, then the shelf moves every piece onto the table and fades away. An address that sets a game up (the browser
// tests, scenes, the play hook, the sound studio) goes straight to the table, as does a reload during a game: the dev
// server reloads the page on every change, and that should land back at the table, not the shelf.
const AT_TABLE = "battle-at-table";
/** The campaign shelf is over the table. */
let shelfUp = false;
function opensOnShelf(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.has("open")) return true;
  if (["seed", "scene", "villain", "remote", "studio"].some((key) => params.has(key))) return false;
  try {
    return !sessionStorage.getItem(AT_TABLE);
  } catch {
    return true;
  }
}
function rememberAtTable(villain: VillainId | null) {
  try {
    if (villain) sessionStorage.setItem(AT_TABLE, villain);
    else sessionStorage.removeItem(AT_TABLE);
  } catch {
    // Private windows may refuse storage: a reload just opens the shelf.
  }
}
/** Everything of the table page stays laid out under the shelf (the shelf reads where its cards are), but untouchable. */
function tableInert(inert: boolean) {
  for (const child of document.body.children)
    if (child instanceof HTMLElement && child.id !== "shelf") child.inert = inert;
}
async function showShelf() {
  shelfUp = true;
  // No game on the shelf yet: the tab says the game's name, not the last matchup.
  document.title = "Marvel Champions";
  rememberAtTable(null);
  tableInert(true);
  // Dark until the room is drawn, so the bare table never shows while the shelf loads.
  document.documentElement.toggleAttribute("data-shelf-loading", true);
  try {
    // A villain unlocked since the shelf was drawn: the page starts again, and the shelf is drawn with it open.
    if (shelfStale()) {
      location.reload();
      return;
    }
    const { openShelf } = await import("./boxes/boxes.js");
    shelfDrawn();
    await openShelf({
      lock: lockReason,
      deal: (villain) => {
        setVillainChoice(villain);
        rememberAtTable(villain);
        start();
      },
      table: () => table ?? null,
      shown: () => {
        shelfUp = false;
        tableInert(false);
        // The mulligan's blur and question waited for the shelf to go; the table may be standing still by now.
        placeLabels();
        dockTitle.focus({ preventScroll: true });
      },
    });
  } catch (error) {
    // No shelf (it failed to load): the table deals as it always has.
    console.error(error);
    shelfUp = false;
    tableInert(false);
    start();
  } finally {
    document.documentElement.toggleAttribute("data-shelf-loading", false);
  }
}
// On the test site the player is known first (their name asked on first open), so the shelf knows what's unlocked.
// Elsewhere (Adam's dev table, the browser tests) it starts at once, as it always has.
function begin() {
  addRecordButton(document.querySelector("#menu .menu-actions"), () => gameMenu.close());
  // The patch notes the player hasn't read come up over the boxes once they are drawn (patch-notes/).
  if (opensOnShelf()) void showShelf().then(offerPatchNotes);
  else start();
}
if (import.meta.env.VITE_TABLE_VERSION) void playerReady.then(begin);
else begin();

// ── Sound Studio (dev server only, `?studio`) ─────────────────────────────────────────────────────────────────────
// The studio page (`battle/studio.html`) shows this table in a frame and asks it to act out one moment at a time, so a
// sound can be lined up with what it goes with. Each demo goes through the same code the game does (`present`'s
// beats where it can), so the sound fires at its real place; the table is put back from the game state afterwards.
async function studioDemo(name: string): Promise<boolean> {
  if (!table || presenting) return false;
  // The Sound Studio plays made-up beats (a hit, threat) that the game never had: the numbers they move are not checked.
  studioPlaying = true;
  try {
    return await studioScene(name);
  } finally {
    studioPlaying = false;
  }
}

/** True while the Sound Studio plays a made-up moment on the table (`studioDemo`). */
let studioPlaying = false;

async function studioScene(name: string): Promise<boolean> {
  if (!table) return false;
  const hero = state.hero.id;
  const villain = state.villain.id;
  const scheme = state.enemyCards.find((card) => card.type === "main_scheme")?.id ?? villain;
  const beat = (part: Partial<Beat>) => ({ text: "", ...part }) as Beat;
  const attack = (amount: number) => [
    beat({ attackAim: { source: villain, target: hero } } as Partial<Beat>),
    beat({ hit: { source: villain, target: hero, amount } } as Partial<Beat>),
  ];
  // A stand-in encounter card for the reveal demos: an encounter card's own picture where one is to hand.
  const looks = [...state.encounterDiscard, ...state.enemyCards].find(
    (card) => card.art && card.id !== villain && card.type !== "main_scheme" && !card.landscape,
  );
  const fake = { id: "studio-card", name: "Studio card", art: looks?.art ?? state.villain.art, landscape: false };
  switch (name) {
    case "whoosh":
    case "hit":
      await present(attack(2));
      break;
    case "hit-heavy":
      await present(attack(5));
      break;
    case "block":
      await present(attack(0));
      break;
    case "threat":
      await present([beat({ threat: { scheme, delta: 1 }, enemy: true } as Partial<Beat>)]);
      break;
    case "thwart":
      await present([beat({ threat: { scheme, delta: -1 } } as Partial<Beat>)]);
      break;
    case "phase-hero":
    case "whoosh-big":
      await present([beat({ phase: "hero" } as Partial<Beat>)]);
      break;
    case "phase-villain":
      await present([beat({ phase: "villain" } as Partial<Beat>)]);
      break;
    case "heal":
      await present([beat({ statusChange: { id: hero, name: "damage", delta: -1 } } as Partial<Beat>)]);
      break;
    case "status":
      await present([beat({ statusChange: { id: villain, name: "stunned", delta: 1 } } as Partial<Beat>)]);
      break;
    case "boom":
      await present([beat({ defeat: `${state.villain.name} defeated` } as Partial<Beat>)]);
      break;
    case "defeat":
      stampCard(villain, "Defeated");
      await flashDefeatedCard(villain);
      await sleep(900);
      break;
    case "ability":
      table.activateWhenRevealed(villain);
      sfx.play("ability");
      await sleep(ACTIVATION_MS);
      break;
    case "surge":
      stampCard(villain, "Surge!", "surge");
      await surgeBurst();
      break;
    case "boost":
      await showBoost({ id: villain, name: state.villain.name, boost: { icons: 2 } } as NonNullable<Beat["reveal"]>);
      dropBoostBurst(villain);
      break;
    case "turn": {
      const exhausted = !!state.hero.exhausted;
      table.turnCards([{ id: hero, exhausted: !exhausted }]);
      sfx.play("turn");
      await sleep(EXHAUST_MS + 500);
      table.turnCards([{ id: hero, exhausted }]);
      await sleep(READY_MS);
      break;
    }
    case "draw": {
      // Five cards drawn, as at the end of a turn: they leave the hand at once, then fly in off the deck.
      const drawn = displayedHand.slice(-5);
      if (!drawn.length) return false;
      const kept = displayedHand.slice(0, displayedHand.length - drawn.length);
      // Both in one go: anything that redraws the hand in between would put the cards straight back.
      table.showDraw(kept, [], state.deckCount + drawn.length);
      table.showDraw(
        displayedHand,
        drawn.map((card) => card.id),
        state.deckCount,
      );
      playDrawSounds(drawn.length);
      await sleep(900 + drawn.length * 180);
      break;
    }
    case "draw-land":
      return studioDemo("draw");
    case "deal":
      table.dealEncounter(fake.id);
      sfx.play("deal");
      await sleep(1300);
      table.retireEncounter(fake.id);
      await sleep(600);
      break;
    case "place":
    case "cancel":
    case "vanish":
      // A revealed card, then what happens to it: it lands by the villain, is cancelled, or is removed from the game.
      table.revealEncounter(fake);
      await sleep(1000);
      if (name === "place") {
        table.parkEncounter(fake.id);
        sfx.play("place");
        await sleep(1100);
        table.retireEncounter(fake.id);
      } else if (name === "cancel") {
        table.flickerCancelled(fake.id);
        stampCard(fake.id, "Cancelled");
        sfx.play("cancel");
        await sleep(900);
        table.retireEncounter(fake.id);
      } else {
        sfx.play("vanish");
        await sleep(table.evaporate(fake.id) || 600);
      }
      await sleep(600);
      break;
    case "play": {
      const card = displayedHand[0];
      if (!card) return false;
      table.stageEvent(card);
      sfx.play("play");
      await sleep(1200);
      break;
    }
    case "discard": {
      const cards = displayedHand.slice(0, 2).map((card) => card.id);
      if (!cards.length) return false;
      sfx.play("discard");
      await new Promise<void>((resolve) => table!.animateDiscards(cards, resolve));
      await sleep(500);
      break;
    }
    case "select":
      activationRing(villain);
      sfx.play("select");
      await sleep(700);
      break;
    case "confirm":
      endTurnButton.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(.92)" },
          { transform: "scale(1.04)" },
          { transform: "scale(1)" },
        ],
        { duration: 320, easing: "ease-out" },
      );
      sfx.play("confirm");
      await sleep(700);
      break;
    case "flip":
      table.revealEncounter(fake);
      sfx.play("flip");
      await sleep(1500);
      table.retireEncounter(fake.id);
      await sleep(700);
      break;
    case "shuffle": {
      // An empty discard pile is given a few cards first, so there is something to shuffle back in.
      if (!state.discard.length) {
        for (const card of displayedHand.slice(0, 3)) table.discardEvent(card);
        await sleep(800);
      }
      const pile = "discard";
      table.shuffleIntoDeck(pile);
      sfx.play("shuffle", { maxMs: 1400 });
      await sleep(1500);
      break;
    }
    case "win":
    case "lose":
      showOutcome({ result: name === "win" ? "win" : "loss", reason: "villainDefeated" } as Snapshot["outcome"]);
      await sleep(2600);
      gameOver.close();
      break;
    case "error": {
      const card = displayedHand[0];
      if (card) showPlayHint(card.id, "This card cannot be played now.");
      sfx.play("error");
      await sleep(1200);
      clearFormHint();
      break;
    }
    default:
      sfx.play(name as SoundName);
      await sleep(600);
      return false;
  }
  render();
  return true;
}

// ── Playing from a script (dev server only) ─────────────────────────────────────────────────────────────────────────
// `__battlePlay` lets Claude play through the page (`play.ts`): it reads the table in words and presses the same
// buttons and cards a click does. Opened with `?remote`, the page also takes moves from the dev server
// (`vite-battle-play.ts`), so a table shown in Surf's Games bubble can be played from a terminal while Adam watches.
if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __battlePlay: createPlayer({
      state: () => state,
      dock: dockView,
      busy: () => !table || presenting || flying || discarding,
      settled,
      pick,
      toggle,
      useAction: useCardAction,
      fieldActions: (id) => model.fieldActions(id),
      powersReady,
      defenseAsked: () => !!defenseQuestionDecline(state.choice),
      picked: () => choicePicks,
      cardFacts: (id) => model.cardFacts(id),
      consequentialDamage: (id, power) => model.consequentialDamage(id, power),
      cardName: (id) => model.cardName(id),
      playerFacts: () => model.playerFacts(),
      sourceName: (sourceId, cardId) => model.paymentSourceName(sourceId, cardId),
      history: () => story,
      reading: () => (readReveal.hidden ? null : revealFocus),
      doneReading: () => readReveal.click(),
    }),
  });
  if (import.meta.hot && new URLSearchParams(location.search).has("remote"))
    answerRemote((globalThis as unknown as { __battlePlay: Player }).__battlePlay, import.meta.hot as RemoteChannel);
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has("studio")) {
  document.documentElement.dataset.studio = "";
  Object.assign(globalThis, {
    __battleStudio: { demo: studioDemo, sfx, ready: () => !!table && !presenting && !!state },
  });
}
