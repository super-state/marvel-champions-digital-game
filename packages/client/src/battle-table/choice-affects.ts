/**
 * The cards a "Choose one" question's options would change, so the table can keep them in focus while it is asked
 * (a player's report, 2026-11-26, issue 210: Ultron's "Place 1 threat on the main scheme, or put the top card of your
 * deck into play as a Drone" blurred the main scheme, so its threat couldn't be read while choosing).
 *
 * Read off the engine's own question: the pending choice names its effects frame, whose effect at the cursor is the
 * `chooseOne` being asked; each offered option's effects name their targets, resolved as the engine would resolve
 * them now. Only effects that change a card's numbers or state are read (threat, damage, healing, statuses,
 * counters, exhausting and readying). A target the engine can't resolve yet (a card still to be picked) names
 * nothing, and the table keeps today's focus for it. Nothing here decides anything: it only says what to show.
 */
import type { EffectSpec, EngineDeps, GameState, InstanceId, PendingChoice, TargetRef } from "@mc/engine";
import { resolveRef } from "@mc/engine";

/** Effect kinds that change the card they target in a way its plate or tokens show. */
const CHANGES_ITS_TARGET = new Set<string>([
  "placeThreat",
  "removeThreat",
  "dealDamage",
  "heal",
  "giveStatus",
  "addCounters",
  "removeCounters",
  "exhaust",
  "ready",
]);

/** Every effect inside a spec, in branches, options and nested lists included. */
function collectTargets(value: unknown, into: TargetRef[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectTargets(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as { kind?: unknown; target?: unknown };
  if (typeof node.kind === "string" && CHANGES_ITS_TARGET.has(node.kind) && node.target)
    into.push(node.target as TargetRef);
  for (const child of Object.values(value)) if (child && typeof child === "object") collectTargets(child, into);
}

export function choiceAffects(state: GameState, pending: PendingChoice, deps: EngineDeps): InstanceId[] {
  if (pending.prompt.kind !== "chooseOption" || pending.frameId === null) return [];
  const frame = state.stack.find((candidate) => candidate.frameId === pending.frameId);
  if (!frame || frame.kind !== "effects") return [];
  const effect: EffectSpec | undefined = frame.effects[frame.cursor];
  if (!effect || effect.kind !== "chooseOne") return [];
  const context = {
    selfInstanceId: frame.selfInstanceId,
    controllerId: frame.controllerId,
    event: frame.event,
    bindings: frame.bindings,
    vars: frame.vars,
    deps,
    scopedPlayerId: frame.scopedPlayerId,
  };
  const found = new Set<InstanceId>();
  for (const offered of pending.options) {
    const option = effect.options[Number(offered.optionId)];
    if (!option) continue;
    const targets: TargetRef[] = [];
    collectTargets(option.effects, targets);
    for (const target of targets) {
      try {
        for (const id of resolveRef(state, target, context)) found.add(id);
      } catch {
        // A target that only means something once the effect runs (a card picked on the way): nothing to show yet.
      }
    }
  }
  return [...found];
}
