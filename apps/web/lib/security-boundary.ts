import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

type ImportEdge = { specifier: string; source: string };
type ImportParse = { edges: ImportEdge[]; diagnostics: ts.Diagnostic[] };
type ResolverConfig = { options: ts.CompilerOptions; configPath?: string };
type SelectedPathMapping = { targets: string[]; substitution: string };
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

function scriptKindFor(fileName: string): ts.ScriptKind {
  switch (extname(fileName).toLowerCase()) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function importsOf(source: string, fileName = "module.tsx"): ImportParse {
  const imports: ImportEdge[] = [];
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const add = (specifier: ts.Expression): void => {
    if (ts.isStringLiteralLike(specifier)) imports.push({ specifier: specifier.text, source: specifier.getText(sourceFile) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { edges: imports, diagnostics: (sourceFile as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? [] };
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

async function configFor(root: string): Promise<ResolverConfig> {
  const configPath = join(root, "tsconfig.json");
  if (!ts.sys.fileExists(configPath)) return { options: {} };
  try {
    const parsed = ts.readConfigFile(configPath, ts.sys.readFile);
    if (parsed.error) throw new Error(`Invalid tsconfig ${configPath}: ${diagnosticText(parsed.error)}`);
    const config = ts.parseJsonConfigFileContent(parsed.config, ts.sys, resolve(root), undefined, configPath);
    if (config.errors.length > 0) throw new Error(`Invalid tsconfig ${configPath}: ${config.errors.map(diagnosticText).join("; ")}`);
    return { options: config.options, configPath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { options: {} };
    throw error;
  }
}

async function nearestConfig(fileName: string, boundaryRoot: string, fallback: ResolverConfig, cache: Map<string, Promise<ResolverConfig>>): Promise<ResolverConfig> {
  let directory = dirname(fileName);
  while (inside(boundaryRoot, directory)) {
    const configPath = join(directory, "tsconfig.json");
    if (ts.sys.fileExists(configPath)) {
      let config = cache.get(configPath);
      if (!config) {
        config = configFor(directory);
        cache.set(configPath, config);
      }
      return config;
    }
    if (directory === boundaryRoot) break;
    directory = dirname(directory);
  }
  return fallback;
}

function allowedResolverPath(candidate: string, workspaceRoot: string): boolean {
  const absolute = resolve(candidate);
  if (!inside(workspaceRoot, absolute)) return false;
  if (!absolute.split(sep).includes("node_modules")) return true;
  try {
    const canonical = realpathSync.native(absolute);
    return inside(workspaceRoot, canonical) && !canonical.split(sep).includes("node_modules");
  } catch { return false; }
}

function resolverHost(workspaceRoot: string): { host: ts.ModuleResolutionHost; blocked: { value: boolean } } {
  const blocked = { value: false };
  const checked = (fileName: string): boolean => {
    const allowed = allowedResolverPath(fileName, workspaceRoot);
    if (!allowed && fileName.split(sep).includes("node_modules")) blocked.value = true;
    return allowed;
  };
  return { host: {
    fileExists: (fileName) => checked(fileName) && ts.sys.fileExists(fileName),
    readFile: (fileName) => checked(fileName) ? ts.sys.readFile(fileName) : undefined,
    directoryExists: (directoryName) => checked(directoryName) && ts.sys.directoryExists(directoryName),
    realpath: (fileName) => {
      try { return realpathSync.native(fileName); } catch { return fileName; }
    },
    getCurrentDirectory: () => workspaceRoot
  }, blocked };
}

function configuredPath(specifier: string, options: ts.CompilerOptions): boolean {
  return selectedPathMapping(specifier, options) !== undefined;
}

function selectedPathMapping(specifier: string, options: ts.CompilerOptions): SelectedPathMapping | undefined {
  const paths = options.paths ?? {};
  const exact = paths[specifier];
  if (exact) return { targets: exact, substitution: "" };
  let match: { targets: string[]; substitution: string; prefixLength: number } | undefined;
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
    if (!match || prefix.length > match.prefixLength) {
      match = { targets, substitution: specifier.slice(prefix.length, specifier.length - suffix.length || undefined), prefixLength: prefix.length };
    }
  }
  return match ? { targets: match.targets, substitution: match.substitution } : undefined;
}

async function validateConfiguredTargets(specifier: string, config: ResolverConfig, allowedRoots: readonly string[]): Promise<boolean> {
  const mapping = selectedPathMapping(specifier, config.options);
  if (!mapping) return true;
  const baseUrl = config.options.baseUrl ?? (config.configPath ? dirname(config.configPath) : undefined);
  if (!baseUrl) return false;
  for (const target of mapping.targets) {
    const substituted = target.replace("*", mapping.substitution);
    const base = resolve(substituted.startsWith(sep) ? substituted : join(baseUrl, substituted));
    for (const candidate of candidatePaths(base)) {
      if (!allowedRoots.some((root) => inside(root, candidate))) return false;
      try {
        const canonical = await realpath(candidate);
        if (!allowedRoots.some((root) => inside(root, canonical))) return false;
      } catch { /* unresolved targets are checked lexically and remain unresolved */ }
    }
  }
  return true;
}

async function resolveImport(specifier: string, from: string, workspaceRoot: string, config: ResolverConfig, allowedRoots: readonly string[]): Promise<{ path?: string; unresolvedAlias?: boolean }> {
  if (!(await validateConfiguredTargets(specifier, config, allowedRoots))) return { unresolvedAlias: true };
  const resolver = resolverHost(workspaceRoot);
  const resolved = ts.resolveModuleName(specifier, from, config.options, resolver.host).resolvedModule;
  if (configuredPath(specifier, config.options) && resolver.blocked.value) return { unresolvedAlias: true };
  if (resolved) {
    try {
      const canonical = await realpath(resolved.resolvedFileName);
      const external = canonical.split(sep).includes("node_modules") || resolved.isExternalLibraryImport;
      if (external) {
        if (configuredPath(specifier, config.options) || specifier.startsWith(".") || /^@lol\//.test(specifier)) return { unresolvedAlias: true };
        return {};
      }
      if (!allowedRoots.some((root) => inside(root, canonical))) return { unresolvedAlias: true };
      return { path: canonical };
    } catch { return { unresolvedAlias: true }; }
  }
  if (specifier.startsWith(".")) {
    const imported = await existingPath(join(dirname(from), specifier), allowedRoots);
    return imported.unsafe ? { unresolvedAlias: true } : { path: imported.path };
  }
  if (configuredPath(specifier, config.options)) return { unresolvedAlias: true };
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
  const rootConfig = await configFor(root);
  const configCache = new Map<string, Promise<ResolverConfig>>();
  const rootConfigPath = rootConfig.configPath;
  if (rootConfigPath) configCache.set(rootConfigPath, Promise.resolve(rootConfig));
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
    const parsed = importsOf(source, canonical);
    if (parsed.diagnostics.length > 0) {
      violations.push(`${relative(workspaceRoot, canonical)} has parse diagnostics`);
      return;
    }
    for (const edge of parsed.edges) {
      if (/@lol\/(?:database|collector)(?:\/|$)|(?:^|[/\\])(?:database|collector)(?:[/\\]|$)/i.test(edge.specifier)) {
        violations.push(`${relative(workspaceRoot, canonical)} imports forbidden ${edge.specifier}`);
      }
      const config = await nearestConfig(canonical, canonicalWorkspaceRoot, rootConfig, configCache);
      const resolution = await resolveImport(edge.specifier, canonical, workspaceRoot, config, allowedRoots);
      if (resolution.unresolvedAlias || (!resolution.path && (edge.specifier.startsWith(".") || configuredPath(edge.specifier, config.options)))) violations.push(`${relative(workspaceRoot, canonical)} has unresolved alias ${edge.specifier}`);
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
