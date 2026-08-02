import { describe, expect, it } from "vitest";

type RouteMethod = (request: Request, context?: any) => Response | Promise<Response>;
type RouteModule = {
  POST: RouteMethod;
  PUT: RouteMethod;
  PATCH: RouteMethod;
  DELETE: RouteMethod;
  OPTIONS: RouteMethod;
};

const routes: Array<[string, string, Promise<RouteModule>]> = [
  ["champions", "/api/champions", import("../app/api/champions/route")],
  ["champion", "/api/champions/222", import("../app/api/champions/[championId]/route")],
  ["stats", "/api/champions/222/roles/BOTTOM/stats", import("../app/api/champions/[championId]/roles/[role]/stats/route")],
  ["meta", "/api/meta", import("../app/api/meta/route")],
  ["methodology", "/api/methodology", import("../app/api/methodology/route")]
];

describe("public route module method dispatch", () => {
  for (const [name, path, modulePromise] of routes) {
    it(`${name} exposes secured mutation handlers without opening the database`, async () => {
      const route = await modulePromise;
      const context = { params: Promise.resolve({ championId: "222", role: "BOTTOM" }) };
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await route[method]!(new Request(`http://localhost${path}`, { method }), context);
        expect(response.status, `${name} ${method}`).toBe(405);
        expect(response.headers.get("allow")).toBe("GET, HEAD");
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("vary")).toBe("Accept, If-None-Match");
        expect(await response.text()).toBe("");
      }
    });

    it(`${name} exposes a CORS-neutral OPTIONS capability response`, async () => {
      const route = await modulePromise;
      const response = await route.OPTIONS!(new Request(`http://localhost${path}`, { method: "OPTIONS" }));
      expect(response.status).toBe(204);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(await response.text()).toBe("");
    });
  }
});
