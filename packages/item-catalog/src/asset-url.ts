const DATA_DRAGON_ORIGIN = "https://ddragon.leagueoflegends.com";
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+)+$/;
const FILENAME_UNSAFE_PATTERN = /[\\/?#\u0000-\u001f\u007f]/;
const FILENAME_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/i;
const FILENAME_ENCODED_ESCAPE_PATTERN = /%[0-9A-Fa-f]{2}/;

export type DataDragonAssetResource = "champion" | "item";

/**
 * Build the only asset URLs that this application persists and exposes.
 * Data Dragon catalog records contain a filename, not a URL. We deliberately
 * reject scheme-like names, percent-encoded escapes, and path separators so
 * untrusted catalog data cannot select an arbitrary image origin or escape the
 * versioned asset directory. Data Dragon provides raw filenames, so rejecting
 * encoded escapes avoids ambiguous double-encoding; a literal percent remains
 * valid when it is not followed by two hexadecimal digits.
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
  if (
    !filename ||
    filename === "." ||
    filename === ".." ||
    FILENAME_UNSAFE_PATTERN.test(filename) ||
    FILENAME_SCHEME_PATTERN.test(filename) ||
    FILENAME_ENCODED_ESCAPE_PATTERN.test(filename)
  ) {
    throw new Error("Invalid Data Dragon asset filename");
  }

  return `${DATA_DRAGON_ORIGIN}/cdn/${encodeURIComponent(version)}/img/${resource}/${encodeURIComponent(filename)}`;
}
