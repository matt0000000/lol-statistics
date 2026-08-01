import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../migrations/0000_initial.sql", import.meta.url), "utf8");

describe("canonical schema integrity contract", () => {
  it("consumes domain patch and role contracts", () => {
    expect(source).toContain('from "@lol/domain"');
    expect(source).toContain("$type<PatchKey>()");
    expect(source).toContain("pgEnum(\"role\", ROLES)");
  });

  it("keeps active patches unique and patch keys formatted", () => {
    expect(source).toContain("patches_one_active_idx");
    expect(source).toContain("patches_patch_key_format");
    expect(migration).toContain('CREATE UNIQUE INDEX "patches_one_active_idx"');
    expect(migration).toContain('CONSTRAINT "patches_patch_key_format" CHECK');
  });

  it("ties participant item rows to observations and patch catalogs", () => {
    expect(source.match(/foreignKey\(\{ columns: \[table\.matchId, table\.participantId, table\.patchId\]/g)).toHaveLength(2);
    expect(source.match(/foreignKey\(\{ columns: \[table\.patchId, table\.itemId\]/g)).toHaveLength(2);
    expect(migration).toContain('participant_core_items_patch_id_item_id_items_patch_id_item_id_fk');
    expect(migration).toContain('participant_boots_patch_id_item_id_items_patch_id_item_id_fk');
  });

  it("checks combination aggregate counts", () => {
    expect(source).toContain("combination_aggregates_counts_nonnegative");
    expect(migration).toContain('CONSTRAINT "combination_aggregates_counts_nonnegative" CHECK');
  });
});
