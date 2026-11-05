export const MAX_SEARCH_LENGTH = 100;

/** trim + collapse internal whitespace + cap length; empty -> null */
export function normalizeSearchTerm(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  if (collapsed.length === 0) {
    return null;
  }
  return collapsed.slice(0, MAX_SEARCH_LENGTH);
}

/** escape backslash, % and _ so user input is literal (PostgreSQL's default LIKE escape is backslash) */
export function escapeLikeLiteral(term: string): string {
  return term.replace(/[\%_\\]/g, '\\$&');
}

export function buildContainsPattern(term: string): string {
  return `%${escapeLikeLiteral(term)}%`;
}

export function buildPrefixPattern(term: string): string {
  return `${escapeLikeLiteral(term)}%`;
}

