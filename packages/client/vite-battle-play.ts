import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

/**
 * Remote play for the 3D table (dev server only): lets Claude play a table that is shown somewhere its browser tools
 * can't reach, such as Surf's Games bubble, while Adam watches it there.
 *
 *   GET /__battle-play?call=look | moves | wait
 *   GET /__battle-play?call=play&move=Keep%20hand     (a move's words, or its number)
 *
 * The request goes over the dev server's own websocket to every battle page opened with `?remote` in its address;
 * that page runs the call on its play hook (`__battlePlay`, `src/battle-table/play.ts`) and sends the text back, and
 * the request answers with it as plain text. Pages without `?remote` (Adam's own table) never answer, so they can't
 * be moved by mistake. No rule lives here: the page presses the same buttons a click does.
 */
export function battlePlayPlugin(): Plugin {
  return {
    name: "mc-battle-play",
    apply: "serve",
    configureServer(server) {
      const waiting = new Map<string, (text: string) => void>();
      let next = 0;
      server.ws.on("battle-play:result", (data: { id?: string; text?: string }) => {
        const done = data?.id ? waiting.get(data.id) : undefined;
        if (!done) return;
        waiting.delete(data.id!);
        done(String(data.text ?? ""));
      });
      server.middlewares.use("/__battle-play", (req: IncomingMessage, res: ServerResponse) => {
        const query = new URL(req.url ?? "", "http://localhost").searchParams;
        const call = query.get("call") ?? "look";
        if (!["look", "moves", "wait", "play"].includes(call)) {
          res.statusCode = 400;
          res.end(`Unknown call ${JSON.stringify(call)}: use look, moves, wait or play.`);
          return;
        }
        const id = `${Date.now().toString(36)}-${(next++).toString(36)}`;
        // A move can wait out a whole villain phase (the hook's own cap is 60 s).
        const timer = setTimeout(() => {
          waiting.delete(id);
          res.statusCode = 504;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("No table answered: open the battle page with ?remote in its address (Surf: surf_game_open).");
        }, 90_000);
        waiting.set(id, (text) => {
          clearTimeout(timer);
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(text);
        });
        server.ws.send({ type: "custom", event: "battle-play:call", data: { id, call, move: query.get("move") } });
      });
    },
  };
}
