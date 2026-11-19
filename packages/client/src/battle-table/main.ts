import { statHue } from "../tokens.js";
import "./battle.css";
import { BattleModel, type BattleCard } from "./model.js";
import { BattleTable, INTERRUPT_MS, EXHAUST_MS, READY_MS, HIT_CONTACT_MS, isTuckedUpgrade } from "./table.js";

type Snapshot = ReturnType<BattleModel["snapshot"]>;

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

const model = new BattleModel();
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
const defenseShade = document.querySelector<SVGSVGElement>("#defense-shade")!;
const abilityGlow = document.querySelector<SVGSVGElement>("#ability-glow")!;
const abilityOutlines = document.querySelector<SVGGElement>("#ability-outlines")!;
const defenderCutouts = document.querySelector<SVGGElement>("#defender-cutouts")!;
const reticle = element("attack-reticle");
let aimTarget: string | null = null;
let heldEncounter: string | null = null;
const instruction = element("instruction");
const restart = element<HTMLButtonElement>("reset");
const pile = element<HTMLButtonElement>("discard-label");
const discardFan = element("discard-fan");
const pileCount = element("discard-count");
const encounterPile = element<HTMLButtonElement>("encounter-discard");
const encounterLabel = element("encounter-label");
const deckLabel = element("deck-label");
const deckCount = element("deck-count");
const handDiscardConfirm = element<HTMLButtonElement>("hand-discard-confirm");
const paymentPanel = element("payment");
const paymentSubmit = element<HTMLButtonElement>("payment-submit");
const paymentTitle = element("payment-title");
const undoButton = element<HTMLButtonElement>("undo");
const endTurnButton = element<HTMLButtonElement>("end-turn");
const turnStatus = element("turn-status");
const choicePicks = new Set<string>();
let table: BattleTable | undefined;
let state: Snapshot;
let staged: BattleCard | null = null;
const readReveal = element<HTMLButtonElement>("read-reveal");
const revealHint = element("reveal-hint");
let readingCard: string | null = null;
let menuCard: string | null = null;
let actionCard: string | null = null;
const moveViews = new WeakMap<
  Snapshot["beats"],
  { staged: BattleCard | null; reveal: Snapshot["beats"][number]["reveal"]; aim: string | null }
>();
let presented: Snapshot["beats"] | undefined;
let presenting = false;
let flying = false;
let discarding = false;
let discardOpen = false;
let viewingEncounterDiscard = false;
const viewedPile = () => (viewingEncounterDiscard ? state.encounterDiscard : state.discard);
const labels = new Map<string, HTMLButtonElement>();

type ResourceSource = NonNullable<Snapshot["payment"]>["sources"][number];
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

function resourceText(icons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const icon of icons) counts.set(icon, (counts.get(icon) ?? 0) + 1);
  return [...counts].map(([icon, n]) => `${n} ${icon}`).join(" + ");
}

function showPayment(payment: NonNullable<Snapshot["payment"]>) {
  const opening = paymentPanel.hidden;
  paymentPanel.hidden = false;
  // The staged card already shows what is being paid for; keep the name for screen readers only.
  paymentTitle.setAttribute("aria-description", `${payment.ability ? "Using" : "Playing"} ${payment.subject.name}`);
  element("payment-total").textContent = `${payment.paid} / ${payment.required}`;
  paymentPanel.querySelector<HTMLElement>(".payment-track span")!.style.transform =
    `scaleX(${payment.required ? Math.min(1, payment.paid / payment.required) : 1})`;
  const left = payment.required - payment.paid;
  element("payment-balance").textContent = payment.outstanding?.length
    ? `Need ${payment.outstanding.join(" + ")}`
    : left > 0
      ? `${left} more needed`
      : left < 0
        ? `${-left} extra selected`
        : payment.canPay
          ? "Cost covered"
          : "Choose resources";
  paymentSubmit.disabled = !payment.canPay;
  if (opening) {
    boardViewport.scrollTop = boardViewport.scrollHeight;
    paymentTitle.focus({ preventScroll: true });
  }
  inspect(hoveredCard);
}

let hoveredCard: string | null = null;
function hoverCard(id: string | null) {
  hoveredCard = id;
  if (!readingCard) inspect(id);
}

function showPreview(card: Pick<BattleCard, "art" | "name" | "landscape">, expand: boolean) {
  rail.toggleAttribute("data-wide-preview", expand && card.landscape);
  if (preview.getAttribute("src") !== card.art) preview.src = card.art;
  preview.alt = card.name;
  preview.hidden = false;
}

function inspect(id: string | null) {
  if (discarding) return;
  const card = cards().find((item) => item.id === id) ?? state.payment?.subject;
  if (card?.art) showPreview(card, card.id === hoveredCard || card.id === heldEncounter);
  else if (!heldEncounter) rail.removeAttribute("data-wide-preview");
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
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  if (model.isTargetedAttachment(card.id)) {
    beginPlay(card);
    return;
  }
  staged = card;
  flying = true;
  instruction.textContent = `Playing ${card.name}…`;
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
      instruction.textContent = card.reason || "Pick another card to play.";
      return;
    }
    state = model.snapshot();
    if (!state.payment && !state.choice) staged = null;
    instruction.textContent = state.payment
      ? "Select the cards you want to spend."
      : (state.choice?.prompt ?? `${card.name} played.`);
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
    instruction.textContent = error instanceof Error ? error.message : "The play could not be completed.";
  } finally {
    render();
  }
}

