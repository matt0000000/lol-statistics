import z from "zod";

const webEnvironmentSchema = z.object({
  DATABASE_READ_URL: z.string().url().or(z.string().startsWith("postgres://")).or(z.string().startsWith("postgresql://")),
  PUBLIC_SITE_URL: z.string().url()
}).passthrough();

const forbiddenWebKeys = ["DATABASE_URL", "RIOT_API_KEY", "RIOT_PLATFORM", "RIOT_REGION"] as const;

export type WebConfig = {
  databaseReadUrl: string;
  publicSiteUrl: string;
};

/** Parse the deliberately small web environment surface without echoing secrets. */
export function readWebConfig(environment: Record<string, string | undefined>): WebConfig {
  const result = webEnvironmentSchema.safeParse(environment);
  if (!result.success || forbiddenWebKeys.some((key) => environment[key] !== undefined)) throw new Error("Invalid web configuration");
  return { databaseReadUrl: result.data.DATABASE_READ_URL, publicSiteUrl: result.data.PUBLIC_SITE_URL };
}
