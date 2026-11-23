import { describe, expect, it } from "vitest";
import { formOnlyNote, statusWarning } from "./play.js";

describe("play hook: where a form-only card is", () => {
  const webShooter = "Hero Resource: Exhaust Web-Shooter and remove 1 web counter from it → generate a wild resource.";
  it("a card that stays in play with a form-only ability can still be played in the other form", () => {
    expect(formOnlyNote(webShooter, "alterEgo", "cardInHand")).toBe(
      "its ability is hero form only; the card can still be played now",
    );
  });
  it("a card marked 'Hero form only' stays in the hand in the other form", () => {
    expect(formOnlyNote("Hero form only. Attach to an enemy.", "alterEgo", "cardInHand")).toBe(
      "hero form only: not usable now, except to pay with",
    );
  });
  it("a card in play is not offered as payment", () => {
    expect(formOnlyNote("Alter-Ego Action: Exhaust Aunt May → heal 4 damage.", "hero", "inPlay")).toBe(
      "alter-ego form only: not usable now",
    );
  });
});

describe("play hook: moves a status will cancel", () => {
  it("warns on an attack while stunned and a thwart while confused, and nothing else", () => {
    expect(statusWarning(new Set(["stunned"]), "attack")).toBe("stunned: this only discards the stun");
    expect(statusWarning(new Set(["confused"]), "thwart")).toBe("confused: this only discards the confusion");
    expect(statusWarning(new Set(["stunned"]), "thwart")).toBe(null);
    expect(statusWarning(new Set(["confused"]), "attack")).toBe(null);
    expect(statusWarning(new Set(), "attack")).toBe(null);
  });
});

describe("play hook: cards that work in one form only", () => {
  it("marks a Hero Interrupt as hero form only, and unusable while in alter-ego form", () => {
    const text =
      "Hero Interrupt: When any amount of threat would be placed on a scheme, you take it as damage instead.";
    expect(formOnlyNote(text, "hero")).toBe("hero form only");
    expect(formOnlyNote(text, "alterEgo")).toBe("hero form only: not usable now, except to pay with");
  });

  it("reads Hero Action, Hero Resource and 'Hero form only' the same way", () => {
    for (const text of [
      "Hero Action (attack): Deal 8 damage to an enemy.",
      "Hero Resource: Exhaust Web-Shooter and remove 1 web counter from it → generate a wild resource.",
      "Hero form only. Attach to an enemy.",
    ])
      expect(formOnlyNote(text, "alterEgo")).toBe("hero form only: not usable now, except to pay with");
  });

  it("marks an Alter-Ego Action as alter-ego form only", () => {
    const text = "Alter-Ego Action: Exhaust Aunt May → heal 4 damage from Peter Parker.";
    expect(formOnlyNote(text, "alterEgo")).toBe("alter-ego form only");
    expect(formOnlyNote(text, "hero")).toBe("alter-ego form only: not usable now, except to pay with");
  });

  it("says nothing for a card that works in either form", () => {
    expect(formOnlyNote("Interrupt (thwart): When the villain schemes, reduce the threat by 1.", "alterEgo")).toBe(
      null,
    );
    expect(formOnlyNote("Action: Heal 2 damage from any character.", "hero")).toBe(null);
  });
});
