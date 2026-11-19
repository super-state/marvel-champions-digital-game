import { describe, expect, test } from "vitest";
import type { BattleChoice } from "./model.js";
import { eventLook, offerDoes, spotOf, type SpotTable } from "./spotlight.js";

const table: SpotTable = {
  hero: { id: "spider-man" },
  inPlay: [{ id: "mockingbird" }],
  enemyCards: [
    { id: "break-in", attachedTo: null },
    { id: "ivory-horn", attachedTo: "rhino" },
    { id: "hydra-mercenary", attachedTo: null },
  ],
  facedownBoosts: [{ id: "sandman", enemy: "rhino" }],
};

function choice(part: Partial<BattleChoice>): BattleChoice {
  return {
    prompt: "",
    options: [],
    canSkip: false,
    canCancel: false,
    min: 1,
    max: 1,
    discardFromHand: false,
    mulligan: false,
    ...part,
  };
}

const at = { offerIndex: 0, choosingDefender: false, heldEncounter: null };

describe("offerDoes", () => {
  test("drops the 'Use <card> to' the button already says", () => {
    expect(offerDoes("Use Spider-Sense to draw 1 card")).toBe("draw 1 card");
    expect(offerDoes("Use Mockingbird to stun an enemy.")).toBe("stun an enemy");
    expect(offerDoes('Use Enhanced Spider-Sense to cancel its "When Revealed" effects')).toBe(
      'cancel its "When Revealed" effects',
    );
  });

  test("reads Great Responsibility's 'you take it' as an instruction", () => {
    expect(offerDoes("Use Great Responsibility to you take it as damage instead")).toBe("take it as damage instead");
  });

  test("takes the instruction out of a line given whole, past its trigger and condition", () => {
    // The lines this deck's interrupts read as (Backflip, Emergency), and an "it" that is not the instruction.
    expect(
      offerDoes(
        "Use Backflip: Interrupt (defense): When you would take any amount of damage from an attack, prevent all of that damage",
      ),
    ).toBe("prevent all of that damage");
    expect(
      offerDoes(
        "Use Emergency: Interrupt (thwart): When the villain schemes, reduce the amount of threat placed on the scheme by 1",
      ),
    ).toBe("reduce the amount of threat placed on the scheme by 1");
    expect(offerDoes("Use Foo: Interrupt (defense): When an enemy attacks you, deal 1 damage to it")).toBe(
      "deal 1 damage to it",
    );
    expect(offerDoes("Use Aunt May: Draw a card")).toBe("Draw a card");
  });

  test("keeps a line it cannot read", () => {
    expect(offerDoes("Use Foo")).toBe("Use Foo");
  });
});

describe("spotOf: the defend question", () => {
  const defense = choice({
    prompt: "Choose a defender",
    defense: { attacker: "Rhino", attackerId: "rhino", target: "spider-man" },
    options: [
      { id: "hero", label: "Defend", cardId: "spider-man" },
      { id: "ally", label: "Defend", cardId: "mockingbird" },
      { id: "decline", label: "Don't defend", cardId: null },
    ],
  });

  test("darkens all but the attacker, glowing red, with its attachment and its facedown boost card", () => {
    expect(spotOf(defense, table, at)).toEqual({
      glow: [{ id: "rhino", tone: "attack" }],
      cutouts: ["rhino", "ivory-horn", "sandman"],
    });
  });

  test("lets the defenders through once the player is choosing one", () => {
    expect(spotOf(defense, table, { ...at, choosingDefender: true })?.cutouts).toEqual([
      "rhino",
      "ivory-horn",
      "sandman",
      "spider-man",
      "mockingbird",
    ]);
  });
});

describe("spotOf: reaction windows", () => {
  const offer = (event: NonNullable<BattleChoice["event"]>, cardId = "great-responsibility") =>
    choice({
      prompt: "",
      event,
      offers: [{ id: "use", cardId, question: "Interrupt with Great Responsibility?", effect: null }],
    });

  test("an interrupt on the threat step glows the scheme orange with its +1 waiting, and the card that could answer gold", () => {
    const spot = spotOf(offer({ kind: "placeThreat", subject: "break-in", amount: 1, before: true }), table, at);
    expect(spot).toEqual({
      glow: [
        { id: "break-in", tone: "threat" },
        { id: "great-responsibility", tone: "ability" },
      ],
      cutouts: ["break-in", "great-responsibility"],
      mark: { id: "break-in", kind: "threat", amount: 1 },
    });
  });

  test("a response after the threat landed pins no amount", () => {
    const spot = spotOf(offer({ kind: "placeThreat", subject: "break-in", amount: 1, before: false }), table, at);
    expect(spot?.mark).toBeNull();
  });

  test("damage about to hit the hero (Backflip) glows the hero red with the damage waiting", () => {
    const spot = spotOf(
      offer({ kind: "dealDamage", subject: "spider-man", amount: 3, before: true }, "backflip"),
      table,
      at,
    );
    expect(spot?.glow[0]).toEqual({ id: "spider-man", tone: "attack" });
    expect(spot?.mark).toEqual({ id: "spider-man", kind: "damage", amount: 3 });
  });

  test("an attack's boost cards stand out with the attacker (Spider-Sense on the hero)", () => {
    const spot = spotOf(
      offer({ kind: "enemyAttack", subject: "rhino", amount: null, before: true }, "spider-man"),
      table,
      at,
    );
    expect(spot?.glow).toEqual([
      { id: "rhino", tone: "attack" },
      { id: "spider-man", tone: "ability" },
    ]);
    expect(spot?.cutouts).toEqual(["rhino", "spider-man", "sandman"]);
    expect(spot?.mark).toBeNull();
  });

  test("the offer being asked about is the one spotlit, and a held encounter card stays visible", () => {
    const two = choice({
      prompt: "",
      offers: [
        { id: "a", cardId: "first", question: "Respond with First?", effect: null },
        { id: "b", cardId: "second", question: "Respond with Second?", effect: null },
      ],
    });
    expect(spotOf(two, table, { ...at, offerIndex: 1, heldEncounter: "treachery" })?.cutouts).toEqual([
      "second",
      "treachery",
    ]);
  });

  test("an ordinary pick spotlights nothing", () => {
    expect(spotOf(choice({ prompt: "Choose an enemy to attack" }), table, at)).toBeNull();
    expect(spotOf(null, table, at)).toBeNull();
  });
});

describe("eventLook", () => {
  test("damage reads red on the hero's side and gold on an enemy", () => {
    const base = { kind: "dealDamage", amount: 2, before: true };
    expect(eventLook({ ...base, subject: "mockingbird" }, table).glow).toBe("attack");
    expect(eventLook({ ...base, subject: "hydra-mercenary" }, table).glow).toBe("ability");
  });

  test("a scheme taking threat, or an enemy scheming, reads orange", () => {
    expect(eventLook({ kind: "placeThreat", subject: "break-in", amount: 1, before: true }, table)).toEqual({
      icon: "threat",
      glow: "threat",
    });
    expect(eventLook({ kind: "enemyScheme", subject: "rhino", amount: null, before: true }, table).glow).toBe("threat");
  });
});
