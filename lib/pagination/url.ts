/**
 * Helper to build stable, clean URL query strings for list screens.
 * Drops null, undefined, and empty string params.
 * Sorts keys for deterministic URLs.
 */
export function buildListHref(
  basePath: string,
  params: Readonly<Record<string, string | number | null | undefined>>,
): string {
  const searchParams = new URLSearchParams();
  const sortedKeys = Object.keys(params).sort();

  for (const key of sortedKeys) {
    const val = params[key];
    if (val !== null && val !== undefined && val !== '') {
      searchParams.set(key, String(val));
    }
  }

  const query = searchParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** Extracts the first string value if input is an array (e.g. Next.js searchParams). */
export function readFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

