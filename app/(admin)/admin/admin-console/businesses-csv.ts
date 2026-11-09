import { formatIstDate } from '@/lib/invoices/ist-date';
import type { BusinessItem } from './types';

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
    `"${(b.legalName || '').replace(/"/g, '""')}"`,
    `"${(b.tradeName || '').replace(/"/g, '""')}"`,
    `"${b.gstin || ''}"`,
    `"${b.email || ''}"`,
    `"${b.phone || ''}"`,
    `"${b.subscriptionPlan || ''}"`,
    `"${b.subscriptionStatus || ''}"`,
    `"${b.subscriptionEndsAt ? formatIstDate(b.subscriptionEndsAt) : 'N/A'}"`,
    b.invoiceCount,
    b.userCount,
    `"${formatIstDate(b.createdAt)}"`,
  ]);

  return [headers.join(','), ...dataRows.map((r) => r.join(','))].join('\n');
}

export function downloadBusinessesCsv(rows: BusinessItem[]): void {
  const csvText = buildBusinessesCsv(rows);
  const csvContent = 'data:text/csv;charset=utf-8,' + csvText;
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `bill_matrix_businesses_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

