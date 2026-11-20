import { statHue } from "../tokens.js";
import "./design.css";
import "./battle.css";
import { arrangeScene } from "./debug-scenes.js";
import { icon, RESOURCE_ICON, type IconName } from "./icons.js";
import { BattleModel, type BattleCard } from "./model.js";
import { eventLook, offerDoes, spotOf, type GlowTone, type Spot } from "./spotlight.js";
import {
  BattleTable,
  ACTIVATION_MS,
  INTERRUPT_MS,
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
const defenseShade = document.querySelector<SVGSVGElement>("#defense-shade")!;
const abilityGlow = document.querySelector<SVGSVGElement>("#ability-glow")!;
const abilityOutlines = document.querySelector<SVGGElement>("#ability-outlines")!;
const defenderCutouts = document.querySelector<SVGGElement>("#defender-cutouts")!;
const reticle = element("attack-reticle");
// The phase banner runs right across the window, over the sidebar too, so it lives on the page, not in the table.
document.body.append(element("phase-banner"));
const pendingMark = element("pending-mark");
let aimTarget: string | null = null;
let heldEncounter: string | null = null;
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
const dockEyebrow = element("dock-eyebrow");
const dockOptions = element("dock-options");
const dockFeed = element("dock-feed");
const dockMeter = element("dock-meter");
const dockPrimary = element<HTMLButtonElement>("dock-primary");
const dockSecondary = element<HTMLButtonElement>("dock-secondary");
const roundLabel = element("round-label");
const undoButton = element<HTMLButtonElement>("undo");
const turnStatus = element("turn-status");
const choicePicks = new Set<string>();
let table: BattleTable | undefined;
let state: Snapshot;
let staged: BattleCard | null = null;
/**
 * An interrupt taken against threat about to land on a scheme (Great Responsibility): the card goes over to the scheme,
 * and if it turns the threat into damage, the threat is shown turning into a damage token and flying to the hero.
 */
let shielding: { card: string; scheme: string; amount: number } | null = null;
/** A targeted attachment (Spider-Tracer) staged while its host is chosen: it waits over the villain's side. */
let stagedAttachment: string | null = null;
const readReveal = element<HTMLButtonElement>("read-reveal");
const revealHint = element("reveal-hint");
let readingCard: string | null = null;
let menuCard: string | null = null;
let actionCard: string | null = null;
const moveViews = new WeakMap<
  Snapshot["beats"],
  { staged: BattleCard | null; reveal: Beat["reveal"]; aim: string | null }
>();
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
  button.onclick = (event) => {
    if (!button.disabled && (event.detail === 0 || settled())) spec.onClick();
  };
}

/** Paint the turn bar; true when it now asks a question it was not asking before. */
function paintDock(view: DockView): boolean {
  dock.dataset.tone = view.tone;
  dock.toggleAttribute("data-asking", view.asking);
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
    // The bar turns over like a card to a new question, so it never reads as the button just pressed.
    if (!reducedMotion())
      dock.animate(
        [
          { transform: "perspective(700px) rotateX(-78deg)", opacity: 0.2 },
          { transform: "perspective(700px) rotateX(9deg)", opacity: 1, offset: 0.68 },
          { transform: "none", opacity: 1 },
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
  if (asked && !presenting && !dock.contains(document.activeElement)) {
    const first = view.options?.length ? dockOptions.querySelector<HTMLElement>("button") : null;
    (first ?? dockTitle).focus({ preventScroll: true });
  }
  return asked;
}

/** What just happened, newest first, so a fast villain phase can be followed. */
interface FeedLine {
  text: string;
  icon: IconName;
  tone?: "villain" | "hero" | "damage" | "threat" | "heal" | undefined;
}
let feed: FeedLine[] = [];
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
  if (yes && choice.event?.kind === "placeThreat" && choice.event.before && choice.event.subject)
    shielding = { card: offer.cardId, scheme: choice.event.subject, amount: choice.event.amount ?? 1 };
  if (++offerIndex < choice.offers.length && acceptedOffers.length < choice.max) {
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
  if (state.payment) return { ...paymentView(state.payment), question: `pay:${state.payment.subject.id}` };
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
      primary: {
        label: "End Turn",
        icon: "next",
        disabled: !state.canEndTurn || flying || discarding || discardOpen,
        onClick: endTurn,
      },
    };
  }
  return {
    tone: villain ? "villain" : "hero",
    asking: false,
    title: villain ? "Villain phase" : "End of turn",
    primary: { label: "End Turn", icon: "next", disabled: true, onClick: () => undefined },
  };
}

