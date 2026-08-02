import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

type ImportEdge = { specifier: string; source: string };
export type SecurityScanResult = {
  clientFiles: string[];
  violations: string[];
  fixtureViolations: string[];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;
const PRIVATE_PATTERNS: readonly [string, RegExp][] = [
  ["RIOT_API_KEY/X-Riot-Token", /RIOT_API_KEY|X-Riot-Token/i],
  ["puuid", /\bpuuid\b/i],
  ["individual match identifier", /\bmatch[_-]?id\b|\bparticipant[_-]?id\b|\bgame[_-]?creation\b/i],
  ["participant observations", /participant[\s_-]*observations?/i],
  ["ladder snapshots", /ladder[\s_-]*snapshots?/i],
  ["raw slots/items", /raw[\s_-]*(?:final[\s_-]*)?(?:slots?|items?)/i],
  ["private error/detail", /\b(?:error[_-]?details?|private[_-]?(?:error|detail)|unavailable[_-]?reason)\b/i]
];

async function filesUnder(directory: string, extensions: readonly string[], skipTests: boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ([".next", "node_modules", "dist"].includes(entry.name)) continue;
    if (skipTests && entry.name === "tests") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path, extensions, skipTests));
    else if (extensions.includes(extname(entry.name) as (typeof extensions)[number])) files.push(path);
  }
  return files;
}

function importsOf(source: string): ImportEdge[] {
  const imports: ImportEdge[] = [];
  const pattern = /(?:\bimport\s+(?:[^"'()]+?\s+from\s+)?|\bexport\s+[^"']+?\s+from\s+|\bimport\s*\(|\brequire\s*\()(["'])([^"']+)\1/g;
  for (const match of source.matchAll(pattern)) imports.push({ specifier: match[2]!, source: match[0]! });
  return imports;
}

function candidatePaths(base: string): string[] {
  const extensionless = SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension)) ? base.slice(0, -extname(base).length) : base;
  return [base, extensionless, ...SOURCE_EXTENSIONS.map((extension) => `${extensionless}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => join(extensionless, `index${extension}`))];
}

async function existingPath(base: string): Promise<string | undefined> {
  for (const candidate of candidatePaths(base)) {
    try {
      const stat = await import("node:fs/promises").then(({ stat }) => stat(candidate));
      if (stat.isFile()) return resolve(candidate);
    } catch { /* unresolved framework/external import */ }
  }
  return undefined;
}

async function resolveImport(specifier: string, from: string, workspaceRoot: string): Promise<string | undefined> {
  if (specifier.startsWith(".")) return existingPath(join(dirname(from), specifier));
  const packageMatch = /^@lol\/([^/]+)(?:\/(.*))?$/.exec(specifier);
  if (!packageMatch) return undefined;
  const packageRoot = join(workspaceRoot, "packages", packageMatch[1]!);
  const suffix = packageMatch[2];
  return existingPath(suffix ? join(packageRoot, suffix) : join(packageRoot, "src", "index"));
}

function privateMatches(source: string): string[] {
  return PRIVATE_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

/** Resolve every reachable client module, including package aliases and index/extension variants. */
export async function scanClientBoundary(webRoot: string): Promise<SecurityScanResult> {
  const root = resolve(webRoot);
  const appMarker = join("apps", "web");
  const markerIndex = root.lastIndexOf(appMarker);
  const workspaceRoot = markerIndex >= 0 ? root.slice(0, markerIndex) : resolve(root, "../..");
  const sources = await filesUnder(root, SOURCE_EXTENSIONS, root.endsWith(join("apps", "web")));
  const sourceMap = new Map<string, string>();
  for (const file of sources) sourceMap.set(resolve(file), await readFile(file, "utf8"));
  const roots = sources.filter((file) => /^\s*["']use client["'];?/m.test(sourceMap.get(resolve(file))!));
  const reachable = new Set<string>();
  const violations: string[] = [];
  const visit = async (file: string): Promise<void> => {
    const canonical = resolve(file);
    if (reachable.has(canonical)) return;
    reachable.add(canonical);
    const source = sourceMap.get(canonical) ?? await readFile(canonical, "utf8").catch(() => undefined);
    if (source === undefined) return;
    for (const label of privateMatches(source)) violations.push(`${relative(workspaceRoot, canonical)} contains ${label}`);
    for (const edge of importsOf(source)) {
      if (/@lol\/(?:database|collector)(?:\/|$)|(?:^|[/\\])(?:database|collector)(?:[/\\]|$)/i.test(edge.specifier)) {
        violations.push(`${relative(workspaceRoot, canonical)} imports forbidden ${edge.specifier}`);
      }
      const imported = await resolveImport(edge.specifier, canonical, workspaceRoot);
      if (imported) await visit(imported);
    }
  };
  for (const file of roots) await visit(file);

  const fixtureViolations: string[] = [];
  const fixtureRoots = [join(root, "tests", "fixtures"), join(workspaceRoot, "fixtures", "api")];
  for (const fixtureRoot of fixtureRoots) {
    let files: string[];
    try { files = await filesUnder(fixtureRoot, [".json"], false); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const file of files) {
      const matches = privateMatches(await readFile(file, "utf8"));
      for (const label of matches) fixtureViolations.push(`${relative(workspaceRoot, file)} contains ${label}`);
    }
  }
  return { clientFiles: [...reachable].map((file) => relative(workspaceRoot, file)), violations: [...new Set(violations)], fixtureViolations: [...new Set(fixtureViolations)] };
}

export const privateBoundaryPatterns = PRIVATE_PATTERNS;
