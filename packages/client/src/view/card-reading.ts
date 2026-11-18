import type { ResourceIconType } from "@mc/content";
import { t } from "../i18n/translate.js";
import type { StatTile } from "./board-model.js";

export type ReaderPage = "text" | "scan" | "details";

/** Spell out the marks on the actual card. Repeated icons stay countable and a printed dash remains a dash. */
export function readingResources(icons: readonly ResourceIconType[]): string {
  const amounts = new Map<ResourceIconType, number>();
  for (const icon of icons) amounts.set(icon, (amounts.get(icon) ?? 0) + 1);
  return [...amounts].map(([icon, amount]) => `${amount} ${t(`reader.resource.${icon}`)}`).join(" · ");
}

export function readingStats(stats: readonly StatTile[]): string {
  return stats
    .map(({ label, value, bonus, star }) => {
      const adjustment = bonus ? ` (${bonus > 0 ? "+" : "−"}${Math.abs(bonus)})` : "";
      return `${t(`reader.stat.${label}`)} ${value}${star ? " ★" : ""}${adjustment}`;
    })
    .join("     ");
}
