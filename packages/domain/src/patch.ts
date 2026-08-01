export type PatchKey = `${number}.${number}`;

export function toPatchKey(version: string): PatchKey {
  const match = /^(\d+)\.(\d+)(?:\.\d+)*$/.exec(version);
  if (!match) throw new Error("Invalid Riot version");
  return `${Number(match[1])}.${Number(match[2])}`;
}