function cancel() {
  const returned = staged?.name;
  model.cancel();
  staged = null;
  flying = false;
  instruction.textContent = returned ? `${returned} returned to your hand.` : "Pick a card to play.";
  render();
}

function pay() {
  const payment = state.payment;
  if (discarding || !payment?.canPay || !table) return;
  const flights = payment.discards;
  const before = state.villainHp;
  if (!model.pay()) return;
  paymentPanel.hidden = true;
  animateDiscards(flights, flights.length ? "Discarding payment…" : `Playing ${payment.subject.name}…`, () => {
    // Keep a resolving event on the mat while the player chooses its target.
    staged = !payment.ability && state.choice && payment.subject.type === "event" ? payment.subject : null;
    const damage = before - state.villainHp;
    instruction.textContent =
      state.choice?.prompt ??
      (damage > 0
        ? `${payment.subject.name} dealt ${damage} damage to Rhino.`
        : `${payment.subject.name} ${payment.ability ? "activated" : "played"}.`);
  });
}

function closeDecision() {
  decision.hidden = true;
  choiceShade.hidden = true;
  defenseShade.setAttribute("hidden", "");
  abilityGlow.setAttribute("hidden", "");
  handDiscardConfirm.hidden = true;
}

function animateDiscards(ids: readonly string[], message: string, onComplete: () => void) {
  if (!table) return;
  discarding = true;
  closeDecision();
  restart.disabled = true;
  undoButton.disabled = endTurnButton.disabled = true;
  handDiscardConfirm.disabled = true;
  anchors.inert = true;
  for (const button of decision.querySelectorAll("button")) button.disabled = true;
  for (const id of ids) {
    const label = labels.get(id);
    if (label) label.hidden = true;
  }
  instruction.textContent = message;
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
    const before = state.villainHp;
    if (!model.choose(id)) return;
    state = model.snapshot();
    if (!state.payment && !state.choice) staged = null;
    const damage = before - state.villainHp;
    instruction.textContent = state.payment
      ? "Select the cards you want to spend."
      : (state.choice?.prompt ?? (damage ? `Rhino took ${damage} damage.` : "Pick a card to play."));
  });
}

function selectChoice(id: string) {
  actionCard = null;
  const choice = state.choice;
  if (discarding || !choice) return;
  if (!choice.discardFromHand && choice.max <= 1) {
    choose(id);
    return;
  }
  if (!choicePicks.delete(id) && choicePicks.size < choice.max) choicePicks.add(id);
  const focusedOption = document.activeElement instanceof HTMLButtonElement && document.activeElement.dataset.option;
  render();
  if (focusedOption) decision.querySelector<HTMLButtonElement>(`[data-option="${CSS.escape(focusedOption)}"]`)?.focus();
}

function confirmChoice() {
  const choice = state.choice;
  const picks = [...choicePicks];
  if (discarding || !choice || !model.chooseMany(picks)) return;
  const discarded = choice.discardFromHand
    ? picks.map((id) => choice.options.find((option) => option.id === id)?.cardId ?? id)
    : [];
  choicePicks.clear();
  animateDiscards(discarded, "Discarding cards…", () => {
    instruction.textContent = state.choice?.prompt ?? "Pick a card to play.";
  });
}

type TriggerChoice = NonNullable<Snapshot["choice"]>;
let triggerChoice: TriggerChoice | null = null;
let defenderSelection: TriggerChoice | null = null;
function defenseQuestionDecline(choice: TriggerChoice | null) {
  if (!choice?.defense || choice === defenderSelection || !choice.options.some((option) => option.cardId)) return;
  return choice.options.find((option) => !option.cardId);
}

let offerIndex = 0;
let acceptedOffers: string[] = [];

function showOffer(choice: TriggerChoice) {
  if (triggerChoice !== choice) {
    triggerChoice = choice;
    offerIndex = 0;
    acceptedOffers = [];
  }
  const offers = choice.offers!;
  const offer = offers[offerIndex]!;
  inspect(offer.cardId);
  askYesNo(offer.question, choice.prompt, offer.effect, (yes) => {
    if (yes) acceptedOffers.push(offer.id);
    if (++offerIndex < offers.length && acceptedOffers.length < choice.max) {
      render();
      return;
    }
    const picks = acceptedOffers;
    triggerChoice = null;
    act(() => {
      model.chooseMany(picks);
    });
  });
}

