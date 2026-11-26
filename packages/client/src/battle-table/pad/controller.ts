/**
 * Controller mode for the battle table: the whole fight played on a pad.
 *
 * The pad presses the same controls the mouse and keyboard do, so no rule lives here: every card on the table already
 * has its own button (`main.ts` nameplates), and the turn bar, the corners and the menus are buttons too. This module
 * moves the focus between them, presses the focused one, and shows which button does what:
 *
 *   D-pad / left stick  move the focus to the nearest card or button that way (held: repeats)   (`pad-nav.ts`)
 *   A                   press it: play a card, pay with it, pick it, open (or close) its actions, answer
 *   B                   back, as Escape: unpin, close a card's actions, cancel a payment or a pick; else the menu
 *   Y                   pin the focused card full size beside the table (again: unpin)
 *   LB / RB             jump between the hand, your side, the villain's side and the turn controls
 *   Start / Menu        the button that moves the game on (Continue, Play, Keep hand, Defend…); else the menu
 *   View                show or hide the card panel
 *   L3 / R3             your discard pile / the encounter discard pile
 *   hold LT             A Attack · X Thwart · Y Recover · B change form · LB Undo · RB End Turn
 *   hold RT             A / X / Y / B use your other cards' powers and abilities, LB / RB for more
 *   right stick         scroll the table
 *
 * A card's actions open with the focus still on the card, as they do for the mouse and the keyboard: a D-pad press
 * steps into them, and A again closes them, so a double press never uses an action by itself.
 *
 * End Turn is never a stray press: it is LT + RB, or the End Turn button reached on purpose with a fresh D-pad press.
 * The focus never lands on it by itself (`pad-nav.ts` HOME.never), a bumper jump or a held direction never stops on
 * it, `main.ts` no longer hands the focus to it when the bar folds while a pad is in use, and a button that turns into
 * End Turn under the focus (a phone's Keep hand) sends the focus back to the hand.
 *
 * Until a pad is used the page behaves exactly as before: nothing moves the focus and nothing is drawn. The first pad
 * input switches the page into controller mode (`data-input="pad"` on the root, which `pad.css` keys every ring and
 * hint on, since `:focus-visible` doesn't follow script focus after a mouse click); moving the mouse, touching the
 * screen or typing switches it back. Button pictures follow the pad (Xbox, PlayStation, Switch) and the player's
 * Settings ▸ Controls choices in the classic game (`mc-settings`). The trigger layers read the classic board's own
 * bindings (`view/pad-layer-bindings.ts`), so the two boards keep one map.
 */

import { GAMEPAD_BUTTON } from "./buttons.js";
import type { Rect } from "./spatial.js";
import { glyphArtFor, glyphArtSvg, isColoredGlyphArt, padGlyphArtOf } from "./glyph-art.js";
import {
  padFamilyName,
  padGlyphOf,
  physicalIndexOf,
  resolvePadFamily,
  usesNintendoSwap,
  type PadFamily,
  type PadIdentity,
} from "./family.js";
import {
  ABILITIES_PER_PAGE,
  abilitySlotOf,
  LAYER_BUTTONS,
  layerActionOf,
  type LayerActionId,
  type PadLayer,
} from "./buttons.js";
import { nextAbilityPage } from "./triggers.js";
import type { FocusDirection } from "./spatial.js";
import { createPadReader, padSettingsFrom, type PadLike } from "./input.js";
import { HOME, homeStop, jumpZone, moveFocus, type PadStop, type PadZone } from "./nav.js";
import type { BattleTable } from "../table.js";
import "./pad.css";

/** A power or ability one of your cards can use now, for the RT layer. */
export interface PadCardAction {
  readonly cardId: string;
  readonly kind: string;
  readonly label: string;
}

/** What the controller asks of the table (`main.ts`): its state, read live, and the moves it already makes. */
export interface ControllerHooks {
  table(): BattleTable | undefined;
  /** Escape's ladder: put away the topmost thing; with nothing to put away, open the menu. */
  back(): void;
  /** The bar's double-press guard: false for a moment after a new question appears. */
  settled(): boolean;
  /** The table is playing something out (the villain phase, a card in flight): the focus is left where it is. */
  busy(): boolean;
  /** Which part of the table a card is in. */
  zoneOf(cardId: string): PadZone | null;
  /** Pressing the card opens its own actions (the hero, an ally, a support with an ability). */
  opensMenu(cardId: string): boolean;
  /** Pin a card full size beside the table; the pinned card again unpins it. */
  pin(cardId: string | null): void;
  pinned(): string | null;
  /** The card whose own actions are open (`#decision`), or null. */
  menuCard(): string | null;
  heroId(): string;
  /** The hero's basic powers usable now (Attack, Thwart, Recover, change form), or none. */
  heroActions(): readonly { readonly kind: string; readonly label: string }[];
  /** Your other cards' powers and abilities usable now, in table order. */
  fieldActions(): readonly PadCardAction[];
  useAction(cardId: string, kind: string): void;
}

/** What the table can ask of the controller. */
export interface PadController {
  /** A short rumble on the pads that can, while a pad is being played with: `strength` 0 to 1. */
  rumble(strength: number): void;
}

/** True while the page is in controller mode. `main.ts` reads it before moving the focus itself. */
export function padActive(): boolean {
  return document.documentElement.dataset.input === "pad";
}

