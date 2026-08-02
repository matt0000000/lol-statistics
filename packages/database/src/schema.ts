import { sql } from "drizzle-orm";
import { ROLES, type PatchKey } from "@lol/domain";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const runStatus = pgEnum("run_status", ["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export const validationState = pgEnum("validation_state", ["PENDING", "VALID", "INVALID", "REJECTED"]);
export const discoveredMatchStatus = pgEnum("discovered_match_status", ["PENDING", "PROCESSED", "UNAVAILABLE"]);
export const rejectionReason = pgEnum("rejection_reason", ["platform", "queue", "patch", "rank", "role", "remake", "duration", "required_field", "unknown_item", "invalid_item"]);
export const role = pgEnum("role", ROLES);
export const tier = pgEnum("tier", ["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]);
export const itemCategory = pgEnum("item_category", [
  "CORE",
  "BOOTS",
  "EXCLUDED_COMPONENT",
  "EXCLUDED_STARTER",
  "EXCLUDED_CONSUMABLE",
  "EXCLUDED_TRINKET",
  "EXCLUDED_SUPPORT",
  "EXCLUDED_MODE",
  "EXCLUDED_UNKNOWN"
]);

export const patches = pgTable(
  "patches",
  {
    id: serial("id").primaryKey(),
    version: text("version").notNull(),
    patchKey: text("patch_key").$type<PatchKey>().notNull(),
    activatedAt: timestamp("activated_at", { withTimezone: true, mode: "date" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    activePublicationId: uuid("active_publication_id"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    unique("patches_version_unique").on(table.version),
    uniqueIndex("patches_one_active_idx").on(table.isActive).where(sql`${table.isActive} = true`),
    check("patches_version_nonempty", sql`length(${table.version}) > 0`),
    check("patches_patch_key_format", sql`${table.patchKey} ~ '^[0-9]+\\.[0-9]+$'`)
  ]
);

export const champions = pgTable(
  "champions",
  {
    patchId: integer("patch_id").notNull().references(() => patches.id),
    championId: integer("champion_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    iconUrl: text("icon_url").notNull(),
    splashUrl: text("splash_url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.patchId, table.championId] }), unique("champions_patch_slug_unique").on(table.patchId, table.slug)]
);

export const items = pgTable(
  "items",
  {
    patchId: integer("patch_id").notNull().references(() => patches.id),
    itemId: integer("item_id").notNull(),
    normalizedBaseId: integer("normalized_base_id").notNull(),
    category: itemCategory("category").notNull(),
    classificationReason: text("classification_reason").notNull(),
    name: text("name").notNull(),
    price: integer("price").notNull(),
    iconUrl: text("icon_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.patchId, table.itemId] }), check("items_price_nonnegative", sql`${table.price} >= 0`)]
);

export const collectionRuns = pgTable(
  "collection_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: runStatus("status").notNull().default("PENDING"),
    // Persist the publisher's canonical lowercase stage values. Public APIs
    // may expose uppercase names, but the database contract is lowercase.
    stage: text("stage").notNull().default("catalog"),
    patchId: integer("patch_id").references(() => patches.id),
    coverageDays: integer("coverage_days").notNull().default(35),
    minimumSample: integer("minimum_sample").notNull().default(100),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    coverageStartedAt: timestamp("coverage_started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    matchesDiscovered: integer("matches_discovered").notNull().default(0),
    matchesIngested: integer("matches_ingested").notNull().default(0),
    observationsAccepted: integer("observations_accepted").notNull().default(0),
    observationsRejected: integer("observations_rejected").notNull().default(0),
    errorDetails: jsonb("error_details"),
    publicationId: uuid("publication_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    index("collection_runs_status_started_at_idx").on(table.status, table.startedAt),
    check("collection_runs_coverage_days_positive", sql`${table.coverageDays} > 0`),
    check("collection_runs_minimum_sample_nonnegative", sql`${table.minimumSample} >= 0`)
  ]
);

export const ladderSnapshots = pgTable(
  "ladder_snapshots",
  {
    runId: uuid("run_id").notNull().references(() => collectionRuns.id),
    puuid: text("puuid").notNull(),
    queue: integer("queue").notNull().default(420),
    tier: tier("tier").notNull(),
    division: varchar("division", { length: 3 }).notNull(),
    nextMatchOffset: integer("next_match_offset").notNull().default(0),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.puuid] }),
    index("ladder_snapshots_run_tier_idx").on(table.runId, table.tier),
    check("ladder_snapshots_queue_fixed", sql`${table.queue} = 420`),
    check("ladder_snapshots_division_valid", sql`${table.division} IN ('I', 'II', 'III', 'IV')`),
    check("ladder_snapshots_next_match_offset_nonnegative", sql`${table.nextMatchOffset} >= 0`)
  ]
);

/** Match IDs discovered for a run, before their full payload is fetched. */
export const discoveredMatches = pgTable(
  "discovered_matches",
  {
    runId: uuid("run_id").notNull().references(() => collectionRuns.id),
    matchId: text("match_id").notNull(),
    status: discoveredMatchStatus("status").notNull().default("PENDING"),
    unavailableReason: text("unavailable_reason"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [primaryKey({ columns: [table.runId, table.matchId] }), index("discovered_matches_run_idx").on(table.runId), check("discovered_matches_unavailable_reason_safe", sql`${table.unavailableReason} IS NULL OR ${table.unavailableReason} = 'not_found'`), check("discovered_matches_unavailable_reason_state", sql`(${table.status} = 'UNAVAILABLE' AND ${table.unavailableReason} IS NOT NULL) OR (${table.status} = 'PENDING' AND ${table.unavailableReason} IS NULL)`)]
);

export const matches = pgTable(
  "matches",
  {
    matchId: text("match_id").primaryKey(),
    patchId: integer("patch_id").notNull().references(() => patches.id),
    platformId: text("platform_id").notNull(),
    queueId: integer("queue_id").notNull(),
    gameVersion: text("game_version").notNull(),
    gameCreation: timestamp("game_creation", { withTimezone: true, mode: "date" }).notNull(),
    gameDuration: integer("game_duration").notNull(),
    validationState: validationState("validation_state").notNull().default("PENDING"),
    validationError: text("validation_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    unique("matches_match_id_patch_id_unique").on(table.matchId, table.patchId),
    index("matches_patch_validation_idx").on(table.patchId, table.validationState),
    check("matches_duration_nonnegative", sql`${table.gameDuration} >= 0`)
  ]
);

export const participantObservations = pgTable(
  "participant_observations",
  {
    matchId: text("match_id").notNull(),
    participantId: integer("participant_id").notNull(),
    patchId: integer("patch_id").notNull().references(() => patches.id),
    puuid: text("puuid").notNull(),
    championId: integer("champion_id").notNull(),
    role: role("role").notNull(),
    win: boolean("win").notNull(),
    tier: tier("tier").notNull(),
    division: varchar("division", { length: 3 }).notNull(),
    gameDuration: integer("game_duration").notNull(),
    rawFinalSlots: jsonb("raw_final_slots").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.participantId] }),
    foreignKey({ columns: [table.matchId, table.patchId], foreignColumns: [matches.matchId, matches.patchId] }),
    unique("participant_observations_identity_patch_unique").on(table.matchId, table.participantId, table.patchId),
    index("participant_observations_patch_champion_role_idx").on(table.patchId, table.championId, table.role)
  ]
);

export const participantRejections = pgTable(
  "participant_rejections",
  {
    matchId: text("match_id").notNull(),
    participantId: integer("participant_id").notNull(),
    patchId: integer("patch_id").notNull(),
    reason: rejectionReason("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.participantId] }),
    foreignKey({ columns: [table.matchId, table.patchId], foreignColumns: [matches.matchId, matches.patchId] })
  ]
);

export const participantCoreItems = pgTable(
  "participant_core_items",
  {
    matchId: text("match_id").notNull(),
    participantId: integer("participant_id").notNull(),
    patchId: integer("patch_id").notNull(),
    slotIndex: integer("slot_index").notNull(),
    itemId: integer("item_id").notNull(),
    quantity: integer("quantity").notNull().default(1)
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.participantId, table.slotIndex] }),
    foreignKey({ columns: [table.matchId, table.participantId, table.patchId], foreignColumns: [participantObservations.matchId, participantObservations.participantId, participantObservations.patchId] }),
    foreignKey({ columns: [table.patchId, table.itemId], foreignColumns: [items.patchId, items.itemId] }),
    check("participant_core_items_slot_nonnegative", sql`${table.slotIndex} >= 0`),
    check("participant_core_items_quantity_positive", sql`${table.quantity} > 0`)
  ]
);

export const participantBoots = pgTable(
  "participant_boots",
  {
    matchId: text("match_id").notNull(),
    participantId: integer("participant_id").notNull(),
    patchId: integer("patch_id").notNull(),
    itemId: integer("item_id").notNull(),
    slotIndex: integer("slot_index")
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.participantId] }),
    foreignKey({ columns: [table.matchId, table.participantId, table.patchId], foreignColumns: [participantObservations.matchId, participantObservations.participantId, participantObservations.patchId] }),
    foreignKey({ columns: [table.patchId, table.itemId], foreignColumns: [items.patchId, items.itemId] })
  ]
);

export const aggregatePublications = pgTable(
  "aggregate_publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    patchId: integer("patch_id").notNull().references(() => patches.id),
    runId: uuid("run_id").notNull().references(() => collectionRuns.id),
    coverageStartedAt: timestamp("coverage_started_at", { withTimezone: true, mode: "date" }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    minimumSample: integer("minimum_sample").notNull().default(100),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex("aggregate_publications_one_active_idx").on(table.isActive).where(sql`${table.isActive} = true`),
    uniqueIndex("aggregate_publications_one_per_run_idx").on(table.runId),
    check("aggregate_publications_minimum_sample_nonnegative", sql`${table.minimumSample} >= 0`)
  ]
);

export const itemAggregates = pgTable(
  "item_aggregates",
  {
    publicationId: uuid("publication_id").notNull().references(() => aggregatePublications.id),
    championId: integer("champion_id").notNull(),
    role: role("role").notNull(),
    itemId: integer("item_id").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.championId, table.role, table.itemId] }), check("item_aggregates_counts_nonnegative", sql`${table.wins} >= 0 AND ${table.losses} >= 0 AND ${table.sample} >= 0`)]
);

export const baselineAggregates = pgTable(
  "baseline_aggregates",
  {
    publicationId: uuid("publication_id").notNull().references(() => aggregatePublications.id),
    championId: integer("champion_id").notNull(),
    role: role("role").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.championId, table.role] }),
    check("baseline_aggregates_counts_nonnegative", sql`${table.wins} >= 0 AND ${table.losses} >= 0 AND ${table.sample} >= 0`),
    check("baseline_aggregates_counts_equal", sql`${table.wins} + ${table.losses} = ${table.sample}`)
  ]
);

