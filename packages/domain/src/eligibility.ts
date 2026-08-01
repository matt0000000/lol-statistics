import { toPatchKey, type PatchKey } from "./patch";
import { parseTeamPosition, type Role } from "./role";
import { parseDivision, parseTier, type Division, type Tier } from "./tiers";

export type RejectionReason = "platform" | "queue" | "patch" | "rank" | "role" | "remake" | "duration" | "required_field" | "unknown_item" | "invalid_item";
export type EligibilityResult = { accepted: true; role: Role; tier?: Tier; division?: Division } | { accepted: false; reason: RejectionReason };

export type EligibilityInput = {
  platformId?: unknown;
  queueId?: unknown;
  gameVersion?: unknown;
  activePatch: PatchKey | string;
  duration?: unknown;
  eligible?: unknown;
  role?: unknown;
  remake?: unknown;
  tier?: unknown;
  division?: unknown;
};

/** Apply the match scope in a fixed order. Diagnostics intentionally contain no payload values. */
export function evaluateParticipant(input: EligibilityInput): EligibilityResult {
  if (input.platformId !== "TR1") return { accepted: false, reason: "platform" };
  if (input.queueId !== 420) return { accepted: false, reason: "queue" };
  if (typeof input.gameVersion !== "string" || input.gameVersion.length === 0 || typeof input.activePatch !== "string" || input.activePatch.length === 0) {
    return { accepted: false, reason: "required_field" };
  }
  let patch: PatchKey;
  try { patch = toPatchKey(input.gameVersion); } catch { return { accepted: false, reason: "patch" }; }
  if (patch !== input.activePatch) return { accepted: false, reason: "patch" };
  if (input.eligible !== true && !(input.eligible && typeof input.eligible === "object")) return { accepted: false, reason: "rank" };
  const role = parseTeamPosition(typeof input.role === "string" ? input.role : "");
  if (!role) return { accepted: false, reason: "role" };
  if (input.remake === true) return { accepted: false, reason: "remake" };
  if (typeof input.duration !== "number" || !Number.isSafeInteger(input.duration)) return { accepted: false, reason: "required_field" };
  if (typeof input.remake !== "boolean") return { accepted: false, reason: "required_field" };
  if (input.duration < 300) return { accepted: false, reason: "duration" };
  if (input.eligible && typeof input.eligible === "object") {
    const entry = input.eligible as Record<string, unknown>;
    const tier = parseTier(entry.tier ?? input.tier);
    const division = parseDivision(entry.division ?? entry.rank ?? input.division);
    if (!tier || !division) return { accepted: false, reason: "rank" };
    return { accepted: true, role, tier, division };
  }
  return { accepted: true, role };
}