const SETTINGS_KEY = "mc-settings";
/** Frames the focus may be lost (a card flown off, a question re-painted) before it is sent home. */
const LOST_FRAMES = 6;
/** How far the mouse must move to take the page back from the pad (a layout change sends moves of 0). */
const MOUSE_TAKEOVER_PX = 6;
/** With no pad attached the page looks for one this often (a stubbed pad never fires `gamepadconnected`). */
const IDLE_POLL_MS = 500;
/**
 * A dialog's buttons wait out a press this long after it opens, as the bar's do (`main.ts` QUESTION_GUARD_MS); the
 * game-over screen longer, since A mashed through the last villain phase would press Try Again and lose the undo.
 */
const DIALOG_GUARD_MS = 380;
const GAME_OVER_GUARD_MS = 1000;
/** The hero's basic powers the LT layer's face buttons use (`view/pad-layer-bindings.ts`), as the model names them. */
const LT_POWER_KIND: Partial<Record<LayerActionId, string>> = {
  attack: "basicAttack",
  thwart: "basicThwart",
  recover: "basicRecover",
  changeForm: "changeForm",
};
/** Names for the LT layer's actions when the hero can't use them now (the model only names the ones it offers). */
const LT_NAMES: Partial<Record<LayerActionId, string>> = {
  attack: "Attack",
  thwart: "Thwart",
  recover: "Recover",
  changeForm: "Change form",
  undo: "Undo",
  endTurn: "End Turn",
};

type Scope =
  | { readonly kind: "dialog"; readonly root: HTMLDialogElement }
  | { readonly kind: "reveal"; readonly root: HTMLElement }
  | { readonly kind: "menu"; readonly root: HTMLElement }
  | { readonly kind: "page"; readonly root: HTMLElement };

