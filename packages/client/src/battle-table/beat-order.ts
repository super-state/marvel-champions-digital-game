import type { BattleSnapshot } from "./model.js";

type Beat = BattleSnapshot["beats"][number];

/**
 * Cards coming back from under a card as it leaves play (Highway Robbery's "When Defeated: return each facedown card
 * here to its owner's hand") are shown sliding out from under it while it is still on the table, so the return plays
 * just before the card goes rather than after, when there is nothing left to come out from under.
 */
export function whileStillThere(beats: readonly Beat[]): Beat[] {
  const out = [...beats];
  for (let index = 0; index < out.length; index++) {
    const leaving = out[index]!.defeatedCard ?? out[index]!.leftPlay;
    if (!leaving) continue;
    const back = out.findIndex((beat, later) => later > index && beat.returnedFrom === leaving);
    if (back < 0) continue;
    const [returned] = out.splice(back, 1);
    out.splice(index, 0, returned!);
    index++;
  }
  return out;
}
