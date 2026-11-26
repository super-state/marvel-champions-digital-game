import { expect, test as base, type Page } from "@playwright/test";

/**
 * The 3D table's browser tests import `test` from here, not from "@playwright/test": every test then fails if the
 * table logged "[table drift]", a health or threat number on screen that disagreed with the game once a move had
 * played out (`checkShownNumbers` in src/battle-table/main.ts). It catches the kind of bug where the table counts a
 * change twice and only comes right when it redraws (the Ultron report of 2026-11-25: 8/10 shown, 5/10 real),
 * whichever card or villain causes it.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const drift: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().startsWith("[table drift]")) drift.push(message.text());
    });
    await use(page);
    expect(drift, "numbers on the table disagreed with the game").toEqual([]);
  },
});

export { expect };
export type { Page };
