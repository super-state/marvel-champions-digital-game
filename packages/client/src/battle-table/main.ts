import { statHue } from "../tokens.js";
import "./design.css";
import "./battle.css";
import { padActive, startController } from "./pad/controller.js";
import { besideSpot, dockSpot } from "./dock-spot.js";
import { whileStillThere } from "./beat-order.js";
import { handBetweenBeats } from "./hand-flow.js";
import { nextOfferIndex } from "./offer-queue.js";
import { holdsEncounter, revealWindowFor, type Reaction } from "./reveal-hold.js";
import { arrangeScene } from "./debug-scenes.js";
import { sfx, type SoundName } from "./sound.js";
import { icon, RESOURCE_ICON, type IconName } from "./icons.js";
import { BattleModel, type BattleCard } from "./model.js";
import { createPlayer } from "./play.js";
import { pictureOf, retryFailedPictures } from "./picture-retry.js";
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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const model = new BattleModel();
const stage = element("stage");
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
const dockPrimary = element<HTMLButtonElement>("dock-primary");
const dockSecondary = element<HTMLButtonElement>("dock-secondary");
const dockActions = dock.querySelector<HTMLElement>(".dock-actions")!;
const arena = document.querySelector<HTMLElement>(".arena")!;
const playfield = document.querySelector<HTMLElement>(".playfield")!;
/** Wider screens: Undo and End Turn keep the bottom corners, and the bar floats up only to say something. */
const turnCorner = element("turn-corner");
const undoCorner = element("undo-corner");
const endTurnButton = element<HTMLButtonElement>("end-turn");
const railToggle = element<HTMLButtonElement>("rail-toggle");
const hoverPicture = element<HTMLImageElement>("hover-card");
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
  ];
}

