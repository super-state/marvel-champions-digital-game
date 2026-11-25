/**
 * The deck builder's screen (`battle/decks.html`; room plan step 0.9.0, "Deck building"): the heroes' deck boxes, the
 * deck choice (starter, a saved deck, or new), then the builder with the binder on the left, the deck tray on the
 * right and the engine's verdict along the bottom. Everything it shows comes from `deck-model.ts`; this file only draws
 * it and turns mouse, touch, keyboard and controller input into the model's calls.
 *
 * One input path: every control is a real `<button>` answering `click` (a press and a release on the same control, so
 * the end of a swipe never presses anything), and the keyboard and the pad move the focus and press the same buttons.
 *
 *   Mouse / touch  click a binder card: add a copy · click a tray line: take one out · 🔍: the card full size
 *   Keyboard       arrows move · Enter adds · Delete / Backspace / - takes out · [ ] or Page Up / Down change tab ·
 *                  F full size
 *   Controller     D-pad moves · A adds · X takes out · LB / RB change tab · Y full size · B back
 *
 * It lives in two places. On its own page (`decks-page.ts`, `battle/decks.html`) it offers the whole Core Set pool,
 * for checking, with its own heroes view and its own controller loop. Laid over the room at the bench
 * (`room/places/decks.ts`, `mode: "room"`) it offers only what the 3D table has been checked with, opens straight
 * into the builder, and Back hands back to the bench; there the room has the keys (it passes them in through `key`)
 * and the table's own controller moves the focus and presses A and B, so this screen's reader takes only X, Y, LB and
 * RB, and B while one of its own dialogs is open (the table's controller leaves dialogs it doesn't know alone).
 *
 * Its cards carry `data-deck-card`, not the table's `data-card`, so the table's controller never takes them for cards
 * on the mat. `?hero=<identity id>&deck=starter|new|<saved id>` opens the page's builder straight away, for checks.
 */
import "./decks.css";
import type { AnyCard, CoreAspect } from "@mc/content";
import { createPadReader, DEFAULT_PAD_SETTINGS } from "../pad/input.js";
import { GAMEPAD_BUTTON } from "../pad/buttons.js";
import { spatialPick, type FocusDirection } from "../pad/spatial.js";
import { cardArtUrl, PLAYER_BACK_URL } from "./card-art.js";
import {
  ASPECT_NAMES,
  BINDER_TABS,
  BUILDER_ASPECTS,
  BUILDER_HEROES,
  COST_BUCKETS,
  DECK_MAX_CARDS,
  DECK_MIN_CARDS,
  addCopy,
  binderPage,
  cardById,
  cardCount,
  chooseAspect,
  copiesLeft,
  deckChart,
  heroOf,
  legalityOf,
  ownCardsDraft,
  quantityOf,
  removeCopy,
  sameDeck,
  starterDraft,
  trayGroups,
  canRemove,
  isOwnCard,
  type BinderTab,
  type Draft,
} from "./deck-model.js";
import { browserDeckStore, duplicateOf, freeName, type DeckStore, type SavedDeck } from "./deck-store.js";

export interface DeckScreenOptions {
  /** On its own page, or laid over the room at the bench. */
  readonly mode: "page" | "room";
  /** The heroes it offers, by identity card id (all the pool's when absent). */
  readonly heroes?: readonly string[];
  /** The aspects a deck may choose here (all the pool's when absent). */
  readonly aspects?: readonly CoreAspect[];
  /** Where saved decks are kept (this browser's storage when absent). */
  readonly store?: DeckStore;
  /** The builder's Back button's words ("‹ Heroes" on the page). */
  readonly backLabel?: string;
  /** In the room: the builder has been left (Back, or the deck deleted), with the deck it last saved, if any. */
  readonly onExit?: (savedId: string | null) => void;
}

export interface DeckScreen {
  /** Opens the builder for a hero (identity card id): their starter deck, just their own cards, or a saved deck. */
  open(identityCardId: string, deck: "starter" | "new" | string): void;
  /** A key, when the room has the keys: true if it was used. */
  key(event: KeyboardEvent): boolean;
  /** Back (Escape, B) from outside: true if something was put away or the builder is being left. */
  back(): boolean;
  /** Whether the builder is open. */
  isOpen(): boolean;
}

