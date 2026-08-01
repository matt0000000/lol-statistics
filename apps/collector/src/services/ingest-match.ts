import { evaluateParticipant, toPatchKey, type LadderEligibility, type Role } from "@lol/domain";
import { aliasesFor, normalizeItemId } from "@lol/item-catalog";
import type { MatchDto, MatchParticipant } from "@lol/riot-client";
import type { ObservationsRepository, ParsedCoreItem, ParsedParticipant } from "@lol/database";

export type CatalogItem = { itemId?: number; id?: number; category: string; normalizedBaseId?: number };
export type CatalogInput = ReadonlyMap<number, CatalogItem> | readonly CatalogItem[] | Record<string, CatalogItem>;
export type InventoryInput = { participant: Pick<MatchParticipant, "item0" | "item1" | "item2" | "item3" | "item4" | "item5" | "item6">; catalog: CatalogInput; gameVersion: string; aliases?: Readonly<Record<number, number>> };
export type FinalInventory = { rawFinalSlots: number[]; coreItems: ParsedCoreItem[]; boots?: { itemId: number; slotIndex: number } };

export class InventoryParseError extends Error {
  constructor(readonly code: "unknown_item" | "invalid_item") { super(`inventory parse failed (${code})`); }
}

/** Normalize final slots into a deterministic core multiset and one boots observation. */
export function parseFinalInventory(input: InventoryInput): FinalInventory {
  const slots = [input.participant.item0, input.participant.item1, input.participant.item2, input.participant.item3, input.participant.item4, input.participant.item5, input.participant.item6];
  const aliases = input.aliases ?? aliasesFor(input.gameVersion);
  const records = catalogRecords(input.catalog);
  const core = new Map<number, ParsedCoreItem>();
  let boots: { itemId: number; slotIndex: number } | undefined;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const raw = slots[slotIndex]!;
    if (raw === 0) continue;
    if (!Number.isSafeInteger(raw) || raw < 0) throw new InventoryParseError("invalid_item");
    const canonical = normalizeItemId(raw, aliases);
    const item = records.get(canonical) ?? records.get(raw);
    if (!item) throw new InventoryParseError("unknown_item");
    const itemId = Number(item.normalizedBaseId ?? canonical);
    if (!records.has(itemId)) throw new InventoryParseError("unknown_item");
    const category = item.category;
    if (category.startsWith("EXCLUDED_")) continue;
    if (category === "BOOTS") {
      // Riot can report two boots-like slots; retain the first slot deterministically.
      if (!boots) boots = { itemId, slotIndex };
      continue;
    }
    if (category !== "CORE") continue;
    const prior = core.get(itemId);
    if (prior) prior.quantity += 1;
    else core.set(itemId, { itemId, quantity: 1, slotIndex });
  }
  return { rawFinalSlots: slots, coreItems: [...core.values()].sort((a, b) => a.slotIndex - b.slotIndex || a.itemId - b.itemId), boots };
}

export type IngestMatchInput = {
  runId: string;
  patchId: number;
  activePatch: string;
  match: MatchDto;
  eligiblePlayers: ReadonlyMap<string, LadderEligibility> | Readonly<Record<string, LadderEligibility>>;
  catalog: CatalogInput;
  observations: Pick<ObservationsRepository, "saveValidatedMatch">;
  logger?: { warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
};
export type IngestMatchResult = Awaited<ReturnType<ObservationsRepository["saveValidatedMatch"]>>;

export class IngestMatchError extends Error {
  constructor(readonly code: "empty_participants") { super(`match ingestion failed (${code})`); }
}

export async function ingestMatch(input: IngestMatchInput): Promise<IngestMatchResult> {
  if (!input.match?.info || !Array.isArray(input.match.info.participants) || input.match.info.participants.length === 0) throw new IngestMatchError("empty_participants");
  const remake = input.match.info.participants.some((participant) => participant.gameEndedInEarlySurrender === true);
  const activePatch = normalizeActivePatch(input.activePatch);
  // Keep malformed active-patch diagnostics inside participant eligibility; do
  // not throw payload-bearing errors before a safe rejected audit is possible.
  const parsed = input.match.info.participants.map((participant) => parseParticipant(participant, input.match, remake, lookupEligibility(input.eligiblePlayers, participant.puuid), input.catalog, activePatch));
  const result = await input.observations.saveValidatedMatch(input.runId, input.patchId, input.match, parsed);
  input.logger?.warn?.({ event: "match_ingested", runId: input.runId, observationsAccepted: result.observationsAccepted, observationsRejected: result.observationsRejected, state: result.observationsAccepted > 0 ? "VALID" : "REJECTED" });
  return result;
}

function parseParticipant(participant: MatchParticipant, match: MatchDto, remake: boolean, eligible: LadderEligibility | undefined, catalog: CatalogInput, activePatch: string): ParsedParticipant {
  const result = evaluateParticipant({ platformId: match.info.platformId, queueId: match.info.queueId, gameVersion: match.info.gameVersion, activePatch, duration: match.info.gameDuration, eligible: eligible ?? false, role: participant.teamPosition, remake });
  if (!result.accepted || !result.tier || !result.division) return { accepted: false, participantId: participant.participantId, reason: result.accepted ? "rank" : result.reason };
  let inventory: FinalInventory;
  try { inventory = parseFinalInventory({ participant, catalog, gameVersion: match.info.gameVersion }); }
  catch (error) {
    const reason = error instanceof InventoryParseError ? error.code : "invalid_item";
    return { accepted: false, participantId: participant.participantId, reason };
  }
  return { accepted: true, observation: { participantId: participant.participantId, puuid: participant.puuid, championId: participant.championId, role: result.role as Role, win: participant.win, tier: result.tier, division: result.division, gameDuration: match.info.gameDuration, rawFinalSlots: inventory.rawFinalSlots, coreItems: inventory.coreItems, boots: inventory.boots } };
}

function lookupEligibility(input: IngestMatchInput["eligiblePlayers"], puuid: string): LadderEligibility | undefined {
  if (input instanceof Map) return input.get(puuid);
  return (input as Readonly<Record<string, LadderEligibility>>)[puuid];
}

function catalogRecords(catalog: CatalogInput): Map<number, CatalogItem> {
  const entries = catalog instanceof Map ? [...catalog.entries()] : Array.isArray(catalog) ? catalog.map((item) => [Number(item.itemId ?? item.id), item] as const) : Object.entries(catalog).map(([id, item]) => [Number(id), item] as const);
  return new Map(entries.filter(([id, item]) => Number.isSafeInteger(id) && id >= 0 && !!item));
}

function normalizeActivePatch(value: string): string {
  if (!/^\d+\.\d+$/.test(value)) return "";
  try { return toPatchKey(`${value}.0`); } catch { return ""; }
}
