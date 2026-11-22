import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERVER_UNREACHABLE_MESSAGE } from '@/lib/actions/_shared/client-errors';

/**
 * BUG-05: a server action call that THROWS (dropped network, an old tab after a redeploy: "Server Action not found")
 * must not leave a button stuck on "Recording…" / "Saving…" or a skeleton loading forever, and must not become an
 * unhandled promise rejection. The test runner has no DOM, so this guards the source: each call sits in a try whose
 * catch shows SERVER_UNREACHABLE_MESSAGE and whose finally resets the busy flag.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/** The text of the function body that starts at `marker` (up to the matching closing brace). */
function bodyAfter(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start, `marker not found: ${marker}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces after ${marker}`);
}

function expectGuarded(body: string, call: string, busyReset: string | null) {
  const tryAt = body.indexOf('try {');
  const callAt = body.indexOf(call);
  expect(tryAt, 'has a try').toBeGreaterThanOrEqual(0);
  expect(callAt, `calls ${call}`).toBeGreaterThan(tryAt); // the call is inside the try
  expect(body).toMatch(/catch\s*(\([^)]*\))?\s*\{/);
  if (busyReset !== null) {
    const finallyBlock = bodyAfter(body, 'finally');
    expect(finallyBlock).toContain(busyReset);
    // and the flag is not reset before the call has settled (the old pattern)
    expect(body.slice(0, tryAt)).not.toContain(busyReset);
  }
}

describe('BUG-05: hand-made loading flags always reset', () => {
  it('the shared message tells the user what to do', () => {
    expect(SERVER_UNREACHABLE_MESSAGE).toBe('Could not reach the server. Please reload the page and try again.');
  });

  it('record payment / refund', () => {
    const source = read('components/app/invoices/payment-section.tsx');
    const body = bodyAfter(source, 'const onSubmit = async');
    expectGuarded(body, 'await recordPayment(', 'setIsSubmitting(false)');
    expect(body).toContain('setError(SERVER_UNREACHABLE_MESSAGE)');
  });

  it('notification settings: load and save', () => {
    const source = read('components/app/settings/notifications-tab/notifications-tab.tsx');
    const load = bodyAfter(source, 'const load = useCallback(async');
    expectGuarded(load, 'await getNotificationSettings(', null);
    expect(load).toContain('setLoadError(SERVER_UNREACHABLE_MESSAGE)');
    const save = bodyAfter(source, 'async function save()');
    expectGuarded(save, 'await saveNotificationPreferences(', 'setSaving(false)');
    expect(save).toContain('SERVER_UNREACHABLE_MESSAGE');
  });

  it('GST filing frequency save', () => {
    const save = bodyAfter(read('components/app/settings/notifications-tab/gst-frequency-card.tsx'), 'async function save()');
    expectGuarded(save, 'await saveGstFilingFrequency(', 'setSaving(false)');
    expect(save).toContain('SERVER_UNREACHABLE_MESSAGE');
  });

  it('notification bell: mark read never leaves an unhandled rejection and always re-syncs', () => {
    const source = read('components/app/notifications/notification-bell.tsx');
    expect(source).toContain('markNotificationsRead({ ids: [item.id] }).then(refresh, refresh)');
    expectGuarded(bodyAfter(source, 'async function markAll()'), 'await markNotificationsRead(', null);
  });
});
