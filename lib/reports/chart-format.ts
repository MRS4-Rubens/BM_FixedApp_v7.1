/**
 * CLEAN-01: rupee formatters shared by the reports chart (app/(app)/reports/client.tsx) and the dashboard chart
 * (components/app/dashboard-chart.tsx). Values are in RUPEES (the chart data), not paise.
 *
 * Do not merge these with lib/money.ts formatPaiseAsInr or the invoice-list/form formatters: those take paise and
 * print two decimals, so they are deliberately different.
 */

const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Tooltip / table value: whole rupees in Indian grouping, e.g. ₹12,34,568. */
export function formatChartCurrency(val: number): string {
  return wholeRupees.format(val);
}

/** Short Y-axis tick label: ₹999, ₹2k, ₹1.5L, ₹1.0Cr. */
export function formatChartAxisCurrency(val: number): string {
  if (val === 0) return '₹0';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(val % 100000 === 0 ? 0 : 1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(0)}k`;
  return `₹${val}`;
}
