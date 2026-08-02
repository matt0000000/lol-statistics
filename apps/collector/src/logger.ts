import pino, { type Logger } from "pino";

const ALLOWED = new Set([
  "runId", "stage", "endpointCategory", "host", "responseStatus", "attempt", "duration", "aggregateCount",
  "matchesDiscovered", "matchesIngested", "observationsAccepted", "observationsRejected", "unknownItemCount", "category", "event", "diagnosticCode"
]);
const SECRET_KEY = /(?:riot.?api.?key|puuid|x.?riot.?token|authorization|request.?path|url|token|password|database.?url|message|error|detail)/i;
const SECRET_VALUE = /(?:RGAPI[-_A-Za-z0-9.%~]+|puuid[-_A-Za-z0-9.%~]+|bearer\s+[-_A-Za-z0-9.%~]+|\/lol\/[^\s"']+)/gi;
const DIAGNOSTIC_CODE = /^[A-Z0-9_]{1,64}$/;

export type CollectorLogger = Pick<Logger, "info" | "warn" | "error" | "debug"> & { child: () => CollectorLogger };
type EventFields = Record<string, unknown>;

/** Structured, allowlisted logger. Message/rest arguments are intentionally unsupported. */
export function createCollectorLogger(options: { write?: (line: string) => void; level?: string } = {}): CollectorLogger {
  const sink = options.write ? { write: options.write } : undefined;
  const base = pino({ level: options.level ?? "info" }, sink as never);
  const emit = (method: "info" | "warn" | "error" | "debug", value: unknown): void => {
    const fields = sanitizeFields(value);
    (base[method] as unknown as (fields: EventFields) => void)(fields);
  };
  const logger = {
    info: (value: EventFields) => emit("info", value),
    warn: (value: EventFields) => emit("warn", value),
    error: (value: EventFields) => emit("error", value),
    debug: (value: EventFields) => emit("debug", value),
    child: () => logger
  } as CollectorLogger;
  return logger;
}

export const createLogger = createCollectorLogger;

function sanitizeFields(value: unknown): EventFields {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Error) return { event: "log" };
  const result: EventFields = {};
  for (const [key, raw] of Object.entries(value as EventFields)) {
    if (!ALLOWED.has(key) || SECRET_KEY.test(key)) continue;
    if (key === "diagnosticCode") {
      if (typeof raw === "string" && DIAGNOSTIC_CODE.test(raw)) result[key] = raw;
    } else if (typeof raw === "string") result[key] = raw.replace(SECRET_VALUE, "[REDACTED]");
    else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) result[key] = raw;
  }
  return result;
}
