import { describe, expect, it } from "vitest";
import { BattleModel } from "../model.js";
import { momentOf, type PageFacts } from "./capture.js";
import { issueBody, issueTitle } from "./issue.js";
import { cleanText, parseReport, REPORT_LIMIT, TEXT_LIMIT, type ReportRecord } from "./moment.js";
import { reportBody } from "./report.js";

const page = {
  innerWidth: 1440,
  innerHeight: 900,
  devicePixelRatio: 2,
  location: { pathname: "/battle/" },
  navigator: { userAgent: "test browser" },
} as unknown as PageFacts;

function dealt() {
  const model = new BattleModel();
  model.reset({ seed: 75 });
  return model;
}

function momentOfModel(model: BattleModel, story: string[] = ["Spider-Man plays Backflip"]) {
  return momentOf(
    {
      snapshot: model.snapshot(),
      state: model.engineState,
      inGame: true,
      hero: "Spider-Man",
      villain: "Rhino",
      difficulty: model.encounter.difficulty,
      modules: ["Bomb Scare"],
      seed: model.seed,
      story,
      asking: "Your turn",
      version: null,
    },
    page,
    "mouse",
  );
}

const record = (text: string, extra: Partial<ReportRecord> = {}): ReportRecord => {
  const moment = momentOfModel(dealt());
  return { id: "r-test", from: "Sam", at: Date.UTC(2026, 10, 25, 12), text, moment, ...extra };
};

describe("the moment a report keeps", () => {
  it("reads the table in words, with the deal and the engine state to load it again", () => {
    const model = dealt();
    const moment = momentOfModel(model);
    expect(moment).toMatchObject({ hero: "Spider-Man", villain: "Rhino", seed: 75, round: 1, input: "mouse" });
    expect(moment.hand.length).toBe(model.snapshot().hand.length);
    expect(moment.hand.every((name) => typeof name === "string" && name.length > 0)).toBe(true);
    expect(moment.enemies.some((card) => /threat/.test(card))).toBe(true);
    expect(moment.screen).toEqual({ width: 1440, height: 900, pixelRatio: 2 });
    expect(moment.state).toBe(model.engineState);
  });

  it("survives the trip as JSON and back through the site's reading", () => {
    const moment = momentOfModel(dealt());
    const back = parseReport(JSON.parse(JSON.stringify({ text: " It broke ", moment })))!;
    expect(back.text).toBe("It broke");
    const { state, ...words } = moment;
    expect(back.moment).toMatchObject(words);
    expect(back.moment.state).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it("keeps only what it lists, nothing longer than it should be, and no report without words", () => {
    expect(parseReport({ text: "", moment: {} })).toBeNull();
    expect(parseReport("text")).toBeNull();
    const odd = parseReport({
      text: "x",
      moment: { hero: "y".repeat(500), extra: "dropped", log: Array(100).fill("l") },
    })!;
    expect(odd.moment.hero.length).toBe(60);
    expect(odd.moment.log.length).toBe(40);
    expect("extra" in odd.moment).toBe(false);
    expect(cleanText("a\r\nb\u0000c".padEnd(TEXT_LIMIT + 50, "z")).length).toBe(TEXT_LIMIT);
    expect(cleanText("a\r\nb\u0000c")).toBe("a\nbc");
  });
});

describe("sending a report", () => {
  it("sends the engine state when it fits, and the words and table without it when it doesn't", () => {
    const moment = momentOfModel(dealt());
    expect(JSON.parse(reportBody("x", moment)).moment.state).toBeDefined();
    const heavy = { ...moment, state: "s".repeat(REPORT_LIMIT) };
    const sent = reportBody("It broke", heavy);
    expect(sent.length).toBeLessThanOrEqual(REPORT_LIMIT);
    const back = parseReport(JSON.parse(sent))!;
    expect(back.text).toBe("It broke");
    expect(back.moment.hand).toEqual(moment.hand);
    expect(back.moment.state).toBeUndefined();
  });
});

describe("a report as a GitHub issue", () => {
  it("fences the player's words so nothing in them can close the fence, ping anyone or link out", () => {
    const text = "Rhino hit twice ``` ```` @adam [click](http://bad) <script>";
    const body = issueBody(record(text));
    const fence = /\n(`{3,})text\n([\s\S]*?)\n\1\n/.exec(body)!;
    expect(fence[2]).toBe(text);
    expect(fence[1]!.length).toBeGreaterThan(4);
    // Outside the fence, a name can't ping or link either.
    const named = issueBody(record("x", { from: "Sam @team [x](http://bad) | y" }));
    expect(named).not.toMatch(/@team/);
    expect(named).toContain("\\[x\\]");
    expect(named).toContain("\\|");
    expect(issueTitle(record("Bug @adam\nsecond line"))).toBe("Player report: Bug @​adam second line");
  });

  it("names the game, the deal, the hand and the link to the engine state", () => {
    const body = issueBody(record("It broke"), "https://gist.github.com/abc");
    expect(body).toContain("Spider-Man vs Rhino");
    expect(body).toContain("seed 75");
    expect(body).toContain("round 1, player turn");
    expect(body).toContain("(https://gist.github.com/abc)");
    expect(body).toContain("Spider-Man plays Backflip");
    expect(body).toContain("the dev table");
  });

  it("stays inside GitHub's limit however long the log is", () => {
    const long = record("x");
    long.moment.log = Array(40).fill("y".repeat(3000));
    const body = issueBody(long);
    expect(body.length).toBeLessThanOrEqual(60_000);
    expect(body).toContain("too long to include");
  });

  it("keeps the title short", () => {
    expect(issueTitle(record("word ".repeat(40))).length).toBeLessThanOrEqual("Player report: ".length + 70);
  });
});
