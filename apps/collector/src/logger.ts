import pino, { type Logger } from "pino";

const ALLOWED = new Set([
  "runId", "stage", "endpointCategory", "host", "responseStatus", "attempt", "duration", "aggregateCount", "matchesDiscovered", "matchesIngested", "observationsAccepted", "observationsRejected", "unknownItemCount", "category", "event"
]);
const SECRET_KEYS = /(?:riot.?api.?key|puuid|x.?riot.?token|authorization|request.?path|url|token|password|database.?url)/i;

export type CollectorLogger = Pick<Logger, "info" | "warn" | "error" | "debug"> & { child: () => CollectorLogger };

export function createCollectorLogger(options: { write?: (line: string) => void; level?: string } = {}): CollectorLogger {
  const sink = options.write ? { write: options.write } : undefined;
  const base = pino({ level: options.level ?? "info", redact: { paths: ["riotApiKey", "puuid", "headers.X-Riot-Token", "requestPath", "url", "databaseUrl"], censor: "[REDACTED]" } }, sink as never);
  const emit = (method: "info" | "warn" | "error" | "debug", value: unknown, rest: unknown[]) => {
    const fields = sanitizeFields(value);
    (base[method] as unknown as (fields: Record<string, unknown>, ...args: unknown[]) => void)(fields, ...rest);
  };
  const logger = {
    info: (value: unknown, ...rest: unknown[]) => emit("info", value, rest),
    warn: (value: unknown, ...rest: unknown[]) => emit("warn", value, rest),
    error: (value: unknown, ...rest: unknown[]) => emit("error", value, rest),
    debug: (value: unknown, ...rest: unknown[]) => emit("debug", value, rest),
    child: () => logger
  } as CollectorLogger;
  return logger;
}

export const createLogger = createCollectorLogger;

function sanitizeFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { event: "log" };
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED.has(key) || SECRET_KEYS.test(key)) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) result[key] = redactScalar(raw);
  }
  return result;
}

function redactScalar(value: string | number | boolean | null): string | number | boolean | null {
  if (typeof value !== "string") return value;
  // Values are already constrained to safe fields; remove common encoded path/identifier forms too.
  return value.replaceAll(/(?:RGAPI-[A-Za-z0-9._~-]+|puuid[-_A-Za-z0-9._~%]*|\/lol\/[^\s"']+)/gi, "[REDACTED]");
}
