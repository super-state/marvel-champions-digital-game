/**
 * The room over the 3D table page, the table's front door: today the campaign shelf, where the campaigns stand on a
 * wooden table as retail boxes with a cube shelf of other game boxes in the dim room behind.
 *
 * It lies over the table page (`main.ts` loads it when the page opens on the shelf, and again for New game), with its
 * own renderer. Play deals the game on the table underneath, out of sight, then flies every piece from the box to the
 * spot the table drew it on and fades away over the real table. `?open=klaw` jumps straight to an opened box, `&play`
 * presses Play, `&at=1.8` freezes the opening and `&hold=2.4` the move onto the table (for checks and screenshots).
 *
 * The room itself is `room.ts`, the camera `camera.ts`, and each place in the room has its own file in `places/`.
 */
import * as campaign from "./places/campaign.js";
import { play, stepOutro, type ShelfHost } from "./places/campaign-play.js";
import { buildRoom, renderFrame, resize, root } from "./room.js";

export type { ShelfHost } from "./places/campaign-play.js";

let last = performance.now();
let looping = false;
function frame(now: number) {
  if (play.stopped) {
    looping = false;
    return;
  }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  stepOutro(dt);
  if (play.stopped) {
    looping = false;
    return;
  }
  campaign.step(dt);
  campaign.pose(now / 1000, dt);
  campaign.placeHoverTag();
  renderFrame();
  requestAnimationFrame(frame);
}

let built: Promise<void> | null = null;
async function build() {
  buildRoom();
  await campaign.build();
}

/**
 * Puts the shelf up over the table page: the room with every box on the shelf, or, the first time with `?open=rhino`
 * in the address, that box already open. Resolves once the room is drawn.
 */
export async function openShelf(over: ShelfHost): Promise<void> {
  play.host = over;
  root.hidden = false;
  root.style.opacity = "1";
  // The keyboard starts on the shelf (Tab reaches the boxes), not on the table underneath.
  root.focus({ preventScroll: true });
  await (built ??= build());
  campaign.reset();
  resize();
  campaign.openFromAddress();
  campaign.pose(performance.now() / 1000, 0);
  renderFrame();
  play.stopped = false;
  last = performance.now();
  if (!looping) {
    looping = true;
    requestAnimationFrame(frame);
  }
}

/** Whether the shelf is up over the table. */
export const shelfShown = () => !root.hidden;
