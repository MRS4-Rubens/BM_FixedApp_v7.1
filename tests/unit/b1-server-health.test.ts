import { describe, expect, it } from 'vitest';
import { RENDER_FREE_MEMORY_BYTES, formatMb, formatUptime, memoryLevel, readServerHealth } from '@/lib/admin/server-health';

const MB = 1024 * 1024;

describe('B1 server health', () => {
  it('reads process memory against the Render Free 512 MB limit', () => {
    const h = readServerHealth(
      { rss: 200 * MB, heapUsed: 90 * MB, heapTotal: 120 * MB, external: 10 * MB, arrayBuffers: 1 * MB },
      3_725.4,
      new Date('2026-11-21T10:00:00.000Z'),
    );
    expect(h).toMatchObject({ rssBytes: 200 * MB, heapUsedBytes: 90 * MB, uptimeSeconds: 3_725, limitBytes: RENDER_FREE_MEMORY_BYTES });
    expect(h.measuredAt).toBe('2026-11-21T10:00:00.000Z');
  });

  it('colours the bar green below 60 %, amber below 85 %, red above', () => {
    expect(memoryLevel(200 * MB, 512 * MB)).toEqual({ percent: 39, level: 'ok' });
    expect(memoryLevel(350 * MB, 512 * MB)).toEqual({ percent: 68, level: 'watch' });
    expect(memoryLevel(480 * MB, 512 * MB)).toEqual({ percent: 94, level: 'danger' });
    expect(memoryLevel(900 * MB, 512 * MB).percent).toBe(100);
  });

  it('formats uptime and megabytes for people', () => {
    expect(formatUptime(42 * 60)).toBe('42 m');
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5 h 12 m');
    expect(formatUptime(3 * 86_400 + 4 * 3600)).toBe('3 d 4 h');
    expect(formatMb(200 * MB)).toBe('200 MB');
  });
});
