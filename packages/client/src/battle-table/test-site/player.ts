/**
 * The player on the test site, in the page: who they are, the villains they have unlocked, saving each finished game,
 * and their record. The server side is players.ts and site-api.ts.
 *
 * Only builds made by `pnpm table:ship` (the ones carrying `VITE_TABLE_VERSION`) ask the site who is playing. Adam's
 * own dev table and the browser tests never do: there, nothing is saved and every villain is open.
 *
 * - First open from the shared invite link: "What's your name?". That makes them a player, with their own link.
 * - On a phone: the table is built for a laptop or a bigger screen, so it offers to email the link to themselves.
 * - The shelf seals a villain that isn't unlocked yet ("Beat Rhino to unlock").
 * - Each finished game is sent once; an ending undone and played out again updates the same game.
 * - The game-over dialog says how they stand against that villain, and when a villain has just unlocked.
 * - "My record" in the menu: their wins and losses overall, per villain and per hero, their latest games, their link.
 */
import "./player.css";

export interface Profile {
  saving: boolean;
  needsName: boolean;
  name: string | null;
  link: string | null;
  unlocked: string[];
  admin: boolean;
}

interface Tally {
  played: number;
  won: number;
  lost: number;
}
interface PlayerRecord {
  name: string;
  link: string;
  total: Tally;
  byVillain: { villain: string; name: string; tally: Tally }[];
  byHero: { hero: string; tally: Tally }[];
  recent: {
    when: number;
    hero: string;
    villain: string;
    result: "win" | "loss";
    reason: string;
    rounds: number;
    version: string;
    minutes: number;
  }[];
}

const VERSION: string | undefined = import.meta.env.VITE_TABLE_VERSION;
const CHAIN = ["rhino", "klaw", "ultron"] as const;
const NAMES: Record<string, string> = { rhino: "Rhino", klaw: "Klaw", ultron: "Ultron" };
const REASONS: Record<string, string> = {
  villainDefeated: "Villain beaten",
  mainSchemeCompleted: "Scheme completed",
  allPlayersDefeated: "Hero knocked out",
};

let profile: Profile | null = null;
/** The unlocks the shelf was drawn with: when they change, the shelf has to be drawn again. */
let shelfDrawnWith: string | null = null;

async function getJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("application/json")) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const postJson = <T>(path: string, body: unknown) =>
  getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function make<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function dialog(id: string): HTMLDialogElement {
  document.getElementById(id)?.remove();
  const d = make("dialog", "player-dialog");
  d.id = id;
  document.body.append(d);
  return d;
}

/** Asks the name of someone in on the shared invite link, and makes them a player. */
function askName(): Promise<void> {
  return new Promise((resolve) => {
    const d = dialog("player-name");
    const form = make("form");
    form.method = "dialog";
    const input = make("input");
    Object.assign(input, { type: "text", name: "name", maxLength: 40, required: true, autocomplete: "given-name" });
    input.placeholder = "Your name";
    const error = make("p", "player-error");
    error.hidden = true;
    const go = make("button", "btn btn-primary", "Let's play");
    go.type = "submit";
    form.append(
      make("p", "eyebrow", "Marvel Champions"),
      make("h2", "", "What's your name?"),
      make(
        "p",
        "player-note",
        "The table keeps a record of your games (who you played, who won, how) so you can unlock the next villain and see how you're doing.",
      ),
      input,
      error,
      go,
    );
    d.append(form);
    // It can't be waved away: the name is how the games are kept.
    d.addEventListener("cancel", (event) => event.preventDefault());
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      go.disabled = true;
      const me = await postJson<Profile>("/api/me", { name });
      go.disabled = false;
      if (!me) {
        error.textContent = "That didn't save. Check the connection and try again.";
        error.hidden = false;
        return;
      }
      profile = me;
      d.close();
      d.remove();
      resolve();
    });
    d.showModal();
    input.focus();
  });
}

