import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const migration = ["0000_initial.sql", "0001_gray_golden_guardian.sql", "0002_next_jack_murdock.sql", "0003_faulty_redwing.sql", "0004_participant_rejections.sql"]
  .map((file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");

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

  it("ties observations to the same patch as their match", () => {
    expect(source).toContain('unique("matches_match_id_patch_id_unique")');
    expect(source).toContain('foreignKey({ columns: [table.matchId, table.patchId], foreignColumns: [matches.matchId, matches.patchId] })');
    expect(migration).toContain('matches_match_id_patch_id_unique');
    expect(migration).toContain('participant_observations_match_id_patch_id_matches_match_id_patch_id_fk');
  });

  it("persists constrained rejected participant outcomes", () => {
    expect(source).toContain('pgEnum("rejection_reason"');
    expect(source).toContain('export const participantRejections = pgTable');
    expect(migration).toContain('CREATE TABLE "participant_rejections"');
    expect(migration).toContain('participant_rejections_match_id_patch_id_matches_match_id_patch_id_fk');
  });

  it("checks combination aggregate counts", () => {
    expect(source).toContain("combination_aggregates_counts_nonnegative");
    expect(migration).toContain('CONSTRAINT "combination_aggregates_counts_nonnegative" CHECK');
  });

  it("defines resumable ladder and unique discovery work rows", () => {
    expect(source).toContain('nextMatchOffset: integer("next_match_offset")');
    expect(source).toContain("ladder_snapshots_queue_fixed");
    expect(source).toContain("ladder_snapshots_division_valid");
    expect(source).toContain('export const discoveredMatches = pgTable');
    expect(migration).toContain('CREATE TABLE "discovered_matches"');
    expect(migration).toContain('ladder_snapshots_next_match_offset_nonnegative');
    expect(migration).toContain('ladder_snapshots_queue_fixed');
    expect(migration).toContain('ladder_snapshots_division_valid');
  });
});
