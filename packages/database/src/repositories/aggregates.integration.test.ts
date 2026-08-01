import { describe, expect, it } from "vitest";
import { AggregatesRepository } from "./aggregates";

describe.skipIf(!process.env.TEST_DATABASE_URL)("aggregate repository (PostgreSQL)", () => {
  it("exports the atomic aggregate repository", () => expect(AggregatesRepository).toBeDefined());
});
