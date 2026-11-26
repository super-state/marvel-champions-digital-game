import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import { bundleMode, cardArtPlugin, cardLanguageOf, carriedLanguagesOf, servedLanguages } from "./vite-card-art.js";
import { marvelcdbImportPlugin } from "./vite-marvelcdb-import.js";
import { releaseHistoryPlugin } from "./vite-release-history.js";
import { battlePlayPlugin } from "./vite-battle-play.js";
import { battleReportPlugin } from "./vite-battle-report.js";
import { soundStudioPlugin } from "./vite-sound-studio.js";

/**
 * The engine runs in a module worker (PLAN.md Phase 4), so the worker format is
 * ES rather than the default IIFE — an IIFE worker can't `import` the engine.
 *
 * `cardArtPlugin` serves `/card-art/*` from this origin. Card art has to be
 * same-origin or WebGL won't accept it as a texture; see vite-card-art.ts.
 *
 * `marvelcdbImportPlugin` serves `/api/marvelcdb-import/*` the same way, for
 * MarvelCDB deck import by URL/id (PLAN.md Phase 9, dev/preview-only; paste
 * is the fallback that works in a production build). See
 * vite-marvelcdb-import.ts.
 */
/**
 * A shipped 3D table build (`pnpm table:ship` sets `VITE_TABLE_VERSION`) carries `table-version.json`, so a friend's open
 * page can ask which version is live and take a new one between matches (`src/battle-table/test-site/update-check.ts`).
 */
function tableVersionPlugin() {
  return {
    name: "table-version",
    apply: "build" as const,
    generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: string }): string }) {
      const version = process.env.VITE_TABLE_VERSION;
      if (version)
        this.emitFile({ type: "asset", fileName: "table-version.json", source: JSON.stringify({ version }) });
    },
  };
}

/**
 * The commit this bundle is built from, for the Title footer's version stamp (`src/view/app-version.ts`). Netlify
 * sets `COMMIT_REF` on every deploy; a local or CI build asks git; with neither, the stamp is just the release.
 */
function buildCommit(): string {
  const fromNetlify = process.env.COMMIT_REF?.trim();
  if (fromNetlify) return fromNetlify.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

export default defineConfig(({ command }) => ({
  // `__CARD_LANG__`: the build language of the card scans (`MC_CARD_LANG`, `src/art/card-language.ts`).
  // `__CARD_LANGS__`: every language the bundle carries (`MC_CARD_LANGS`), or in dev every one the dev server serves.
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __CARD_LANG__: JSON.stringify(cardLanguageOf()),
    // Only a pool copy writes the other languages; `all` and `none` builds offer the build language alone.
    __CARD_LANGS__: JSON.stringify(
      (command !== "build"
        ? servedLanguages()
        : bundleMode() === "pool"
          ? carriedLanguagesOf()
          : [cardLanguageOf()]
      ).join(","),
    ),
  },
  plugins: [
    tableVersionPlugin(),
    cardArtPlugin(),
    marvelcdbImportPlugin(),
    releaseHistoryPlugin(),
    soundStudioPlugin(),
    battlePlayPlugin(),
    battleReportPlugin(),
  ],
  worker: { format: "es" },
  build: {
    target: "es2022",
    rolldownOptions: { input: { game: "index.html", battle: "battle/index.html" } },
    // Phaser is large and ships as one chunk; the warning adds nothing here.
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    // Never watch the Tauri build tree: cargo rewrites executables under
    // src-tauri/target while a desktop build runs, and a watch handle on one
    // of them fails with EBUSY on Windows and takes the whole dev server down.
    watch: { ignored: ["**/src-tauri/**", "**/android/**", "**/ios/**"] },
  },
}));
