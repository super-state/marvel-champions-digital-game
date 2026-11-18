import "./battle.css";
import { BattleModel, type BattleCard } from "./model.js";
import { BattleTable } from "./table.js";
import { PaymentLightbox, resourceText } from "./payment-lightbox.js";

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
const reader = element("reader");
const preview = element<HTMLImageElement>("preview");
const decision = element("decision");
const instruction = element("instruction");
const restart = element<HTMLButtonElement>("reset");
const pile = element<HTMLButtonElement>("discard-label");
const discardFan = element("discard-fan");
const pileCount = element("discard-count");
const lightbox = new PaymentLightbox(toggle, pay, cancel);
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
    if (target) choose(target.id);
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
  const flights = lightbox.discardRects(payment);
  const before = state.villainHp;
  if (!model.pay()) return;
  discarding = true;
  restart.disabled = true;
  lightbox.close();
  anchors.inert = true;
  for (const { id } of flights) {
    const label = labels.get(id);
    if (label) label.hidden = true;
  }
  instruction.textContent = flights.length ? "Discarding payment…" : `Playing ${payment.subject.name}…`;
  table.animateDiscards(flights, () => {
    discarding = false;
    restart.disabled = false;
    anchors.inert = false;
    state = model.snapshot();
    // Keep a resolving event on the mat while the player chooses its target.
    staged =
      state.choice && payment.subject.type === "event" && !state.discard.some((card) => card.id === payment.subject.id)
        ? payment.subject
        : null;
    const damage = before - state.villainHp;
    instruction.textContent =
      state.choice?.prompt ??
      (damage > 0 ? `${payment.subject.name} dealt ${damage} damage to Rhino.` : `${payment.subject.name} played.`);
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

function showChoice(choice: NonNullable<Snapshot["choice"]>) {
  decision.append(make("p", "eyebrow", "Resolve card"), make("h2", "", choice.prompt));
  function option(id: string | null, text: string) {
    const button = make("button", "option", text);
    button.onclick = () => choose(id);
    decision.append(button);
  }
  for (const item of choice.options) option(item.id, item.label);
  if (choice.canSkip) option(null, "Skip");
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
    label.dataset.spent = String(!!source?.selected);
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    label.className = "anchor" + (discardOpen ? " discard-card" : hero ? " identity" : enemy ? " enemy" : "");
    label.textContent = hero || enemy ? `${card.name} · ${hero ? state.heroHp : state.villainHp} HP` : card.name;
    const target = state.choice?.options.find((option) => option.cardId === card.id);
    label.setAttribute(
      "aria-label",
      discardOpen
        ? `Inspect ${card.name}`
        : target
          ? `Choose ${card.name}`
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
  table?.setCards({
    hero: state.hero,
    villain: state.villain,
    inPlay: state.inPlay,
    discard: state.discard,
    discardOpen,
    hand: state.hand.filter((card) => card.id !== staged?.id),
    staged,
    selected: state.payment?.sources.filter((item) => item.selected).map((item) => item.cardId) ?? [],
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
  element("hand-count").textContent = String(state.hand.filter((card) => card.id !== staged?.id).length);
  decision.replaceChildren();
  decision.hidden = !state.choice || discardOpen;
  reader.hidden = !decision.hidden;
  if (state.payment) lightbox.show(state.payment, cards());
  else lightbox.close();
  if (state.choice) showChoice(state.choice);
}

function deal() {
  restart.disabled = true;
  flying = false;
  discardOpen = false;
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
  if (discardOpen && event.key === "Escape") {
    event.preventDefault();
    setDiscardOpen(false);
    pile.focus({ preventScroll: true });
  }
});
start();
