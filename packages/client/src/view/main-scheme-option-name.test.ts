import { describe, expect, test } from "vitest";
import { CORE_DEPS, coreScenario } from "@mc/cards";
import { createGame } from "@mc/engine";
import { optionLabelOf } from "./names.js";

/**
 * A choice's option names a main scheme by the stage it is on: Klaw's Underground Distribution turns over to Secret
 * Rendezvous, and a thwart choice offered after that must not keep the stage-1 name the engine's label carries.
 */
describe("optionLabelOf on a main scheme", () => {
  const created = createGame(
    coreScenario("klaw", { seed: 7, players: [{ starterDeckId: "core-spider-man-justice" }] }),
    CORE_DEPS,
  );
  if (!created.ok) throw Error(created.error.message);
  const state = created.state;
  const main = state.mainScheme.instanceId;
  const option = { label: "Underground Distribution", ref: { kind: "card", instanceId: main } };

  test("stage 1 is Underground Distribution", () => {
    expect(optionLabelOf(state, option)).toBe("Underground Distribution");
  });

  test("once it has advanced, the option says Secret Rendezvous", () => {
    const advanced = { ...state, mainScheme: { ...state.mainScheme, stageIndex: 1 } };
    expect(optionLabelOf(advanced, option)).toBe("Secret Rendezvous");
  });
});
