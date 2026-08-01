import type { ItemAliases } from "./normalize";

const VERSIONED_ALIASES: Record<string, ItemAliases> = {
  "16.15": { 7002: 3031 }
};

/** Return a defensive copy of the aliases for a Data Dragon major/minor patch. */
export function aliasesFor(version: string): ItemAliases {
  const patch = version.match(/^(\d+\.\d+)/)?.[1];
  return patch ? { ...(VERSIONED_ALIASES[patch] ?? {}) } : {};
}
