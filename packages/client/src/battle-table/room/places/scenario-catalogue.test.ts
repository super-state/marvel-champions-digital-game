import * as content from "@mc/content";
import { describe, expect, test } from "vitest";
import { SHELF_PRODUCTS } from "./scenario-catalogue.js";

interface Scenario {
  id: string;
  name: string;
  packCode: string;
  villainCardId: string;
}
interface Pack {
  code: string;
  name: string;
  cycleId: string;
  releaseDate?: string;
}

const all = content as unknown as Record<string, unknown>;
const packs = new Map<string, Pack>();
const scenarios = new Map<string, Scenario>();
for (const [name, value] of Object.entries(all)) {
  if (name.endsWith("_PACK") && value && typeof value === "object" && "code" in value) {
    const pack = value as Pack;
    packs.set(pack.code, pack);
  }
  if (name.endsWith("_SCENARIOS") && !name.startsWith("WAVE") && Array.isArray(value))
    for (const scenario of value as Scenario[]) scenarios.set(scenario.id, scenario);
}

describe("the scenario shelf's boxes", () => {
  test("hold every scenario in @mc/content, each in its own pack's box", () => {
    const shelved = SHELF_PRODUCTS.flatMap((product) =>
      product.scenarios.map((scenario) => ({ ...scenario, pack: product.code })),
    );
    expect(shelved.map((s) => s.id).sort()).toEqual([...scenarios.keys()].sort());
    for (const s of shelved) {
      const real = scenarios.get(s.id)!;
      expect(s.name, s.id).toBe(real.name);
      expect(s.villain, s.id).toBe(real.villainCardId);
      expect(s.pack, s.id).toBe(real.packCode);
    }
  });

  test("are named and dated as their packs are, in the order they came out", () => {
    for (const product of SHELF_PRODUCTS) {
      const pack = packs.get(product.code);
      expect(pack, product.code).toBeDefined();
      expect(product.name).toBe(pack!.name);
      expect(product.cycle).toBe(pack!.cycleId);
      expect(product.released).toBe(pack!.releaseDate);
    }
    const dates = SHELF_PRODUCTS.map((product) => product.released);
    expect(dates).toEqual([...dates].sort());
  });

  test("are big for the Core Set and the campaign boxes, small for a scenario pack", () => {
    for (const product of SHELF_PRODUCTS)
      expect(product.size, product.code).toBe(
        product.code === "core" || product.scenarios.length >= 4 ? "big" : "small",
      );
    expect(SHELF_PRODUCTS[0]!.code).toBe("core");
    expect(SHELF_PRODUCTS[0]!.scenarios.map((s) => s.id)).toEqual(["rhino", "klaw", "ultron"]);
  });
});
