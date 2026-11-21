import { describe, expect, test } from "vitest";
import { whileStillThere } from "./beat-order.js";
import type { BattleBeat } from "./model.js";

const beat = (extra: Partial<BattleBeat>) => ({ text: "", enemy: false, ...extra }) as BattleBeat;

describe("beats played while the card is still there", () => {
  test("Highway Robbery's cards come back before it leaves the table", () => {
    const thwart = beat({ text: "Remove 1 threat" });
    const defeated = beat({ defeatedCard: "robbery" });
    const back = beat({ returned: ["genius"], returnedFrom: "robbery" });
    expect(whileStillThere([thwart, defeated, back])).toEqual([thwart, back, defeated]);
  });

  test("a return from elsewhere stays where it is", () => {
    const defeated = beat({ defeatedCard: "robbery" });
    const back = beat({ returned: ["genius"] });
    expect(whileStillThere([defeated, back])).toEqual([defeated, back]);
  });
});
