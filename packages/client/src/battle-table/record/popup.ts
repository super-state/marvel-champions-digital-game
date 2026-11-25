/**
 * "Achievement unlocked", the way a console announces one: a toast of its own, always in the same place at the bottom
 * of the screen, above everything (the table, the game-over panel, any menu), one achievement at a time.
 *
 * Each one: its badge (the card it is about, or its emblem) bursts in with a ring and sparks, the bar slides out of it
 * with the name, holds, then folds back into the badge and goes; the next one follows. It never takes a click, a key or
 * the focus, so the game carries on under it. No sound (tests and the house stay quiet).
 *
 * It sits in the browser's top layer (a manual popover) so a modal dialog opened before or after it never covers it.
 */
import "./toast.css";
import { CORE_CARDS } from "@mc/content";
import { CARD_ART_ROUTE, cardArtUrl } from "../decks/card-art.js";
import { icon, type IconName } from "../icons.js";
import type { Achievement } from "./achievements.js";

const ID = "achievement-toast";
/** How long each toast stays (its in and out included); the reduced-motion one fades in and out instead. */
export const TOAST_MS = 5200;

const queue: Achievement[] = [];
let showing = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The overlay that holds the toast: made once, kept in the top layer while a toast shows. */
function layer(): HTMLElement {
  let host = document.getElementById(ID);
  if (!host) {
    host = make("div", "achievement-toast-layer");
    host.id = ID;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    if ("popover" in host) host.popover = "manual";
    document.body.append(host);
  }
  return host;
}

/** Into the top layer, above whatever is up now (shown again so it lands on top of a dialog opened since). */
function raise(host: HTMLElement): void {
  if (!("showPopover" in host)) return;
  try {
    if (host.matches(":popover-open")) host.hidePopover();
    host.showPopover();
  } catch {
    // Not in the document, or a browser without popovers: it stays where it is, still fixed on screen.
  }
}

function lower(host: HTMLElement): void {
  try {
    if ("hidePopover" in host && host.matches(":popover-open")) host.hidePopover();
  } catch {
    // Already hidden.
  }
}

/** A card's picture: a villain by its first stage's scan (a villain card has no front of its own), else its front. */
function pictureOf(card: (typeof CORE_CARDS)[number]): string {
  if (card.type === "villain") {
    const image = card.sides[0]?.stages[0]?.image;
    return image ? `${CARD_ART_ROUTE}${String(image).replace(/^\/+/, "")}` : "";
  }
  return cardArtUrl(card);
}

/** The badge: the card the achievement is about, cut to a circle, or its emblem. */
function badge(a: Achievement): HTMLElement {
  const disc = make("span", "achievement-toast-badge");
  disc.dataset.tone = a.symbol.tone;
  const card = a.symbol.cardId ? CORE_CARDS.find((c) => c.id === a.symbol.cardId) : undefined;
  const url = card ? pictureOf(card) : "";
  if (url) {
    const picture = make("span", "achievement-toast-picture");
    picture.style.backgroundImage = `url("${url}")`;
    picture.dataset.kind = card!.type;
    disc.append(picture);
  } else disc.append(icon(a.symbol.icon as IconName));
  // A little trophy pinned to the badge's edge says what this is, whatever the picture.
  const cup = make("span", "achievement-toast-cup");
  cup.append(trophy());
  disc.append(cup, make("span", "achievement-toast-ring"));
  for (let i = 0; i < 10; i++) {
    const spark = make("span", "achievement-toast-spark");
    spark.style.setProperty("--a", `${i * 36 + (i % 2) * 14}deg`);
    spark.style.setProperty("--d", `${46 + (i % 3) * 10}px`);
    disc.append(spark);
  }
  return disc;
}

/** A trophy cup, drawn here (the table's icon set has none). */
function trophy(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M7 3h10v2h3.5v2.2c0 2.6-1.9 4.7-4.4 5A5.6 5.6 0 0 1 13 15v2.4h3.2V21H7.8v-3.6H11V15a5.6 5.6 0 0 1-3.1-2.8c-2.5-.3-4.4-2.4-4.4-5V5H7zM5.3 6.8v.4c0 1.4.9 2.6 2.1 3a8 8 0 0 1-.4-2.3V6.8zm13.4 0H17v1.1a8 8 0 0 1-.4 2.3c1.2-.4 2.1-1.6 2.1-3z",
  );
  svg.append(path);
  return svg;
}

