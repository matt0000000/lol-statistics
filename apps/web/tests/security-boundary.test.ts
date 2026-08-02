import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(process.cwd(), "apps/web");
const PRIVATE_TERMS = /RIOT_API_KEY|X-Riot-Token|\bpuuid\b|participantObservations|ladderSnapshots/i;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === ".next" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

async function jsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.name.endsWith(".json")) files.push(path);
  }
  return files;
}

async function readClientComponentSources(root = WEB_ROOT): Promise<string> {
  const files = await sourceFiles(root);
  const clientFiles = files.filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));
  const sources: string[] = [];
  for (const file of clientFiles) {
    const source = await readFile(file, "utf8");
    if (/^\s*["']use client["'];?/m.test(source)) sources.push(source);
  }
  return sources.join("\n");
}

describe("web security boundary", () => {
  it("keeps collector secrets and private database modules out of client components", async () => {
    const files = await sourceFiles(WEB_ROOT);
    const productionSources = await Promise.all(files
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
      .map(async (file) => ({ file, source: await readFile(file, "utf8") })));
    const clientSources = await readClientComponentSources();

    expect(clientSources).not.toMatch(PRIVATE_TERMS);
    expect(productionSources.filter(({ source }) => /apps[\\/]collector|@lol[\\/]collector/.test(source))).toEqual([]);
    for (const { file, source } of productionSources) {
      if (/^\s*["']use client["'];?/m.test(source)) {
        expect(source, relative(process.cwd(), file)).not.toMatch(/@lol\/database|packages\/database/);
      }
    }
  });

  it("keeps private identifiers out of web API fixture snapshots", async () => {
    const fixtureRoots = [join(WEB_ROOT, "tests/fixtures"), join(process.cwd(), "fixtures/api")];
    const fixtureFiles: string[] = [];
    for (const root of fixtureRoots) {
      try { fixtureFiles.push(...await jsonFiles(root)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const snapshots = await Promise.all(fixtureFiles.map((file) => readFile(file, "utf8")));
    expect(snapshots.join("\n")).not.toMatch(PRIVATE_TERMS);
  });
});
