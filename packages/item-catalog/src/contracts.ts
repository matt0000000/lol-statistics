import z from "zod";

const imageSchema = z.object({
  full: z.string().min(1)
});

const goldSchema = z.object({
  base: z.number(),
  total: z.number(),
  sell: z.number(),
  purchasable: z.boolean()
});

export const realmSchema = z.object({
  v: z.string().min(1),
  dd: z.string().min(1),
  l: z.string().min(1),
  cdn: z.string().url()
});

const championSchema = z.object({
  id: z.string().min(1),
  key: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform(Number),
  name: z.string().min(1),
  image: imageSchema
});

const itemSchema = z.object({
  name: z.string(),
  description: z.string(),
  gold: goldSchema,
  into: z.array(z.string()).default([]),
  from: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  maps: z.record(z.string(), z.boolean()).default({}),
  purchasable: z.boolean(),
  image: imageSchema
});

export const itemDtoSchema = itemSchema.extend({
  id: z.number().int().nonnegative()
});

export const championCatalogSchema = z.object({
  data: z.record(z.string(), championSchema)
});

export const itemCatalogSchema = z.object({
  data: z.record(z.string(), itemSchema)
});

export type RealmDto = z.infer<typeof realmSchema>;
export type ChampionDto = z.infer<typeof championSchema>;
export type ItemMetadata = z.infer<typeof itemSchema>;
export type ItemDto = z.infer<typeof itemDtoSchema>;
export type ChampionCatalogDto = z.infer<typeof championCatalogSchema>;
export type ItemCatalogDto = z.infer<typeof itemCatalogSchema>;

/** Parse and validate a realm descriptor received from Data Dragon. */
export function parseRealm(input: unknown): RealmDto {
  return realmSchema.parse(input);
}

/** Parse and validate a champion catalog received from Data Dragon. */
export function parseChampionCatalog(input: unknown): ChampionCatalogDto {
  return championCatalogSchema.parse(input);
}

/** Parse and validate an item catalog received from Data Dragon. */
export function parseItemCatalog(input: unknown): ItemCatalogDto {
  return itemCatalogSchema.parse(input);
}

// Fixture loaders intentionally accept unknown values so callers cannot bypass
// the same boundary validation used for live Data Dragon responses.
export const loadRealmFixture = parseRealm;
export const loadChampionFixture = parseChampionCatalog;
export const loadItemFixture = parseItemCatalog;