const mailto = (link: string) =>
  `mailto:?subject=${encodeURIComponent("Marvel Champions: my link")}&body=${encodeURIComponent(
    `Open this on a laptop or computer to play. It's your login, so keep it to yourself:\n\n${link}\n`,
  )}`;

/**
 * Copies text. Some browsers refuse the clipboard API (Surf did, 2026-11-24): then the old copy command; false when
 * neither works, and the caller shows the link to copy by hand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Falls through to the old way.
  }
  const area = make("textarea");
  area.value = text;
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  // Inside the open dialog, or the page's inert backdrop would keep it from being selected.
  (document.querySelector("dialog[open]") ?? document.body).append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function linkActions(link: string): HTMLElement {
  const row = make("div", "player-link-actions");
  const copy = make("button", "btn btn-secondary", "Copy link");
  copy.type = "button";
  copy.onclick = async () => {
    if (await copyText(link)) copy.textContent = "Copied";
    else {
      window.prompt("Copy this link:", link);
      return;
    }
    setTimeout(() => (copy.textContent = "Copy link"), 1600);
  };
  const mail = make("a", "btn btn-secondary", "Email it to me");
  mail.href = mailto(link);
  row.append(copy, mail);
  return row;
}

/** A phone: the table is built for a laptop or a big screen, so it offers to send the link there. */
function onPhone(): boolean {
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 700;
}

function laptopNotice(link: string): Promise<void> {
  return new Promise((resolve) => {
    const d = dialog("player-laptop");
    const anyway = make("button", "btn btn-ghost", "Play here anyway");
    anyway.type = "button";
    anyway.onclick = () => d.close();
    d.addEventListener("close", () => {
      d.remove();
      resolve();
    });
    d.append(
      make("p", "eyebrow", "Marvel Champions"),
      make("h2", "", "Best on a laptop"),
      make(
        "p",
        "player-note",
        "This table is made for a laptop or a bigger screen. Send yourself your link and open it there: it's your login, so your games and unlocks come with you.",
      ),
      linkActions(link),
      anyway,
    );
    d.showModal();
  });
}

async function load(): Promise<Profile | null> {
  if (!VERSION) return null;
  profile = await getJson<Profile>("/api/me");
  if (!profile?.saving) return profile;
  if (profile.needsName) await askName();
  if (profile.link && onPhone()) await laptopNotice(profile.link);
  return profile;
}

/** Who is playing; settles before the shelf is drawn (null off the test site: nothing saved, nothing locked). */
export const playerReady: Promise<Profile | null> = load();

const unlockKey = () => (profile?.saving ? profile.unlocked.join(",") : "all");

/** Why a villain's box is sealed ("Beat Rhino to unlock"), or null when it is open. */
export function lockReason(villain: string): string | null {
  if (!profile?.saving || profile.unlocked.includes(villain)) return null;
  const at = CHAIN.indexOf(villain as (typeof CHAIN)[number]);
  return at > 0 ? `Beat ${NAMES[CHAIN[at - 1]!]} to unlock` : "Locked";
}

/** The shelf is being drawn with the unlocks as they are now. */
export function shelfDrawn(): void {
  shelfDrawnWith = unlockKey();
}

/** A villain has unlocked since the shelf was drawn: it has to be drawn again to show it. */
export function shelfStale(): boolean {
  return shelfDrawnWith !== null && shelfDrawnWith !== unlockKey();
}

export interface GameHandle {
  id: string;
  villain: string;
  startedAt: number;
  /** The ending last sent, so the same ending isn't sent twice. */
  sent: string | null;
}

/** A newly dealt game, to be saved when it ends; null when nothing is being saved. */
export function startGame(villain: string): GameHandle | null {
  // The last game's line under the game-over text goes with it.
  document.getElementById("game-over-record")?.remove();
  if (!profile?.saving || !profile.name) return null;
  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id, villain, startedAt: Date.now(), sent: null };
}

interface Saved {
  saved: boolean;
  unlocked?: string[];
  newlyUnlocked?: string[];
  versus?: { won: number; lost: number };
}

/**
 * Saves the game's ending and puts a line under the game-over dialog's text: how they stand against this villain,
 * and a villain that has just unlocked.
 */
export async function finishGame(
  game: GameHandle | null,
  outcome: { result: "win" | "loss"; reason: string; rounds: number; hero: string; deck: string[] },
): Promise<void> {
  if (!game) return;
  const ending = `${outcome.result}/${outcome.reason}/${outcome.rounds}`;
  if (game.sent === ending) return;
  game.sent = ending;
  const saved = await postJson<Saved>("/api/games", {
    id: game.id,
    villain: game.villain,
    startedAt: game.startedAt,
    version: VERSION,
    ...outcome,
  });
  const line = document.getElementById("game-over-record") ?? make("p", "outcome-record");
  line.id = "game-over-record";
  document.getElementById("game-over-detail")?.after(line);
  if (!saved?.saved) {
    game.sent = null;
    line.textContent = "This game couldn't be saved to your record.";
    return;
  }
  if (profile && saved.unlocked) profile.unlocked = saved.unlocked;
  const name = NAMES[game.villain] ?? game.villain;
  const v = saved.versus ?? { won: 0, lost: 0 };
  line.replaceChildren(`You against ${name}: ${v.won} won, ${v.lost} lost.`);
  for (const villain of saved.newlyUnlocked ?? []) {
    const news = make("strong", "outcome-unlocked", `${villain} is unlocked!`);
    // Try again deals the same villain: this goes back to the shelf, drawn with the new one open.
    const go = make("button", "btn btn-secondary outcome-unlock-go", `Play ${villain}`);
    go.type = "button";
    go.onclick = () => {
      (document.getElementById("game-over") as HTMLDialogElement | null)?.close();
      document.getElementById("reset")?.click();
    };
    line.append(make("br"), news, go);
  }
}

const pct = (t: Tally) => (t.played ? `${Math.round((t.won / t.played) * 100)}%` : "–");
const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function table(head: string[], rows: (string | HTMLElement)[][]): HTMLTableElement {
  const t = make("table", "player-table");
  const tr = make("tr");
  for (const h of head) tr.append(make("th", "", h));
  t.append(tr);
  for (const row of rows) {
    const r = make("tr");
    for (const cell of row) {
      const td = make("td");
      td.append(cell);
      r.append(td);
    }
    t.append(r);
  }
  return t;
}

/** Opens "My record". */
export async function openRecord(): Promise<void> {
  const d = dialog("player-record");
  d.classList.add("player-record");
  const close = make("button", "btn btn-primary", "Close");
  close.type = "button";
  close.onclick = () => d.close();
  d.addEventListener("close", () => d.remove());
  d.append(make("p", "eyebrow", "Your record"), make("p", "player-note", "Loading…"));
  d.showModal();

  const record = await getJson<PlayerRecord>("/api/record");
  d.replaceChildren(make("p", "eyebrow", "Your record"), make("h2", "", record?.name ?? "Your record"));
  if (!record) {
    d.append(make("p", "player-note", "Your record couldn't be loaded just now."), close);
    return;
  }
  const stats = make("div", "player-stats");
  for (const [label, value] of [
    ["Played", String(record.total.played)],
    ["Won", String(record.total.won)],
    ["Lost", String(record.total.lost)],
    ["Win rate", pct(record.total)],
  ] as const) {
    const box = make("div", "player-stat");
    box.append(make("b", "", value), make("span", "", label));
    stats.append(box);
  }
  d.append(stats);

  const villains = CHAIN.map((id) => {
    const row = record.byVillain.find((v) => v.villain === id);
    const t = row?.tally ?? { played: 0, won: 0, lost: 0 };
    const lock = lockReason(id);
    return [NAMES[id]!, lock ?? String(t.won), lock ? "" : String(t.lost), lock ? "" : pct(t)];
  });
  d.append(make("h3", "", "Against each villain"), table(["Villain", "Won", "Lost", "Win rate"], villains));
  if (record.byHero.length)
    d.append(
      make("h3", "", "As each hero"),
      table(
        ["Hero", "Won", "Lost", "Win rate"],
        record.byHero.map((h) => [h.hero, String(h.tally.won), String(h.tally.lost), pct(h.tally)]),
      ),
    );
  d.append(make("h3", "", "Latest games"));
  if (record.recent.length) {
    d.append(
      table(
        ["When", "Game", "Result", "How", "Rounds", "Time"],
        record.recent.map((g) => {
          const result = make("span", g.result === "win" ? "won" : "lost", g.result === "win" ? "Won" : "Lost");
          return [
            when(g.when),
            `${g.hero} vs ${g.villain}`,
            result,
            REASONS[g.reason] ?? g.reason,
            String(g.rounds),
            `${g.minutes} min`,
          ];
        }),
      ),
    );
  } else d.append(make("p", "player-note", "No games yet: finish one and it shows up here."));

  d.append(
    make("h3", "", "Your link"),
    make(
      "p",
      "player-note",
      "It's your login on any computer: open it there and your games and unlocks come with you.",
    ),
    linkActions(record.link),
    close,
  );
}

/** Adds "My record" to the game menu, for a player on the test site. */
export function addRecordButton(menuActions: Element | null, beforeOpen?: () => void): void {
  if (!menuActions || !profile?.saving || !profile.name || document.getElementById("menu-record")) return;
  const button = make("button", "btn btn-secondary", "My record");
  button.type = "button";
  button.id = "menu-record";
  button.onclick = () => {
    beforeOpen?.();
    void openRecord();
  };
  menuActions.append(button);
}
