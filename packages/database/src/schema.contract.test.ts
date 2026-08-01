import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");
const migrationFiles = readdirSync(new URL("../../../migrations", import.meta.url)).filter((file) => /^000\d+_.*\.sql$/.test(file)).sort();
const migration = migrationFiles
  .map((file) => readFileSync(new URL(`../../../migrations/${file}`, import.meta.url), "utf8"))
  .join("\n");
const migrationMetadata = readFileSync(new URL("../../../migrations/meta/0008_snapshot.json", import.meta.url), "utf8");

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

  it("covers every checked-in migration and current durability invariants", () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(9);
    expect(migrationFiles.map((file) => file.slice(0, 4))).toEqual(migrationFiles.map((_, index) => String(index).padStart(4, "0")));
    expect(readFileSync(new URL("../../../migrations/meta/_journal.json", import.meta.url), "utf8")).toContain('"tag": "0007_one_publication_per_run"');
    expect(readdirSync(new URL("../../../migrations/meta", import.meta.url))).toContain("0007_snapshot.json");
    expect(source).toContain("activePublicationId: uuid(\"active_publication_id\")");
    expect(source).toContain("discoveredMatchStatus");
    expect(migration).toContain("aggregate_publications_one_per_run_idx");
    expect(migration).toContain("discovered_matches_unavailable_reason_safe");
    expect(migration).toContain("active_publication_id");
    expect(migration).toContain("ORDER BY ap.created_at, ap.id");
    expect(migration).toContain("active_publication_id = NULL");
    expect(migrationMetadata).toContain("\"active_publication_id\"");
    expect(readFileSync(new URL("../../../migrations/meta/_journal.json", import.meta.url), "utf8")).toContain("0008_ambitious_hitman");
  });
});
