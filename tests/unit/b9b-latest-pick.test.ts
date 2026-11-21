import { describe, expect, it } from 'vitest';
import { createLatestPick } from '@/lib/images/latest-pick';

describe('B9b only the latest picked image fills the form', () => {
  it('A (slow) finishing after B was REJECTED as too large must not fill the form', () => {
    const pick = createLatestPick();
    const a = pick.start(); // A is being shrunk
    pick.start(); // B picked and rejected (too large) - still a new pick
    expect(pick.isCurrent(a)).toBe(false);
  });

  it('A finishing after B was accepted is ignored; B applies', () => {
    const pick = createLatestPick();
    const a = pick.start();
    const b = pick.start();
    expect(pick.isCurrent(a)).toBe(false);
    expect(pick.isCurrent(b)).toBe(true);
  });

  it('Cancel / Remove makes a pending pick stale', () => {
    const pick = createLatestPick();
    const a = pick.start();
    pick.invalidate();
    expect(pick.isCurrent(a)).toBe(false);
  });

  it('an uninterrupted pick still applies', () => {
    const pick = createLatestPick();
    expect(pick.isCurrent(pick.start())).toBe(true);
  });
});