export const combinationAggregates = pgTable(
  "combination_aggregates",
  {
    publicationId: uuid("publication_id").notNull().references(() => aggregatePublications.id),
    championId: integer("champion_id").notNull(),
    role: role("role").notNull(),
    size: integer("size").notNull(),
    combinationKey: text("combination_key").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0)
  },
  (table) => [
    primaryKey({ columns: [table.publicationId, table.championId, table.role, table.size, table.combinationKey] }),
    check("combination_aggregates_size_valid", sql`${table.size} IN (2, 3)`),
    check("combination_aggregates_counts_nonnegative", sql`${table.wins} >= 0 AND ${table.losses} >= 0 AND ${table.sample} >= 0`)
  ]
);

export const bootsAggregates = pgTable(
  "boots_aggregates",
  {
    publicationId: uuid("publication_id").notNull().references(() => aggregatePublications.id),
    championId: integer("champion_id").notNull(),
    role: role("role").notNull(),
    itemId: integer("item_id").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    sample: integer("sample").notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.publicationId, table.championId, table.role, table.itemId] }), check("boots_aggregates_counts_nonnegative", sql`${table.wins} >= 0 AND ${table.losses} >= 0 AND ${table.sample} >= 0`)]
);

export const schemaContract = {
  patches: "pk(id), unique(version)",
  champions: "pk(patch_id, champion_id), unique(patch_id, slug)",
  items: "pk(patch_id, item_id)",
  collectionRuns: "pk(id), index(status, started_at)",
  ladderSnapshots: "pk(run_id, puuid), index(run_id, tier), next_match_offset",
  discoveredMatches: "pk(run_id, match_id), index(run_id)",
  matches: "pk(match_id), index(patch_id, validation_state)",
  participantObservations: "pk(match_id, participant_id), index(patch_id, champion_id, role)",
  participantRejections: "pk(match_id, participant_id), fk(match_id, patch_id)",
  participantCoreItems: "pk(match_id, participant_id, slot_index)",
  participantBoots: "pk(match_id, participant_id)",
  aggregatePublications: "pk(id), unique run target, unique active partial index",
  itemAggregates: "pk(publication_id, champion_id, role, item_id)",
  baselineAggregates: "pk(publication_id, champion_id, role)",
  combinationAggregates: "pk(publication_id, champion_id, role, size, combination_key)",
  bootsAggregates: "pk(publication_id, champion_id, role, item_id)"
} as const;

export type Schema = typeof schemaContract;
