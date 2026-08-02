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

  it("resolves configured tsconfig aliases across static, dynamic, require, and re-export edges", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-fixtures");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/RIOT_API_KEY/);
    expect(result.violations.join("\n")).toMatch(/puuid/);
    expect(result.violations.join("\n")).toMatch(/participant observations/);
    expect(result.violations.join("\n")).toMatch(/ladder snapshots/);
    expect(result.violations.join("\n")).toMatch(/private error\/detail/);
  });

  it("reports an unresolved configured local alias instead of silently skipping it", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-unresolved");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/unresolved alias @missing\//);
  });

  it("uses an exact tsconfig alias before an overlapping wildcard alias", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-exact-overlap");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/puuid/);
    expect(result.violations.join("\n")).not.toMatch(/unresolved alias @foo/);
  });

  it("resolves inherited JSONC tsconfig aliases", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-inherited");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/participant observations/);
  });

  it("fails closed for aliases that resolve outside the workspace", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-unsafe");
    const result = await scanClientBoundary(root);
    expect(result.violations.join("\n")).toMatch(/unresolved alias @unsafe\//);
  });

  it("reports tsconfig extends cycles instead of dropping aliases", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-cycle");
    await expect(scanClientBoundary(root)).rejects.toThrow(/Invalid tsconfig/);
  });

  it("ignores import-like text in comments and ordinary strings", async () => {
    const root = join(process.cwd(), "apps/web/tests/security-alias-comment-text");
    const result = await scanClientBoundary(root);
    expect(result.violations, result.violations.join("\n")).toEqual([]);
  });
});
