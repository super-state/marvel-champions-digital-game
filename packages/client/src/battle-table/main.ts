import "./battle.css";
import { BattleModel, type BattleCard } from "./model.js";
import { BattleTable } from "./table.js";

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
const anchors = element("anchors");
const preview = element<HTMLImageElement>("preview");
const decision = element("decision");
const instruction = element("instruction");
const restart = element<HTMLButtonElement>("reset");
const pile = element<HTMLButtonElement>("discard-label");
const discardFan = element("discard-fan");
const pileCount = element("discard-count");
const deckLabel = element("deck-label");
const deckCount = element("deck-count");
const handDiscardConfirm = element<HTMLButtonElement>("hand-discard-confirm");
const paymentPanel = element("payment");
const paymentSubmit = element<HTMLButtonElement>("payment-submit");
const paymentTitle = element("payment-title");
const endTurnButton = element<HTMLButtonElement>("end-turn");
const turnStatus = element("turn-status");
const choicePicks = new Set<string>();
let table: BattleTable | undefined;
let state: Snapshot;
let staged: BattleCard | null = null;
let flying = false;
let discarding = false;
let discardOpen = false;
const labels = new Map<string, HTMLButtonElement>();

function cards() {
  return [state.hero, state.villain, ...state.hand, ...state.inPlay, ...state.discard];
}

function resourceText(icons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const icon of icons) counts.set(icon, (counts.get(icon) ?? 0) + 1);
  return [...counts].map(([icon, n]) => `${n} ${icon}`).join(" + ");
}

function showPayment(payment: NonNullable<Snapshot["payment"]>) {
  const opening = paymentPanel.hidden;
  paymentPanel.hidden = false;
  element("payment-subject").textContent = `Playing ${payment.subject.name}`;
  element("payment-total").textContent = `${payment.paid} / ${payment.required}`;
  paymentPanel.querySelector<HTMLElement>(".payment-track span")!.style.transform =
    `scaleX(${payment.required ? Math.min(1, payment.paid / payment.required) : 1})`;
  const left = payment.required - payment.paid;
  element("payment-balance").textContent =
    left > 0 ? `${left} more needed` : left < 0 ? `${-left} extra selected` : "Cost covered";
  paymentSubmit.disabled = !payment.canPay;
  if (opening) paymentTitle.focus({ preventScroll: true });
}

function inspect(id: string | null) {
  if (!id || discarding) return;
  const card = cards().find((item) => item.id === id);
  if (card && card.art) {
    if (preview.getAttribute("src") !== card.art) preview.src = card.art;
    preview.alt = card.name;
    preview.hidden = false;
  }
}

function setDiscardOpen(open: boolean) {
  if (discardOpen === open || (open && (flying || discarding || state.payment || !state.discard.length))) return;
  const restoreFocus = discardFan.contains(document.activeElement);
  discardOpen = open;
  render();
  inspect(state.discard.at(-1)?.id ?? null);
  if (!open && restoreFocus) pile.focus({ preventScroll: true });
}