const TEMPLATE = `
<section class="decks-heroes" id="view-heroes" aria-labelledby="heroes-title">
  <header class="decks-head">
    <h1 id="heroes-title">Heroes &amp; Decks</h1>
    <p class="decks-sub">Pick a hero, then a deck to play or build.</p>
  </header>
  <div class="hero-boxes" id="hero-boxes"></div>
  <section class="deck-choice" id="deck-choice" aria-labelledby="deck-choice-title" hidden>
    <h2 id="deck-choice-title"></h2>
    <div class="deck-choice-list" id="deck-choice-list"></div>
  </section>
</section>

<section class="decks-builder" id="view-builder" aria-label="Deck builder" hidden>
  <header class="builder-bar">
    <button type="button" class="btn btn-ghost" id="builder-back" title="Back to the heroes (Esc)">
      ‹ Heroes
    </button>
    <label class="deck-name">
      <span class="visually-hidden">Deck name</span>
      <input id="deck-name" type="text" maxlength="40" autocomplete="off" spellcheck="false" />
    </label>
    <div class="builder-actions">
      <button type="button" class="btn btn-primary" id="deck-save">Save</button>
      <button type="button" class="btn btn-secondary" id="deck-duplicate">Duplicate</button>
      <button type="button" class="btn btn-ghost" id="deck-delete">Delete</button>
    </div>
    <span class="builder-notice" id="builder-notice" role="status" aria-live="polite"></span>
  </header>

  <div class="builder-body">
    <section class="binder" id="binder" aria-label="Binder">
      <div class="binder-tabs" role="tablist" aria-label="Binder pages" id="binder-tabs"></div>
      <div class="aspect-picker" id="aspect-picker" role="radiogroup" aria-label="Aspect"></div>
      <p class="binder-help" id="binder-help"></p>
      <div class="binder-cards" id="binder-cards" role="list"></div>
    </section>

    <aside class="tray" id="tray" aria-label="Your deck">
      <div class="tray-head">
        <h2>Your deck</h2>
        <p class="tray-total" id="tray-total"></p>
      </div>
      <div class="tray-chart" id="tray-chart" aria-label="Costs and resources"></div>
      <div class="tray-groups" id="tray-groups"></div>
    </aside>
  </div>

  <footer class="legality" id="legality" role="status" aria-live="polite"></footer>
</section>

<aside class="card-panel" id="card-panel" aria-hidden="true" hidden>
  <img id="card-panel-img" alt="" />
</aside>

<dialog class="zoom" id="zoom" aria-labelledby="zoom-name">
  <img id="zoom-img" alt="" />
  <div class="zoom-side">
    <h2 id="zoom-name"></h2>
    <p id="zoom-count"></p>
    <div class="zoom-actions">
      <button type="button" class="btn btn-primary" id="zoom-add">Add a copy</button>
      <button type="button" class="btn btn-secondary" id="zoom-remove">Take one out</button>
      <button type="button" class="btn btn-ghost" id="zoom-close">Close</button>
    </div>
  </div>
</dialog>

<dialog class="confirm" id="confirm" aria-labelledby="confirm-text">
  <p id="confirm-text"></p>
  <div class="confirm-actions">
    <button type="button" class="btn btn-primary" id="confirm-yes"></button>
    <button type="button" class="btn btn-secondary" id="confirm-no">Cancel</button>
  </div>
</dialog>
`;

