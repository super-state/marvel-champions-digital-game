import { describe, expect, test } from "vitest";
import { arrangeScene } from "./debug-scenes.js";
import { BattleModel } from "./model.js";
import { KNOWN_PLAIN, QUESTION_HANDLING, plainQuestion, tagsQuestion } from "./question-check.js";

/** Up to Masters of Mayhem's search: discard down, pass Spider-Sense, don't defend (as model.test.ts does). */
function toTheSearch() {
  const battle = new BattleModel();
  battle.reset({ seed: 7, villain: "klaw", arrange: arrangeScene("klawsearch")! });
  battle.endTurn();
  for (let i = 0; i < 12 && !battle.snapshot().choice?.searched; i++) {
    const choice = battle.snapshot().choice;
    if (!choice) break;
    if (choice.offers?.length) battle.chooseMany([]);
    else if (choice.discardFromHand) battle.chooseMany(choice.options.slice(0, choice.min).map((o) => o.id));
    else battle.choose(choice.options.find((o) => !o.cardId)?.id ?? null);
  }
  return battle;
}

describe("the question tripwire (question-check.ts)", () => {
  test("Masters of Mayhem's search is designed; without its panel it is caught as cards off the table", () => {
    const battle = toTheSearch();
    const snapshot = battle.snapshot();
    expect(snapshot.choice?.searched?.length).toBe(4);
    expect(plainQuestion(snapshot, battle.game)).toBeNull();
    // The bug Adam met: the same question with only names to go on.
    const { searched, ...namesOnly } = snapshot.choice!;
    expect(searched).toBeDefined();
    const plain = { ...snapshot, choice: namesOnly };
    expect(plainQuestion(plain, battle.game)?.key).toBe("chooseCards: cards off the table");
  });

  test("a pick of cards on the table is the table's own way of asking: not caught", () => {
    const battle = new BattleModel();
    battle.reset({ seed: 7, arrange: arrangeScene("guard")! });
    battle.heroAction("basicAttack");
    const snapshot = battle.snapshot();
    // The guard pick is the table's own, picked on the table: not caught.
    expect(plainQuestion(snapshot, battle.game)).toBeNull();
  });

  test("an unhandled kind can never be listed as known", () => {
    for (const key of Object.keys(KNOWN_PLAIN)) {
      const kind = key.split(":")[0] as keyof typeof QUESTION_HANDLING;
      expect(QUESTION_HANDLING[kind], key).toBeDefined();
      expect(QUESTION_HANDLING[kind], key).not.toBe("unhandled");
      expect(key.endsWith(": unhandled"), key).toBe(false);
    }
  });

  test("an accepted plain question wears no tag on the dev table; one waiting for a design still does", () => {
    const plain = (key: string) => ({ key, kind: key.split(":")[0]!, why: "buttons only" as const, asker: "?" });
    expect(tagsQuestion(plain("chooseOption: buttons only"))).toBe(false);
    expect(tagsQuestion(plain("orderSpecials: cards as name buttons"))).toBe(true);
    expect(tagsQuestion(plain("chooseNumber: buttons only"))).toBe(true);
    expect(tagsQuestion(null)).toBe(false);
  });
});
