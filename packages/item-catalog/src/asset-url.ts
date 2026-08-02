const DATA_DRAGON_ORIGIN = "https://ddragon.leagueoflegends.com";
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+)+$/;
const FILENAME_UNSAFE_PATTERN = /[\\/?#\u0000-\u001f\u007f]/;

export type DataDragonAssetResource = "champion" | "item";

/**
 * Build the only asset URLs that this application persists and exposes.
 * Data Dragon catalog records contain a filename, not a URL. We deliberately
 * reject absolute URLs and path separators so untrusted catalog data cannot
 * select an arbitrary image origin or escape the versioned asset directory.
 */
export function dataDragonAssetUrl(
  version: string,
  resource: DataDragonAssetResource,
  filename: string
): string {
  if (!VERSION_PATTERN.test(version) || version.split(".").some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Invalid Data Dragon asset version");
  }
  if (resource !== "champion" && resource !== "item") throw new Error("Invalid Data Dragon asset resource");
  if (!filename || filename === "." || filename === ".." || FILENAME_UNSAFE_PATTERN.test(filename)) {
    throw new Error("Invalid Data Dragon asset filename");
  }

  return `${DATA_DRAGON_ORIGIN}/cdn/${encodeURIComponent(version)}/img/${resource}/${encodeURIComponent(filename)}`;
}