function pick(id: string) {
  if (flying || discarding) return;
  const choosingCard = state.choice?.options.some((option) => option.cardId === id);
  if (state.discard.some((card) => card.id === id) && !state.payment && (discardOpen || !choosingCard)) {
    if (discardOpen) inspect(id);
    else setDiscardOpen(true);
    return;
  }
  if (discardOpen) return;
  inspect(id);
  if (state.payment) {
    const source = state.payment.sources.find((item) => item.cardId === id);
    if (source) toggle(source.id);
    return;
  }
  if (state.choice) {
    const target = state.choice.options.find((option) => option.cardId === id);
    if (target) selectChoice(target.id);
    return;
  }
  const card = state.hand.find((item) => item.id === id);
  if (!card) return;
  if (!card.playable) {
    instruction.textContent = card.reason || `${card.name} cannot be played now.`;
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
  act(() => {
    if (!model.pick(id)) {
      staged = null;
      instruction.textContent = "Pick another card to play.";
      return;
    }
    state = model.snapshot();
    if (!state.payment && !state.choice) staged = null;
    instruction.textContent = state.payment ? "Select the cards you want to spend." : "Choose how to resolve the play.";
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
    staged =
      state.choice && payment.subject.type === "event" && !state.discard.some((card) => card.id === payment.subject.id)
        ? payment.subject
        : null;
    const damage = before - state.villainHp;
    instruction.textContent =
      state.choice?.prompt ??
      (damage > 0 ? `${payment.subject.name} dealt ${damage} damage to Rhino.` : `${payment.subject.name} played.`);
  });
}

function animateDiscards(ids: readonly string[], message: string, onComplete: () => void) {
  if (!table) return;
  discarding = true;
  restart.disabled = true;
  endTurnButton.disabled = true;
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

function showChoice(choice: NonNullable<Snapshot["choice"]>) {
  const multiple = choice.discardFromHand || choice.max > 1;
  decision.append(
    make(
      "p",
      "eyebrow",
      state.turn === "enemy" ? "Enemy turn" : state.turn === "ending" ? "End of turn" : "Resolve card",
    ),
    make("h2", "", choice.discardFromHand ? "Choose cards from your hand to discard" : choice.prompt),
  );
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
  for (const item of choice.options) option(item.id, item.label);
  if (multiple) {
    const confirm = make("button", "option choice-confirm", "Continue");
    confirm.disabled = choicePicks.size < choice.min;
    confirm.onclick = confirmChoice;
    decision.append(confirm);
  } else if (choice.canSkip) option(null, "Skip");
  if (choice.canCancel) {
    const back = make("button", "quiet", "Cancel");
    back.onclick = cancel;
    decision.append(back);
  }
}

function synchronizeLabels() {
  const visible = discardOpen
    ? state.discard
    : [state.hero, state.villain, ...state.hand.filter((c) => c.id !== staged?.id), ...state.inPlay];
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
        inspect(card.id);
        table?.setHovered(card.id);
      };
      label.onblur = () => table?.setHovered(null);
      labels.set(card.id, label);
      (discardOpen ? discardFan : anchors).append(label);
    }
    const source = state.payment?.sources.find((s) => s.cardId === card.id);
    const target = state.choice?.options.find((option) => option.cardId === card.id);
    const discardChoice = state.choice?.discardFromHand && target;
    label.disabled = !!state.payment && !source;
    label.dataset.spent = String(!!source?.selected);
    if (source || discardChoice)
      label.setAttribute("aria-pressed", String(source?.selected ?? choicePicks.has(target!.id)));
    else label.removeAttribute("aria-pressed");
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    label.className = "anchor" + (discardOpen ? " discard-card" : hero ? " identity" : enemy ? " enemy" : "");
    label.textContent = hero || enemy ? `${card.name} · ${hero ? state.heroHp : state.villainHp} HP` : card.name;
    if (source) label.append(make("span", "resource-value", `+${resourceText(source.icons)}`));
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

function placeLabels() {
  if (!table) return;
  const discard = table.discardAnchor();
  const deck = table.deckAnchor();
  deckLabel.style.transform = `translate(${Math.round(deck.x)}px,${Math.round(deck.bottom + 3)}px)`;
  pile.style.transform = discardOpen ? "" : `translate(${Math.round(discard.x)}px,${Math.round(discard.bottom + 3)}px)`;
  const projected = table.anchors();
  const handIds = new Set(state.hand.filter((card) => card.id !== staged?.id).map((card) => card.id));
  const hand = projected.filter((point) => handIds.has(point.id)).sort((a, b) => a.x - b.x);
  const width = hand.reduce(
    (gap, point, index) => (index ? Math.min(gap, point.x - hand[index - 1]!.x - 4) : gap),
    142,
  );
  for (const anchor of projected) {
    const node = labels.get(anchor.id);
    if (!node) continue;
    node.style.transform = `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.bottom + 4)}px)`;
    const labelWidth = discardOpen ? anchor.width * 0.82 : handIds.has(anchor.id) ? Math.max(32, width) : 142;
    node.style.setProperty("--card-width", `${labelWidth}px`);
  }
}

function render() {
  state = model.snapshot();
  const selected =
    state.payment?.sources.filter((item) => item.selected).map((item) => item.cardId) ??
    state.choice?.options.flatMap((option) => (option.cardId && choicePicks.has(option.id) ? [option.cardId] : [])) ??
    [];
  table?.setCards({
    hero: state.hero,
    villain: state.villain,
    inPlay: state.inPlay,
    discard: state.discard,
    deckCount: state.deckCount,
    discardOpen,
    hand: state.hand.filter((card) => card.id !== staged?.id),
    staged,
    paymentSources: state.payment?.sources.map((item) => item.cardId) ?? null,
    selected,
  });
  discardFan.hidden = !discardOpen;
  synchronizeLabels();
  pile.disabled = !state.discard.length || flying || discarding || !!state.payment;
  pile.setAttribute("aria-expanded", String(discardOpen));
  const count = state.discard.length;
  pile.setAttribute(
    "aria-label",
    `${discardOpen ? "Stack" : "Inspect"} discard pile, ${count} card${count === 1 ? "" : "s"}`,
  );
  instruction.hidden = discardOpen;
  element("discard-hint").hidden = !discardOpen;
  pileCount.textContent = String(state.discard.length);
  deckCount.textContent = String(state.deckCount);
  element("hand-count").textContent = String(state.hand.filter((card) => card.id !== staged?.id).length);
  decision.replaceChildren();
  decision.hidden = !state.choice || discardOpen;
  const handChoice = !decision.hidden && !!state.choice?.discardFromHand;
  decision.toggleAttribute("data-hand-choice", handChoice);
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
  turnStatus.textContent = `Round ${state.round} · ${turn}`;
  turnStatus.dataset.turn = state.turn;
  if (state.payment) showPayment(state.payment);
  else paymentPanel.hidden = true;
  if (state.choice) showChoice(state.choice);
}

function deal() {
  restart.disabled = true;
  flying = false;
  discardOpen = false;
  choicePicks.clear();
  staged = null;
  model.reset();
  state = model.snapshot();
  if (!table) {
    table = new BattleTable(element("space"), {
      onPick: pick,
      onHover: inspect,
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
restart.onclick = start;
endTurnButton.onclick = () => {
  if (endTurnButton.disabled) return;
  act(() => {
    if (model.endTurn()) instruction.textContent = model.snapshot().choice?.prompt ?? "";
  });
};
paymentSubmit.onclick = pay;
handDiscardConfirm.onclick = confirmChoice;
element<HTMLButtonElement>("payment-cancel").onclick = cancel;
pile.onclick = () => setDiscardOpen(!discardOpen);
document.addEventListener(
  "click",
  (event) => {
    if (
      !discardOpen ||
      !(event.target instanceof Element) ||
      event.target.closest("#space, #discard-label, #discard-fan")
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setDiscardOpen(false);
  },
  true,
);
document.addEventListener("keydown", (event) => {
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
start();
