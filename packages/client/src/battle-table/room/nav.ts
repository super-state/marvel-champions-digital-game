/**
 * Going to another place from inside one (Campaign's play flow sends the camera to the hero shelf and back): the room's
 * own `go` (`index.ts`), handed over when the room loads, so the places don't import the room's front door.
 */
import type { PlaceId } from "./places/place.js";

let go: ((id: PlaceId) => void) | null = null;

/** The room hands over its `go` (`index.ts`). */
export function setGo(fn: (id: PlaceId) => void) {
  go = fn;
}

/** Sends the camera to a place, as the menu does. */
export function goTo(id: PlaceId) {
  go?.(id);
}
