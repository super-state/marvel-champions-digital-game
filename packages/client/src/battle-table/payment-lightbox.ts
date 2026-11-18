import type { BattleCard, BattlePayment } from "./model.js";

export function resourceText(icons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const icon of icons) counts.set(icon, (counts.get(icon) ?? 0) + 1);
  return [...counts].map(([icon, n]) => `${n} ${icon}`).join(" + ");
}

/** The card scans are both the selection controls and the starting positions of the discard flights. */
export class PaymentLightbox {
  readonly #dialog = document.querySelector<HTMLDialogElement>("#payment")!;
  readonly #sources = this.#dialog.querySelector<HTMLElement>("#payment-sources")!;
  readonly #submit = this.#dialog.querySelector<HTMLButtonElement>("#payment-submit")!;
  readonly #total = this.#dialog.querySelector<HTMLElement>("#payment-total")!;
  readonly #balance = this.#dialog.querySelector<HTMLElement>("#payment-balance")!;
  readonly #fill = this.#dialog.querySelector<HTMLElement>(".payment-track span")!;
  readonly #buttons = new Map<string, HTMLButtonElement>();

  constructor(toggle: (id: string) => void, submit: () => void, cancel: () => void) {
    this.#sources.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-source]") : null;
      if (button?.dataset.source) toggle(button.dataset.source);
    });
    this.#submit.onclick = submit;
    this.#dialog.querySelector<HTMLButtonElement>("#payment-cancel")!.onclick = cancel;
    this.#dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      cancel();
    });
  }

  show(payment: BattlePayment, cards: readonly BattleCard[]) {
    this.#dialog.querySelector<HTMLElement>("#payment-subject")!.textContent = `Playing ${payment.subject.name}`;
    for (const [id, button] of this.#buttons) {
      if (!payment.sources.some((source) => source.id === id)) {
        button.remove();
        this.#buttons.delete(id);
      }
    }
    for (const source of payment.sources) {
      let button = this.#buttons.get(source.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "resource-card";
        button.dataset.source = source.id;
        button.dataset.cardId = source.cardId;
        const image = document.createElement("img");
        image.alt = "";
        image.draggable = false;
        const art = cards.find((card) => card.id === source.cardId)?.art;
        if (art) image.src = art;
        const name = document.createElement("strong");
        name.textContent = source.label;
        const value = document.createElement("span");
        value.className = "resource-value";
        button.append(image, name, value);
        this.#buttons.set(source.id, button);
        this.#sources.append(button);
      }
      const ability = source.kind === "resourceAbility";
      const resource = resourceText(source.icons);
      button.querySelector(".resource-value")!.textContent = `${ability ? "Ability · " : ""}+${resource}`;
      button.setAttribute("aria-label", `${ability ? "Use ability" : "Discard"} ${source.label} for ${resource}`);
      button.setAttribute("aria-pressed", String(source.selected));
    }
    this.#total.textContent = `${payment.paid} / ${payment.required}`;
    this.#fill.style.transform = `scaleX(${payment.required ? Math.min(1, payment.paid / payment.required) : 1})`;
    const left = payment.required - payment.paid;
    this.#balance.textContent =
      left > 0 ? `${left} more needed` : left < 0 ? `${-left} extra selected` : "Cost covered";
    this.#submit.disabled = !payment.canPay;
    if (!this.#dialog.open) this.#dialog.showModal();
  }

  discardRects(payment: BattlePayment) {
    return payment.discards.flatMap((id) => {
      const image = this.#sources.querySelector<HTMLImageElement>(
        `[aria-pressed="true"][data-card-id="${CSS.escape(id)}"] img`,
      );
      return image ? [{ id, rect: image.getBoundingClientRect() }] : [];
    });
  }

  close() {
    if (!this.#dialog.open) return;
    this.#dialog.close();
    this.#sources.replaceChildren();
    this.#buttons.clear();
  }
}
