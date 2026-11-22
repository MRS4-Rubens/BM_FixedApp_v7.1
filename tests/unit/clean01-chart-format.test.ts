import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatChartCurrency, formatChartAxisCurrency } from '@/lib/reports/chart-format';

/**
 * CLEAN-01: the reports chart and the dashboard chart used two identical private copies of these formatters.
 * The expected values below were captured from those copies BEFORE the move, so the move changes no output.
 */
describe('CLEAN-01: shared chart currency formatters', () => {
  it('formatChartCurrency prints whole rupees in Indian grouping', () => {
    expect(formatChartCurrency(0)).toBe('₹0');
    expect(formatChartCurrency(999)).toBe('₹999');
    expect(formatChartCurrency(100000)).toBe('₹1,00,000');
    expect(formatChartCurrency(1234567.89)).toBe('₹12,34,568');
    expect(formatChartCurrency(10000000)).toBe('₹1,00,00,000');
    expect(formatChartCurrency(-1500)).toBe('-₹1,500');
    expect(formatChartCurrency(0.4)).toBe('₹0');
  });

  it('formatChartAxisCurrency shortens to k / L / Cr', () => {
    expect(formatChartAxisCurrency(0)).toBe('₹0');
    expect(formatChartAxisCurrency(999)).toBe('₹999');
    expect(formatChartAxisCurrency(1000)).toBe('₹1k');
    expect(formatChartAxisCurrency(1500)).toBe('₹2k');
    expect(formatChartAxisCurrency(100000)).toBe('₹1L');
    expect(formatChartAxisCurrency(150000)).toBe('₹1.5L');
    expect(formatChartAxisCurrency(10000000)).toBe('₹1.0Cr');
    expect(formatChartAxisCurrency(25000000)).toBe('₹2.5Cr');
  });

  it('both charts use the shared module and keep no private copy', () => {
    for (const file of ['app/(app)/reports/client.tsx', 'components/app/dashboard-chart.tsx']) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toContain("from '@/lib/reports/chart-format'");
      expect(src).not.toMatch(/function formatCurrency\(|function formatYAxisCurrency\(/);
    }
  });
});
