/**
 * "How to play" (guided mode G6c part 1, `docs/guided-mode.md` §4): the learning hub Title's own menu opens, plus
 * Settings' "Play the tutorial", the round debrief's "Replay a lesson" and the chips' "Aspects ▸" once G10c lands.
 * Pure data plus a pure layout, the same split as `guide-chooser-model.ts`/`how-to-win-model.ts`.
 *
 * **Three modules**, each reading done/next state straight from the live `GuidePrefs` (`guide/guide-store.ts`)
 * rather than any second copy of progress:
 * - **THE BASICS**: the tutorial's real five lessons (`guide/tutorial-lessons.ts` `TUTORIAL_LESSONS`), each ✓ done
 *   or "Next" — the first one not in `prefs.tutorial.lessonsDone` is the recommended one.
 * - **ASPECTS**: the four playable aspects from `guide/aspects.ts` `ASPECT_GUIDES` (Basic is skipped — it has a
 *   tip card, not a lesson, per §5.4's own table), each with its tagline and a done mark from
 *   `prefs.aspectLessonsDone`. §5.4's `'Pool` isn't in `ASPECT_GUIDES` yet either, so nothing extra is needed here
 *   to skip it.
 * - **REFERENCE**: rules reference and glossary — one row, no progress state.
 *
 * `howToPlayModules` never throws on missing content the way `how-to-win-model.ts` does for the tutorial matchup:
 * every row here is drawn from data (`TUTORIAL_LESSONS`, `ASPECT_GUIDES`) that already exists at build time, so a
 * missing lesson or aspect would be a real bug caught by `tutorial-lessons.test.ts`/`aspects.test.ts`, not
 * something this screen needs to guard against a second time.
 *
 * **Layout is two parts.** `howToPlayHeaderLayout` sizes the fixed header (Back ×, title) — never scrolled.
 * `howToPlayContentLayout` sizes everything below it in *content space*: `x` absolute (screen space, already
 * inset by the scene's own padding), `y` measured from the content's own top (0) — the same convention
 * `McScrollRegion` (`ui/scroll-region.ts`) documents for every other scrolling screen in this app (Settings,
 * Table setup). The scene wraps that in a `McScrollRegion` viewport starting just below the header, so a short
 * phone screen scrolls the modules while the header stays put, and a tall desktop window shows the whole thing
 * with no scrollbar at all (`McScrollRegion` clamps its own offset to 0 when the content already fits).
 */
import { ASPECT_GUIDES, type AspectGuide } from "../guide/aspects.js";
import type { GuidePrefs } from "../guide/guide-prefs.js";
import { TUTORIAL_LESSONS } from "../guide/tutorial-lessons.js";
import type { BoxPage } from "./new-in-box-model.js";
import { formFactorFor, type FormFactor, type Rect } from "./layout.js";

export interface LessonRowInfo {
  readonly id: string;
  /** 1-based position in `TUTORIAL_LESSONS`, for "1", "2", … row numbering. */
  readonly index: number;
  readonly title: string;
  readonly done: boolean;
  /** True for the first lesson not yet done — the hub's own "GUIDE PICK" for where to go next. */
  readonly recommended: boolean;
}

export interface AspectRowInfo {
  readonly aspect: AspectGuide["aspect"];
  readonly name: string;
  readonly tagline: string;
  readonly done: boolean;
}

export interface ReferenceRowInfo {
  readonly title: string;
  readonly detail: string;
}

/** One "New in this box" row on the hub (`view/new-in-box-model.ts`): the page it opens and its one-line summary. */
export interface BoxRowInfo {
  readonly id: BoxPage["id"];
  readonly title: string;
  readonly summary: string;
}

export interface HowToPlayModules {
  readonly lessons: readonly LessonRowInfo[];
  /** Index into `lessons` of the row "Continue learning ▸" starts, or `null` when every lesson is done. */
  readonly recommendedLessonIndex: number | null;
  readonly aspects: readonly AspectRowInfo[];
  readonly reference: ReferenceRowInfo;
  /** One row per "New in this box" page the player has unlocked (none while no box has a page), release order. */
  readonly boxes: readonly BoxRowInfo[];
}

/**
 * The hub's modules, built from the live `GuidePrefs` — no second progress record. `boxPages` is the unlocked
 * "New in this box" pages (`view/new-in-box-model.ts#boxPages`); the scene passes the player's own unlocks.
 */
