export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export type Role = (typeof ROLES)[number];

export function parseTeamPosition(value: string): Role | null {
  return ROLES.find((role) => role === value) ?? null;
}

export function roleLabel(role: Role): string {
  return role === "UTILITY" ? "Support" : role[0] + role.slice(1).toLowerCase();
}
