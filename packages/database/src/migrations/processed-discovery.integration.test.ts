import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createMigratedTestDatabase } from "../test-utils";

const url = process.env.TEST_DATABASE_URL;
const migration = readFileSync(new URL("../../../../migrations/0012_processed_discovery.sql", import.meta.url), "utf8");
const migrationStatements = migration
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

describe.skipIf(!url)("processed discovery migration upgrade", () => {
  it("preserves pre-0012 rows while recreating the enum and restoring its dependencies", async () => {
    const database = await createMigratedTestDatabase(url!);
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(sql.raw(`
          ALTER TABLE "public"."discovered_matches"
            DROP CONSTRAINT "discovered_matches_unavailable_reason_state"
        `));
        await tx.execute(sql.raw(`
          ALTER TABLE "public"."discovered_matches"
            ALTER COLUMN "status" DROP DEFAULT
        `));
        await tx.execute(sql.raw(`
          CREATE TYPE "public"."discovered_match_status_old" AS ENUM('PENDING', 'UNAVAILABLE')
        `));
        await tx.execute(sql.raw(`
          ALTER TABLE "public"."discovered_matches"
            ALTER COLUMN "status" TYPE "public"."discovered_match_status_old"
            USING "status"::text::"public"."discovered_match_status_old"
        `));
        await tx.execute(sql.raw(`DROP TYPE "public"."discovered_match_status"`));
        await tx.execute(sql.raw(`ALTER TYPE "public"."discovered_match_status_old" RENAME TO "discovered_match_status"`));
        await tx.execute(sql.raw(`
          ALTER TABLE "public"."discovered_matches"
            ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."discovered_match_status"
        `));
        await tx.execute(sql.raw(`
          ALTER TABLE "public"."discovered_matches"
            ADD CONSTRAINT "discovered_matches_unavailable_reason_state"
            CHECK (("status" = 'UNAVAILABLE' AND "unavailable_reason" IS NOT NULL)
              OR ("status" = 'PENDING' AND "unavailable_reason" IS NULL))
        `));
        await tx.execute(sql.raw(`
          INSERT INTO "public"."collection_runs" ("id")
          VALUES ('00000000-0000-0000-0000-000000000001')
        `));
        await tx.execute(sql.raw(`
          INSERT INTO "public"."discovered_matches" ("run_id", "match_id", "status", "unavailable_reason")
          VALUES
            ('00000000-0000-0000-0000-000000000001', 'pre-0012-pending', 'PENDING', NULL),
            ('00000000-0000-0000-0000-000000000001', 'pre-0012-unavailable', 'UNAVAILABLE', 'not_found')
        `));

        for (const statement of migrationStatements) await tx.execute(sql.raw(statement));
      });

      const labels = await database.db.execute(sql.raw(`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typname = 'discovered_match_status'
        ORDER BY e.enumsortorder
      `)) as unknown as Array<{ enumlabel: string }>;
      expect(labels.map(({ enumlabel }) => enumlabel)).toEqual(["PENDING", "PROCESSED", "UNAVAILABLE"]);

      const column = await database.db.execute(sql.raw(`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'discovered_matches' AND column_name = 'status'
      `)) as unknown as Array<{ column_default: string }>;
      expect(column[0]?.column_default).toContain("'PENDING'");
      expect(column[0]?.column_default).toContain("discovered_match_status");

      const constraint = await database.db.execute(sql.raw(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'discovered_matches_unavailable_reason_state'
      `)) as unknown as Array<{ definition: string }>;
      expect(constraint[0]?.definition).toContain("UNAVAILABLE");
      expect(constraint[0]?.definition).toContain("PROCESSED");
      expect(constraint[0]?.definition).toContain("unavailable_reason IS NULL");

      const rows = await database.db.execute(sql.raw(`
        SELECT "match_id", "status"::text AS status, "unavailable_reason"
        FROM "public"."discovered_matches"
        WHERE "run_id" = '00000000-0000-0000-0000-000000000001'
        ORDER BY "match_id"
      `)) as unknown as Array<{ match_id: string; status: string; unavailable_reason: string | null }>;
      expect(rows).toEqual([
        { match_id: "pre-0012-pending", status: "PENDING", unavailable_reason: null },
        { match_id: "pre-0012-unavailable", status: "UNAVAILABLE", unavailable_reason: "not_found" }
      ]);

      await database.db.execute(sql.raw(`
        INSERT INTO "public"."discovered_matches" ("run_id", "match_id")
        VALUES ('00000000-0000-0000-0000-000000000001', 'pre-0012-default')
      `));
      const [defaulted] = await database.db.execute(sql.raw(`
        SELECT "status"::text AS status, "unavailable_reason"
        FROM "public"."discovered_matches"
        WHERE "run_id" = '00000000-0000-0000-0000-000000000001' AND "match_id" = 'pre-0012-default'
      `)) as unknown as Array<{ status: string; unavailable_reason: string | null }>;
      expect(defaulted).toEqual({ status: "PENDING", unavailable_reason: null });

      await database.db.execute(sql.raw(`
        UPDATE "public"."discovered_matches"
        SET "status" = 'PROCESSED'
        WHERE "run_id" = '00000000-0000-0000-0000-000000000001' AND "match_id" = 'pre-0012-pending'
      `));
      const [processed] = await database.db.execute(sql.raw(`
        SELECT "status"::text AS status, "unavailable_reason"
        FROM "public"."discovered_matches"
        WHERE "run_id" = '00000000-0000-0000-0000-000000000001' AND "match_id" = 'pre-0012-pending'
      `)) as unknown as Array<{ status: string; unavailable_reason: string | null }>;
      expect(processed).toEqual({ status: "PROCESSED", unavailable_reason: null });
    } finally {
      await database.close();
    }
  });
});