export function howToPlayModules(prefs: GuidePrefs, boxPages: readonly BoxPage[] = []): HowToPlayModules {
  let recommendedLessonIndex: number | null = null;
  const lessons: LessonRowInfo[] = TUTORIAL_LESSONS.map((lesson, index) => {
    const done = prefs.tutorial.lessonsDone.includes(lesson.id);
    const recommended = !done && recommendedLessonIndex === null;
    if (recommended) recommendedLessonIndex = index;
    return { id: lesson.id, index: index + 1, title: lesson.title, done, recommended };
  });

  const aspects: AspectRowInfo[] = ASPECT_GUIDES.filter((guide) => guide.aspect !== "basic").map((guide) => ({
    aspect: guide.aspect,
    name: guide.name,
    tagline: guide.tagline,
    done: prefs.aspectLessonsDone.includes(guide.aspect),
  }));

  return {
    lessons,
    recommendedLessonIndex,
    aspects,
    reference: { title: "Rules & glossary", detail: "Every keyword and the full rules reference, searchable." },
    boxes: boxPages.map((page) => ({ id: page.id, title: page.title, summary: page.summary })),
  };
}

/**
 * How much of How to Play is done: the five basics lessons and every aspect's Try it, the rows the hub marks ✓. What
 * the "Studying Like Doctor Strange" achievement counts (`progression/achievements.ts`).
 */
export function howToPlayProgressOf(prefs: GuidePrefs): { readonly done: number; readonly total: number } {
  const modules = howToPlayModules(prefs);
  const rows = [...modules.lessons, ...modules.aspects];
  return { done: rows.filter((row) => row.done).length, total: rows.length };
}

/** "Continue learning ▸" / "Play it again ▸" (once every lesson is done) — the hub's one red primary action's label. */
export function continueLearningLabel(modules: HowToPlayModules): string {
  return modules.recommendedLessonIndex === null ? "Play it again ▸" : "Continue learning ▸";
}

/** The lesson `"Continue learning ▸"` starts — the recommended one, or lesson 1 again once every lesson is done. */
export function continueLearningLesson(modules: HowToPlayModules): LessonRowInfo {
  return modules.lessons[modules.recommendedLessonIndex ?? 0]!;
}

const HEADER_HEIGHT = 64;
const CLOSE_SIZE = 44;
const PAD = 28;
const NARROW_PAD = 16;

export interface HowToPlayHeaderLayout {
  readonly formFactor: FormFactor;
  readonly pad: number;
  readonly header: Rect;
  readonly close: Rect;
  readonly title: Rect;
}

/** The fixed header — Back ×, "HOW TO PLAY" — never inside the scroll region. */
export function howToPlayHeaderLayout(width: number, height: number): HowToPlayHeaderLayout {
  const formFactor = formFactorFor(width, height);
  const wide = formFactor === "desktop" || formFactor === "tabletLandscape";
  const pad = wide ? PAD : NARROW_PAD;
  const close: Rect = { x: pad, y: (HEADER_HEIGHT - CLOSE_SIZE) / 2, width: wide ? 116 : 84, height: CLOSE_SIZE };
  const header: Rect = { x: 0, y: 0, width, height: HEADER_HEIGHT };
  const title: Rect = {
    x: close.x + close.width + 12,
    y: 0,
    width: width - close.x - close.width - 12 - pad,
    height: HEADER_HEIGHT,
  };
  return { formFactor, pad, header, close, title };
}

