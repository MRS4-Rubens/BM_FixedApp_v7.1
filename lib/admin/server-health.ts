/**
 * B1: live memory of the running server for the admin console. Render Free hides RAM in its dashboard, and the app is
 * ONE Node process serving every user, so these numbers are the whole app's memory, not one user's.
 */

/** Render Free instance memory. The process is restarted when it goes above this. */
export const RENDER_FREE_MEMORY_BYTES = 512 * 1024 * 1024;

export interface ServerHealth {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  uptimeSeconds: number;
  nodeVersion: string;
  limitBytes: number;
  measuredAt: string;
}

export function readServerHealth(
  usage: NodeJS.MemoryUsage = process.memoryUsage(),
  uptimeSeconds: number = process.uptime(),
  now: Date = new Date(),
): ServerHealth {
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    externalBytes: usage.external,
    uptimeSeconds: Math.round(uptimeSeconds),
    nodeVersion: process.version,
    limitBytes: RENDER_FREE_MEMORY_BYTES,
    measuredAt: now.toISOString(),
  };
}

export type HealthLevel = 'ok' | 'watch' | 'danger';

/** PURE: share of the instance limit in use, and the colour band (green < 60 %, amber < 85 %, red above). */
export function memoryLevel(rssBytes: number, limitBytes: number): { percent: number; level: HealthLevel } {
  const percent = limitBytes > 0 ? Math.min(100, Math.round((rssBytes / limitBytes) * 100)) : 0;
  return { percent, level: percent < 60 ? 'ok' : percent < 85 ? 'watch' : 'danger' };
}

/** PURE: "3 d 4 h", "5 h 12 m", "42 m". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m`;
}

export function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
