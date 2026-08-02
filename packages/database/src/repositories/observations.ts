import { and, eq, sql } from "drizzle-orm";
import { toPatchKey, type RejectionReason } from "@lol/domain";
import { assertEligibleRun } from "./ladder";
import { collectionRuns, discoveredMatches, matches, participantBoots, participantCoreItems, participantObservations, participantRejections, patches } from "../schema";

export type ParsedCoreItem = { itemId: number; quantity: number; slotIndex: number };
export type ParsedBoots = { itemId: number; slotIndex: number | null };
export type ParsedObservation = {
  participantId: number;
  puuid: string;
  championId: number;
  role: "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";
  win: boolean;
  tier: "EMERALD" | "DIAMOND" | "MASTER" | "GRANDMASTER" | "CHALLENGER";
  division: "I" | "II" | "III" | "IV";
  gameDuration: number;
  rawFinalSlots: number[];
  coreItems: ParsedCoreItem[];
  boots?: ParsedBoots;
};
export type RejectedObservation = { participantId: number; reason: RejectionReason };
export type ParsedParticipant = { accepted: true; observation: ParsedObservation } | { accepted: false; participantId: number; reason: RejectionReason };

export type IngestMatch = {
  metadata: { matchId: string };
  info: {
    platformId: string;
    queueId: number;
    gameVersion: string;
    gameCreation: number;
    gameDuration: number;
  };
};

export type IngestResult = { observationsAccepted: number; observationsRejected: number; replay: boolean };

/** Decide whether a rejected-only canonical audit may be refreshed by a later run. */
export function rejectedRefreshAllowed(input: {
  existingValidationState: string;
  hasAcceptedCanonicalRows: boolean;
  incomingAcceptedCount: number;
  existingRunIds: readonly (string | null | undefined)[];
  currentRunId: string;
}): boolean {
  const runIds = input.existingRunIds;
  const allLegacy = runIds.length > 0 && runIds.every((runId) => runId == null);
  const allPriorRuns = runIds.length > 0 && runIds.every((runId) => runId != null && runId !== input.currentRunId);
  return input.existingValidationState === "REJECTED"
    && !input.hasAcceptedCanonicalRows
    && input.incomingAcceptedCount === 0
    && (allLegacy || allPriorRuns);
}

/** Canonical persistence boundary for one match. All writes happen in one transaction. */
export class ObservationsRepository {
  constructor(private readonly db: any) {}