function nameOf(id: string | null | undefined): string {
  if (!id) return "";
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
  meter?: { paid: number; required: number; balance: string } | null;
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
      if (option.icon) button.append(icon(option.icon));
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
  paintButton(dockPrimary, view.primary);
  paintButton(dockSecondary, view.secondary);
  paintFeed();
  // A new question takes the keyboard focus so it is read out and answerable from the keyboard.
  const pressing = [dock, turnCorner, undoCorner].some((home) => home.contains(document.activeElement));
  if (asked && !presenting && !pressing) {
    const first = view.options?.length ? dockOptions.querySelector<HTMLElement>("button") : null;
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
  if (/\bheal/.test(text)) return "heal";
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
  const listed = choice.options.filter((option) => !onTable(option.cardId) || actionCard === option.cardId);
  const source =
    choice.sourceTitle?.replace(/ · When Revealed$/, "") ??
    (nameOf(state.choiceSource) ||
      (state.turn === "enemy" ? "Villain phase" : state.turn === "ending" ? "End of turn" : staged?.name || ""));
  const heading = /^choose one[.:]?$/i.test(choice.prompt.trim()) ? "Choose one" : choice.prompt;
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
    options: listed.map((option) => ({
      id: option.id,
      label: option.label,
      icon: optionIcon(option.label),
      ...(multiple ? { pressed: choicePicks.has(option.id) } : {}),
      onClick: () => selectChoice(option.id),
    })),
    primary: multiple
      ? {
          label: n ? `Confirm ${n}` : "Confirm",
          icon: "next",
          disabled: n < choice.min || discarding,
          attention: n >= choice.min,
          onClick: confirmChoice,
        }
      : null,
    secondary: choice.canCancel
      ? { label: "Cancel", onClick: cancel }
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
  if (card?.art) showPreview(card, card.id === hoveredCard || card.id === heldEncounter);
  else if (!heldEncounter) setWidePreview(false);
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
    table.channelEventTo(event, target);
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

function selectChoice(id: string) {
  actionCard = null;
  const choice = state.choice;
  if (discarding || !choice) return;
  if (!choice.discardFromHand && !choice.mulligan && choice.max <= 1) {
    choose(id);
    return;
  }
  if (!choicePicks.delete(id) && choicePicks.size < choice.max) choicePicks.add(id);
  render();
}

function confirmChoice() {
  const choice = state.choice;
  const picks = [...choicePicks];
  if (discarding || !choice || !model.chooseMany(picks)) return;
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

function threatPill(count: number, target: number | null): HTMLElement {
  const pill = make("span", "stat-pill scheme-threat");
  pill.dataset.kind = "threat";
  if (target != null) pill.dataset.target = String(target);
  pill.append(icon("threat"), make("b", "", ""));
  if (target != null) pill.append(make("i", "", `/${target}`));
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
  element("game-over-title").textContent = won ? "Victory" : "Defeat";
  element("game-over-detail").textContent = detail;
  gameOver.toggleAttribute("data-victory", won);
  gameOverUndo.hidden = !model.canUndo;
  tryAgain.replaceChildren(icon("mulligan"), make("span", "", won ? "Play again" : "Try again"));
  if (!gameOver.open) {
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

function throwConfetti() {
  const host = element("outcome-confetti");
  host.replaceChildren();
  if (reducedMotion()) return;
  for (let i = 0; i < 110; i++) {
    const bit = make("i", "confetti-bit");
    const left = Math.random() * 100;
    bit.style.setProperty("--x", left + "%");
    bit.style.setProperty("--drift", (Math.random() - 0.5) * 220 + "px");
    bit.style.setProperty("--spin", (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720) + "deg");
    bit.style.setProperty("--delay", Math.random() * 1.4 + "s");
    bit.style.setProperty("--fall", 2.6 + Math.random() * 2 + "s");
    bit.style.setProperty("--size", 6 + Math.random() * 7 + "px");
    bit.style.background = CONFETTI[i % CONFETTI.length]!;
    if (i % 3 === 0) bit.style.borderRadius = "50%";
    host.append(bit);
  }
}

function synchronizeLabels() {
  const visible = discardOpen
    ? viewedPile()
    : [state.hero, state.villain, ...state.enemyCards, ...displayedHand, ...state.inPlay];
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
    if (source || handPick) label.setAttribute("aria-pressed", String(source?.selected ?? picked));
    else label.removeAttribute("aria-pressed");
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    const hp = hero ? state.heroHp : enemy ? state.villainHp : card.hp;
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
      // Picking a defender, the plate is just the health: the card shows who it is and the dock asks the question
      // (Adam, 2026-11-22: "All the player needs is their health").
      if ((source || target) && !handPick && !state.choice?.defense)
        label.append(make("span", "plate-name", card.name));
      if (!discardOpen && hp !== undefined) label.append(hpPill(hp));
    }
    if (hp === undefined || discardOpen || inHand) delete label.dataset.hp;
    else label.dataset.hp = String(hp);
    if (card.threat !== null && onTable(card.id)) label.append(threatPill(card.threat, card.threatTarget));
    if (
      !inHand &&
      target &&
      !handPick &&
      !state.choice?.offers?.length &&
      !state.choice?.defense &&
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
          ? `${handPick ? (state.choice?.mulligan ? "Swap" : "Discard") : "Choose"} ${card.name}`
          : source
            ? `${source.selected ? "Remove" : "Spend"} ${card.name}, ${resourceText(source.icons)}`
            : card.playable
              ? `Play ${card.name}, cost ${card.cost}`
              : `Inspect ${card.name}`,
    );
  }
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
    return width && height ? [{ left: anchor.x - width / 2, top: anchor.bottom + 5, width, height }] : [];
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
    table?.landEncounter(permanent);
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
  focusBlur.hidden = !state.choice?.mulligan && !revealFocus && !dockFocus;
  focusBlur.style.maskImage = focusBlur.style.webkitMaskImage = "";
  // A dock question still waiting keeps its own blur.
  if (dockFocus) focusBlur.dataset.ready = "";
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
  encounterLabel.style.transform = `translate(${Math.round(encounter.x)}px,${Math.round(encounter.bottom + 4)}px)`;
  deckLabel.style.transform = `translate(${Math.round(deck.x)}px,${Math.round(deck.bottom + 5)}px)`;
  const encounterDiscard = table.encounterDiscardAnchor();
  encounterPile.style.transform =
    discardOpen && viewingEncounterDiscard
      ? ""
      : `translate(${Math.round(Math.min(encounterDiscard.x, stage.clientWidth - encounterPile.offsetWidth / 2 - 2))}px,${Math.round(encounterDiscard.bottom + 4)}px)`;
  pile.style.transform =
    discardOpen && !viewingEncounterDiscard
      ? ""
      : `translate(${Math.round(discard.x)}px,${Math.round(discard.bottom + 5)}px)`;
  const projected = table.anchors();
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
  for (const [id, tag] of boostTags) {
    const card = projected.find((p) => p.id === id);
    tag.hidden = !card;
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
    // Fades in only once the dealt cards have landed in the hand; then it stays, whatever the hand does.
    if (table.handSettled) focusBlur.dataset.ready = "";
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
    // A hand card wears its chip (Spend, Swap, Discard) low on its face; other cards' plates sit under them.
    const y = handCard ? anchor.bottom - 44 : anchor.bottom + 5;
    node.style.transform = `translate(${Math.round(anchor.x)}px,${Math.round(y)}px)`;
  }
  if (spot) updatePlateCutouts(spot.plates ?? [], projected);
}

// ── Presenting what happened ─────────────────────────────────────────────────────────────────────────────────────
const PHASE_BANNER_MS = 1500;

function phaseIndicator(phase: "hero" | "villain" | "ending" | "setup", announce = false) {
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
  roundLabel.textContent = `Round ${state?.round ?? 1}`;
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

function stampCard(id: string, text: string, tone?: "status" | "confused" | "tough" | "surge" | "boost") {
  const node = make("div", "card-stamp", text);
  if (tone) node.dataset.tone = tone;
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
  if (beat.villainStage || beat.villainFlip) return { text: beat.text, icon: "flip", tone: "villain" };
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
  if (dockFocus) {
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
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]!;
    if (spotted) {
      setSpot(null);
      spotted = false;
    }
    if (beat.gameEnded) break;
    if (answeredHeld) {
      // The revealed card whose question was just answered: it lands beside the villain first, then fires there,
      // and only then does the answer play out (Adam, 2026-11-22: Peter exhausted while Eviction Notice was still
      // in the air).
      const id = answeredHeld;
      answeredHeld = null;
      if (!reducedMotion() && table?.parkedEncounters().includes(id)) {
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
      // Each card lifts off the deck 120 ms in, then every 180 ms: its draw sound's marker lands on that.
      beat.draw.forEach((_, i) => sfx.play("draw", { contactIn: 120 + i * 180 }));
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
    if (beat.phase) {
      announcement.hidden = true;
      phaseIndicator(beat.phase, true);
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
      if (beat.scheming) stampCard(beat.scheming, "Schemes");
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
        table?.holdEvent(beat.interrupt);
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
      setSpot({ glow: [{ id: beat.encounterDeal, tone: "attack" }], cutouts: [beat.encounterDeal] });
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
        !(state.choice?.sourceTitle && state.choiceSource === beat.reveal.id);
      if (willHold) table?.holdReveal(true);
      table?.revealEncounter(beat.reveal);
      sfx.play("flip");
      if (!beat.reveal.boost) parkedViews.set(beat.reveal.id, beat.reveal);
      await sleep(360);
      if (beat.reveal.art) showPreview(beat.reveal, !beat.reveal.boost);
      if (beat.reveal.boost) {
        await showBoost(beat.reveal);
        dropBoostBurst(beat.reveal.id);
        table?.retireEncounter(
          beat.reveal.id,
          state.encounterDiscard.find((c) => c.id === beat.reveal!.id),
        );
        continue;
      }
      heldReveal = beat.reveal;
      if (state.choice?.sourceTitle && state.choiceSource === beat.reveal.id) {
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
      } else {
        readReveal.setAttribute("aria-label", `Continue after reading ${beat.reveal.name}`);
        readReveal.hidden = false;
        // Known before the bar asks, so its Continue leaves the table where it is.
        revealFocus = beat.reveal.id;
        narrate(beat, null, {
          eyebrow: { text: revealedBy(beat.reveal), icon: "forced", tone: "villain" },
          title: beat.reveal.name,
          help: appliesHelp(beat.reveal),
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
        focusBlur.hidden = !state.choice?.mulligan;
        focusBlur.style.clipPath = "";
        revealHint.hidden = readReveal.hidden = true;
        narrate(beat, null);
      }
      readingCard = null;
      setWidePreview(false);
      const permanent = state.enemyCards.find((c) => c.id === beat.reveal!.id);
      if (permanent) {
        table?.landEncounter(permanent);
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
        const n = Math.max(0, Number(counter.dataset.count) + beat.threat.delta);
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
  const selected =
    state.payment?.sources.filter((item) => item.selected).map(resourcePieceId) ??
    state.choice?.options.flatMap((option) => (option.cardId && choicePicks.has(option.id) ? [option.cardId] : [])) ??
    [];
  if (state.payment || state.choice || discardOpen || state.turn !== "player") menuCard = null;
  paintReading();
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
      state.choice.max <= 1 &&
      !state.choice.discardFromHand &&
      !state.choice.mulligan
        ? state.choice.options.flatMap((item) => (item.cardId && onTable(item.cardId) ? [item.cardId] : []))
        : [],
    discardOpen,
    hand: displayedHand,
    staged,
    stagedOverEnemies: !!staged && staged.id === stagedAttachment,
    paymentSources: state.payment?.sources.filter((s) => s.available).map(resourcePieceId) ?? null,
    selected,
  });
  table?.markActor(state.choiceSource);
  discardFan.hidden = !discardOpen;
  syncBoostTags();
  synchronizeLabels();
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
  const waiting = waitsOnDock(state.choice, (id) => onTable(id) && actionCard !== id);
  dockFocus =
    waiting && !revealFocus && !rowFocus.length ? { keep: heldEncounter ?? state.choiceSource ?? null } : null;
  const blurWasHidden = focusBlur.hidden;
  focusBlur.hidden = !state.choice?.mulligan && !revealFocus && !dockFocus && !rowFocus.length;
  if (focusBlur.hidden) delete focusBlur.dataset.ready;
  else if (dockFocus && blurWasHidden) requestAnimationFrame(() => dockFocus && (focusBlur.dataset.ready = ""));
  choiceShade.hidden = !state.choice || !heldEncounter || !!state.choice.offers?.length;
  const asked = paintDock(dockView());
  // A question about the hand sends a ripple through it, so the eye goes where the answer is.
  if (asked && (state.choice?.discardFromHand || state.choice?.mulligan)) table?.waveHand();
  // A question darkens the table around what it is about: the attacker (red), or what an interrupt would change.
  setSpot(
    spotOf(state.choice, state, {
      offerIndex,
      choosingDefender: !defenseQuestionDecline(state.choice),
      heldEncounter,
    }),
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

/** A game has been dealt in this page, so a `?scene=` set-up has had its turn. */
let sceneDealt = false;

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
  const arrange = import.meta.env.DEV ? arrangeScene(params.get("scene") ?? "") : undefined;
  model.reset(arrange ? { seed, arrange } : { seed, mulligan: true });
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
  layoutHand();
  render();
  inspect(state.hand.find((card) => card.playable)?.id ?? state.hero.id);
  restart.disabled = false;
  placeLabels();
}

function start() {
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
restart.onclick = start;
menuButton.onclick = () => {
  if (!gameMenu.open) gameMenu.showModal();
};
element<HTMLButtonElement>("menu-resume").onclick = () => gameMenu.close();
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
endTurnButton.title = "End Turn (Ctrl+Space)";
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
undoButton.title = "Undo (Ctrl+Z)";
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

/** Undo has the bottom-left corner on a wider screen, opposite End Turn; on a phone it sits in the bar. */
function placeUndo() {
  const home = roomy.matches ? undoCorner : dockActions;
  if (undoButton.parentElement !== home) home.prepend(undoButton);
}

// The card panel folds away completely; a card being read then floats over the table's edge instead.
const RAIL_KEY = "battle-sidebar-collapsed";
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
// Until it is chosen: a mouse on a smaller screen starts with the panel folded, since hovering a card shows it
// floating; a touch screen keeps it open, with no hover to bring a folded card up.
setRailCollapsed(railStored ? railStored === "1" : matchMedia("(hover: hover) and (max-width: 1100px)").matches, false);

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
}

/**
 * Where a table card's full-size picture shows while it is hovered (the card panel folded), and on which side of the
 * card: `besideSpot`, clear of a pinned card. The card's own menu opens on the other side, so neither moves the other.
 */
function previewSpot(id: string) {
  const folded = roomy.matches && arena.hasAttribute("data-collapsed");
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
  if (!roomy.matches || !table) {
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
      ? state.inPlay.flatMap((card) =>
          model
            .fieldActions(card.id)
            .map((action) => ({ cardId: card.id, kind: action.kind, label: `${card.name}: ${action.label}` })),
        )
      : [],
  useAction: useCardAction,
});
start();

// ── Sound Studio (dev server only, `?studio`) ─────────────────────────────────────────────────────────────────────
// The studio page (`battle/studio.html`) shows this table in a frame and asks it to act out one moment at a time, so a
// sound can be lined up with what it goes with. Each demo goes through the same code the game does (`present`'s
// beats where it can), so the sound fires at its real place; the table is put back from the game state afterwards.
async function studioDemo(name: string): Promise<boolean> {
  if (!table || presenting) return false;
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
      drawn.forEach((_, i) => sfx.play("draw", { contactIn: 120 + i * 180 }));
      await sleep(900 + drawn.length * 180);
      break;
    }
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
// buttons and cards a click does.
if (import.meta.env.DEV)
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
      cardName: (id) => model.cardName(id),
      sourceName: (sourceId, cardId) => model.paymentSourceName(sourceId, cardId),
      history: () => story,
      reading: () => (readReveal.hidden ? null : revealFocus),
      doneReading: () => readReveal.click(),
    }),
  });

if (import.meta.env.DEV && new URLSearchParams(location.search).has("studio")) {
  document.documentElement.dataset.studio = "";
  Object.assign(globalThis, {
    __battleStudio: { demo: studioDemo, sfx, ready: () => !!table && !presenting && !!state },
  });
}