function askYesNo(question: string, context: string | null, effect: string | null, answer: (yes: boolean) => void) {
  const heading = make("h2", "", question);
  heading.id = "turn-question";
  decision.setAttribute("data-ability", "");
  decision.setAttribute("role", "dialog");
  decision.setAttribute("aria-modal", "true");
  decision.setAttribute("aria-labelledby", heading.id);
  if (context) decision.append(make("p", "choice-help", context));
  decision.append(heading);
  if (effect) decision.append(make("p", "choice-help", effect));
  const actions = make("div", "trigger-actions");
  for (const yes of [true, false]) {
    const button = make("button", "option", yes ? "Yes" : "No");
    button.onclick = () => answer(yes);
    actions.append(button);
  }
  actions.onkeydown = (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const [yes, no] = actions.querySelectorAll("button");
    (document.activeElement === yes ? no : yes)?.focus();
  };
  decision.append(actions);
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function showChoice(choice: NonNullable<Snapshot["choice"]>) {
  if (choice.offers?.length) {
    showOffer(choice);
    return;
  }
  const decline = defenseQuestionDecline(choice);
  if (decline && choice.defense) {
    askYesNo(`Defend ${choice.defense.attacker}’s attack?`, null, null, (yes) => {
      if (yes) {
        const defenders = choice.options.filter((option) => option.cardId);
        if (defenders.length === 1) {
          choose(defenders[0]!.id);
          return;
        }
        defenderSelection = choice;
        render();
      } else choose(decline.id);
    });
    return;
  }
  const multiple = choice.discardFromHand || choice.max > 1;
  decision.append(
    make(
      "p",
      "eyebrow",
      (choice.defense ? `${choice.defense.attacker} attacks` : choice.sourceTitle) ??
        (state.turn === "enemy"
          ? (cards().find((c) => c.id === state.choiceSource)?.name ?? "Villain Phase")
          : state.turn === "ending"
            ? "End of turn"
            : "Resolve card"),
    ),
  );
  const heading = choice.discardFromHand ? "Choose cards to discard" : choice.prompt;
  const explanation = choice.explanation && make("p", "choice-help", choice.explanation);
  if (explanation && choice.sourceTitle) decision.append(explanation);
  if (!/^choose one[.:]?$/i.test(heading.trim())) decision.append(make("h2", "", heading));
  if (explanation && !choice.sourceTitle) decision.append(explanation);
  decision.toggleAttribute("data-revealed-choice", !!choice.sourceTitle);
  if (multiple && choice.min > 0) {
    decision.append(
      make("p", "choice-help", `Choose at least ${choice.min} ${choice.min === 1 ? "card" : "cards"} to continue.`),
    );
  }
  if (choice.discardFromHand) {
    handDiscardConfirm.textContent = choicePicks.size ? `Discard ${choicePicks.size} & continue` : "Keep hand";
    handDiscardConfirm.disabled = choicePicks.size < choice.min || discarding;
    return;
  }
  function option(id: string | null, text: string) {
    const button = make("button", "option", text);
    if (id !== null && multiple) {
      button.dataset.option = id;
      button.setAttribute("aria-pressed", String(choicePicks.has(id)));
    }
    button.onclick = () => (id === null ? choose(null) : selectChoice(id));
    decision.append(button);
  }
  for (const item of choice.options)
    if (!onTable(item.cardId) || actionCard === item.cardId) option(item.id, item.label);
  if (multiple) {
    const confirm = make("button", "option choice-confirm", "Continue");
    confirm.disabled = choicePicks.size < choice.min;
    confirm.onclick = confirmChoice;
    decision.append(confirm);
  } else if (choice.canSkip) option(null, choice.decline ?? "Skip");
  if (choice.canCancel) {
    const back = make("button", "quiet", "Cancel");
    back.onclick = cancel;
    decision.append(back);
  }
}

function updateThreatLabel(counter: HTMLElement, count: number) {
  counter.dataset.count = String(count);
  counter.textContent =
    counter.dataset.target === undefined ? `${count} threat` : `${count} / ${counter.dataset.target} threat`;
  const target = Number(counter.dataset.target);
  counter.toggleAttribute("data-near-limit", count > 0 && count >= target - Math.ceil(target / 4));
}

function updateHpLabel(label: HTMLButtonElement | undefined, hp: number) {
  if (!label?.dataset.hp || !label.firstChild) return;
  const previous = label.dataset.hp;
  label.dataset.hp = String(hp);
  label.firstChild.textContent = label.firstChild.textContent!.replace(/\d+ HP/, `${hp} HP`);
  const description = label.getAttribute("aria-description");
  if (label.classList.contains("identity") && description)
    label.setAttribute("aria-description", description.replace(`${previous} HP`, `${hp} HP`));
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
  tryAgain.textContent = won ? "Play Again" : "Try Again";
  if (!gameOver.open) {
    if (won) throwConfetti();
    gameOver.showModal();
  }
}

function shakeStage(strength: "light" | "heavy") {
  const stage = element("stage");
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
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    const discardChoice = state.choice?.discardFromHand && target;
    label.disabled = (!!state.payment && !source?.available) || (!!state.choice?.defense && !target);
    label.toggleAttribute("data-target", !!target);
    label.toggleAttribute(
      "data-tucked",
      ((isTuckedUpgrade(card) && state.inPlay.some((c) => c.id === card.id)) ||
        (!!card.attachedTo && state.enemyCards.some((c) => c.id === card.id))) &&
        !discardOpen &&
        !source &&
        !target,
    );
    label.dataset.spent = String(!!source?.selected);
    if (source || discardChoice)
      label.setAttribute("aria-pressed", String(source?.selected ?? choicePicks.has(target!.id)));
    else label.removeAttribute("aria-pressed");
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    const hp = hero ? state.heroHp : enemy ? state.villainHp : card.hp;
    label.className = "anchor" + (discardOpen ? " discard-card" : hero ? " identity" : enemy ? " enemy" : "");
    const inHand = !discardOpen && displayedHand.some((item) => item.id === card.id);
    const layer = discardOpen ? discardFan : inHand ? anchors : boardLabels;
    const description = card.markers.map((m) => `${m.name} ×${m.count}`);
    if (hero) {
      if (card.exhausted) description.unshift("Exhausted");
      description.unshift(`${hp} HP`);
    }
    if (description.length && layer === boardLabels) label.setAttribute("aria-description", description.join(", "));
    else label.removeAttribute("aria-description");
    if (label.parentElement !== layer) layer.append(label);
    let caption = inHand ? "" : card.name;
    if (!inHand && !discardOpen && hp !== undefined) caption = hero ? `${hp} HP` : `${card.name} · ${hp} HP`;
    label.textContent = caption;
    if (hp === undefined || discardOpen) delete label.dataset.hp;
    else label.dataset.hp = String(hp);
    if (card.threat !== null && onTable(card.id)) {
      const counter = make("span", "scheme-threat");
      if (card.threatTarget != null) counter.dataset.target = String(card.threatTarget);
      updateThreatLabel(counter, card.threat);
      label.append(counter);
    }
    if (!inHand && target && !discardChoice && target.label !== card.name && !target.label.startsWith(card.name + " ("))
      label.append(make("span", "resource-value", target.label));
    if (source)
      label.append(
        make(
          "span",
          "resource-value",
          `${source.kind === "resourceAbility" ? "Ability · " : ""}+${resourceText(source.icons)}`,
        ),
      );
    label.setAttribute(
      "aria-label",
      discardOpen
        ? `Inspect ${card.name}`
        : target
          ? `${discardChoice ? "Discard" : "Choose"} ${card.name}`
          : source
            ? `${source.selected ? "Remove" : "Spend"} ${card.name}, ${resourceText(source.icons)}`
            : card.playable
              ? `Play ${card.name}, cost ${card.cost}`
              : `Inspect ${card.name}`,
    );
  }
}