export function startController(hooks: ControllerHooks): PadController {
  const root = document.documentElement;
  const stage = document.getElementById("stage")!;
  const viewport = document.getElementById("board-viewport")!;
  const decision = document.getElementById("decision")!;
  const readReveal = document.getElementById("read-reveal") as HTMLButtonElement;
  const reader = createPadReader();

  let settings = padSettingsFrom(readSettings());
  window.addEventListener("storage", (event) => {
    if (event.key === SETTINGS_KEY) settings = padSettingsFrom(event.newValue);
  });

  // ── What is drawn in controller mode ──────────────────────────────────────────────────────────────────────────────
  const ring = svg("svg", { id: "pad-ring", "aria-hidden": "true", hidden: "" });
  const ringShape = svg("polygon", {});
  ring.append(ringShape);
  stage.append(ring);
  const chip = make("div", "pad-chip");
  chip.id = "pad-chip";
  chip.setAttribute("aria-hidden", "true");
  chip.hidden = true;
  stage.append(chip);
  // The pictures are for the eye: the controls they sit by keep their own names. Only the toast is read out.
  const hints = make("div", "");
  hints.id = "pad-hints";
  const legend = make("div", "pad-legend");
  legend.setAttribute("aria-hidden", "true");
  const sheet = make("div", "pad-sheet");
  sheet.setAttribute("aria-hidden", "true");
  sheet.hidden = true;
  const toastNode = make("div", "pad-toast");
  toastNode.setAttribute("role", "status");
  toastNode.hidden = true;
  hints.append(legend, sheet, toastNode);
  document.body.append(hints);
  /** Badges beside the controls a combo presses: the bar's forward button, End Turn, Undo. */
  const badges = new Map<string, HTMLElement>();

  // ── Controller mode on and off ────────────────────────────────────────────────────────────────────────────────────
  let identity: PadIdentity | null = null;
  let family: PadFamily = "xbox";
  let announced = false;
  let paintedKey = "";

  function enter(pad: PadIdentity): void {
    identity = pad;
    const next = resolvePadFamily(settings.family, pad);
    if (!padActive() || next !== family) {
      family = next;
      root.dataset.input = "pad";
      root.dataset.padFamily = family;
      paintedKey = "";
    }
    if (!announced) {
      announced = true;
      toast(`${padFamilyName(family)} controller connected`);
    }
  }

  function leave(): void {
    if (!padActive()) return;
    delete root.dataset.input;
    ring.toggleAttribute("hidden", true);
    chip.hidden = sheet.hidden = true;
    for (const badge of badges.values()) badge.hidden = true;
  }

  let travelled = 0;
  document.addEventListener(
    "pointermove",
    (event) => {
      if (!padActive() || event.pointerType !== "mouse") return;
      travelled += Math.abs(event.movementX) + Math.abs(event.movementY);
      if (travelled > MOUSE_TAKEOVER_PX) leave();
    },
    { passive: true },
  );
  for (const type of ["pointerdown", "wheel", "keydown"] as const)
    document.addEventListener(type, () => leave(), { capture: true, passive: true });

  // ── The loop ──────────────────────────────────────────────────────────────────────────────────────────────────────
  let frameId = 0;
  let idleTimer = 0;
  let lost = 0;
  let layer: PadLayer | null = null;
  let abilityPage = 0;
  let padsSeen = 0;
  /** The scope the focus moves in, and when it last changed (a dialog's double-press guard). */
  let scopeKind = "page";
  let scopeSince = 0;
  const zoneMemory = new Map<PadZone, HTMLElement>();

  function poll(now: number): void {
    frameId = 0;
    let attached = 0;
    try {
      const pads = readPads();
      const frame = reader.read(pads, now, settings, !document.hidden);
      attached = frame.pads.length;
      for (const id of frame.ignored)
        console.info(`Gamepad "${id}" doesn't report the standard layout, so the battle table ignores it.`);
      if (padsSeen && !attached && padActive()) {
        // The pad went away: the pointer comes back for the mouse.
        toast("Controller disconnected");
        leave();
      }
      padsSeen = attached;
      if (frame.touched) {
        travelled = 0;
        enter(frame.touched);
      }
      if (frame.layer !== layer) {
        layer = frame.layer;
        abilityPage = 0;
      }
      noteScope(now);
      if (frame.move) step(frame.move, frame.repeat);
      for (const meaning of frame.presses) press(meaning, now);
      if (frame.scroll) scroll(frame.scroll.dx, frame.scroll.dy);
      if (padActive()) {
        keepFocus();
        paint();
      }
      noteScope(now);
    } finally {
      // Whatever a hook threw, the pad keeps working on the next frame.
      if (attached) frameId = requestAnimationFrame(poll);
      else idleTimer = window.setTimeout(() => (frameId = requestAnimationFrame(poll)), IDLE_POLL_MS);
    }
  }
  const wake = (): void => {
    clearTimeout(idleTimer);
    if (!frameId) frameId = requestAnimationFrame(poll);
  };
  window.addEventListener("gamepadconnected", wake);
  frameId = requestAnimationFrame(poll);

  /** Keyed by the dialog itself, so the menu giving way to the game-over screen in one render restarts the guard. */
  function noteScope(now: number): void {
    const scope = scopeNow();
    const key = scope.kind === "dialog" ? `dialog:${scope.root.id}` : scope.kind;
    if (key === scopeKind) return;
    scopeKind = key;
    scopeSince = now;
  }

  // ── Moving the focus ──────────────────────────────────────────────────────────────────────────────────────────────
  function step(direction: FocusDirection, repeat: boolean): void {
    const scope = scopeNow();
    const stops = stopsIn(scope);
    const active = document.activeElement;
    const current = stops.find((stop) => stop.key === active);
    if (!current) {
      if (scope.kind === "page" && cardsLocked()) return;
      // From a card whose actions are open, a fresh press steps into them; a direction still held from before doesn't.
      if (scope.kind === "menu") {
        if (repeat) return;
        const first = homeStop(stops);
        if (first) focusStop(first, stops);
        return;
      }
      goHome(stops);
      return;
    }
    const next = moveFocus(stops, current.key, direction);
    // A held direction sweeps across the cards but never stops on End Turn or Undo: reaching them takes a fresh press.
    if (next && !(repeat && (isEndTurn(next) || next.id === "undo"))) focusStop(next, stops);
  }

  function goHome(stops: readonly PadStop<HTMLElement>[]): void {
    // A card's open actions (opened with the mouse, say) start at the card, never on an action a press would use.
    const owner = menuOpen() ? cardOfMenu() : null;
    if (owner && reachable(owner)) {
      owner.focus({ preventScroll: true });
      return;
    }
    const home = homeStop(stops);
    if (home) focusStop(home, stops);
  }

  function focusStop(element: HTMLElement, stops: readonly PadStop<HTMLElement>[]): void {
    element.focus({ preventScroll: true });
    // Only a move onto End Turn while it already says End Turn counts as choosing it (`keepFocus`).
    endTurnChosen = isEndTurn(element) ? element : null;
    const stop = stops.find((item) => item.key === element);
    if (!stop) return;
    remember(stop.zone, element);
    bringIntoView(stop.rect);
  }

  /** The stop to come back to in a zone with the bumpers: anything but End Turn, which a bumper never lands on. */
  function remember(zone: PadZone, element: HTMLElement): void {
    if (!isEndTurn(element)) zoneMemory.set(zone, element);
  }

  /**
   * The End Turn the player moved the focus onto, or null. A button can turn into End Turn under the focus (on a
   * phone, Keep hand becomes the bar's End Turn once the hand is kept): that focus is sent home, so a second A never
   * ends the turn.
   */
  let endTurnChosen: HTMLElement | null = null;
  function endTurnByAccident(element: Element): boolean {
    return isEndTurn(element) && element !== endTurnChosen;
  }

  /** The table scrolls on a phone: a stop the focus moves to is scrolled into sight. */
  function bringIntoView(rect: Rect): void {
    const view = viewport.getBoundingClientRect();
    const margin = 12;
    let dy = 0;
    if (rect.y < view.top + margin) dy = rect.y - view.top - margin;
    else if (rect.y + rect.height > view.bottom - margin) dy = rect.y + rect.height - view.bottom + margin;
    if (dy && viewport.scrollHeight > viewport.clientHeight) viewport.scrollBy({ top: dy });
  }

  /**
   * In controller mode the focus is always somewhere: a played card's button goes away, a new question focuses the
   * bar's title, the bar folds away. After a few frames with nothing reachable focused it goes home, unless the table
   * is playing something out (a dialog or a revealed card waiting on Continue take it at once).
   */
  function keepFocus(): void {
    const scope = scopeNow();
    const active = document.activeElement;
    if (endTurnChosen && !(isEndTurn(endTurnChosen) && reachable(endTurnChosen))) endTurnChosen = null;
    if (
      active instanceof HTMLElement &&
      inScope(active, scope) &&
      (reachable(active) || active === cardOfMenu()) &&
      !endTurnByAccident(active)
    ) {
      lost = 0;
      if (scope.kind === "page") {
        const zone = zoneOfStop(active);
        if (zone) remember(zone, active);
      }
      return;
    }
    if (scope.kind === "page" || scope.kind === "menu") {
      if (++lost < LOST_FRAMES || hooks.busy()) return;
    }
    lost = 0;
    goHome(stopsIn(scope));
  }

  function scroll(dx: number, dy: number): void {
    const target = viewport.scrollHeight > viewport.clientHeight ? viewport : document.getElementById("dock-feed");
    target?.scrollBy({ left: dx, top: dy });
  }

  // ── Pressing ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function press(meaning: number, now: number): void {
    const page = scopeNow().kind === "page";
    // The trigger layers and the pile and panel buttons reach the table itself: never from behind a dialog, a card's
    // open actions or a card waiting on Continue.
    if (layer) {
      if (!page) return;
      return layer === "lt" ? pressPower(meaning) : pressAbility(meaning);
    }
    switch (meaning) {
      case GAMEPAD_BUTTON.a:
        return activate(now);
      case GAMEPAD_BUTTON.b:
        return backOut();
      case GAMEPAD_BUTTON.y:
        return pin();
      case GAMEPAD_BUTTON.l1:
        return jump(-1);
      case GAMEPAD_BUTTON.r1:
        return jump(1);
      case GAMEPAD_BUTTON.menu:
        return forward();
      case GAMEPAD_BUTTON.view:
        if (page) clickIfReachable(document.getElementById("rail-toggle"));
        return;
      case GAMEPAD_BUTTON.l3:
        if (page) clickIfReachable(document.getElementById("discard-label"));
        return;
      case GAMEPAD_BUTTON.r3:
        if (page) clickIfReachable(document.getElementById("encounter-discard"));
        return;
    }
  }

  function activate(now: number): void {
    const scope = scopeNow();
    const active = document.activeElement;
    const owner = scope.kind === "menu" ? cardOfMenu() : null;
    if (
      !(active instanceof HTMLElement) ||
      !inScope(active, scope) ||
      !(reachable(active) || active === owner) ||
      endTurnByAccident(active)
    ) {
      // Nothing to press yet: the first A shows where the focus is (once the cards are back, if they are moving).
      if (scope.kind !== "page" || !cardsLocked()) goHome(stopsIn(scope));
      return;
    }
    if (scope.kind === "dialog") {
      const guard = scope.root.id === "game-over" ? GAME_OVER_GUARD_MS : DIALOG_GUARD_MS;
      if (now - scopeSince < guard) return;
    } else {
      // A new question's answers wait out a double press, as they do for a double click: mashing A through Continue
      // must not also answer the question that follows it. Spending a resource or picking a card to swap only
      // toggles, so those answer at once.
      const answers =
        !!active.closest("#dock, #turn-corner") ||
        active === readReveal ||
        (active.hasAttribute("data-target") && !active.hasAttribute("aria-pressed"));
      if (answers && !hooks.settled()) return;
    }
    if (isEndTurn(active)) endTurnChosen = null;
    active.click();
  }

  function backOut(): void {
    const dialog = openDialog();
    if (dialog) {
      // The game-over screen can't be put away; the menu closes as Resume; a dialog may name its own (`data-pad-back`).
      if (dialog.id === "menu") clickIfReachable(document.getElementById("menu-resume"));
      else clickIfReachable(dialog.querySelector<HTMLElement>("[data-pad-back]"));
      return;
    }
    // Closing a card's actions hands the focus back to the card (unpinning a card first leaves them open).
    const owner = menuOpen() ? cardOfMenu() : null;
    hooks.back();
    if (owner)
      requestAnimationFrame(() => {
        if (!menuOpen() && owner.isConnected && reachable(owner)) owner.focus({ preventScroll: true });
      });
  }

  function pin(): void {
    const active = document.activeElement;
    const card = active instanceof HTMLElement ? active.dataset.card : undefined;
    if (card) hooks.pin(card);
    else if (hooks.pinned()) hooks.pin(null);
  }

  function jump(direction: 1 | -1): void {
    const scope = scopeNow();
    if (scope.kind !== "page" || cardsLocked()) return;
    const stops = stopsIn(scope);
    const active = document.activeElement;
    const current = stops.find((stop) => stop.key === active)?.key ?? null;
    const next = jumpZone(stops, current, direction, (zone) => zoneMemory.get(zone));
    if (next) focusStop(next, stops);
  }

  /** Start: the button that moves the game on, while one is ready; else the menu (or, in the menu, Resume). */
  function forward(): void {
    const dialog = openDialog();
    if (dialog) {
      if (dialog.id === "menu") clickIfReachable(document.getElementById("menu-resume"));
      return;
    }
    if (!hooks.settled()) return;
    if (!readReveal.hidden) {
      readReveal.click();
      return;
    }
    const primary = forwardButton();
    if (primary) {
      primary.click();
      return;
    }
    // As Escape does, whatever the table is playing out.
    clickIfReachable(document.getElementById("menu-button"));
  }

  /** The bar's gold button, while it is ready and is not End Turn (End Turn always takes two buttons). */
  function forwardButton(): HTMLButtonElement | null {
    const primary = document.getElementById("dock-primary") as HTMLButtonElement | null;
    return primary && !primary.hasAttribute("data-end-turn") && reachable(primary) ? primary : null;
  }

  /** The End Turn button in reach now: the corner's, or a phone's bar's. */
  function endTurnButton(): HTMLButtonElement | null {
    for (const id of ["end-turn", "dock-primary"]) {
      const button = document.getElementById(id);
      if (button instanceof HTMLButtonElement && isEndTurn(button) && reachable(button)) return button;
    }
    return null;
  }

  function pressPower(meaning: number): void {
    const action = layerActionOf("lt", meaning);
    if (action === "undo") {
      if (!clickIfReachable(document.getElementById("undo"))) toast("Nothing to undo");
      return;
    }
    if (action === "endTurn") {
      const ready = endTurnButton();
      if (ready && hooks.settled()) ready.click();
      else if (!ready) toast("You can't end the turn yet");
      return;
    }
    const kind = action ? LT_POWER_KIND[action] : undefined;
    if (!action || !kind) return;
    const power = hooks.heroActions().find((item) => item.kind === kind);
    if (power && hooks.settled()) hooks.useAction(hooks.heroId(), kind);
    else if (!power) toast(`${LT_NAMES[action] ?? "That"} isn't possible now`);
  }

  function pressAbility(meaning: number): void {
    const action = layerActionOf("rt", meaning);
    if (!action) return;
    const abilities = hooks.fieldActions();
    const pages = Math.max(1, Math.ceil(abilities.length / ABILITIES_PER_PAGE));
    if (action === "pageNext" || action === "pagePrevious") {
      abilityPage = nextAbilityPage(abilityPage, pages, action === "pageNext" ? 1 : -1);
      return;
    }
    const slot = abilitySlotOf(action);
    if (slot === null) return;
    const ability = abilities[Math.min(abilityPage, pages - 1) * ABILITIES_PER_PAGE + slot];
    if (ability && hooks.settled()) hooks.useAction(ability.cardId, ability.kind);
    else if (!ability) toast(abilities.length ? "No ability on that button" : "No abilities to use now");
  }

  // ── The stops ─────────────────────────────────────────────────────────────────────────────────────────────────────
  function scopeNow(): Scope {
    const dialog = openDialog();
    if (dialog) return { kind: "dialog", root: dialog };
    if (!readReveal.hidden) return { kind: "reveal", root: readReveal };
    if (menuOpen()) return { kind: "menu", root: decision };
    return { kind: "page", root: document.body };
  }

  /** In the scope's own area; a card's open actions also keep the card itself, where the focus waits until it steps in. */
  function inScope(element: HTMLElement, scope: Scope): boolean {
    if (scope.kind === "page")
      return !element.closest("dialog") && element !== readReveal && !decision.contains(element);
    if (scope.kind === "menu" && element === cardOfMenu()) return true;
    return scope.root === element || scope.root.contains(element);
  }

  function stopsIn(scope: Scope): PadStop<HTMLElement>[] {
    if (scope.kind === "reveal")
      return [{ key: readReveal, rect: rectOf(readReveal), zone: "turn", home: HOME.reveal }];
    const buttons = [...scope.root.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => inScope(button, scope) && reachable(button),
    );
    if (scope.kind === "dialog" || scope.kind === "menu") {
      const first = scope.kind === "dialog" ? HOME.dialog : HOME.cardMenu;
      return buttons.map((button, index) => ({
        key: button,
        rect: rectOf(button),
        zone: "turn",
        // The dialog's own first choice (autofocus) or the menu's first action starts.
        home: index === 0 || button.autofocus ? first : HOME.control,
      }));
    }
    const cards = cardRects();
    const stops: PadStop<HTMLElement>[] = [];
    for (const button of buttons) {
      if (button.classList.contains("pinned-close")) continue;
      const card = button.dataset.card;
      if (card !== undefined) {
        const rect = cards.get(card);
        if (!rect) continue;
        stops.push({ key: button, rect, zone: hooks.zoneOf(card) ?? "player", home: cardHome(button, card) });
        continue;
      }
      const rect = rectOf(button);
      if (rect.width <= 0 && rect.height <= 0) continue;
      stops.push({ key: button, rect, zone: zoneOfStop(button) ?? "turn", home: controlHome(button) });
    }
    return stops;
  }

  function cardHome(button: HTMLElement, card: string): number {
    if (button.hasAttribute("data-target")) return HOME.target;
    if (button.getAttribute("aria-pressed") === "false") return HOME.spend;
    if (button.getAttribute("aria-pressed") === "true") return HOME.hand;
    const label = button.getAttribute("aria-label") ?? "";
    const zone = hooks.zoneOf(card);
    if (zone === "hand") return label.startsWith("Play ") ? HOME.playable : HOME.hand;
    if (card === hooks.heroId()) return HOME.hero;
    if (button.classList.contains("enemy")) return HOME.villain;
    return HOME.card;
  }

  function controlHome(button: HTMLElement): number {
    if (isEndTurn(button)) return HOME.never;
    if (button.id === "dock-primary") return button.hasAttribute("data-attention") ? HOME.attention : HOME.primary;
    if (button.dataset.option !== undefined) return HOME.option;
    if (button.id === "dock-secondary") return HOME.answer;
    return HOME.control;
  }

  function zoneOfStop(element: HTMLElement): PadZone | null {
    const card = element.dataset.card;
    if (card !== undefined) return hooks.zoneOf(card);
    if (element.id === "discard-label") return "player";
    if (element.id === "encounter-discard") return "villain";
    return "turn";
  }

  /** Each card's box on screen, from the table's own projection (a nameplate sits under its card, a hand card's is empty). */
  function cardRects(): Map<string, Rect> {
    const rects = new Map<string, Rect>();
    const table = hooks.table();
    if (!table) return rects;
    const origin = stage.getBoundingClientRect();
    for (const anchor of table.anchors())
      rects.set(anchor.id, {
        x: origin.left + anchor.left,
        y: origin.top + anchor.top,
        width: Math.max(1, anchor.right - anchor.left),
        height: Math.max(1, anchor.bottom - anchor.top),
      });
    return rects;
  }

  function menuOpen(): boolean {
    return !decision.hidden && !!decision.querySelector("button");
  }

  /** The nameplate of the card whose actions are open. */
  function cardOfMenu(): HTMLElement | null {
    const owner = hooks.menuCard();
    return owner ? document.querySelector<HTMLElement>(`.anchor[data-card="${CSS.escape(owner)}"]`) : null;
  }

  // ── Drawing the hints ─────────────────────────────────────────────────────────────────────────────────────────────
  function paint(): void {
    const swap = usesNintendoSwap(family, settings.nintendoLayout, identity);
    const glyphs = settings.glyphs;
    hints.toggleAttribute("data-glyphs", glyphs);
    paintRing();
    paintChip(glyphs, swap);
    paintBadges(glyphs, swap);
    paintLegend(glyphs, swap);
    paintSheet(glyphs, swap);
  }

  function paintRing(): void {
    const active = document.activeElement;
    const card = active instanceof HTMLElement ? active.dataset.card : undefined;
    const outline = card ? (hooks.table()?.cardOutline(card) ?? []) : [];
    ring.toggleAttribute("hidden", !outline.length);
    if (outline.length) ringShape.setAttribute("points", outline.join(" "));
  }

  function paintChip(glyphs: boolean, swap: boolean): void {
    const active = document.activeElement;
    const card = active instanceof HTMLElement && padActive() ? active.dataset.card : undefined;
    const point = card
      ? hooks
          .table()
          ?.anchors()
          .find((anchor) => anchor.id === card)
      : undefined;
    // Hidden while the card's own actions are open: they stand just where it would, above the card.
    if (!glyphs || !card || !point || !(active instanceof HTMLElement) || hooks.menuCard() === card) {
      chip.hidden = true;
      return;
    }
    const verb = verbOf(active, card);
    const key = `${family}|${swap}|${verb}|${hooks.pinned() === card}`;
    if (chip.dataset.key !== key) {
      chip.dataset.key = key;
      chip.replaceChildren(
        ...(verb ? [hint(GAMEPAD_BUTTON.a, verb, swap)] : []),
        hint(GAMEPAD_BUTTON.y, hooks.pinned() === card ? "Unpin" : "Pin", swap),
      );
    }
    chip.hidden = false;
    chip.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.top - 8)}px)`;
  }

  /** What A does to a focused card, from its own button's label (`main.ts` synchronizeLabels). */
  function verbOf(button: HTMLElement, card: string): string | null {
    const label = button.getAttribute("aria-label") ?? "";
    const first = label.split(" ")[0] ?? "";
    if (["Play", "Choose", "Spend", "Remove", "Swap", "Discard"].includes(first)) return first;
    if (button.classList.contains("discard-card")) return null;
    if (hooks.opensMenu(card)) return "Actions";
    if (hooks.zoneOf(card) === "hand") return "Why not?";
    return null;
  }

  function paintBadges(glyphs: boolean, swap: boolean): void {
    const forwardReady = forwardButton();
    const endCorner = document.getElementById("end-turn");
    const endInBar = document.getElementById("dock-primary");
    const wanted: [string, HTMLElement | null, () => HTMLElement[]][] = [
      ["forward", forwardReady, () => [glyph(GAMEPAD_BUTTON.menu, swap)]],
      ["end-turn", endCorner, () => combo(GAMEPAD_BUTTON.l2, GAMEPAD_BUTTON.r1, swap)],
      [
        "end-turn-bar",
        endInBar?.hasAttribute("data-end-turn") ? endInBar : null,
        () => combo(GAMEPAD_BUTTON.l2, GAMEPAD_BUTTON.r1, swap),
      ],
      ["undo", document.getElementById("undo"), () => combo(GAMEPAD_BUTTON.l2, GAMEPAD_BUTTON.l1, swap)],
    ];
    for (const [name, target, draw] of wanted) {
      let badge = badges.get(name);
      const show = glyphs && target instanceof HTMLButtonElement && reachable(target);
      if (!show) {
        if (badge) badge.hidden = true;
        continue;
      }
      if (!badge) {
        badge = make("span", "pad-badge");
        badge.setAttribute("aria-hidden", "true");
        badges.set(name, badge);
        hints.append(badge);
      }
      const key = `${family}|${swap}`;
      if (badge.dataset.key !== key) {
        badge.dataset.key = key;
        badge.replaceChildren(...draw());
      }
      const box = target.getBoundingClientRect();
      badge.style.transform = `translate(${Math.round(box.right)}px, ${Math.round(box.top)}px)`;
      badge.hidden = false;
    }
  }

  function paintLegend(glyphs: boolean, swap: boolean): void {
    placeLegend();
    const scope = scopeNow();
    const forwardLabel = scope.kind === "dialog" ? "Resume" : forwardLabelNow();
    const key = `${glyphs}|${family}|${swap}|${scope.kind}|${forwardLabel}`;
    if (key === paintedKey) return;
    paintedKey = key;
    legend.hidden = !glyphs;
    if (!glyphs) return;
    // A phone shows only the buttons that answer (`pad.css` folds the rest away): A, B and what Start does now.
    const extra = (item: HTMLElement) => ((item.dataset.extra = ""), item);
    const items: HTMLElement[] = [
      extra(move()),
      hint(GAMEPAD_BUTTON.a, "Select", swap),
      hint(GAMEPAD_BUTTON.b, "Back", swap),
    ];
    if (scope.kind === "page") {
      items.push(
        extra(hint(GAMEPAD_BUTTON.y, "Pin", swap)),
        extra(pair(GAMEPAD_BUTTON.l1, GAMEPAD_BUTTON.r1, "Zones", swap)),
        extra(hint(GAMEPAD_BUTTON.l2, "Actions", swap)),
        extra(hint(GAMEPAD_BUTTON.r2, "Abilities", swap)),
      );
    }
    if (scope.kind !== "menu") items.push(hint(GAMEPAD_BUTTON.menu, forwardLabel, swap));
    legend.replaceChildren(...items);
  }

  /**
   * On a wider screen the strip sits across the top of the table, centred in the space between the phase chip and
   * the card panel's toggle so it covers neither; a phone keeps it under the table (`pad.css`).
   */
  function placeLegend(): void {
    const field = document.querySelector(".playfield")?.getBoundingClientRect();
    const status = document.querySelector(".phase-status")?.getBoundingClientRect();
    const toggle = document.getElementById("rail-toggle");
    const toggleBox = toggle && getComputedStyle(toggle).display !== "none" ? toggle.getBoundingClientRect() : null;
    if (!field || !status || !ROOMY.matches) {
      for (const node of [legend, toastNode])
        for (const property of ["left", "max-width", "top"]) node.style.removeProperty(property);
      return;
    }
    const left = Math.max(field.left, status.right) + 12;
    const right = (toggleBox && toggleBox.width ? Math.min(field.right, toggleBox.left) : field.right) - 12;
    legend.style.left = `${Math.round((left + right) / 2)}px`;
    legend.style.maxWidth = `${Math.max(200, Math.round(right - left))}px`;
    // A message shows just under the strip, however many rows it wraps to.
    const below = legend.hidden ? 52 : legend.getBoundingClientRect().bottom + 8;
    toastNode.style.top = `${Math.round(below)}px`;
    toastNode.style.left = legend.style.left;
  }

  function forwardLabelNow(): string {
    if (!readReveal.hidden) return "Continue";
    const primary = forwardButton();
    return primary?.textContent?.trim() || "Menu";
  }

  function paintSheet(glyphs: boolean, swap: boolean): void {
    if (!layer || scopeNow().kind !== "page") {
      sheet.hidden = true;
      sheet.dataset.key = "";
      return;
    }
    const rows: [number, string, boolean][] = [];
    if (layer === "lt") {
      const powers = hooks.heroActions();
      for (const [button, action] of LAYER_BUTTONS.lt) {
        if (action === "undo") rows.push([button, "Undo", reachableId("undo")]);
        else if (action === "endTurn") rows.push([button, "End Turn", endTurnButton() !== null]);
        else {
          const power = powers.find((item) => item.kind === LT_POWER_KIND[action]);
          rows.push([button, power?.label ?? LT_NAMES[action] ?? action, !!power]);
        }
      }
    } else {
      const abilities = hooks.fieldActions();
      const pages = Math.max(1, Math.ceil(abilities.length / ABILITIES_PER_PAGE));
      const page = Math.min(abilityPage, pages - 1);
      for (const [button, action] of LAYER_BUTTONS.rt) {
        const slot = abilitySlotOf(action);
        const ability = slot === null ? undefined : abilities[page * ABILITIES_PER_PAGE + slot];
        if (ability) rows.push([button, ability.label, true]);
      }
      if (pages > 1) rows.push([GAMEPAD_BUTTON.r1, `More (${page + 1}/${pages})`, true]);
      if (!abilities.length) rows.push([-1, "No abilities to use now", false]);
    }
    const key = `${layer}|${family}|${swap}|${glyphs}|${rows.map((row) => row.join(":")).join(",")}`;
    if (sheet.dataset.key !== key) {
      sheet.dataset.key = key;
      const title = make("p", "pad-sheet-title");
      title.append(
        glyph(layer === "lt" ? GAMEPAD_BUTTON.l2 : GAMEPAD_BUTTON.r2, swap),
        text(layer === "lt" ? "Hero actions" : "Abilities"),
      );
      sheet.replaceChildren(
        title,
        ...rows.map(([button, label, ready]) => {
          const row = button < 0 ? make("p", "pad-sheet-row", label) : hint(button, label, swap, "p");
          row.classList.add("pad-sheet-row");
          row.toggleAttribute("data-off", !ready);
          return row;
        }),
      );
    }
    sheet.hidden = false;
  }

  function reachableId(id: string): boolean {
    const element = document.getElementById(id);
    return element instanceof HTMLButtonElement && reachable(element);
  }

  // ── Glyph pictures ────────────────────────────────────────────────────────────────────────────────────────────────
  /** The picture of the button that means `meaning` on this pad (after the Nintendo swap, the button to press). */
  function glyph(meaning: number, swap: boolean): HTMLElement {
    const index = physicalIndexOf(meaning, swap);
    const art = padGlyphArtOf(family, index);
    if (!art) return make("span", "pad-glyph pad-glyph-text", padGlyphOf(family, index)?.label ?? "?");
    const image = new Image();
    image.className = "pad-glyph" + (isColoredGlyphArt(art) ? " pad-glyph-colored" : "");
    image.alt = "";
    image.src = glyphUrl(art);
    return image;
  }

  function hint(meaning: number, label: string, swap: boolean, tag: "span" | "p" = "span"): HTMLElement {
    const item = make(tag, "pad-hint");
    item.append(glyph(meaning, swap), text(label));
    return item;
  }

  function pair(first: number, second: number, label: string, swap: boolean): HTMLElement {
    const item = make("span", "pad-hint");
    item.append(glyph(first, swap), glyph(second, swap), text(label));
    return item;
  }

  function combo(hold: number, then: number, swap: boolean): HTMLElement[] {
    return [glyph(hold, swap), make("span", "pad-plus", "+"), glyph(then, swap)];
  }

  function move(): HTMLElement {
    const item = make("span", "pad-hint");
    const art = glyphArtFor(family, "dpad");
    if (art) {
      const image = new Image();
      image.className = "pad-glyph";
      image.alt = "";
      image.src = glyphUrl(art);
      item.append(image);
    } else item.append(make("span", "pad-glyph pad-glyph-text", "✥"));
    item.append(text("Move"));
    return item;
  }

  // ── Small things ──────────────────────────────────────────────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(message: string): void {
    toastNode.textContent = message;
    toastNode.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastNode.hidden = true), 2600);
  }

  return {
    rumble(strength) {
      if (!padActive()) return;
      const magnitude = Math.max(0, Math.min(1, strength));
      for (const pad of readPads()) {
        const actuator = (pad as { vibrationActuator?: Rumble | null } | null)?.vibrationActuator;
        actuator
          ?.playEffect?.("dual-rumble", { duration: 220, strongMagnitude: magnitude, weakMagnitude: magnitude / 2 })
          ?.catch(() => undefined);
      }
    },
  };
}

/** The part of a pad's `vibrationActuator` used (not every browser or pad has one). */
interface Rumble {
  playEffect?(
    type: "dual-rumble",
    params: { duration: number; strongMagnitude: number; weakMagnitude: number },
  ): Promise<unknown> | undefined;
}

function readSettings(): string | null {
  try {
    return localStorage.getItem(SETTINGS_KEY);
  } catch {
    return null;
  }
}

function readPads(): (PadLike | null)[] {
  try {
    return [...(navigator.getGamepads?.() ?? [])];
  } catch {
    // A page without permission to read pads (a sandboxed frame) just never enters controller mode.
    return [];
  }
}

function openDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("dialog[open]");
}

/** Wider than a phone: the turn bar folds away when it has nothing to ask (`main.ts` `roomy`). */
const ROOMY = matchMedia("(min-width: 741px)");

/**
 * The cards' buttons are switched off while cards fly to a pile (`main.ts` animateDiscards): a press that would send
 * the focus home waits for them, rather than landing on a corner button for want of a card.
 */
function cardsLocked(): boolean {
  return document.getElementById("anchors")?.inert === true;
}

/** The End Turn button in the corner, or the bar's gold button while it is End Turn (a phone's). */
function isEndTurn(element: Element | null): boolean {
  return !!element && (element.id === "end-turn" || element.hasAttribute("data-end-turn"));
}

/**
 * A control the focus may be on and A may press: shown, enabled, not inert, not in the folded or waiting turn bar
 * (still clickable from script, but not there for the player), and not a tucked upgrade's hidden nameplate.
 */
function reachable(element: Element): element is HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement) || !element.isConnected || element.disabled) return false;
  if (element.closest("[hidden], [inert], .dock[data-waiting], .anchor[data-tucked]")) return false;
  // The bar folds away (`data-idle`) only on a wider screen (battle.css), where it fades out before it hides; a phone's
  // bar, End Turn and all, stays.
  if (ROOMY.matches && element.closest(".dock[data-idle]")) return false;
  const style = getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") return false;
  if (element.dataset.card !== undefined) return true;
  const box = element.getBoundingClientRect();
  return box.width > 0 || box.height > 0;
}

function clickIfReachable(element: HTMLElement | null): boolean {
  if (!element || !reachable(element)) return false;
  element.click();
  return true;
}

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

const glyphUrls = new Map<string, string>();
function glyphUrl(art: Parameters<typeof glyphArtSvg>[0]): string {
  let url = glyphUrls.get(art);
  if (!url) {
    // A white button with an ink mark, as on the classic board; `pad.css` rings it in ink so it reads on any ground.
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphArtSvg(art, { body: 0xffffff, cut: 0x0b1118 }))}`;
    glyphUrls.set(art, url);
  }
  return url;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, content?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function text(content: string): HTMLElement {
  return make("span", "pad-hint-label", content);
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
