export type RiotErrorCategory = "auth" | "rate_limit" | "not_found" | "server" | "network" | "schema";

export class RiotHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly category: RiotErrorCategory,
  ) {
    super(message);
    this.name = "RiotHttpError";
  }
}