function show(a: Achievement): void {
  const host = layer();
  const toast = make("div", "achievement-toast");
  const text = make("span", "achievement-toast-text");
  const reward = rewardText(a.reward);
  text.append(
    make("span", "achievement-toast-kicker", "Achievement unlocked"),
    make("b", "achievement-toast-name", a.name),
    make("span", "achievement-toast-how", reward ? `${a.how} · ${reward}` : a.how),
  );
  const bar = make("span", "achievement-toast-bar");
  bar.append(text, make("span", "achievement-toast-shine"));
  toast.append(badge(a), bar);
  toast.style.setProperty("--toast-ms", `${TOAST_MS}ms`);
  host.replaceChildren(toast);
  raise(host);
  place(host, toast);
  timer = setTimeout(next, TOAST_MS);
}

/** How far two boxes overlap, top to bottom (0 when they don't). */
const overlap = (a: DOMRect, b: DOMRect) =>
  a.right <= b.left || b.right <= a.left ? 0 : Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** A box grown by `margin` on every side. */
const grown = (r: DOMRect, margin: number) =>
  new DOMRect(r.x - margin, r.y - margin, r.width + 2 * margin, r.height + 2 * margin);

/**
 * At the bottom, unless that would cover the game-over panel's heading ("Victory") or its buttons (Play again, Undo):
 * then at the top, where only the panel's picture can be under it. The heading always wins: where the top would cover
 * it too (a screen too short for either), the place that covers less of it.
 */
function place(host: HTMLElement, toast: HTMLElement): void {
  host.dataset.place = "bottom";
  const panel = document.querySelector<HTMLDialogElement>("dialog#game-over[open]");
  const title = panel?.querySelector("#game-over-title")?.getBoundingClientRect();
  if (!title || !title.height) return;
  const heading = grown(title, 8);
  const actions = panel!.querySelector(".game-over-actions")?.getBoundingClientRect();
  const atBottom = toast.getBoundingClientRect();
  const headingAtBottom = overlap(atBottom, heading);
  if (!headingAtBottom && !(actions && overlap(atBottom, grown(actions, 4)))) return;
  host.dataset.place = "top";
  if (overlap(toast.getBoundingClientRect(), heading) > headingAtBottom) host.dataset.place = "bottom";
}

/** When the game-over panel last opened: the first toast waits for the victory (or defeat) to land first. */
let panelOpenedAt = 0;
/** How long the game-over panel shows on its own before the first toast (its stamp, heading and confetti land). */
export const SETTLE_MS = 2200;

function watchPanel(): void {
  const panel = document.getElementById("game-over");
  if (!(panel instanceof HTMLDialogElement)) return;
  if (panel.open) panelOpenedAt = performance.now();
  new MutationObserver(() => {
    if (panel.open) panelOpenedAt = performance.now();
  }).observe(panel, { attributes: true, attributeFilter: ["open"] });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchPanel, { once: true });
  else watchPanel();
}

/** The wait before the first toast: until the open game-over panel has been up `SETTLE_MS`. */
function settleWait(): number {
  const panel = document.getElementById("game-over");
  if (!(panel instanceof HTMLDialogElement) || !panel.open) return 0;
  return Math.max(0, panelOpenedAt + SETTLE_MS - performance.now());
}

function next(): void {
  const a = queue.shift();
  if (a) {
    show(a);
    return;
  }
  showing = false;
  const host = document.getElementById(ID);
  if (host) {
    host.replaceChildren();
    lower(host);
  }
}

/** The reward in words, from its id (`mat:rhino` → "Unlocks a mat"); drawing the rewards is a later task. */
function rewardText(reward: string): string {
  const kind = reward.split(":")[0];
  return (
    (
      {
        mat: "Unlocks a mat",
        decor: "Unlocks a room piece",
        deckbox: "Unlocks a deck box",
        tokens: "Unlocks token styles",
        silly: "Unlocks something silly",
      } as Record<string, string>
    )[kind ?? ""] ?? ""
  );
}

/** Shows what a game earned, one at a time after any already showing; nothing when it earned nothing. */
export function announceAchievements(earned: readonly Achievement[]): void {
  queue.push(...earned);
  if (!showing && queue.length) {
    showing = true;
    // The game-over panel lands first: "Victory" is seen before any toast.
    const wait = settleWait();
    if (wait) timer = setTimeout(next, wait);
    else next();
  }
}

/** Clears the queue and the toast on screen (a new page state, the tests). */
export function dismissAchievements(): void {
  queue.length = 0;
  clearTimeout(timer);
  next();
}
