/**
 * Card pictures that fail to load get asked for again, a few times, a little later each time. One dropped request
 * (the server briefly unable to open the file, a network blip) used to leave a card black on the table and its preview
 * broken for the rest of the game, because nothing ever asked again.
 */

/** How long to wait before each further try, in order; after the last one the picture is given up on. */
export const PICTURE_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 8_000, 20_000];

const RETRY_PARAM = "retry";

/**
 * `url` marked as try number `attempt` (0 is the plain URL), so the browser doesn't hand back the failure it already
 * has for the same address. The servers ignore the query. Data and blob URLs can't take one and are retried as they are.
 */
export function retryUrl(url: string, attempt: number): string {
  if (attempt <= 0 || /^(data|blob):/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${RETRY_PARAM}=${attempt}`;
}

/** `url` without a `retryUrl` mark: the picture it is a try of. */
export function pictureOf(url: string): string {
  return url.replace(new RegExp(`[?&]${RETRY_PARAM}=\\d+$`), "");
}

/**
 * Loads `url` with `load`, trying again after each `PICTURE_RETRY_DELAYS_MS` step while it fails. `alive` is asked
 * before each further try, so a picture nobody shows any more isn't fetched again.
 */
export function loadWithRetry(
  url: string,
  load: (url: string, onError: () => void) => void,
  alive: () => boolean = () => true,
): void {
  const attempt = (n: number) =>
    load(retryUrl(url, n), () => {
      const wait = PICTURE_RETRY_DELAYS_MS[n];
      if (wait === undefined) return;
      setTimeout(() => {
        if (alive()) attempt(n + 1);
      }, wait);
    });
  attempt(0);
}

const tries = new WeakMap<HTMLImageElement, { picture: string; attempt: number }>();

/**
 * Makes an `<img>` that shows card pictures ask again when its picture fails, the same way the table's cards do. Its
 * `src` attribute then carries a `retryUrl` mark; a caller setting the plain URL again just starts the tries over.
 */
export function retryFailedPictures(image: HTMLImageElement): void {
  image.addEventListener("error", () => {
    const src = image.getAttribute("src");
    if (!src) return;
    const picture = pictureOf(src);
    const last = tries.get(image);
    const attempt = last?.picture === picture ? last.attempt : 0;
    const wait = PICTURE_RETRY_DELAYS_MS[attempt];
    if (wait === undefined) return;
    tries.set(image, { picture, attempt: attempt + 1 });
    setTimeout(() => {
      // Still showing the same picture (not moved on to another card, not hidden by a caller clearing it).
      const now = image.getAttribute("src");
      if (now && pictureOf(now) === picture) image.src = retryUrl(picture, attempt + 1);
    }, wait);
  });
  image.addEventListener("load", () => {
    const src = image.getAttribute("src");
    if (src && tries.get(image)?.picture === pictureOf(src)) tries.delete(image);
  });
}
