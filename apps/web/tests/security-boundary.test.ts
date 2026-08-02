import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanClientBoundary } from "../lib/security-boundary";

describe("web security boundary", () => {
  it("keeps collector secrets and private database modules out of client components", async () => {
    const result = await scanClientBoundary(join(process.cwd(), "apps/web"));
    expect(result.violations, result.violations.join("\n")).toEqual([]);
  });

  it("keeps private identifiers out of web API fixture snapshots", async () => {
    const result = await scanClientBoundary(join(process.cwd(), "apps/web"));
    expect(result.fixtureViolations, result.fixtureViolations.join("\n")).toEqual([]);
  });

  it("resolves transitive relative and package imports from client roots", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-fixtures");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/RIOT_API_KEY/);
    expect(result.violations.join("\n")).toMatch(/@lol\/database/);
  });
});
