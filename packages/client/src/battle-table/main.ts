import "./battle.css";
import { BattleModel, type BattleCard } from "./model.js";
import { BattleTable } from "./table.js";

type Snapshot = ReturnType<BattleModel["snapshot"]>;
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

const model = new BattleModel();
const anchors = element("anchors");
const reader = element("reader");
const preview = element<HTMLImageElement>("preview");
const decision = element("decision");
const instruction = element("instruction");
const restart = element<HTMLButtonElement>("reset");
let table: BattleTable | undefined;
let state: Snapshot;
let staged: BattleCard | null = null;
let flying = false;
const labels = new Map<string, HTMLButtonElement>();

function cards() {
  return [state.hero, state.villain, ...state.hand, ...state.inPlay];
}

function inspect(id: string | null) {
  if (!id) return;
  const card = cards().find((item) => item.id === id);
  if (card && card.art) {
    if (preview.getAttribute("src") !== card.art) preview.src = card.art;
    preview.alt = card.name;
    preview.hidden = false;
  }
}

function wordsForIcons(icons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const icon of icons) counts.set(icon, (counts.get(icon) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${n} ${name.toLowerCase()}`).join(" + ");
}

function pick(id: string) {
  if (flying) return;
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
  const restore = document.activeElement instanceof HTMLButtonElement ? document.activeElement.dataset.source : null;
  model.toggle(id);
  render();
  if (restore)
    decision.querySelector<HTMLButtonElement>(`[data-source="${CSS.escape(restore)}"]`)?.focus({ preventScroll: true });
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
  model.cancel();
  staged = null;
  flying = false;
  instruction.textContent = "Pick a card to play.";
  render();
}

function pay() {
  if (!state.payment?.canPay) return;
  const subject = state.payment.subject;
  const before = state.villainHp;
  act(() => {
    if (!model.pay()) return;
    state = model.snapshot();
    staged = null;
    const damage = before - state.villainHp;
    instruction.textContent = state.choice
      ? state.choice.prompt
      : damage > 0
        ? `${subject.name} dealt ${damage} damage to Rhino.`
        : `${subject.name} played.`;
  });
}

function showPayment(payment: Payment) {
  const header = make("div", "payment-header");
  const art = make("img", "subject-art");
  art.src = payment.subject.art;
  art.alt = "";
  const title = make("div", "");
  title.append(make("p", "eyebrow", "Pay for card"), make("h2", "", payment.subject.name));
  header.append(art, title);
  const total = make("div", "total");
  total.append(make("strong", "", `${payment.paid} / ${payment.required}`), make("span", "", "resources"));
  const meter = make("div", "meter");
  const fill = make("span", "");
  fill.style.width = `${100 * Math.min(1, payment.paid / (payment.required || 1))}%`;
  meter.append(fill);
  const remaining = Math.max(0, payment.required - payment.paid);
  const excess = Math.max(0, payment.paid - payment.required);
  const status = make(
    "p",
    "balance",
    remaining
      ? `Choose ${remaining} more resource${remaining === 1 ? "" : "s"}.`
      : excess
        ? `Cost covered · ${excess} extra selected.`
        : "Cost covered.",
  );
  status.setAttribute("role", "status");
  const sources = make("div", "sources");
  if (payment.sources.length) sources.append(make("h3", "", "Available resources"));
  for (const source of payment.sources) {
    const button = make("button", "source");
    button.type = "button";
    button.dataset.source = source.id;
    button.setAttribute("aria-pressed", String(source.selected));
    button.onclick = () => toggle(source.id);
    const checkbox = make("span", "check", source.selected ? "✓" : "");
    checkbox.setAttribute("aria-hidden", "true");
    const label = make("span", "");
    const resource = wordsForIcons(source.icons);
    label.append(make("strong", "", source.label), make("span", "source-detail", resource));
    const amount = make("span", "yield", `+${source.icons.length}`);
    amount.setAttribute("aria-hidden", "true");
    button.append(checkbox, label, amount);
    sources.append(button);
  }
  const actions = make("div", "decision-actions");
  const confirm = make("button", "commit", "Pay & play");
  confirm.type = "button";
  confirm.disabled = !payment.canPay;
  confirm.onclick = pay;
  const back = make("button", "quiet", "Cancel");
  back.type = "button";
  back.onclick = cancel;
  actions.append(confirm, back);
  decision.append(header, total, meter, status, sources, actions);
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
  const visible = [state.hero, state.villain, ...state.hand.filter((c) => c.id !== staged?.id), ...state.inPlay];
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
      anchors.append(label);
    }
    const source = state.payment?.sources.find((s) => s.cardId === card.id);
    label.dataset.spent = String(!!source?.selected);
    const hero = card.id === state.hero.id;
    const enemy = card.id === state.villain.id;
    label.className = "anchor" + (hero ? " identity" : enemy ? " enemy" : "");
    label.textContent = hero || enemy ? `${card.name} · ${hero ? state.heroHp : state.villainHp} HP` : card.name;
    const target = state.choice?.options.find((option) => option.cardId === card.id);
    label.setAttribute(
      "aria-label",
      target
        ? `Choose ${card.name}`
        : source
          ? `${source.selected ? "Remove" : "Spend"} ${card.name}, ${wordsForIcons(source.icons)}`
          : card.playable
            ? `Play ${card.name}, cost ${card.cost}`
            : `Inspect ${card.name}`,
    );
  }
}

function placeLabels() {
  if (!table) return;
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
    node.style.setProperty("--card-width", `${handIds.has(anchor.id) ? Math.max(32, width) : 142}px`);
  }
}

function render() {
  state = model.snapshot();
  table?.setCards({
    hero: state.hero,
    villain: state.villain,
    inPlay: state.inPlay,
    hand: state.hand.filter((card) => card.id !== staged?.id),
    staged,
    selected: state.payment?.sources.filter((item) => item.selected).map((item) => item.cardId) ?? [],
  });
  synchronizeLabels();
  element("hand-count").textContent = String(state.hand.filter((card) => card.id !== staged?.id).length);
  decision.replaceChildren();
  decision.hidden = !state.payment && !state.choice;
  reader.hidden = !decision.hidden;
  if (state.payment) showPayment(state.payment);
  else if (state.choice) showChoice(state.choice);
}

function deal() {
  restart.disabled = true;
  flying = false;
  staged = null;
  model.reset();
  state = model.snapshot();
  if (!table) {
    table = new BattleTable(element("space"), {
      onPick: pick,
      onHover: inspect,
      onLanded: landed,
      onDraw: placeLabels,
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
start();
