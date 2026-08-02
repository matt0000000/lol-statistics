const publicationScopes = new WeakMap<object, string>();

export function attachPublicationScope<T>(value: T, publicationId: unknown): T {
  if (value && typeof value === "object" && typeof publicationId === "string" && publicationId.length > 0) {
    publicationScopes.set(value, publicationId);
  }
  return value;
}

export function publicationScopeOf(value: unknown): string | undefined {
  return value && typeof value === "object" ? publicationScopes.get(value) : undefined;
}