export interface HowToPlayContentLayout {
  readonly formFactor: FormFactor;
  /** Desktop/tabletLandscape: two columns, Basics left, Aspects+Reference stacked right. Phone/tabletPortrait: one stacked column. */
  readonly wide: boolean;
  /** Content-space (`y` from 0) — every rect below is drawn inside a `McScrollRegion` at these coordinates. */
  readonly basicsLabel: Rect;
  /** One row per `HowToPlayModules.lessons` entry, same order. */
  readonly lessonRows: readonly Rect[];
  readonly aspectsLabel: Rect;
  /** One row per `HowToPlayModules.aspects` entry, same order. */
  readonly aspectRows: readonly Rect[];
  readonly referenceLabel: Rect;
  readonly referenceRow: Rect;
  readonly sample: Rect;
  readonly sampleScrollIndex: number;
  /** "NEW IN EACH BOX": a full-width band under the columns, or `null` while no box has a page. Rows are in a two-column grid on wide layouts. */
  readonly boxesLabel: Rect | null;
  /** One row per `HowToPlayModules.boxes` entry, same order. */
  readonly boxRows: readonly Rect[];
  readonly continueLearning: Rect;
  /** The content's own total height (`contentSlotHeights`'s own gap-inclusive convention) — `McScrollRegion`'s `heights` sums this for its scroll clamp. */
  readonly heights: readonly number[];
  readonly totalHeight: number;
  /**
   * Each row's own index into `heights`, for `McScrollRegion#scrollIntoView` (`topOf(heights, index)` must equal
   * that row's real content-space `y`, which only holds for rows in the *same* cumulative-sum sequence `heights`
   * was built from). On a narrow (single-column) layout every row is in that one sequence, so every index here is
   * exact. On a **wide** (two-column) layout the right column (Aspects, Reference) isn't part of the left
   * column's own cumulative sequence `heights` uses for `clamp`'s total — `aspectScrollIndex`/`referenceScrollIndex`
   * fall back to the nearest real checkpoint (the bottom of Basics) rather than a wrong mid-sequence number, so
   * `ensureVisible` still scrolls toward the right column without claiming a pixel-exact position it can't have
   * inside a single linear `heights` sequence that only tracks one column.
   */
  readonly lessonScrollIndex: readonly number[];
  readonly aspectScrollIndex: readonly number[];
  readonly referenceScrollIndex: number;
  readonly boxScrollIndex: readonly number[];
  readonly continueScrollIndex: number;
}

const SECTION_GAP = 28;
/** Top padding above "THE BASICS"/"ASPECTS" — the same `SECTION_GAP` used between sections below it, so the first
 * label doesn't sit tight under the ink header the way it used to before this content body had any top padding of
 * its own (found in browser verification: "THE BASICS" read as glued to the header bar). */
const CONTENT_TOP_PAD = SECTION_GAP;
const LABEL_HEIGHT = 24;
const LABEL_ROW_GAP = 8;
const ROW_GAP = 10;
const BOX_ROW_HEIGHT = 64;
const LESSON_ROW_HEIGHT = 64;
const ASPECT_ROW_HEIGHT = 76;
const CONTINUE_HEIGHT = 56;
const COLUMN_GAP = 24;

interface StackedSection {
  readonly label: Rect;
  readonly rows: readonly Rect[];
  readonly bottom: number;
}

/** One "LABEL + N rows" section stacked at `(x, top)`, each row `rowHeight` tall — the shape Basics, Aspects and Reference all share. */
function section(x: number, top: number, width: number, rowHeight: number, count: number): StackedSection {
  const label: Rect = { x, y: top, width, height: LABEL_HEIGHT };
  let y = top + LABEL_HEIGHT + LABEL_ROW_GAP;
  const rows: Rect[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ x, y, width, height: rowHeight });
    y += rowHeight + ROW_GAP;
  }
  // No trailing `ROW_GAP` after the section's last row — the caller adds `SECTION_GAP` between sections itself.
  const bottom = count > 0 ? y - ROW_GAP : y;
  return { label, rows, bottom };
}

interface BoxBand {
  readonly label: Rect | null;
  readonly rows: readonly Rect[];
  readonly bottom: number;
}

/**
 * The "NEW IN EACH BOX" band at `top`, each row `BOX_ROW_HEIGHT` tall. `columns` are the x and width of each column
 * across: on wide layouts the same two columns the sections above it sit in, so every row edge lines up down the page.
 */
function boxBand(
  x: number,
  top: number,
  width: number,
  count: number,
  columns: readonly { readonly x: number; readonly width: number }[],
): BoxBand {
  if (count === 0) return { label: null, rows: [], bottom: top };
  const label: Rect = { x, y: top, width, height: LABEL_HEIGHT };
  const rowsTop = top + LABEL_HEIGHT + LABEL_ROW_GAP;
  const rows: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const column = columns[i % columns.length]!;
    const line = Math.floor(i / columns.length);
    rows.push({
      x: column.x,
      y: rowsTop + line * (BOX_ROW_HEIGHT + ROW_GAP),
      width: column.width,
      height: BOX_ROW_HEIGHT,
    });
  }
  const lines = Math.ceil(count / columns.length);
  return { label, rows, bottom: rowsTop + lines * (BOX_ROW_HEIGHT + ROW_GAP) - ROW_GAP };
}

