import z from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RIOT_API_KEY: z.string().min(1),
  RIOT_PLATFORM: z.literal("TR1").default("TR1"),
  RIOT_REGION: z.literal("EUROPE").default("EUROPE")
});

export type CollectorConfig = {
  databaseUrl: string;
  riotApiKey: string;
  platform: "TR1";
  region: "EUROPE";
};

export function readCollectorConfig(
  environment: Record<string, string | undefined>
): CollectorConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    riotApiKey: parsed.RIOT_API_KEY,
    platform: parsed.RIOT_PLATFORM,
    region: parsed.RIOT_REGION
  };
}
