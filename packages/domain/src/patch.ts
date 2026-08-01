export type PatchKey = `${number}.${number}`;

export function toPatchKey(version: string): PatchKey {
  const match = /^([0-9]+)(?:\.([0-9]+))(?:\.[0-9]+)*$/.exec(version);
  if (!match) throw new Error("Invalid Riot version");
  const components = version.split(".");
  if (components.some((component) => !Number.isSafeInteger(Number(component)))) throw new Error("Invalid Riot version");
  return `${Number(match[1])}.${Number(match[2])}`;
}