export function howToPlayContentLayout(
  width: number,
  height: number,
  modules: HowToPlayModules,
): HowToPlayContentLayout {
  const formFactor = formFactorFor(width, height);
  const wide = formFactor === "desktop" || formFactor === "tabletLandscape";
  const pad = Math.max(wide ? PAD : NARROW_PAD, Math.round((width - 1100) / 2));
  const contentWidth = width - 2 * pad;
  const referenceLabel: Rect = { x: pad, y: CONTENT_TOP_PAD, width: contentWidth, height: LABEL_HEIGHT };
  const start = referenceLabel.y + referenceLabel.height + LABEL_ROW_GAP;
  const half = (contentWidth - ROW_GAP) / 2;
  const continueLearning: Rect = {
    x: pad,
    y: start,
    width: wide ? contentWidth * 0.42 : contentWidth,
    height: CONTINUE_HEIGHT,
  };
  const utilityWidth = wide ? (contentWidth - continueLearning.width - ROW_GAP * 2) / 2 : half;
  const sample: Rect = {
    x: wide ? pad + continueLearning.width + ROW_GAP : pad,
    y: wide ? start : start + CONTINUE_HEIGHT + ROW_GAP,
    width: utilityWidth,
    height: CONTINUE_HEIGHT,
  };
  const referenceRow: Rect = { ...sample, x: sample.x + sample.width + ROW_GAP };
  const columnWidth = wide ? (contentWidth - COLUMN_GAP) / 2 : contentWidth;
  const columns = [{ x: pad, width: columnWidth }];
  if (wide) columns.push({ x: pad + columnWidth + COLUMN_GAP, width: columnWidth });
  const listTop = referenceRow.y + referenceRow.height + SECTION_GAP;
  const basics = section(pad, listTop, columnWidth, LESSON_ROW_HEIGHT, modules.lessons.length);
  const aspects = section(
    columns.at(-1)!.x,
    wide ? listTop : basics.bottom + SECTION_GAP,
    columnWidth,
    ASPECT_ROW_HEIGHT,
    modules.aspects.length,
  );
  const bottom = Math.max(basics.bottom, aspects.bottom);
  const boxes = boxBand(pad, bottom + SECTION_GAP, contentWidth, modules.boxes.length, columns);
  const totalHeight = (boxes.label ? boxes.bottom : bottom) + CONTENT_TOP_PAD;
  // Focus follows each row's true top, including side-by-side rows of different heights.
  const stops = [
    ...new Set([
      0,
      referenceLabel.y,
      continueLearning.y,
      sample.y,
      referenceRow.y,
      basics.label.y,
      aspects.label.y,
      ...basics.rows.map((r) => r.y),
      ...aspects.rows.map((r) => r.y),
      ...boxes.rows.map((r) => r.y),
      ...(boxes.label ? [boxes.label.y] : []),
    ]),
  ].sort((a, b) => a - b);
  const heights = stops.map((y, i) => (stops[i + 1] ?? totalHeight) - y);
  const index = (r: Rect): number => stops.indexOf(r.y);
  return {
    formFactor,
    wide,
    basicsLabel: basics.label,
    lessonRows: basics.rows,
    aspectsLabel: aspects.label,
    aspectRows: aspects.rows,
    referenceLabel,
    referenceRow,
    sample,
    boxesLabel: boxes.label,
    boxRows: boxes.rows,
    continueLearning,
    heights,
    totalHeight,
    lessonScrollIndex: basics.rows.map(index),
    aspectScrollIndex: aspects.rows.map(index),
    referenceScrollIndex: index(referenceRow),
    sampleScrollIndex: index(sample),
    boxScrollIndex: boxes.rows.map(index),
    continueScrollIndex: index(continueLearning),
  };
}

/** Every drawn row (not section labels — a label is a header, not content to keep clear of) — for a no-overlap test. */
export function howToPlayContentLayoutRects(layout: HowToPlayContentLayout): readonly Rect[] {
  return [
    ...layout.lessonRows,
    ...layout.aspectRows,
    layout.referenceRow,
    ...layout.boxRows,
    layout.sample,
    layout.continueLearning,
  ];
}

/** Focus order: close, every lesson row, every aspect row, reference, every box row, then Continue learning. */
export function howToPlayFocusOrder(modules: HowToPlayModules): readonly string[] {
  return [
    "close",
    "continue-learning",
    "sample",
    "reference",
    ...modules.lessons.map((lesson) => `lesson:${lesson.id}`),
    ...modules.aspects.map((aspect) => `aspect:${aspect.aspect}`),
    ...modules.boxes.map((box) => `box:${box.id}`),
  ];
}
