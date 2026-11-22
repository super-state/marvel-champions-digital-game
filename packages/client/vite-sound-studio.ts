import type { Plugin } from "vite";
import { studioMiddleware } from "./src/battle-table/studio/studio-server.js";

/**
 * The Sound Studio's routes (`/__studio/*`, `src/battle-table/studio/studio-server.ts`) on `vite dev` only. A save
 * tells the open game to load the new sounds without a reload.
 */
export function soundStudioPlugin(): Plugin {
  return {
    name: "mc-sound-studio",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        studioMiddleware({ onSaved: () => server.ws.send({ type: "custom", event: "sound-studio:saved" }) }),
      );
    },
  };
}