/** Builds the deck builder into `host` (which becomes the screen's root) and wires it up. */
export function createDeckScreen(host: HTMLElement, options: DeckScreenOptions): DeckScreen {
  host.classList.add("decks");
  host.dataset.view = "heroes";
  host.dataset.mode = options.mode;
  host.innerHTML = TEMPLATE;
  const store = options.store ?? browserDeckStore();
  const inRoom = options.mode === "room";
  const touchScreen = matchMedia("(pointer: coarse)").matches;
  const offeredHeroes = BUILDER_HEROES.filter(
    (hero) => !options.heroes || options.heroes.includes(hero.identityCardId),
  );
  const offeredAspects = BUILDER_ASPECTS.filter((aspect) => !options.aspects || options.aspects.includes(aspect));

  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const el = host.querySelector(`#${id}`);
    if (!el) throw new Error(`#${id} missing from the deck screen`);
    return el as T;
  };

  function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: Record<string, string | boolean | undefined> = {},
    ...children: (Node | string | null | undefined)[]
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === false) continue;
      if (key === "class") el.className = String(value);
      else if (key === "text") el.textContent = String(value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) if (child !== null && child !== undefined) el.append(child);
    return el;
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  interface BuilderState {
    draft: Draft;
    /** The deck as last saved (or as opened), to tell whether there are changes to keep. */
    base: Draft;
    /** The saved deck being edited, or null for one not saved yet. */
    savedId: string | null;
    savedName: string;
    tab: BinderTab;
    /** The aspect the aspect page shows before one is chosen. */
    lookAspect: CoreAspect;
  }

  let chosenHero: string | null = null;
  let builder: BuilderState | null = null;

  const heroName = (identityCardId: string): string => heroOf(identityCardId).name;
  const aspectOfDraft = (draft: Draft): CoreAspect | undefined => draft.aspects[0];
  const nowIso = (): string => new Date().toISOString();
  const newId = (): string =>
    globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Pictures ──────────────────────────────────────────────────────────────────────────────────────────────────────

  /** One picture element per card and place, kept across redraws so adding a copy never makes the binder flicker. */
  const pictures = new Map<string, HTMLImageElement>();

  function cardPicture(card: AnyCard, className: string): HTMLImageElement {
    const key = `${className}:${card.id}`;
    const kept = pictures.get(key);
    if (kept) return kept;
    const img = h("img", { class: className, alt: "", decoding: "async", draggable: "false" });
    img.src = cardArtUrl(card) || PLAYER_BACK_URL;
    img.addEventListener("error", () => {
      if (!img.src.endsWith(PLAYER_BACK_URL)) img.src = PLAYER_BACK_URL;
    });
    pictures.set(key, img);
    return img;
  }

  // ── The heroes and the deck choice ────────────────────────────────────────────────────────────────────────────────

  function showView(view: "heroes" | "builder"): void {
    host.dataset.view = view;
    $("view-heroes").hidden = view !== "heroes";
    $("view-builder").hidden = view !== "builder";
    hidePanel();
  }

  function renderHeroes(): void {
    const boxes = $("hero-boxes");
    boxes.replaceChildren(
      ...offeredHeroes.map((hero) => {
        const saved = store.list().filter((d) => d.identityCardId === hero.identityCardId).length;
        const button = h(
          "button",
          {
            type: "button",
            class: "hero-box",
            "data-focus": `hero:${hero.identityCardId}`,
            "data-preview": hero.identityCardId,
            "data-aspect": hero.starterAspect,
            "aria-pressed": String(chosenHero === hero.identityCardId),
          },
          h("span", { class: "hero-box-lid" }, cardPicture(hero.identity, "hero-box-art")),
          h("span", { class: "hero-box-name", text: hero.name }),
          h("span", {
            class: "hero-box-note",
            text: saved === 0 ? ASPECT_NAMES[hero.starterAspect] : `${saved} saved deck${saved === 1 ? "" : "s"}`,
          }),
        );
        button.addEventListener("click", () => pickHero(hero.identityCardId));
        return button;
      }),
    );
  }

  function pickHero(identityCardId: string): void {
    chosenHero = identityCardId;
    renderHeroes();
    renderDeckChoice();
    const first = $("deck-choice-list").querySelector<HTMLButtonElement>("button");
    first?.focus({ preventScroll: false });
  }

  /** Back from the deck choice to the row of boxes, the focus on the hero who was chosen. */
  function closeDeckChoice(): void {
    const hero = chosenHero;
    chosenHero = null;
    renderHeroes();
    renderDeckChoice();
    (hero ? host.querySelector<HTMLElement>(`[data-focus="hero:${hero}"]`) : null)?.focus();
  }

  function renderDeckChoice(): void {
    const panel = $("deck-choice");
    if (!chosenHero) {
      panel.hidden = true;
      return;
    }
    const hero = heroOf(chosenHero);
    panel.hidden = false;
    $("deck-choice-title").textContent = `${hero.name}: pick a deck`;
    const option = (key: string, title: string, note: string, open: () => void): HTMLButtonElement => {
      const button = h(
        "button",
        { type: "button", class: "deck-option", "data-focus": `deck:${key}` },
        h("strong", { text: title }),
        h("small", { text: note }),
      );
      button.addEventListener("click", open);
      return button;
    };
    const saved = store.list().filter((d) => d.identityCardId === hero.identityCardId);
    $("deck-choice-list").replaceChildren(
      option("starter", "Starter deck", `${ASPECT_NAMES[hero.starterAspect]}, as printed`, () =>
        openBuilder(starterDraft(hero.identityCardId), null, `${hero.name} ${ASPECT_NAMES[hero.starterAspect]}`),
      ),
      ...saved.map((deck) => {
        const legal = legalityOf(deck).legal;
        const aspect = deck.aspects[0];
        return option(
          deck.id,
          deck.name,
          `${cardCount(deck)} cards${aspect ? `, ${ASPECT_NAMES[aspect]}` : ""}${legal ? "" : " · not legal yet"}`,
          () => openSaved(deck),
        );
      }),
      option("new", "New deck", `Start from ${hero.name}'s own 15 cards`, () =>
        openBuilder(
          ownCardsDraft(hero.identityCardId),
          null,
          freeName(
            `${hero.name} deck`,
            store.list().map((d) => d.name),
          ),
        ),
      ),
    );
  }

  function openSaved(deck: SavedDeck): void {
    openBuilder({ identityCardId: deck.identityCardId, aspects: deck.aspects, cards: deck.cards }, deck.id, deck.name);
  }

  // ── The builder ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** The aspect the aspect page shows before one is chosen: the hero's starter one if it is offered here. */
  function lookFirst(identityCardId: string): CoreAspect {
    const starter = heroOf(identityCardId).starterAspect;
    return offeredAspects.includes(starter) ? starter : (offeredAspects[0] ?? starter);
  }

  function openBuilder(draft: Draft, savedId: string | null, name: string): void {
    chosenHero = draft.identityCardId;
    builder = {
      draft,
      base: draft,
      savedId,
      savedName: name,
      tab: aspectOfDraft(draft) ? "aspect" : "basic",
      lookAspect: aspectOfDraft(draft) ?? lookFirst(draft.identityCardId),
    };
    $<HTMLInputElement>("deck-name").value = name;
    notice("");
    syncSavedButtons();
    showView("builder");
    renderBuilder();
    focusFirstCard();
  }

  const tabLabel = (tab: BinderTab, b: BuilderState): string =>
    tab === "hero"
      ? `${heroName(b.draft.identityCardId)}'s cards`
      : tab === "basic"
        ? "Basic"
        : aspectOfDraft(b.draft)
          ? ASPECT_NAMES[aspectOfDraft(b.draft)!]
          : "Aspect";

  function renderBuilder(): void {
    if (!builder) return;
    const keep = focusKey();
    const b = builder;
    const aspect = aspectOfDraft(b.draft);
    const shownAspect = aspect ?? b.lookAspect;
    $("binder").dataset.aspect = b.tab === "aspect" ? shownAspect : b.tab === "basic" ? "basic" : "hero";

    // Tabs.
    $("binder-tabs").replaceChildren(
      ...BINDER_TABS.map((tab) => {
        const button = h("button", {
          type: "button",
          role: "tab",
          class: "binder-tab",
          id: `tab-${tab}`,
          "aria-selected": String(tab === b.tab),
          "data-focus": `tab:${tab}`,
          "data-aspect": tab === "aspect" ? shownAspect : tab,
          text: tabLabel(tab, b),
        });
        button.addEventListener("click", () => setTab(tab));
        return button;
      }),
    );

    // The aspect picker, on the aspect page only.
    const picker = $("aspect-picker");
    picker.hidden = b.tab !== "aspect";
    picker.replaceChildren(
      ...offeredAspects.map((choice) => {
        const button = h("button", {
          type: "button",
          role: "radio",
          class: "aspect-chip",
          "data-aspect": choice,
          "data-focus": `aspect:${choice}`,
          "aria-checked": String(choice === aspect),
          text: ASPECT_NAMES[choice],
        });
        button.addEventListener("click", () => pickAspect(choice));
        return button;
      }),
    );

    // The help line over the cards.
    $("binder-help").textContent =
      b.tab === "hero"
        ? `${heroName(b.draft.identityCardId)}'s own cards are always in the deck, all of them.`
        : b.tab === "aspect" && !aspect
          ? "Choose the deck's one aspect to add its cards."
          : "Click a card to add a copy. Click it in your deck to take one out.";

    // The cards.
    const page = binderPage(b.draft, b.tab, b.tab === "aspect" ? shownAspect : undefined);
    $("binder-cards").replaceChildren(
      ...page.map((entry) => {
        const left = entry.fixed ? 0 : copiesLeft(b.draft, entry.cardId);
        const limit = entry.inDeck + left;
        const label = entry.fixed
          ? `${entry.name}, ${entry.inDeck} in the deck, fixed`
          : `${entry.name}, ${entry.inDeck} in the deck${entry.canAdd ? ", add a copy" : ""}`;
        const tile = h(
          "button",
          {
            type: "button",
            class: "binder-card",
            "data-deck-card": entry.cardId,
            "data-focus": `card:${entry.cardId}`,
            "data-fixed": entry.fixed,
            "data-full": !entry.fixed && !entry.canAdd && entry.inDeck > 0,
            "aria-disabled": String(!entry.canAdd),
            "aria-label": label,
          },
          cardPicture(entry.card, "binder-card-art"),
          h("span", {
            class: "binder-count",
            "data-zero": entry.inDeck === 0,
            text: entry.fixed ? `×${entry.inDeck}` : `${entry.inDeck}/${Math.max(limit, entry.inDeck)}`,
          }),
        );
        tile.addEventListener("click", () => add(entry.cardId));
        const zoom = h("button", {
          type: "button",
          class: "zoom-btn",
          "aria-label": `${entry.name} full size`,
          "data-zoom": entry.cardId,
          tabindex: "-1",
          text: "🔍",
        });
        zoom.addEventListener("click", (event) => {
          event.stopPropagation();
          openZoom(entry.cardId);
        });
        // In the room the table's controller steps through every button on the page, so the magnifier (a touch control) is
        // only there on a touch screen; the mouse has the hover panel, the keys F and the pad Y.
        return h("div", { class: "binder-slot", role: "listitem" }, tile, inRoom && !touchScreen ? null : zoom);
      }),
    );

    renderTray();
    renderLegality();
    restoreFocus(keep);
  }

  function renderTray(): void {
    if (!builder) return;
    const draft = builder.draft;
    const count = cardCount(draft);
    const total = $("tray-total");
    total.textContent = `${count} cards (${DECK_MIN_CARDS} to ${DECK_MAX_CARDS})`;
    // Coloured by the engine's verdict on size, not by a count of our own.
    const sizeWrong = legalityOf(draft).problems.some((problem) => problem.code === "deck_size");
    total.dataset.range = sizeWrong ? "wrong" : "ok";

    const chart = deckChart(draft);
    const top = Math.max(1, ...chart.costs);
    const bars = h(
      "div",
      { class: "cost-bars", role: "img", "aria-label": costSummary(chart.costs) },
      ...chart.costs.map((n, i) =>
        h(
          "span",
          { class: "cost-bar" },
          h("b", { text: String(n) }),
          h("i", { style: `height:${Math.round((n / top) * 100)}%` }),
          h("small", { text: COST_BUCKETS[i]! }),
        ),
      ),
    );
    const resources = h(
      "div",
      { class: "resource-chips" },
      ...(["physical", "mental", "energy", "wild"] as const).map((kind) =>
        h(
          "span",
          { class: "resource-chip", "data-resource": kind, title: `${kind} resources` },
          h("i"),
          h("span", { text: `${chart.resources[kind]}` }),
          h("span", { class: "visually-hidden", text: ` ${kind}` }),
        ),
      ),
    );
    $("tray-chart").replaceChildren(h("p", { class: "chart-title", text: "Costs" }), bars, resources);

    $("tray-groups").replaceChildren(
      ...trayGroups(draft).map((group) =>
        h(
          "section",
          { class: "tray-group" },
          h("h3", {}, group.name, h("span", { text: String(group.count) })),
          h(
            "ul",
            {},
            ...group.lines.map((line) => {
              const button = h(
                "button",
                {
                  type: "button",
                  class: "tray-line",
                  "data-deck-card": line.cardId,
                  "data-focus": `tray:${line.cardId}`,
                  "data-fixed": line.fixed,
                  "aria-disabled": String(line.fixed),
                  "aria-label": line.fixed
                    ? `${line.name}, ${line.quantity}, ${heroName(draft.identityCardId)}'s own card`
                    : `${line.name}, ${line.quantity}, take one out`,
                },
                h("span", { class: "tray-qty", text: `${line.quantity}×` }),
                h("span", { class: "tray-name", text: line.name }),
                h("span", { class: "tray-cost", text: line.cost >= 0 ? String(line.cost) : "" }),
              );
              button.addEventListener("click", () => remove(line.cardId));
              return h("li", {}, button);
            }),
          ),
        ),
      ),
    );
  }

  const costSummary = (costs: readonly number[]): string =>
    `Cards by cost: ${costs.map((n, i) => `${n} at ${COST_BUCKETS[i]}`).join(", ")}`;

  function renderLegality(): void {
    if (!builder) return;
    const legality = legalityOf(builder.draft);
    const line = $("legality");
    const said = `${legality.legal}|${legality.line}|${legality.more}`;
    if (line.dataset.said === said) return;
    line.dataset.said = said;
    line.dataset.legal = String(legality.legal);
    line.replaceChildren(
      h("span", { class: "legality-mark", "aria-hidden": "true", text: legality.legal ? "✓" : "!" }),
      h("span", { class: "legality-text", text: legality.line }),
      ...(legality.more > 0 ? [h("span", { class: "legality-more", text: `and ${legality.more} more` })] : []),
    );
  }

  function setTab(tab: BinderTab): void {
    if (!builder || builder.tab === tab) return;
    builder.tab = tab;
    renderBuilder();
    $(`tab-${tab}`).focus();
  }

  function stepTab(by: number): void {
    if (!builder) return;
    const i = BINDER_TABS.indexOf(builder.tab);
    const next = BINDER_TABS[(i + by + BINDER_TABS.length) % BINDER_TABS.length]!;
    builder.tab = next;
    renderBuilder();
    focusFirstCard();
  }

  function pickAspect(aspect: CoreAspect): void {
    if (!builder) return;
    const result = chooseAspect(builder.draft, aspect);
    builder.draft = result.draft;
    builder.lookAspect = aspect;
    notice(
      result.removed > 0
        ? `${ASPECT_NAMES[aspect]} chosen: took out ${result.removed} card${result.removed === 1 ? "" : "s"} of the old aspect.`
        : `${ASPECT_NAMES[aspect]} chosen.`,
    );
    renderBuilder();
  }

  function add(cardId: string): void {
    if (!builder) return;
    const next = addCopy(builder.draft, cardId);
    if (next === builder.draft) {
      const card = cardById(cardId);
      if (card && isOwnCard(builder.draft, card)) notice("The hero's own cards are fixed.");
      else if (builder.tab === "aspect" && !aspectOfDraft(builder.draft)) notice("Choose the aspect first.");
      else notice("No more copies of that card can go in.");
      return;
    }
    builder.draft = next;
    notice("");
    renderBuilder();
    if (!$("zoom").hasAttribute("open")) return;
    renderZoom(cardId);
  }

  function remove(cardId: string): void {
    if (!builder) return;
    if (!canRemove(builder.draft, cardId)) {
      const card = cardById(cardId);
      if (card && isOwnCard(builder.draft, card)) notice("The hero's own cards are fixed.");
      return;
    }
    builder.draft = removeCopy(builder.draft, cardId);
    notice("");
    renderBuilder();
    if ($("zoom").hasAttribute("open")) renderZoom(cardId);
  }

  function notice(text: string): void {
    $("builder-notice").textContent = text;
  }

  /** Duplicate copies a saved deck, so it waits until this one has been saved. */
  function syncSavedButtons(): void {
    const duplicateButton = $<HTMLButtonElement>("deck-duplicate");
    duplicateButton.disabled = builder?.savedId === null;
    duplicateButton.title = duplicateButton.disabled ? "Save the deck first" : "Save a copy under a new name";
  }

  // ── Saving ────────────────────────────────────────────────────────────────────────────────────────────────────────

  const typedName = (): string => $<HTMLInputElement>("deck-name").value.trim();

  function save(): void {
    if (!builder) return;
    const others = store
      .list()
      .filter((d) => d.id !== builder!.savedId)
      .map((d) => d.name);
    const name = freeName(typedName() || builder.savedName, others);
    const id = builder.savedId ?? newId();
    const renamed = builder.savedId !== null && name !== builder.savedName;
    if (!store.put({ ...builder.draft, id, name, updatedAt: nowIso() })) {
      notice("Couldn't save: this browser's storage is full or switched off.");
      return;
    }
    builder.savedId = id;
    builder.savedName = name;
    builder.base = builder.draft;
    syncSavedButtons();
    $<HTMLInputElement>("deck-name").value = name;
    const legal = legalityOf(builder.draft).legal;
    notice(`${renamed ? "Renamed and saved" : "Saved"} as “${name}”${legal ? "." : " (not legal yet)."}`);
  }

  function duplicate(): void {
    if (!builder) return;
    const source: SavedDeck = {
      ...builder.draft,
      id: builder.savedId ?? newId(),
      name: typedName() || builder.savedName,
      updatedAt: nowIso(),
    };
    const copy = duplicateOf(
      source,
      newId(),
      nowIso(),
      store.list().map((d) => d.name),
    );
    if (!store.put(copy)) {
      notice("Couldn't save the copy: this browser's storage is full or switched off.");
      return;
    }
    builder.savedId = copy.id;
    builder.savedName = copy.name;
    builder.base = builder.draft;
    $<HTMLInputElement>("deck-name").value = copy.name;
    notice(`Saved a copy as “${copy.name}”. You are now editing the copy.`);
  }

  async function deleteDeck(): Promise<void> {
    if (!builder) return;
    if (builder.savedId === null) {
      if (!sameDeck(builder.draft, builder.base) && !(await confirmBox("Throw away this unsaved deck?", "Throw away")))
        return;
      goToHeroes();
      return;
    }
    const name = builder.savedName;
    if (!(await confirmBox(`Delete “${name}”? This can't be undone.`, "Delete"))) return;
    if (!store.remove(builder.savedId)) {
      notice("Couldn't delete it: this browser's storage is switched off.");
      return;
    }
    goToHeroes();
  }

  async function back(): Promise<void> {
    if (!builder) return;
    const unsaved =
      !sameDeck(builder.draft, builder.base) || (builder.savedId !== null && typedName() !== builder.savedName);
    if (unsaved && !(await confirmBox("Leave without saving your changes?", "Leave"))) return;
    goToHeroes();
  }

  function goToHeroes(): void {
    if (inRoom) {
      // In the room the heroes are the bench's own deck boxes: hand back to it.
      const savedId = builder?.savedId ?? null;
      builder = null;
      hidePanel();
      closeZoom();
      options.onExit?.(savedId && store.get(savedId) ? savedId : null);
      return;
    }
    const hero = builder?.draft.identityCardId ?? chosenHero;
    builder = null;
    showView("heroes");
    chosenHero = hero;
    renderHeroes();
    renderDeckChoice();
    const target = hero ? host.querySelector<HTMLElement>(`[data-focus="hero:${hero}"]`) : null;
    (target ?? $("hero-boxes").querySelector<HTMLElement>("button"))?.focus();
  }

  function confirmBox(text: string, yes: string): Promise<boolean> {
    const dialog = $<HTMLDialogElement>("confirm");
    $("confirm-text").textContent = text;
    $("confirm-yes").textContent = yes;
    return new Promise((resolve) => {
      const done = (answer: boolean): void => {
        $("confirm-yes").removeEventListener("click", onYes);
        $("confirm-no").removeEventListener("click", onNo);
        dialog.removeEventListener("close", onClose);
        if (dialog.open) dialog.close();
        resolve(answer);
      };
      const onYes = (): void => done(true);
      const onNo = (): void => done(false);
      const onClose = (): void => done(false);
      $("confirm-yes").addEventListener("click", onYes);
      $("confirm-no").addEventListener("click", onNo);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      $("confirm-no").focus();
    });
  }

  // ── A card full size ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Hover (or focus) shows the card full size in the card panel, on the side away from what is being looked at. */
  function showPanel(cardId: string, from: HTMLElement): void {
    const card = cardById(cardId);
    if (!card || !window.matchMedia("(min-width: 900px)").matches) return;
    const panel = $("card-panel");
    const img = $<HTMLImageElement>("card-panel-img");
    const url = cardArtUrl(card);
    if (img.getAttribute("src") !== url) img.src = url;
    img.alt = cardById(cardId)?.name ?? "";
    const rect = from.getBoundingClientRect();
    panel.dataset.side = rect.left + rect.width / 2 < window.innerWidth / 2 ? "right" : "left";
    panel.hidden = false;
  }

  function hidePanel(): void {
    $("card-panel").hidden = true;
  }

  let zoomed: string | null = null;
  /** The card shown full size, while the dialog is open (its close handler runs a moment after Escape). */
  const openZoomCard = (): string | null => ($<HTMLDialogElement>("zoom").open ? zoomed : null);
  /** What had the focus when the card opened full size, to hand it back on close. */
  let zoomOpener: string | null = null;

  function openZoom(cardId: string): void {
    zoomOpener = focusKey();
    zoomed = cardId;
    renderZoom(cardId);
    const dialog = $<HTMLDialogElement>("zoom");
    if (!dialog.open) dialog.showModal();
    hidePanel();
    const addButton = $<HTMLButtonElement>("zoom-add");
    (addButton.disabled ? $("zoom-close") : addButton).focus();
  }

  function renderZoom(cardId: string): void {
    const card = cardById(cardId);
    if (!card || !builder) return;
    $<HTMLImageElement>("zoom-img").src = cardArtUrl(card);
    $<HTMLImageElement>("zoom-img").alt = card.name;
    $("zoom-name").textContent = card.name;
    const n = quantityOf(builder.draft, cardId);
    const fixed = isOwnCard(builder.draft, card);
    $("zoom-count").textContent = fixed
      ? `${n} in the deck: one of ${heroName(builder.draft.identityCardId)}'s own cards, always in it.`
      : `${n} in the deck.`;
    $<HTMLButtonElement>("zoom-add").disabled = copiesLeft(builder.draft, cardId) <= 0;
    $<HTMLButtonElement>("zoom-remove").disabled = !canRemove(builder.draft, cardId);
    // However the copy went in or out (a click, a key, the pad), a button that has just greyed out under the focus hands
    // it on.
    if ($<HTMLDialogElement>("zoom").open) keepZoomFocus();
  }

  function closeZoom(): void {
    const dialog = $<HTMLDialogElement>("zoom");
    if (dialog.open) dialog.close();
  }

  $("zoom").addEventListener("close", () => {
    const byKey = (key: string | null): HTMLElement | null =>
      key ? host.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`) : null;
    const back = byKey(zoomOpener) ?? byKey(zoomed && `card:${zoomed}`) ?? byKey(zoomed && `tray:${zoomed}`);
    zoomed = null;
    zoomOpener = null;
    const target = back ?? $("binder-cards").querySelector<HTMLElement>(".binder-card");
    target?.focus();
    // The browser hands the focus back to whatever had it when the dialog opened; when a copy went in or out meanwhile,
    // that card was redrawn and the old one is gone, so the focus can land on the page. Put it on the card again once the
    // browser is done.
    setTimeout(() => {
      if (target?.isConnected && document.activeElement !== target && !host.querySelector("dialog[open]")) {
        target.focus();
      }
    }, 0);
  });
  /** A zoom button that has just greyed itself out hands the focus to one that still works. */
  function keepZoomFocus(): void {
    const focused = document.activeElement as HTMLButtonElement | null;
    if (!focused?.disabled) return;
    const other = [$<HTMLButtonElement>("zoom-add"), $<HTMLButtonElement>("zoom-remove")].find((b) => !b.disabled);
    (other ?? $("zoom-close")).focus();
  }
  $("zoom-add").addEventListener("click", () => zoomed && add(zoomed));
  $("zoom-remove").addEventListener("click", () => zoomed && remove(zoomed));
  $("zoom-close").addEventListener("click", closeZoom);

  // ── Focus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  const focusKey = (): string | null => (document.activeElement as HTMLElement | null)?.dataset?.focus ?? null;

  function restoreFocus(key: string | null): void {
    if (!key) return;
    const el = host.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    else if (!el && key.startsWith("tray:")) {
      // The last copy left the tray: the focus goes to the card in the binder, else the next tray line.
      const card = host.querySelector<HTMLElement>(`[data-focus="card:${CSS.escape(key.slice(5))}"]`);
      (card ?? host.querySelector<HTMLElement>(".tray-line"))?.focus({ preventScroll: true });
    }
  }

  function focusFirstCard(): void {
    const first = $("binder-cards").querySelector<HTMLElement>(".binder-card") ?? $(`tab-${builder?.tab ?? "basic"}`);
    first.focus({ preventScroll: true });
  }

  /** Every control the arrows and the D-pad can stop on, in the open dialog when there is one. */
  function stops(): HTMLElement[] {
    const scope =
      host.querySelector<HTMLElement>("dialog[open]") ??
      (host.dataset.view === "builder" ? $("view-builder") : $("view-heroes"));
    return [...scope.querySelectorAll<HTMLElement>("button:not([disabled]):not([tabindex='-1']), input")].filter(
      (el) => el.offsetParent !== null || el.getClientRects().length > 0,
    );
  }

  function moveFocus(direction: FocusDirection): void {
    const all = stops();
    const current = document.activeElement as HTMLElement | null;
    if (!current || !all.includes(current)) {
      (all.find((el) => el.classList.contains("binder-card")) ?? all[0])?.focus();
      return;
    }
    const rects = all.filter((el) => el !== current).map((el) => ({ key: el, rect: rectOf(el) }));
    const next = spatialPick(rects, rectOf(current), direction) ?? spatialPick(rects, rectOf(current), direction, true);
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  const rectOf = (el: HTMLElement): { x: number; y: number; width: number; height: number } => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };

  /** The card the focus is on (a binder card or a tray line), for take out and full size. */
  const focusedCard = (): string | null => (document.activeElement as HTMLElement | null)?.dataset?.deckCard ?? null;

  // ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  /** The card a control shows: a binder card or tray line (`data-deck-card`), or a hero box (`data-preview`). */
  const previewOf = (el: HTMLElement): string | undefined => el.dataset.deckCard ?? el.dataset.preview;
  const PREVIEWS = "[data-deck-card], [data-preview]";

  host.addEventListener("pointerover", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(PREVIEWS);
    if (!el || event.pointerType !== "mouse") return;
    setInput("mouse");
    showPanel(previewOf(el)!, el);
  });
  host.addEventListener("pointerout", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(PREVIEWS);
    const to = (event.relatedTarget as HTMLElement | null)?.closest?.(PREVIEWS);
    if (el && !to) {
      const focused = document.activeElement as HTMLElement | null;
      const shown = focused ? previewOf(focused) : undefined;
      if (focused && shown && focusDriven()) showPanel(shown, focused);
      else hidePanel();
    }
  });
  host.addEventListener("focusin", (event) => {
    const el = event.target as HTMLElement;
    const shown = previewOf(el);
    if (shown && focusDriven()) showPanel(shown, el);
    else if (!shown) hidePanel();
  });

  /** Mouse, keyboard or pad: hover previews only follow the focus when it was moved by keys or a pad. */
  const setInput = (kind: "mouse" | "keys" | "pad"): void => {
    if (host.dataset.input === kind) return;
    host.dataset.input = kind;
    // A panel the keys or the pad opened goes when the mouse takes over; hovering opens its own.
    if (kind === "mouse") hidePanel();
    else {
      const focused = document.activeElement as HTMLElement | null;
      const shown = focused ? previewOf(focused) : undefined;
      if (focused && shown) showPanel(shown, focused);
    }
  };
  /** Whether the focus was last moved by the keyboard or a pad (not on page load, not by the mouse). */
  const focusDriven = (): boolean => {
    const input = host.dataset.input;
    return input === "keys" || input === "pad";
  };
  host.addEventListener("pointerdown", () => setInput("mouse"));
  host.addEventListener("mousemove", () => setInput("mouse"), { passive: true });

  /** A key while the screen is up: true if it was used (the room then leaves it alone). */
  function handleKey(event: KeyboardEvent): boolean {
    if (inRoom && !builder) return false;
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      } else if (event.key === "Escape") {
        event.preventDefault();
        (event.target as HTMLInputElement).blur();
      }
      // Typing stays in the name: nothing else hears it.
      return true;
    }
    // Leave the browser's own shortcuts alone (Ctrl+minus zooms out, Ctrl+F finds).
    if ((event.ctrlKey || event.metaKey || event.altKey) && !event.getModifierState("AltGraph")) return false;
    setInput("keys");
    const arrows: Record<string, FocusDirection> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
    };
    const direction = arrows[event.key];
    if (direction) {
      event.preventDefault();
      moveFocus(direction);
      return true;
    }
    if (event.key === "Escape") {
      // A dialog closes itself on Escape: the key is used, so the room doesn't also step back.
      if (host.querySelector("dialog[open]")) return true;
      event.preventDefault();
      if (builder) void back();
      else if (chosenHero) closeDeckChoice();
      else return false;
      return true;
    }
    if (!builder || host.querySelector("dialog[open]:not(#zoom)")) return false;
    const card = focusedCard() ?? openZoomCard();
    if ((event.key === "Delete" || event.key === "Backspace" || event.key === "-") && card) {
      event.preventDefault();
      remove(card);
      return true;
    }
    if ((event.key === "+" || event.key === "=") && card) {
      event.preventDefault();
      add(card);
      return true;
    }
    if (
      (event.key === "[" || event.key === "]" || event.key === "PageUp" || event.key === "PageDown") &&
      !host.querySelector("dialog[open]")
    ) {
      event.preventDefault();
      stepTab(event.key === "]" || event.key === "PageDown" ? 1 : -1);
      return true;
    }
    if ((event.key === "f" || event.key === "F") && card) {
      event.preventDefault();
      if (openZoomCard()) closeZoom();
      else openZoom(card);
      return true;
    }
    return false;
  }
  if (!inRoom) document.addEventListener("keydown", (event) => void handleKey(event));

  $("builder-back").addEventListener("click", () => void back());
  $("deck-save").addEventListener("click", save);
  $("deck-duplicate").addEventListener("click", duplicate);
  $("deck-delete").addEventListener("click", () => void deleteDeck());

  // ── Controller ────────────────────────────────────────────────────────────────────────────────────────────────────

  const pads = createPadReader();

  function padLoop(now: number): void {
    const list = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
    // In the room, only while the builder is up (the reader still reads, so a held button isn't a fresh press later).
    const live = !inRoom || (builder !== null && host.isConnected && !host.hidden);
    const frame = pads.read(list, now, DEFAULT_PAD_SETTINGS, live);
    if (live) {
      if (frame.touched) setInput("pad");
      // In the room the table's controller moves the focus and presses A; here, the page's own loop does.
      if (frame.move && !inRoom) moveFocus(frame.move);
      for (const press of frame.presses) padPress(press);
    }
    requestAnimationFrame(padLoop);
  }

  function padPress(button: number): void {
    const dialog = host.querySelector<HTMLDialogElement>("dialog[open]");
    const focused = document.activeElement as HTMLElement | null;
    switch (button) {
      case GAMEPAD_BUTTON.a:
        if (inRoom) return;
        if (focused instanceof HTMLButtonElement) focused.click();
        else if (focused instanceof HTMLInputElement) save();
        return;
      case GAMEPAD_BUTTON.b:
        // In the room the table's controller sends B to the room's Back (the bench's `back`), except while a dialog is
        // open, which it leaves alone: then it is this screen's.
        if (inRoom && !dialog) return;
        if (dialog) {
          if (dialog.id === "confirm") $("confirm-no").click();
          else dialog.close();
        } else if (builder) void back();
        else if (chosenHero) closeDeckChoice();
        return;
      case GAMEPAD_BUTTON.x: {
        const card = focusedCard() ?? openZoomCard();
        if (card && builder) remove(card);
        return;
      }
      case GAMEPAD_BUTTON.y: {
        if (dialog?.id === "zoom") closeZoom();
        else {
          const card = focusedCard();
          if (card && builder) openZoom(card);
        }
        return;
      }
      case GAMEPAD_BUTTON.l1:
        if (builder && !dialog) stepTab(-1);
        return;
      case GAMEPAD_BUTTON.r1:
        if (builder && !dialog) stepTab(1);
        return;
    }
  }

  function startPage(): void {
    renderHeroes();
    renderDeckChoice();
    const params = new URLSearchParams(location.search);
    const hero = params.get("hero");
    const deck = params.get("deck");
    if (hero && offeredHeroes.some((h) => h.identityCardId === hero)) {
      const name = heroName(hero);
      if (deck === "starter")
        openBuilder(starterDraft(hero), null, `${name} ${ASPECT_NAMES[heroOf(hero).starterAspect]}`);
      else if (deck === "new") openBuilder(ownCardsDraft(hero), null, `${name} deck`);
      else if (deck && store.get(deck)?.identityCardId === hero) openSaved(store.get(deck)!);
      else pickHero(hero);
    } else {
      $("hero-boxes").querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }
  }

  if (options.backLabel) $("builder-back").textContent = options.backLabel;
  if (inRoom) host.hidden = true;
  else startPage();
  requestAnimationFrame(padLoop);

  return {
    open(identityCardId, deck) {
      const hero = heroOf(identityCardId);
      host.hidden = false;
      if (deck === "starter")
        openBuilder(starterDraft(identityCardId), null, `${hero.name} ${ASPECT_NAMES[hero.starterAspect]}`);
      else if (deck === "new")
        openBuilder(
          ownCardsDraft(identityCardId),
          null,
          freeName(
            `${hero.name} deck`,
            store.list().map((d) => d.name),
          ),
        );
      else {
        const saved = store.get(deck);
        if (saved) openSaved(saved);
      }
    },
    key: handleKey,
    back() {
      const dialog = host.querySelector<HTMLDialogElement>("dialog[open]");
      if (dialog) {
        if (dialog.id === "confirm") $("confirm-no").click();
        else dialog.close();
        return true;
      }
      if (!builder) return false;
      void back();
      return true;
    },
    isOpen: () => builder !== null,
  };
}
