/**
 * What is open to choose. Friends on the test site unlock by playing: a villain opens when the one before it is
 * beaten (`test-site/players.ts` `unlockedFrom`), a mat when its achievement is earned. Adam's own table (the dev
 * server, not a shipped build) has everything open (the room plan's call 4), so he can try anything at once.
 *
 * The override is at the gate only: it decides what can be chosen, never what is recorded. Achievements still show as
 * earned or not from his real games, and nothing is written into a saved game.
 *
 * Adam can look at his table as a friend would (Settings at the radio, or `?friend=1` in the address), so the locks
 * can be checked without shipping: then his villains and mats lock by his own record, the way a friend's do by theirs.
 */
import { unlockedFrom } from "./test-site/players.js";
import type { FinishedGame } from "./record/game.js";

const VERSION: string | undefined = import.meta.env.VITE_TABLE_VERSION;
const FRIEND_KEY = "battle-see-as-friend";

/** Whether this is a shipped build on the test site (where friends play and the locks always hold). */
export const onTestSite = () => !!VERSION;

/** Adam looking at his own table as a friend would: `?friend=1` (`?friend=0` turns it off), or the Settings switch. */
export function seeingAsFriend(): boolean {
  if (onTestSite()) return false;
  const asked = new URLSearchParams(location.search).get("friend");
  if (asked !== null) return asked !== "0";
  try {
    return localStorage.getItem(FRIEND_KEY) === "1";
  } catch {
    return false;
  }
}

/** The Settings switch: remembered on this device. */
export function seeAsFriend(on: boolean): void {
  try {
    if (on) localStorage.setItem(FRIEND_KEY, "1");
    else localStorage.removeItem(FRIEND_KEY);
  } catch {
    // Private windows may refuse storage: `?friend=1` still works.
  }
}

/** Everything open to choose: Adam's own table, unless he is looking at it as a friend would. */
export const allOpen = (): boolean => !onTestSite() && !seeingAsFriend();

const CHAIN = ["rhino", "klaw", "ultron"] as const;
const NAMES: Record<string, string> = { rhino: "Rhino", klaw: "Klaw", ultron: "Ultron" };

/**
 * Adam's villain locks when he looks at his table as a friend: worked out from his own record the way the test site
 * works out a friend's. Null when nothing is locked this way (everything open, or the test site, whose locks come from
 * the site itself).
 */
export function friendLocks(games: readonly FinishedGame[] | null): ((villain: string) => string | null) | null {
  if (!seeingAsFriend()) return null;
  const open = new Set(unlockedFrom(games ?? []));
  return (villain) => {
    if (open.has(villain)) return null;
    const at = CHAIN.indexOf(villain as (typeof CHAIN)[number]);
    return at > 0 ? `Beat ${NAMES[CHAIN[at - 1]!]} to unlock` : "Locked";
  };
}
