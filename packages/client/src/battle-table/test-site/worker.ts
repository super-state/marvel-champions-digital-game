/**
 * The entry of the test site's Cloudflare Worker (`wrangler.table.jsonc`). Only the default export: the Workers runtime
 * reads every named export of the entry module as an entrypoint, so the logic lives in `gate.ts`.
 */
import { handleTableSiteRequest, type SiteContext, type TableSiteEnv } from "./gate.js";

export default {
  fetch: (request: Request, env: TableSiteEnv, ctx: SiteContext) => handleTableSiteRequest(request, env, ctx),
};
