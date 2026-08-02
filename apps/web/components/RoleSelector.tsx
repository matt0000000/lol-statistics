import Link from "next/link";
import { isRole, type Role } from "@lol/public-api";

const LABELS: Readonly<Record<Role, string>> = Object.freeze(Object.assign(Object.create(null) as Record<Role, string>, {
  TOP: "Top",
  JUNGLE: "Jungle",
  MIDDLE: "Middle",
  BOTTOM: "Bottom",
  UTILITY: "Support"
}));

export function roleLabel(role: Role): string {
  return LABELS[role];
}

export function RoleSelector({ championSlug, roles, selectedRole, unavailableRole }: {
  championSlug: string;
  roles: Role[];
  selectedRole: Role | null;
  unavailableRole?: string | null;
}) {
  const unavailableLabel = unavailableRole === null || unavailableRole === undefined
    ? null
    : isRole(unavailableRole) ? roleLabel(unavailableRole) : "That role selection";
  return (
    <section className="role-selector" aria-labelledby="role-heading">
      <div>
        <p className="eyebrow">Explore by position</p>
        <h2 id="role-heading">Role</h2>
      </div>
      {unavailableLabel !== null ? <p className="role-warning" role="status">{unavailableLabel} is not available for this champion. Choose one of the published roles below.</p> : null}
      {selectedRole === null && unavailableLabel === null ? <p className="role-prompt">Choose a role to view statistics</p> : null}
      <nav aria-label="Champion role" className="role-links">
        {roles.map((role) => (
          <Link
            key={role}
            href={`/champions/${encodeURIComponent(championSlug)}?role=${role}`}
            aria-current={selectedRole === role ? "page" : undefined}
          >
            {roleLabel(role)}
          </Link>
        ))}
      </nav>
    </section>
  );
}
