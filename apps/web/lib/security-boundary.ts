import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

type ImportEdge = { specifier: string; source: string };
type PathAlias = { pattern: string; targets: string[] };
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

function importsOf(source: string, fileName = "module.tsx"): ImportEdge[] {
  const imports: ImportEdge[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (specifier: ts.Expression): void => {
    if (ts.isStringLiteralLike(specifier)) imports.push({ specifier: specifier.text, source: specifier.getText(sourceFile) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function candidatePaths(base: string): string[] {
  const extensionless = SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension)) ? base.slice(0, -extname(base).length) : base;
  return [base, extensionless, ...SOURCE_EXTENSIONS.map((extension) => `${extensionless}${extension}`), ...SOURCE_EXTENSIONS.map((extension) => join(extensionless, `index${extension}`))];
}

function inside(root: string, candidate: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(prefix);
}

type ExistingPath = { path?: string; unsafe?: boolean };

async function existingPath(base: string, allowedRoots: readonly string[]): Promise<ExistingPath> {
  for (const candidate of candidatePaths(base)) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      const canonical = await realpath(candidate);
      if (canonical.split(sep).includes("node_modules") || !allowedRoots.some((root) => inside(root, canonical))) return { unsafe: true };
      return { path: canonical };
    } catch { /* unresolved framework/external import */ }
  }
  return {};
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

async function aliasesFor(root: string): Promise<{ baseUrl: string; aliases: PathAlias[]; configPath?: string }> {
  const configPath = join(root, "tsconfig.json");
  if (!ts.sys.fileExists(configPath)) return { baseUrl: root, aliases: [] };
  try {
    const parsed = ts.readConfigFile(configPath, ts.sys.readFile);
    if (parsed.error) throw new Error(`Invalid tsconfig ${configPath}: ${diagnosticText(parsed.error)}`);
    const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, resolve(root), undefined, configPath);
    if (config.errors.length > 0) throw new Error(`Invalid tsconfig ${configPath}: ${config.errors.map(diagnosticText).join("; ")}`);
    const paths = config.options.paths ?? {};
    return { baseUrl: config.options.baseUrl ?? resolve(root), aliases: Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets })), configPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { baseUrl: root, aliases: [] };
    throw error;
  }
}

function aliasTarget(specifier: string, aliases: PathAlias[]): { alias: PathAlias; value: string } | undefined {
  const exact = aliases.find((alias) => !alias.pattern.includes("*") && alias.pattern === specifier);
  if (exact) return { alias: exact, value: "" };
  const matching = aliases.flatMap((alias) => {
    const star = alias.pattern.indexOf("*");
    if (star < 0) return [];
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return [];
    return [{ alias, value: specifier.slice(prefix.length, specifier.length - suffix.length || undefined), prefixLength: prefix.length, suffixLength: suffix.length }];
  });
  matching.sort((left, right) => right.prefixLength - left.prefixLength || right.suffixLength - left.suffixLength);
  return matching[0] && { alias: matching[0].alias, value: matching[0].value };
}

async function resolveImport(specifier: string, from: string, workspaceRoot: string, baseUrl: string, aliases: PathAlias[], allowedRoots: readonly string[]): Promise<{ path?: string; unresolvedAlias?: boolean }> {
  if (specifier.startsWith(".")) {
    const imported = await existingPath(join(dirname(from), specifier), allowedRoots);
    return imported.unsafe ? { unresolvedAlias: true } : { path: imported.path };
  }
  const configured = aliasTarget(specifier, aliases);
  if (configured) {
    for (const target of configured.alias.targets) {
      const substituted = target.replace("*", configured.value);
      const imported = await existingPath(isAbsolute(substituted) ? substituted : resolve(baseUrl, substituted), allowedRoots);
      if (imported.unsafe) return { unresolvedAlias: true };
      if (imported.path) return { path: imported.path };
    }
    return { unresolvedAlias: true };
  }
  const packageMatch = /^@lol\/([^/]+)(?:\/(.*))?$/.exec(specifier);
  if (!packageMatch) return { unresolvedAlias: /^(?:[@~]\/|#)/.test(specifier) };
  const packageRoot = join(workspaceRoot, "packages", packageMatch[1]!);
  const suffix = packageMatch[2];
  const imported = await existingPath(suffix ? join(packageRoot, suffix) : join(packageRoot, "src", "index"), allowedRoots);
  return imported.unsafe ? { unresolvedAlias: true } : { path: imported.path };
}

function privateMatches(source: string): string[] {
  return PRIVATE_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
}

/** Resolve every reachable client module, including package aliases and index/extension variants. */
export async function scanClientBoundary(webRoot: string): Promise<SecurityScanResult> {
  const root = await realpath(resolve(webRoot));
  const appMarker = join("apps", "web");
  const markerIndex = root.lastIndexOf(appMarker);
  const workspaceRoot = markerIndex >= 0 ? root.slice(0, markerIndex) : resolve(root, "../..");
  const sources = await filesUnder(root, SOURCE_EXTENSIONS, root.endsWith(join("apps", "web")));
  const { baseUrl, aliases } = await aliasesFor(root);
  const canonicalWorkspaceRoot = await realpath(workspaceRoot);
  const allowedRoots = [canonicalWorkspaceRoot];
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
    for (const edge of importsOf(source, canonical)) {
      if (/@lol\/(?:database|collector)(?:\/|$)|(?:^|[/\\])(?:database|collector)(?:[/\\]|$)/i.test(edge.specifier)) {
        violations.push(`${relative(workspaceRoot, canonical)} imports forbidden ${edge.specifier}`);
      }
      const resolution = await resolveImport(edge.specifier, canonical, workspaceRoot, baseUrl, aliases, allowedRoots);
      if (resolution.unresolvedAlias || (!resolution.path && (edge.specifier.startsWith(".") || aliasTarget(edge.specifier, aliases)))) violations.push(`${relative(workspaceRoot, canonical)} has unresolved alias ${edge.specifier}`);
      if (resolution.path) await visit(resolution.path);
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
