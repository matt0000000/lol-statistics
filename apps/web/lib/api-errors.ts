import { publicQueryErrorSchema, type PublicQueryError } from "@lol/public-api";

export type ApiError = PublicQueryError | { code: "invalid_request" | "internal_error" };

export function responseForError(error: ApiError): Response {
  let body: Record<string, unknown>;
  let status: number;
  if (error.code === "dataset_warming") {
    body = { code: "dataset_warming", retryAfterSeconds: 300 };
    status = 503;
  } else if (error.code === "champion_not_found" || error.code === "role_not_found") {
    body = { code: error.code };
    status = 404;
  } else if (error.code === "invalid_request") {
    body = { code: "invalid_request" };
    status = 400;
  } else {
    body = { code: "internal_error" };
    status = 500;
  }
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  if (status === 503) headers.set("Retry-After", "300");
  return Response.json(body, { status, headers });
}

export function mapQueryResult(value: unknown): ApiError | undefined {
  const parsed = publicQueryErrorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
