import { describe, expect, it } from "vitest";
import { PublicationInvariantError } from "./publish";

describe.skipIf(!process.env.TEST_DATABASE_URL)("publication activation (PostgreSQL)", () => {
  it("uses a safe invariant error type", () => expect(new PublicationInvariantError([]).name).toBe("PublicationInvariantError"));
});
