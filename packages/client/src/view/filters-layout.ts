/** Sizing and translated text for the setup rosters’ filter disclosure. */
import type { CardLanguage } from "../art/card-language.js";
import { t } from "../i18n/translate.js";

/** The Filters button's width, wide enough for "Filters (3) ▾". */
export const FILTERS_BUTTON_WIDTH = 156;

/** The disclosure carries the active filter count in the current UI language. */
export function filtersLabel(activeCount: number, open: boolean, lang?: CardLanguage): string {
  return t("filters.label", { active: activeCount > 0 ? ` (${activeCount})` : "", arrow: open ? "▾" : "▸" }, lang);
}