  async saveValidatedMatch(runId: string, patchId: number, match: IngestMatch, participants: readonly ParsedParticipant[]): Promise<IngestResult> {
    try {
      return await this.db.transaction(async (tx: any) => this.saveInTransaction(tx, runId, patchId, match, participants));
    } catch (error) {
      if (!(error instanceof ReplayConflict)) throw error;
      // The canonical rows must remain untouched, while the run failure is durable.
      await this.db.transaction(async (tx: any) => {
        const locked = await tx.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).for("update").limit(1);
        if (locked[0] && locked[0].status !== "FAILED") {
          await tx.update(collectionRuns).set({ status: "FAILED", finishedAt: new Date(), errorDetails: { code: "INGEST_FAILED", stage: "ingest" }, updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
        }
      });
      throw new Error("match replay conflict");
    }
  }

  private async saveInTransaction(tx: any, runId: string, patchId: number, match: IngestMatch, participants: readonly ParsedParticipant[]): Promise<IngestResult> {
    if (participants.length === 0) throw new Error("match has no participants");
    await assertEligibleRun(tx, runId, true);
    if (!Number.isSafeInteger(patchId) || patchId < 1) throw new Error("invalid patch");
    const patch = (await tx.select().from(patches).where(eq(patches.id, patchId)).limit(1))[0];
    if (!patch) throw new Error("patch not found");
    if (patch.isActive !== true) throw new Error("patch is not active");
    const found = await tx.select({ matchId: discoveredMatches.matchId }).from(discoveredMatches).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.matchId, match.metadata.matchId))).limit(1);
    if (!found[0]) throw new Error("match does not belong to collection run");
    let matchPatch: string | undefined;
    try { matchPatch = toPatchKey(match.info.gameVersion); } catch {
      matchPatch = undefined;
    }
    if (matchPatch !== patch.patchKey) throw new Error("match patch mismatch");

    const accepted = participants.filter((part): part is Extract<ParsedParticipant, { accepted: true }> => part.accepted);
    const rejected = participants.length - accepted.length;
    const values = {
      matchId: match.metadata.matchId,
      patchId,
      platformId: match.info.platformId,
      queueId: match.info.queueId,
      gameVersion: match.info.gameVersion,
      gameCreation: new Date(match.info.gameCreation),
      gameDuration: match.info.gameDuration,
      validationState: accepted.length > 0 ? "VALID" as const : "REJECTED" as const,
      validationError: accepted.length > 0 ? null : "NO_ELIGIBLE_PARTICIPANTS"
    };
    await tx.insert(matches).values(values).onConflictDoNothing({ target: matches.matchId });
    const existing = (await tx.select().from(matches).where(eq(matches.matchId, match.metadata.matchId)).for("update").limit(1))[0];
    if (!existing) throw new Error("match could not be persisted");
    const rejectedUpgrade = existing.validationState === "REJECTED" && values.validationState === "VALID";
    if (existing.patchId !== patchId || existing.platformId !== values.platformId || existing.queueId !== values.queueId || existing.gameVersion !== values.gameVersion || existing.gameDuration !== values.gameDuration || (!rejectedUpgrade && existing.validationState !== values.validationState) || (!rejectedUpgrade && existing.validationError !== values.validationError) || new Date(existing.gameCreation).getTime() !== values.gameCreation.getTime()) {
      throw new ReplayConflict();
    }
    const hasAcceptedCanonicalRows = await this.hasAcceptedCanonicalRows(tx, match.metadata.matchId);
    const hasCanonicalRows = await this.hasCanonicalRows(tx, match.metadata.matchId);
    // A rejected match with observations violates the canonical invariant. Check
    // before any upgrade, replacement, or deletion so the failure is atomic.
    if (existing.validationState === "REJECTED" && hasAcceptedCanonicalRows) throw new ReplayConflict();
    if (hasCanonicalRows) {
      if (await this.sameCanonical(tx, match.metadata.matchId, patchId, participants)) {
        return { observationsAccepted: accepted.length, observationsRejected: rejected, replay: true };
      }
      const rejectionRows = await tx.select({ runId: participantRejections.runId }).from(participantRejections).where(eq(participantRejections.matchId, match.metadata.matchId));
      if (rejectedRefreshAllowed({ existingValidationState: existing.validationState, hasAcceptedCanonicalRows, incomingAcceptedCount: accepted.length, existingRunIds: rejectionRows.map((row: { runId: string | null }) => row.runId), currentRunId: runId })) {
        await tx.delete(participantRejections).where(and(eq(participantRejections.matchId, match.metadata.matchId), eq(participantRejections.patchId, patchId)));
        await tx.insert(participantRejections).values(participants.filter((part): part is Extract<ParsedParticipant, { accepted: false }> => !part.accepted).map((part) => ({ matchId: match.metadata.matchId, participantId: part.participantId, patchId, reason: part.reason, runId })));
        await tx.update(collectionRuns).set({ matchesIngested: sql`${collectionRuns.matchesIngested} + 1`, observationsRejected: sql`${collectionRuns.observationsRejected} + ${rejected}`, updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
        return { observationsAccepted: 0, observationsRejected: rejected, replay: false };
      }
      if (!rejectedUpgrade) throw new ReplayConflict();
    } else if (!rejectedUpgrade && existing.validationState !== values.validationState) {
      throw new ReplayConflict();
    }
    if (rejectedUpgrade) {
      await tx.delete(participantRejections).where(and(eq(participantRejections.matchId, match.metadata.matchId), eq(participantRejections.patchId, patchId)));
      await tx.update(matches).set({ validationState: "VALID", validationError: null }).where(eq(matches.matchId, match.metadata.matchId));
    }
    for (const part of accepted) {
      const observation = part.observation;
      await tx.insert(participantObservations).values({ matchId: match.metadata.matchId, participantId: observation.participantId, patchId, puuid: observation.puuid, championId: observation.championId, role: observation.role, win: observation.win, tier: observation.tier, division: observation.division, gameDuration: observation.gameDuration, rawFinalSlots: observation.rawFinalSlots });
      if (observation.coreItems.length) await tx.insert(participantCoreItems).values(observation.coreItems.map((item) => ({ matchId: match.metadata.matchId, participantId: observation.participantId, patchId, slotIndex: item.slotIndex, itemId: item.itemId, quantity: item.quantity })));
      if (observation.boots) await tx.insert(participantBoots).values({ matchId: match.metadata.matchId, participantId: observation.participantId, patchId, itemId: observation.boots.itemId, slotIndex: observation.boots.slotIndex });
    }
    const rejectedParticipants = participants.filter((part): part is Extract<ParsedParticipant, { accepted: false }> => !part.accepted);
    if (rejectedParticipants.length) await tx.insert(participantRejections).values(rejectedParticipants.map((part) => ({ matchId: match.metadata.matchId, participantId: part.participantId, patchId, reason: part.reason, runId })));
    await tx.update(collectionRuns).set({ matchesIngested: sql`${collectionRuns.matchesIngested} + 1`, observationsAccepted: sql`${collectionRuns.observationsAccepted} + ${accepted.length}`, observationsRejected: sql`${collectionRuns.observationsRejected} + ${rejected}`, updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
    return { observationsAccepted: accepted.length, observationsRejected: rejected, replay: false };
  }

  private async hasCanonicalRows(tx: any, matchId: string): Promise<boolean> {
    const [observation, rejection] = await Promise.all([
      tx.select({ participantId: participantObservations.participantId }).from(participantObservations).where(eq(participantObservations.matchId, matchId)).limit(1),
      tx.select({ participantId: participantRejections.participantId }).from(participantRejections).where(eq(participantRejections.matchId, matchId)).limit(1)
    ]);
    return observation.length > 0 || rejection.length > 0;
  }

  private async hasAcceptedCanonicalRows(tx: any, matchId: string): Promise<boolean> {
    const rows = await tx.select({ participantId: participantObservations.participantId }).from(participantObservations).where(eq(participantObservations.matchId, matchId)).limit(1);
    return rows.length > 0;
  }

  private async sameCanonical(tx: any, matchId: string, patchId: number, participants: readonly ParsedParticipant[]): Promise<boolean> {
    const accepted = participants.filter((part): part is Extract<ParsedParticipant, { accepted: true }> => part.accepted);
    const rejected = participants.filter((part): part is Extract<ParsedParticipant, { accepted: false }> => !part.accepted);
    const rows = await tx.select().from(participantObservations).where(eq(participantObservations.matchId, matchId));
    const rejectionRows = await tx.select().from(participantRejections).where(eq(participantRejections.matchId, matchId));
    if (rows.length !== accepted.length) return false;
    if (rejectionRows.length !== rejected.length) return false;
    if (rejectionRows.some((row: any) => !rejected.some((part) => part.participantId === row.participantId && part.reason === row.reason && row.patchId === patchId))) return false;
    for (const part of accepted) {
      const o = part.observation;
      const row = rows.find((candidate: any) => candidate.participantId === o.participantId);
      if (!row || row.patchId !== patchId || row.puuid !== o.puuid || row.championId !== o.championId || row.role !== o.role || row.win !== o.win || row.tier !== o.tier || row.division !== o.division || row.gameDuration !== o.gameDuration || JSON.stringify(row.rawFinalSlots) !== JSON.stringify(o.rawFinalSlots)) return false;
      const cores = await tx.select().from(participantCoreItems).where(and(eq(participantCoreItems.matchId, matchId), eq(participantCoreItems.participantId, o.participantId)));
      if (cores.length !== o.coreItems.length || cores.some((core: any) => !o.coreItems.some((item) => item.slotIndex === core.slotIndex && item.itemId === core.itemId && item.quantity === core.quantity))) return false;
      const boots = await tx.select().from(participantBoots).where(and(eq(participantBoots.matchId, matchId), eq(participantBoots.participantId, o.participantId)));
      if ((o.boots ? 1 : 0) !== boots.length || (o.boots && (!boots[0] || boots[0].itemId !== o.boots.itemId || boots[0].slotIndex !== o.boots.slotIndex))) return false;
    }
    return true;
  }
}

/** Backwards-compatible singular spelling for callers that use repository naming conventions. */
export class ObservationRepository extends ObservationsRepository {}

export async function saveValidatedMatch(db: any, runId: string, patchId: number, match: IngestMatch, participants: readonly ParsedParticipant[]): Promise<IngestResult> {
  return new ObservationsRepository(db).saveValidatedMatch(runId, patchId, match, participants);
}

class ReplayConflict extends Error {}
