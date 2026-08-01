import { describe, expect, it } from "vitest";
import { toPatchKey } from "./patch";

describe("toPatchKey", () => {
  it("uses only the major and minor game-version components", () => {
    expect(toPatchKey("16.15.623.1234")).toBe("16.15");
    expect(() => toPatchKey("16")).toThrow("Invalid Riot version");
  });

  it.each(["16.15.foo", "16.15.", "16.15.1foo", " 16.15", "+16.15", "16.15 ", "999999999999999999999999.15", "16.999999999999999999999999", "16.15.999999999999999999999999"]) ("rejects malformed version %s", (version) => {
    expect(() => toPatchKey(version)).toThrow("Invalid Riot version");
  });

  it("canonicalizes leading-zero numeric components", () => {
    expect(toPatchKey("016.015.001")).toBe("16.15");
  });
});
