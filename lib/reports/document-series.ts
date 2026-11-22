import { parseInvoiceNumberFormat } from '@/lib/invoices/number-format';

/**
 * MONEY-07: GSTR-1 Table 13 ("Documents issued") is reported per document SERIES — one row with the first and last
 * serial number of each series, the count and the cancelled count. It is mandatory from the May 2025 return period
 * (GSTN advisory). A shop gets several series in one period when its number format restarts every month or day
 * ({MM} / {DD}) or when the format or credit-note prefix is changed; a back-dated invoice must not make "from"/"to"
 * come out of order, so each series is ordered by its counter, not by date.
 */
export interface SeriesDocument {
  readonly number: string;
  readonly cancelled: boolean;
}

export interface DocumentSeriesRange {
  readonly from: string;
  readonly to: string;
  readonly total: number;
  readonly cancelled: number;
}

interface Parsed {
  readonly key: string;
  readonly sequence: number;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * A matcher for numbers printed by `format` (lib/invoices/number-format.ts): every token except {SEQ:N} has a fixed
 * width, and {SEQ:N} is zero-padded to at least N digits. Null when the format cannot be parsed.
 */
function formatMatcher(format: string | null | undefined): RegExp | null {
  if (!format) return null;
  try {
    const { tokens } = parseInvoiceNumberFormat(format);
    if (tokens.filter((token) => token.type === 'seq').length !== 1) return null;
    const pattern = tokens
      .map((token) => {
        switch (token.type) {
          case 'literal':
            return escapeRegex(token.value ?? '');
          case 'seq':
            return `(\\d{${token.width ?? 1},})`;
          case 'fy':
            return '\\d{2}-\\d{2}';
          case 'fyyyy':
            return '\\d{4}-\\d{2}';
          case 'yyyy':
            return '\\d{4}';
          default: // yy, mm, dd
            return '\\d{2}';
        }
      })
      .join('');
    return new RegExp(`^${pattern}$`, 'd');
  } catch {
    return null;
  }
}

/** Series key (the number with its counter replaced by "#") and the counter value. */
function parseNumber(number: string, matcher: RegExp | null): Parsed {
  const match = matcher?.exec(number);
  const indices = match?.indices?.[1];
  if (match?.[1] !== undefined && indices !== undefined) {
    return { key: `${number.slice(0, indices[0])}#${number.slice(indices[1])}`, sequence: Number(match[1]) };
  }
  // Fallback (a number printed by an earlier format, or a credit note "CN/26-27/001"): the LAST run of digits is the
  // counter; everything around it names the series.
  const fallback = /^(.*?)(\d+)(\D*)$/.exec(number);
  if (fallback) return { key: `${fallback[1]}#${fallback[3]}`, sequence: Number(fallback[2]) };
  return { key: number, sequence: 0 };
}

/**
 * Groups documents into their series. `format` is the business's current invoice number format (used to find the
 * counter exactly); numbers it does not describe fall back to "last digits = counter". Series are returned in order of
 * their key; within a series "from"/"to" are the lowest and highest counter.
 */
export function groupDocumentSeries(
  documents: readonly SeriesDocument[],
  format?: string | null,
): DocumentSeriesRange[] {
  const matcher = formatMatcher(format);
  const groups = new Map<string, { sequence: number; doc: SeriesDocument }[]>();
  for (const doc of documents) {
    const parsed = parseNumber(doc.number, matcher);
    const list = groups.get(parsed.key) ?? [];
    list.push({ sequence: parsed.sequence, doc });
    groups.set(parsed.key, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => {
      const ordered = [...list].sort(
        (a, b) => a.sequence - b.sequence || a.doc.number.localeCompare(b.doc.number),
      );
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      return {
        from: first?.doc.number ?? '',
        to: last?.doc.number ?? '',
        total: ordered.length,
        cancelled: ordered.filter((entry) => entry.doc.cancelled).length,
      };
    });
}
