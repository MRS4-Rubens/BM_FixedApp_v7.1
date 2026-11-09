export interface RevenueChartPoint {
  name: string;
  revenue: number;
  claims: number;
}

export function buildRevenueChartData(
  monthlyRevenue?: Array<{ month: string; revenuePaise: number; claimCount: number }>
): RevenueChartPoint[] {
  if (!monthlyRevenue || monthlyRevenue.length === 0) return [];
  return monthlyRevenue.map((item) => ({
    name: item.month,
    revenue: item.revenuePaise / 100,
    claims: item.claimCount,
  }));
}

