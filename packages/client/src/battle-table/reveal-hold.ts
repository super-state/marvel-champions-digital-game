import type { BattleSnapshot } from "./model.js";

/** A reaction the player chose in a window: the card played, what the window was about, and what kind it was. */
export interface Reaction {
  readonly card: string;
  readonly subject: string;
  readonly kind: string;
  readonly amount: number;
}

type HoldState = Pick<BattleSnapshot, "choice" | "choiceSource" | "payment" | "beats">;

/**
 * The window that holds a revealed encounter card up is about its reveal (a card like Enhanced Spider-Sense can
 * interrupt it): the question is up, or the reaction chosen in it is still being paid for or played out.
 */
export function revealWindowFor(state: HoldState, reacting: Reaction | null, id: string): boolean {
  const event = state.choice?.event;
  if (event?.kind === "encounterCardRevealing" && event.subject === id) return true;
  return reacting?.subject === id && (!!state.payment || state.beats.some((beat) => beat.interrupt === reacting.card));
}

/**
 * A revealed encounter card stays up, full size, while anything is about it: its own question, or a window about
 * its reveal (`revealWindowFor`).
 */
export function holdsEncounter(state: HoldState, reacting: Reaction | null, id: string): boolean {
  if (state.choice?.sourceTitle && state.choiceSource === id) return true;
  return revealWindowFor(state, reacting, id);
}
