import { describe, expect, it } from "vitest";
import { handleTableSiteRequest, INVITE_COOKIE, type TableSiteEnv } from "./gate.js";

const KEY = "k3y-for-tests";

function env(key: string | undefined = KEY): TableSiteEnv & { served: string[] } {
  const served: string[] = [];
  return {
    INVITE_KEY: key,
    served,
    ASSETS: {
      fetch: async (request: Request) => {
        served.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200, headers: { "content-type": "image/webp" } });
      },
    },
  };
}

const at = (path: string, cookie?: string) =>
  new Request(`https://table.example${path}`, cookie ? { headers: { cookie } } : undefined);

describe("the test site's invite lock", () => {
  it("refuses the table and its card scans without an invite", async () => {
    const e = env();
    for (const path of ["/", "/battle/", "/card-art/bundles/cards/01001a.webp", "/assets/battle.js"]) {
      expect((await handleTableSiteRequest(at(path), e)).status).toBe(403);
    }
    expect(e.served).toEqual([]);
  });

  it("refuses a wrong invite link and a wrong cookie", async () => {
    const e = env();
    expect((await handleTableSiteRequest(at("/join/nope"), e)).status).toBe(403);
    expect((await handleTableSiteRequest(at("/battle/", `${INVITE_COOKIE}=nope`), e)).status).toBe(403);
    expect(e.served).toEqual([]);
  });

  it("lets the invite link in: a cookie, then the table", async () => {
    const response = await handleTableSiteRequest(at(`/join/${KEY}`), env());
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/battle/");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${INVITE_COOKIE}=${KEY}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("serves everything to an invited browser, never indexed, and sends the front page to the table", async () => {
    const e = env();
    const cookie = `other=1; ${INVITE_COOKIE}=${KEY}`;
    const scan = await handleTableSiteRequest(at("/card-art/bundles/cards/01001a.webp", cookie), e);
    expect(scan.status).toBe(200);
    expect(scan.headers.get("x-robots-tag")).toBe("noindex");
    expect(e.served).toEqual(["/card-art/bundles/cards/01001a.webp"]);
    const front = await handleTableSiteRequest(at("/", cookie), e);
    expect(front.status).toBe(302);
    expect(front.headers.get("location")).toBe("/battle/");
  });

  it("stays locked when no key is set", async () => {
    const e = env(undefined);
    expect((await handleTableSiteRequest(at("/join/"), e)).status).toBe(403);
    expect((await handleTableSiteRequest(at("/battle/", `${INVITE_COOKIE}=`), e)).status).toBe(403);
  });

  it("tells search engines to stay away", async () => {
    const robots = await handleTableSiteRequest(at("/robots.txt"), env());
    expect(await robots.text()).toContain("Disallow: /");
  });
});
