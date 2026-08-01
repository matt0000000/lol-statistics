import { describe, expect, it } from "vitest";
import { healthCommand } from "./health";

describe("collector health", () => {
  it("returns sanitized JSON when database configuration is unavailable", async () => {
    const lines: string[] = [];
    const result = await healthCommand({ env: { DATABASE_URL: "postgres://secret-user:secret-pass@db/private" }, json: true, write: (line) => lines.push(line) });
    expect(result).toBe(1);
    const output = lines.join("");
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain("secret-pass");
    expect(output).toContain("database_unavailable");
  });
});