function updateOutlines(group: SVGGElement, ids: readonly string[]) {
  while (group.childElementCount > ids.length) group.lastElementChild!.remove();
  ids.forEach((id, i) => {
    const polygon =
      group.children[i] ?? group.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "polygon"));
    polygon.setAttribute("points", table!.cardOutline(id).join(" "));
  });
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
  encounterLabel.style.transform = `translate(${Math.round(encounter.x)}px,${Math.round(encounter.bottom + 2)}px)`;
  deckLabel.style.transform = `translate(${Math.round(deck.x)}px,${Math.round(deck.bottom + 3)}px)`;
  const encounterDiscard = table.encounterDiscardAnchor();
  encounterPile.style.transform =
    discardOpen && viewingEncounterDiscard
      ? ""
      : `translate(${Math.round(Math.min(encounterDiscard.x, element("stage").clientWidth - encounterPile.offsetWidth / 2 - 2))}px,${Math.round(encounterDiscard.bottom + 2)}px)`;
  pile.style.transform =
    discardOpen && !viewingEncounterDiscard
      ? ""
      : `translate(${Math.round(discard.x)}px,${Math.round(discard.bottom + 3)}px)`;
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
  if (!abilityGlow.hasAttribute("hidden"))
    updateOutlines(abilityOutlines, state.choice?.offers?.slice(offerIndex, offerIndex + 1).map((o) => o.cardId) ?? []);
  if (state.choice?.defense && !defenseShade.hasAttribute("hidden")) {
    updateOutlines(
      defenderCutouts,
      state.choice.options.flatMap((o) => (o.cardId ? [o.cardId] : [])),
    );
  }
  if (heldEncounter && !choiceShade.hidden) {
    const card = projected.find((p) => p.id === heldEncounter);
    if (card) {
      decision.style.setProperty("--reveal-bottom", card.bottom + 8 + "px");
      choiceShade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${card.left}px ${card.top}px, ${card.right}px ${card.top}px, ${card.right}px ${card.bottom}px, ${card.left}px ${card.bottom}px, ${card.left}px ${card.top}px)`;
    }
  }
  if (readingCard) {
    const card = projected.find((p) => p.id === readingCard);
    if (card) {
      revealHint.style.left = card.x + "px";
      revealHint.style.top = card.bottom + 4 + "px";
    }
  }
  if (menuCard) {
    const hero = projected.find((p) => p.id === menuCard);
    if (hero) {
      decision.style.setProperty("--hero-x", hero.x + "px");
      decision.style.setProperty("--hero-y", hero.y - (hero.bottom - hero.y) * 0.74 + "px");
    }
  }
  const handIds = new Set(displayedHand.map((card) => card.id));
  const hand = projected.filter((point) => handIds.has(point.id)).sort((a, b) => a.x - b.x);
  const paymentEdge = table.paymentEdge;
  if (state.payment) paymentPanel.style.setProperty("--hand-edge", paymentEdge + "px");
  const width = hand.reduce(
    (gap, point, index) => (index ? Math.min(gap, point.x - hand[index - 1]!.x - 4) : gap),
    142,
  );
  for (const anchor of projected) {
    const node = labels.get(anchor.id);
    if (!node) continue;

    const labelWidth = discardOpen
      ? anchor.width * 0.82
      : handIds.has(anchor.id)
        ? Math.max(32, width)
        : anchor.id === state.hero.id
          ? Math.min(90, anchor.width)
          : 142;
    node.style.setProperty("--card-width", `${labelWidth}px`);
    let y = anchor.bottom + 4;
    if (!discardOpen && handIds.has(anchor.id)) {
      const halfWidth = node.offsetWidth / 2;
      const nearby = hand.filter((p) => p.right > anchor.x - halfWidth && p.left < anchor.x + halfWidth);
      y = Math.max(y, ...nearby.map((p) => p.bottom + 4));
    }
    node.style.transform = `translate(${Math.round(anchor.x)}px,${Math.round(y)}px)`;
  }
}

const PHASE_BANNER_MS = 1500;

function phaseIndicator(phase: "hero" | "villain", announce = false) {
  table?.setPhase(phase);
  const title = phase === "hero" ? "Hero Phase" : "Villain Phase";
  turnStatus.dataset.phase = phase;
  turnStatus.textContent = `${title} · ${state.round}`;
  if (announce) {
    const banner = element("phase-banner");
    banner.dataset.phase = phase;
    const lettering = banner.querySelector("b")!;
    lettering.textContent = title;
    banner.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    banner.animate([{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], {
      duration: PHASE_BANNER_MS,
    });
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      lettering.animate(
        [
          { transform: "translateX(-100%)", easing: "cubic-bezier(.18,.74,.28,1)" },
          { transform: "translateX(-2.5%)", offset: 0.24, easing: "linear" },
          { transform: "translateX(2.5%)", offset: 0.73, easing: "cubic-bezier(.6,.02,.9,.5)" },
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
  element("stage").append(ring);
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
  element("stage").append(svg);
  await svg.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: 230, easing: "ease-out" }).finished;
  svg.remove();
}
async function showBoost(reveal: NonNullable<Snapshot["beats"][number]["reveal"]>) {
  const boost = reveal.boost!;
  const projected = table?.anchors();
  const card = projected?.find((p) => p.id === reveal.id);
  const enemy = projected?.find((p) => p.id === boost.enemy);
  if (!card) return;
  const burst = make("div", "boost-burst");
  burst.setAttribute("role", "status");
  burst.append(make("b", "", `+${boost.icons}`), make("span", "", "Boost"));
  const x = card.x + card.width * 0.33;
  const y = card.bottom - card.width * 0.25;
  burst.style.left = x + "px";
  burst.style.top = y + "px";
  element("stage").append(burst);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animation = burst.animate(
    reduced
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
          { transform: "scale(.55)", opacity: 0 },
          { transform: "scale(1.18)", opacity: 1, offset: 0.18 },
          { transform: "scale(1)", opacity: 1, offset: 0.35 },
          { transform: "scale(1)", opacity: 1, offset: 0.68 },
          { transform: `translate(${(enemy?.x ?? x) - x}px,${(enemy?.y ?? y) - y}px) scale(.62)`, opacity: 0 },
        ],
    { duration: 760, easing: "ease-out" },
  );
  await animation.finished;
  burst.remove();
}

async function present(beats: Snapshot["beats"]) {
  presenting = true;
  closeDecision();
  paymentPanel.hidden = true;
  const stage = element("stage");
  const announcement = element("action-beat");
  const impact = element("impact");
  stage.dataset.resolving = "true";
  anchors.inert = decision.inert = true;
  undoButton.disabled = endTurnButton.disabled = restart.disabled = handDiscardConfirm.disabled = true;
  const pendingDraws = new Set(beats.flatMap((beat) => beat.draw ?? []));
  for (let index = 0; index < beats.length; index++) {
    const beat = beats[index]!;
    if (beat.gameEnded) break;
    if (beat.draw) {
      for (const id of beat.draw) pendingDraws.delete(id);
      displayedHand = state.hand.filter((card) => !pendingDraws.has(card.id));
      const deckSize = state.deckCount + pendingDraws.size;
      table?.showDraw(displayedHand, beat.draw, deckSize, state.discard);
      deckCount.textContent = String(deckSize);
      element("hand-count").textContent = String(displayedHand.length);
      announcement.replaceChildren(
        make("b", "", beat.enemy ? "Villain phase" : "Player phase"),
        make("span", "", `Draw ${beat.draw.length} card${beat.draw.length === 1 ? "" : "s"}`),
      );
      announcement.hidden = false;
      const duration = 680 + (beat.draw.length - 1) * 180;
      await new Promise((resolve) => setTimeout(resolve, duration));
      continue;
    }
    if (beat.phase) {
      announcement.hidden = true;
      phaseIndicator(beat.phase, true);
      turnStatus.dataset.turn = beat.phase === "hero" ? "player" : "enemy";
      await new Promise((resolve) => setTimeout(resolve, PHASE_BANNER_MS));
      continue;
    }
    if (beat.defeatedCard) {
      announcement.hidden = true;
      table?.markActor(null);
      const id = beat.defeatedCard;
      const label = labels.get(id);
      updateHpLabel(label, 0);
      const threat = label?.querySelector<HTMLElement>(".scheme-threat");
      if (threat && threat.dataset.count !== "0") {
        updateThreatLabel(threat, 0);
        table?.setThreat(id, 0);
      }
      await flashDefeatedCard(id);
      label?.remove();
      labels.delete(id);
      const encounter = state.encounterDiscard.find((card) => card.id === id);
      const discarded = encounter ?? state.discard.find((card) => card.id === id);
      table?.discardDefeatedCard(id, discarded, encounter ? "encounterDiscard" : "discard");
      if (discarded) await new Promise((resolve) => setTimeout(resolve, 460));
      continue;
    }
    const actor = beat.actor ?? beat.hit?.source ?? beat.reveal?.id ?? null;
    table?.markActor(beat.defeat ? null : actor);
    if (actor && !beat.defeat) inspect(actor);
    if (beat.defeat) {
      announcement.hidden = true;
      if (actor) await flashDefeatedCard(actor);
      announcement.style.setProperty("--defeat-top", `${boardViewport.scrollTop + 18}px`);
      announcement.setAttribute("data-defeat", "");
      announcement.replaceChildren(make("span", "", beat.defeat));
      announcement.hidden = false;
      await new Promise((resolve) => setTimeout(resolve, 1350));
      announcement.removeAttribute("data-defeat");
      if (!beat.villainStage) {
        announcement.hidden = true;
        continue;
      }
    }
    announcement.replaceChildren(
      make("b", "", beat.enemy ? beat.activity || "Villain phase" : "Card effect"),
      make("span", "", beat.text),
    );
    announcement.hidden = false;
    if (beat.enemy) {
      turnStatus.dataset.turn = "enemy";
      phaseIndicator("villain");
    }
    if (beat.villainStage || beat.villainFlip) {
      table?.showVillain(state.villain, !!(beat.defeat || beat.villainFlip));
      await new Promise((resolve) => setTimeout(resolve, 360));
      inspect(state.villain.id);
      const label = labels.get(state.villain.id);
      if (label?.firstChild) {
        label.dataset.hp = String(state.villainHp);
        label.firstChild.textContent = `${state.villain.name} · ${state.villainHp} HP`;
      }
      await new Promise((resolve) => setTimeout(resolve, 460));
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
          matchMedia("(prefers-reduced-motion: reduce)").matches
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
      await new Promise((resolve) => setTimeout(resolve, 90));
      const projected = table?.anchors();
      const from = projected?.find((a) => a.id === source);
      const to = projected?.find((a) => a.id === target);
      aimTarget = target;
      reticle.hidden = false;
      placeLabels();
      if (from && to && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        reticle.animate(
          [
            { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(1.45)`, opacity: 0.25 },
            { transform: "translate(0,0) scale(1)", opacity: 1 },
          ],
          { duration: 300, easing: "ease-out" },
        );
    }
    if (beat.activate) {
      const event = [staged, ...state.discard, ...displayedHand].find((c) => c?.id === beat.activate!.card);
      if (event) {
        staged = event;
        table?.stageEvent(event);
        displayedHand = displayedHand.filter((c) => c.id !== event.id);
        labels.get(event.id)?.remove();
        labels.delete(event.id);
        await new Promise((resolve) => setTimeout(resolve, 320));
      }
      activationRing(beat.activate.card);
      await new Promise((resolve) => setTimeout(resolve, 360));
      table?.channelEvent(beat.activate.card);
      await new Promise((resolve) => setTimeout(resolve, 450));
      table?.markActor(beat.activate.hero);
      activationRing(beat.activate.hero);
    }
    if (beat.interrupt) {
      table?.pulseInterrupt(beat.interrupt);
      await new Promise((resolve) => setTimeout(resolve, INTERRUPT_MS));
      continue;
    }
    if (beat.deflection) table?.deflectDamage(beat.deflection.card, beat.deflection.amount);
    if (beat.discardEvent) {
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
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      table?.changeStatus(id, name, delta);
    }
    if (beat.turned) {
      const turns = [beat.turned];
      if (!beat.turned.exhausted) {
        while (beats[index + 1]?.turned?.exhausted === false) turns.push(beats[++index]!.turned!);
        if (turns.length > 1) announcement.lastElementChild!.textContent = `Ready ${turns.length} cards`;
      }
      table?.turnCards(turns);
      const duration = beat.turned.exhausted ? EXHAUST_MS : READY_MS;
      await new Promise((resolve) => setTimeout(resolve, duration));
      continue;
    }
    if (beat.encounterDeal) {
      table?.dealEncounter(beat.encounterDeal);
      const count = element("encounter-count");
      count.textContent = String(Math.max(0, Number(count.textContent) - 1));
    }
    if (beat.reveal) {
      readingCard = beat.reveal.boost ? null : beat.reveal.id;
      table?.revealEncounter(beat.reveal);
      await new Promise((resolve) => setTimeout(resolve, 360));
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
        await new Promise((resolve) => setTimeout(resolve, 650));
      } else {
        readReveal.setAttribute("aria-label", `Continue after reading ${beat.reveal.name}`);
        revealHint.hidden = readReveal.hidden = false;
        readReveal.focus({ preventScroll: true });
        placeLabels();
        await new Promise<void>((resolve) => readReveal.addEventListener("click", () => resolve(), { once: true }));
        revealHint.hidden = readReveal.hidden = true;
      }
      readingCard = null;
      rail.removeAttribute("data-wide-preview");
      const permanent = state.enemyCards.find((c) => c.id === beat.reveal!.id);
      if (permanent) table?.landEncounter(permanent);
      else {
        table?.retireEncounter(
          beat.reveal.id,
          state.encounterDiscard.find((c) => c.id === beat.reveal!.id),
        );
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    if (beat.threat) {
      activationRing(beat.threat.scheme);
      const counter = labels.get(beat.threat.scheme)?.querySelector<HTMLElement>(".scheme-threat");
      if (counter) {
        const n = Math.max(0, Number(counter.dataset.count) + beat.threat.delta);
        updateThreatLabel(counter, n);
        table?.setThreat(beat.threat.scheme, n);
      }
    }
    if (beat.hit) {
      table?.strike(beat.hit.source, beat.hit.target);
      await new Promise((resolve) => setTimeout(resolve, HIT_CONTACT_MS));
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
        impact.textContent = beat.hit.amount ? `−${beat.hit.amount}` : beat.hit.tough ? "Tough" : "Blocked";
        impact.style.left = anchor.x + "px";
        impact.style.top = anchor.y + "px";
        impact.dataset.blocked = String(!beat.hit.amount);
        impact.style.setProperty("--burst-size", Math.min(180, Math.max(74, anchor.width * 1.1)) + "px");
        impact.hidden = false;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, beat.attackAim ? 390 : beat.hit ? 670 : 1000));
    impact.hidden = true;
  }
  impact.hidden = true;
  announcement.hidden = true;
  delete stage.dataset.resolving;
  anchors.inert = decision.inert = false;
  presenting = false;
  render();
}
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
  decision.removeAttribute("aria-modal");
  decision.removeAttribute("role");
  decision.removeAttribute("aria-labelledby");
  decision.removeAttribute("data-revealed-choice");
  if (defenderSelection !== state.choice) defenderSelection = null;
  const defenseQuestion = !!defenseQuestionDecline(state.choice);
  const defending = !!state.choice?.defense && !defenseQuestion;
  if (state.choice?.defense) aimTarget = state.choice!.defense!.target;
  else if (!state.choice) aimTarget = null;
  reticle.hidden =
    defenseQuestion || !aimTarget || (!defending && !state.choice?.options.some((o) => o.cardId === aimTarget));
  abilityGlow.setAttribute("hidden", "");
  decision.removeAttribute("data-ability");
  defenseShade.setAttribute("hidden", "");
  decision.toggleAttribute("data-defense", defending);
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
  if (
    paymentSubject &&
    !staged &&
    !model.isTargetedAttachment(paymentSubject.id) &&
    state.hand.some((card) => card.id === paymentSubject.id)
  ) {
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
      state.choice && !defenseQuestion && state.choice.max <= 1 && !state.choice.discardFromHand
        ? state.choice.options.flatMap((item) => (item.cardId && onTable(item.cardId) ? [item.cardId] : []))
        : [],
    discardOpen,
    hand: displayedHand,
    staged,
    paymentSources: state.payment?.sources.filter((s) => s.available).map(resourcePieceId) ?? null,
    selected,
  });
  table?.markActor(state.choiceSource);
  discardFan.hidden = !discardOpen;
  synchronizeLabels();
  pile.disabled = !state.discard.length || flying || discarding || !!state.payment;
  pile.setAttribute("aria-expanded", String(discardOpen && !viewingEncounterDiscard));
  encounterPile.setAttribute("aria-expanded", String(discardOpen && viewingEncounterDiscard));
  encounterPile.hidden = !state.encounterDiscard.length;
  encounterPile.disabled = !state.encounterDiscard.length || flying || discarding || !!state.payment;
  element("encounter-discard-count").textContent = String(state.encounterDiscard.length);
  const count = state.discard.length;
  pile.setAttribute(
    "aria-label",
    `${discardOpen ? "Stack" : "Inspect"} discard pile, ${count} card${count === 1 ? "" : "s"}`,
  );
  instruction.hidden = discardOpen;
  element("discard-hint").hidden = !discardOpen;
  pileCount.textContent = String(state.discard.length);
  element("encounter-count").textContent = String(state.encounterCount);
  deckCount.textContent = String(state.deckCount);
  element("hand-count").textContent = String(state.hand.filter((card) => card.id !== staged?.id).length);
  decision.replaceChildren();
  decision.hidden = (!state.choice && !menuCard) || discardOpen;
  decision.toggleAttribute("data-identity", !!menuCard);
  decision.toggleAttribute(
    "data-enemy-choice",
    !!state.choice &&
      (state.turn === "enemy" ||
        state.choice.options.some(
          (o) => state.enemyCards.some((c) => c.id === o.cardId) || state.villain.id === o.cardId,
        )),
  );
  if (menuCard) {
    const id = menuCard;
    const card = [state.hero, ...state.inPlay].find((c) => c.id === id);
    const actions = id === state.hero.id ? state.heroActions : model.fieldActions(id);
    if (!actions.length)
      decision.append(make("p", "choice-help", card?.exhausted ? "Exhausted" : "No actions available"));
    for (const action of actions) {
      const button = make("button", "option", action.label);
      button.dataset.power = action.kind;
      if (action.kind === "basicAttack" || action.kind === "basicThwart" || action.kind === "basicRecover") {
        const stat = action.kind === "basicAttack" ? "atk" : action.kind === "basicThwart" ? "thw" : "rec";
        const value = model.basicPower(id, stat);
        const description = `${action.label} with ${card?.name ?? "card"} (${value} ${stat.toUpperCase()})`;
        button.setAttribute("aria-label", description);
        button.title = description;
        button.classList.add("stat-action");
        button.style.setProperty("--stat-color", statHue[stat].css);
        button.replaceChildren(make("b", "stat-value", String(value)), make("span", "stat-ribbon", stat.toUpperCase()));
      } else if ("exhausts" in action && action.exhausts) {
        const description = `${card?.name ?? "Card"}: ${action.label}`;
        button.setAttribute("aria-label", description);
        button.title = description;
        const icon = make("span", "exhaust-icon", "↷");
        icon.setAttribute("aria-hidden", "true");
        button.replaceChildren(icon);
        button.classList.add("exhaust-action");
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
    if (id === state.hero.id) {
      const close = make("button", "quiet", "Close");
      close.onclick = () => {
        menuCard = null;
        render();
      };
      decision.append(close);
    }
    placeLabels();
  }
  const handChoice = !decision.hidden && !!state.choice?.discardFromHand;
  decision.toggleAttribute("data-hand-choice", handChoice);
  const undoNeighbor = handChoice ? handDiscardConfirm : endTurnButton;
  if (undoButton.nextElementSibling !== undoNeighbor) undoNeighbor.before(undoButton);
  undoButton.disabled = !model.canUndo || flying || discarding || !!state.payment || !!state.choice?.canCancel;
  handDiscardConfirm.hidden = !handChoice;
  paymentSubmit.hidden = handChoice;
  element("payment-cancel").hidden = handChoice;
  restart.disabled = discarding || !!state.payment;
  endTurnButton.disabled = !state.canEndTurn || flying || discarding || discardOpen;
  const turn =
    state.turn === "enemy"
      ? "Enemy turn"
      : state.turn === "ending"
        ? "Ending your turn"
        : state.turn === "finished"
          ? state.outcome?.result === "win"
            ? "Victory"
            : "Defeat"
          : "Your turn";
  if (state.turn === "finished") turnStatus.textContent = turn;
  else phaseIndicator(state.turn === "enemy" ? "villain" : "hero");
  turnStatus.dataset.turn = state.turn;
  if (state.payment) showPayment(state.payment);
  else paymentPanel.hidden = true;
  choiceShade.hidden = decision.hidden || !(heldEncounter || state.choice?.offers?.length || defenseQuestion);
  if (state.choice) {
    showChoice(state.choice);
    if (defending) {
      defenseShade.removeAttribute("hidden");
      reticle.hidden = false;
    }
    if (state.choice.offers?.length) {
      abilityGlow.removeAttribute("hidden");
    }
    placeLabels();
  }
  showOutcome(state.outcome);
}

function deal() {
  menuCard = null;
  actionCard = null;
  restart.disabled = true;
  flying = false;
  discardOpen = false;
  choicePicks.clear();
  staged = null;
  model.reset();
  state = model.snapshot();
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
  }
  render();
  inspect(state.hand.find((card) => card.playable)?.id ?? state.hero.id);
  instruction.textContent = "Pick a card to play.";
  restart.disabled = false;
  placeLabels();
  phaseIndicator("hero", true);
}

