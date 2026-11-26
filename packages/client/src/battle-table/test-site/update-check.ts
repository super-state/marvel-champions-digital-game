/**
 * A new version reaches a friend after a match, never during one (Adam, 2026-11-26: "it should wait until after they
 * finish a match"). Shipping never touches a game in progress: an open page keeps the code it loaded. So when a match is
 * over and the player goes back to the boxes or plays again, the table asks the site which version is live
 * (`table-version.json`, written into every shipped build by `vite.config.ts`) and, if it isn't this one, starts the
 * page again on it; the What's new pop-up then shows what changed. Only on the test site: Adam's own table has no
 * version and reloads by itself whenever a file changes.
 */

/** The version this page was built as; none on Adam's own table. */
function builtVersion(): string | undefined {
  return import.meta.env.VITE_TABLE_VERSION || undefined;
}

/** Whether the site is serving a different version from this page's, so the page should start again on it. */
export async function newerVersionLive(): Promise<boolean> {
  const built = builtVersion();
  if (!built) return false;
  try {
    const response = await fetch(`/table-version.json?at=${Date.now()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === "string" && version !== built;
  } catch {
    // Offline or the site busy: carry on with this version and ask again after the next match.
    return false;
  }
}

/** The key that keeps a failing reload from looping: at most one in this many milliseconds. */
const RELOADED_KEY = "battle-reloaded-for-version";
const RELOAD_GAP_MS = 60_000;

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GAP_MS) return false;
    sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    // No storage: reload anyway.
  }
  location.reload();
  return true;
}

/**
 * Between matches: starts the page again if a new version is live, and says whether it did (the caller then stops).
 * The page comes back where it would after any reload: the boxes, or the same villain dealt again for Try again.
 */
export async function takeNewVersion(): Promise<boolean> {
  return (await newerVersionLive()) && reloadOnce();
}

// A screen loaded on demand (the deck bench) whose file went with the last version: start the page again on the new
// one rather than leave the screen broken. Vite raises this when such a file fails to load.
if (builtVersion())
  addEventListener("vite:preloadError", (event) => {
    if (reloadOnce()) event.preventDefault();
  });