// ── Reading cards ─────────────────────────────────────────────────────────────────────────────────────────────────
let hoveredCard: string | null = null;
function hoverCard(id: string | null) {
  hoveredCard = id;
  if (!readingCard) inspect(id);
}

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
  if (preview.getAttribute("src") !== card.art) preview.src = card.art;
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
    if (targets.length === 1) selectChoice(targets[0]!.id);
    else if (targets.length > 1) {
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
    showPlayHint(state.hero.id, "Hero form required", true);
    return;
  }
  if (!card.playable) {
    showPlayHint(card.id, card.reason || "This card cannot be played now.");
    return;
  }
  clearFormHint();
  stagedAttachment = model.isTargetedAttachment(card.id) ? card.id : null;
  staged = card;
  flying = true;
  render();
}

function landed(id: string) {
  if (!flying || staged?.id !== id) return;
  flying = false;
  beginPlay(staged);
}

function beginPlay(card: BattleCard) {
  act(() => {
    if (!model.pick(card.id)) {
      staged = null;
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
    if (!state.payment && !state.choice) {
      staged = null;
      say(`${card.name} played`);
    }
  });
}

function toggle(id: string) {
  if (!state.payment) return;
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

function cancel() {
  const returned = staged?.name;
  model.cancel();
  staged = null;
  flying = false;
  if (returned) say(`${returned} back to hand`);
  render();
}

function pay() {
  const payment = state.payment;
  if (discarding || !payment?.canPay || !table) return;
  const flights = payment.discards;
  if (!model.pay()) return;
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
  undoButton.disabled = dockPrimary.disabled = dockSecondary.disabled = true;
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

function choose(id: string | null) {
  actionCard = null;
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
  if (featured.art && art.getAttribute("src") !== featured.art) art.src = featured.art;
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
      if ((source || target) && !handPick) label.append(make("span", "plate-name", card.name));
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
async function whenRevealedFires(beat: Beat, card: { id: string; name: string }) {
  table?.activateWhenRevealed(card.id);
  narrate(beat, null, { eyebrow: { text: "When Revealed", icon: "forced", tone: "villain" }, title: card.name });
  await sleep(ACTIVATION_MS);
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
function setSpot(next: Spot | null) {
  spot = next?.cutouts.length ? next : null;
  defenseShade.toggleAttribute("hidden", !spot);
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
  const clips = table.foregroundCardClips();
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
  for (const [id, tag] of boostTags) {
    const card = projected.find((p) => p.id === id);
    tag.hidden = !card;
    // The tag sits on the part of the card showing past its enemy's edge.
    if (card)
      tag.style.transform = `translate(${Math.round(card.right - card.width * 0.32)}px,${Math.round(card.y)}px)`;
  }
  if (!focusBlur.hidden && revealFocus) {
    // Everything but the revealed card, cut out along its outline.
    const outline = table.cardOutline(revealFocus);
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
  dock.toggleAttribute("data-waiting", !focusBlur.hidden && !revealFocus && !("ready" in focusBlur.dataset));
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
      decision.style.setProperty("--hero-x", hero.x + "px");
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
  turnStatus.textContent = title;
  roundLabel.textContent = `Round ${state?.round ?? 1}`;
  if (announce && phase !== "setup") {
    const banner = element("phase-banner");
    banner.dataset.phase = phase;
    const lettering = banner.querySelector("b")!;
    lettering.textContent = title;
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

async function showBoost(reveal: NonNullable<Beat["reveal"]>) {
  const boost = reveal.boost!;
  const projected = table?.anchors();
  const card = projected?.find((p) => p.id === reveal.id);
  const enemy = projected?.find((p) => p.id === boost.enemy);
  if (!card) return;
  const burst = make("div", "boost-burst");
  burst.setAttribute("role", "status");
  const marks = make("span", "boost-marks");
  for (let i = 0; i < Math.min(boost.icons, 4); i++) marks.append(icon("boost"));
  burst.append(marks, make("b", "", `+${boost.icons}`), make("span", "", "Boost"));
  const x = card.x + card.width * 0.33;
  const y = card.bottom - card.width * 0.25;
  burst.style.left = x + "px";
  burst.style.top = y + "px";
  stage.append(burst);
  const animation = burst.animate(
    reducedMotion()
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { transform: "scale(.55)", opacity: 0 },
          { transform: "scale(1.18)", opacity: 1, offset: 0.18 },
          { transform: "scale(1)", opacity: 1, offset: 0.35 },
          { transform: "scale(1)", opacity: 1, offset: 0.68 },
          { transform: `translate(${(enemy?.x ?? x) - x}px,${(enemy?.y ?? y) - y}px) scale(.62)`, opacity: 0 },
        ],
    { duration: 860, easing: "ease-out" },
  );
  await animation.finished;
  burst.remove();
}

/** "+1 card" bursting off the encounter deck, so the extra deal that follows has a cause. */
async function surgeBurst() {
  const deck = table?.encounterAnchor();
  if (!deck) return;
  const burst = make("div", "surge-burst");
  burst.setAttribute("role", "status");
  burst.append(icon("surge"), make("b", "", "Surge"), make("span", "", "+1 card"));
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
    return { text: `${plural(beat.returned.length, "card")} back to your hand`, icon: "draw", tone: "hero" };
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
  const announcement = element("action-beat");
  const impact = element("impact");
  stage.dataset.resolving = "true";
  anchors.inert = true;
  undoButton.disabled = restart.disabled = true;
  const pendingDraws = new Set(beats.flatMap((beat) => beat.draw ?? []));
  let spotted = false;
  // The payment screen's stand-ins for resource abilities (Peter Parker's Scientist) are spent by now.
  displayedHand = displayedHand.filter((card) => !card.id.startsWith("ability:"));
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]!;
    if (spotted) {
      setSpot(null);
      spotted = false;
    }
    if (beat.gameEnded) break;
    if (beat.draw) {
      for (const id of beat.draw) pendingDraws.delete(id);
      displayedHand = state.hand.filter((card) => !pendingDraws.has(card.id));
      const deckSize = state.deckCount + pendingDraws.size;
      table?.showDraw(displayedHand, beat.draw, deckSize, state.discard);
      deckCount.textContent = String(deckSize);
      narrate(beat, feedLineOf(beat));
      await sleep(680 + (beat.draw.length - 1) * 180);
      continue;
    }
    if (beat.handDiscard) {
      const fresh = beat.handDiscard.filter((id) => !preAnimated.has(id));
      for (const id of beat.handDiscard) preAnimated.delete(id);
      if (!fresh.length) continue;
      narrate(beat, feedLineOf(beat));
      await new Promise<void>((resolve) => (table ? table.animateDiscards(fresh, resolve) : resolve()));
      displayedHand = displayedHand.filter((card) => !fresh.includes(card.id));
      await sleep(240);
      continue;
    }
    if (beat.returned) {
      narrate(beat, feedLineOf(beat));
      const back = state.hand.filter((card) => beat.returned!.includes(card.id));
      displayedHand = [...displayedHand.filter((card) => !beat.returned!.includes(card.id)), ...back];
      table?.showDraw(displayedHand, beat.returned, state.deckCount + pendingDraws.size, state.discard);
      await sleep(760);
      continue;
    }
    if (beat.surge) {
      narrate(beat, feedLineOf(beat), { title: "Surge! One more encounter card" });
      stampCard(beat.surge, "Surge!", "surge");
      await surgeBurst();
      continue;
    }
    if (beat.milled) {
      narrate(beat, feedLineOf(beat));
      deckCount.textContent = String(Math.max(0, Number(deckCount.textContent) - beat.milled.length));
      await sleep(700);
      continue;
    }
    if (beat.leftPlay) {
      const id = beat.leftPlay;
      table?.markActor(null);
      narrate(beat, feedLineOf(beat));
      labels.get(id)?.remove();
      labels.delete(id);
      const encounter = state.encounterDiscard.find((card) => card.id === id);
      const discarded = encounter ?? state.discard.find((card) => card.id === id);
      table?.discardDefeatedCard(id, discarded, encounter ? "encounterDiscard" : "discard");
      await sleep(discarded ? 560 : 240);
      continue;
    }
    if (beat.phase) {
      announcement.hidden = true;
      phaseIndicator(beat.phase, true);
      narrate(beat, null, { title: beat.phase === "hero" ? "Your turn" : "Villain phase", eyebrow: null });
      await sleep(PHASE_BANNER_MS);
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
      await sleep(1450);
      announcement.removeAttribute("data-defeat");
      announcement.hidden = true;
      if (!beat.villainStage) continue;
    } else narrate(beat, line);
    if (beat.villainStage || beat.villainFlip) {
      table?.showVillain(state.villain, !!(beat.defeat || beat.villainFlip));
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
    }
    if (beat.attackAim) {
      const { source, target } = beat.attackAim;
      table?.windUp(source);
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
        displayedHand = displayedHand.filter((c) => c.id !== event.id);
        labels.get(event.id)?.remove();
        labels.delete(event.id);
        await sleep(320);
      }
      activationRing(beat.activate.card);
      await sleep(360);
      if (shielding?.card === beat.activate.card) {
        // It goes to the scheme it protects, not onto the hero.
        table?.channelEventTo(beat.activate.card, shielding.scheme);
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
      await sleep(INTERRUPT_MS);
      continue;
    }
    if (beat.deflection) {
      table?.deflectDamage(beat.deflection.card, beat.deflection.amount);
      floatNumber(beat.deflection.card, "blocked", "Blocked", `${beat.deflection.amount} damage`);
    }
    if (beat.discardEvent) {
      if (shielding?.card === beat.discardEvent) shielding = null;
      const card = state.discard.find((c) => c.id === beat.discardEvent);
      if (card) {
        table?.discardEvent(card);
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
        const label = labels.get(id);
        if (label?.dataset.hp) updateHpLabel(label, Number(label.dataset.hp) - delta);
        table?.healBurst(id);
      } else if (delta > 0 && STATUS_STAMP[name]) {
        const [tone, text] = STATUS_STAMP[name]!;
        stampCard(id, text, tone);
      }
    }
    if (beat.turned) {
      const turns = [beat.turned];
      if (!beat.turned.exhausted) {
        while (beats[index + 1]?.turned?.exhausted === false) turns.push(beats[++index]!.turned!);
        dockTitle.textContent = turns.length > 1 ? `Ready ${plural(turns.length, "card")}` : beat.text;
      }
      table?.turnCards(turns);
      await sleep(beat.turned.exhausted ? EXHAUST_MS : READY_MS);
      continue;
    }
    if (beat.encounterDeal) {
      table?.dealEncounter(beat.encounterDeal, beat.boostFor ?? null);
      const count = element("encounter-count");
      count.textContent = String(Math.max(0, Number(count.textContent) - 1));
      if (beat.boostFor) {
        // A boost card lands facedown beside its enemy: say so on the card, then tag it until it turns up.
        await sleep(reducedMotion() ? 120 : 480);
        stampCard(beat.encounterDeal, "Boost", "boost");
        await sleep(reducedMotion() ? 300 : 860);
        tagBoost(beat.encounterDeal);
        placeLabels();
        await sleep(200);
        continue;
      }
      // The encounter step, called out like the others: the table darkens around the card dealt to the player.
      narrate(
        beat,
        { text: "Deal an encounter card", icon: "forced", tone: "villain" },
        { eyebrow: { text: "Encounter", icon: "forced", tone: "villain" }, title: "Deal an encounter card" },
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
      table?.revealEncounter(beat.reveal);
      await sleep(360);
      if (beat.reveal.art) showPreview(beat.reveal, !beat.reveal.boost);
      if (beat.reveal.boost) {
        await showBoost(beat.reveal);
        table?.retireEncounter(
          beat.reveal.id,
          state.encounterDiscard.find((c) => c.id === beat.reveal!.id),
        );
        continue;
      }
      if (state.choice?.sourceTitle && state.choiceSource === beat.reveal.id) {
        heldEncounter = beat.reveal.id;
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
          eyebrow: { text: "Revealed", icon: "forced", tone: "villain" },
          title: beat.reveal.name,
        });
        await sleep(reducedMotion() ? 700 : 1150);
      } else {
        readReveal.setAttribute("aria-label", `Continue after reading ${beat.reveal.name}`);
        readReveal.hidden = false;
        narrate(beat, null, {
          eyebrow: { text: "Revealed", icon: "forced", tone: "villain" },
          title: beat.reveal.name,
          primary: { label: "Continue", icon: "next", attention: true, onClick: () => readReveal.click() },
        });
        readReveal.focus({ preventScroll: true });
        // The table goes soft around the revealed card while it waits to be read.
        revealFocus = beat.reveal.id;
        focusBlur.hidden = false;
        placeLabels();
        requestAnimationFrame(() => (focusBlur.dataset.ready = ""));
        await new Promise<void>((resolve) => readReveal.addEventListener("click", () => resolve(), { once: true }));
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
        if (beat.reveal.whenRevealed && !reducedMotion()) {
          // Lands on the mat first, then its When Revealed fires: it rises with a flash before the effect hits.
          await sleep(520);
          await whenRevealedFires(beat, beat.reveal);
        }
      } else {
        table?.retireEncounter(
          beat.reveal.id,
          state.encounterDiscard.find((c) => c.id === beat.reveal!.id),
        );
        await sleep(450);
      }
    }
    if (beat.threat) {
      if (beat.enemy && beat.threat.delta > 0) {
        // The scheme's moment: the table darkens around it and its threat shows coming in before it lands.
        const scheme = beat.threat.scheme;
        spotted = true;
        setSpot({
          glow: [{ id: scheme, tone: "threat" }],
          cutouts: [scheme],
          mark: { id: scheme, kind: "threat", amount: beat.threat.delta },
        });
        placeLabels();
        await sleep(reducedMotion() ? 260 : 620);
        setSpot({ glow: [{ id: scheme, tone: "threat" }], cutouts: [scheme] });
      }
      activationRing(beat.threat.scheme);
      const counter = labels.get(beat.threat.scheme)?.querySelector<HTMLElement>(".scheme-threat");
      if (counter) {
        const n = Math.max(0, Number(counter.dataset.count) + beat.threat.delta);
        updateThreatLabel(counter, n);
        table?.setThreat(beat.threat.scheme, n);
      }
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
      if (shielding && beat.hit.source === shielding.card) {
        // The threat it stopped turns into damage at the scheme and flies to the hero.
        await convertThreat(shielding.scheme, beat.hit.target, beat.hit.amount);
      } else {
        table?.strike(beat.hit.source, beat.hit.target);
        await sleep(HIT_CONTACT_MS);
      }
      if (beat.hit.tough) table?.changeStatus(beat.hit.target, "tough", -1);
      if (beat.hit.amount) {
        shakeStage(beat.hit.amount >= 4 ? "heavy" : "light");
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
function render() {
  if (presenting) return;
  state = model.snapshot();
  if (!formHint.hidden) clearFormHint();
  if (state.payment || state.choice || state.turn !== "player") element("play-refusal").hidden = true;
  if (heldEncounter && (state.choiceSource !== heldEncounter || !state.choice?.sourceTitle)) {
    const permanent = state.enemyCards.find((c) => c.id === heldEncounter);
    if (permanent) table?.landEncounter(permanent);
    else
      table?.retireEncounter(
        heldEncounter,
        state.encounterDiscard.find((c) => c.id === heldEncounter),
      );
    heldEncounter = null;
    inspect(hoveredCard);
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
    if (presented.length) {
      void present(presented);
      return;
    }
  }
  table?.reconcileEncounters([...state.facedownEncounters, ...(state.choiceSource ? [state.choiceSource] : [])]);
  if (!flying && !state.payment && !state.choice?.canCancel) {
    const reveal = heldEncounter
      ? (state.beats.find((b) => b.reveal?.id === heldEncounter)?.reveal ?? moveViews.get(state.beats)?.reveal)
      : undefined;
    moveViews.set(state.beats, {
      staged: staged && !state.hand.some((c) => c.id === staged!.id) ? staged : null,
      reveal,
      aim: aimTarget,
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
  table?.setCards({
    defending,
    menuCard,
    hero: state.hero,
    villain: state.villain,
    inPlay: state.inPlay,
    enemyCards: state.enemyCards,
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
  undoButton.disabled = !model.canUndo || flying || discarding || !!state.payment || !!state.choice?.canCancel;
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
  focusBlur.hidden = !state.choice?.mulligan && !revealFocus;
  if (focusBlur.hidden) delete focusBlur.dataset.ready;
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
  if (!menuCard) return;
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
    button.onclick = () => {
      menuCard = null;
      act(() => {
        if (id === state.hero.id) model.heroAction(action.kind);
        else model.fieldAction(id, action.kind);
      });
      inspect(id);
    };
    decision.append(button);
  }
  // No close button: a click anywhere else, or Escape (a controller's B later), puts the menu away.
}

// ── Starting a game ───────────────────────────────────────────────────────────────────────────────────────────────
function seedFromUrl(): number | undefined {
  const seed = Number(new URLSearchParams(location.search).get("seed"));
  return Number.isInteger(seed) && seed > 0 ? seed : undefined;
}

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
  feed = [];
  paintFeed();
  const seed = seedFromUrl() ?? Math.floor(Math.random() * 2 ** 31) + 1;
  // Dev builds only: `?scene=crowded` skips the mulligan and lays out a busy table for checking the presentation.
  const arrange = import.meta.env.DEV
    ? arrangeScene(new URLSearchParams(location.search).get("scene") ?? "")
    : undefined;
  model.reset(arrange ? { seed, arrange } : { seed, mulligan: true });
  state = model.snapshot();
  presented = state.beats;
  if (!table) {
    table = new BattleTable(element("space"), boardViewport, {
      onPick: pick,
      onHover: hoverCard,
      onLanded: landed,
      onDismissDiscard: () => setDiscardOpen(false),
      onDraw: placeLabels,
      onDiscardLanded: (count) => {
        pileCount.textContent = String(count);
      },
    });
    // Dev builds expose the scene for checking it from the console and from scripted screenshots.
    if (import.meta.env.DEV) (window as unknown as { battleTable?: BattleTable }).battleTable = table;
  }
  table?.setBottomReserve(Math.max(0, boardViewport.getBoundingClientRect().bottom - dock.getBoundingClientRect().top));
  render();
  inspect(state.hand.find((card) => card.playable)?.id ?? state.hero.id);
  restart.disabled = false;
  placeLabels();
}

function start() {
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
  aimTarget = view?.aim ?? null;
  menuCard = actionCard = null;
  discardOpen = false;
  choicePicks.clear();
  table?.reconcileEncounters([]);
  say("Move undone");
  render();
  for (const id of state.facedownEncounters)
    table?.dealEncounter(id, state.facedownBoosts.find((boost) => boost.id === id)?.enemy ?? null);
  if (view?.reveal) table?.revealEncounter(view.reveal);
  if (staged?.type === "event") table?.channelEvent(staged.id);
  inspect(heldEncounter ?? state.hero.id);
};
restart.onclick = start;
menuButton.onclick = () => {
  if (!gameMenu.open) gameMenu.showModal();
};
element<HTMLButtonElement>("menu-resume").onclick = () => gameMenu.close();
// Which side the card reader and log sit on, remembered on this device.
function setSidebarSide(side: "left" | "right") {
  document.querySelector(".arena")!.setAttribute("data-rail", side);
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
      event.target.closest("#space, #discard-label, #encounter-discard, #discard-fan, #dock")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setDiscardOpen(false);
  },
  true,
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (gameMenu.open || gameOver.open)) return;
  if (event.key === "Escape" && menuCard) {
    menuCard = null;
    render();
    return;
  }
  if (event.key === "Escape" && state?.payment && !discarding) {
    event.preventDefault();
    cancel();
    return;
  }
  if (discardOpen && event.key === "Escape") {
    event.preventDefault();
    setDiscardOpen(false);
    pile.focus({ preventScroll: true });
    return;
  }
  if (event.key === "Escape" && state?.choice?.canCancel && !discarding && !presenting) {
    event.preventDefault();
    cancel();
    return;
  }
  // Nothing else to put away: Escape opens the menu (the dialog closes itself on a second Escape).
  if (event.key === "Escape" && !gameMenu.open && !gameOver.open) {
    event.preventDefault();
    gameMenu.showModal();
  }
});
// The hand sits just above the turn bar, however tall the bar's current question makes it.
new ResizeObserver(() => {
  const bar = dock.getBoundingClientRect();
  const view = boardViewport.getBoundingClientRect();
  table?.setBottomReserve(Math.max(0, view.bottom - bar.top));
}).observe(dock);
boardViewport.addEventListener("scroll", centerDecisionInViewport, { passive: true });
new ResizeObserver(centerDecisionInViewport).observe(boardViewport);
start();