function start() {
  try {
    deal();
  } catch (error) {
    instruction.textContent = error instanceof Error ? error.message : "Could not open the table.";
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
  render();
  for (const id of state.facedownEncounters) table?.dealEncounter(id);
  if (view?.reveal) table?.revealEncounter(view.reveal);
  if (staged?.type === "event") table?.channelEvent(staged.id);
  inspect(heldEncounter ?? state.hero.id);
  instruction.textContent = state.choice?.prompt ?? "Move undone.";
};
restart.onclick = start;
tryAgain.onclick = start;
gameOverUndo.onclick = () => undoButton.click();
gameOver.oncancel = (event) => event.preventDefault();
endTurnButton.onclick = () => {
  if (endTurnButton.disabled) return;
  act(() => {
    if (model.endTurn()) instruction.textContent = model.snapshot().choice?.prompt ?? "";
  });
};
paymentSubmit.onclick = pay;
handDiscardConfirm.onclick = confirmChoice;
element<HTMLButtonElement>("payment-cancel").onclick = cancel;
pile.onclick = () => setDiscardOpen(!discardOpen || viewingEncounterDiscard, false);
encounterPile.onclick = () => setDiscardOpen(!discardOpen || !viewingEncounterDiscard, true);
document.addEventListener(
  "click",
  (event) => {
    if (
      !discardOpen ||
      !(event.target instanceof Element) ||
      event.target.closest("#space, #discard-label, #encounter-discard, #discard-fan")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setDiscardOpen(false);
  },
  true,
);
document.addEventListener("keydown", (event) => {
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
  }
});
boardViewport.addEventListener("scroll", centerDecisionInViewport, { passive: true });
new ResizeObserver(centerDecisionInViewport).observe(boardViewport);
start();
