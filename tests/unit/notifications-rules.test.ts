import { describe, expect, it } from 'vitest';
import { categoriesForRole, CATEGORY_ROLES, NOTIFICATION_KIND_CATEGORY } from '@/lib/notifications/catalog';
import { addDaysIso, diffDaysIso, formatIsoDateShort } from '@/lib/notifications/dates';
import { gstReturnsDueOn, gstr3bQuarterlyDueDay } from '@/lib/notifications/gst-calendar';
import {
  invoicesOverdueDraft,
  memberJoinedDraft,
  paymentRejectedDraft,
  pdfArchivalFailedDraft,
  trialEndingDraft,
} from '@/lib/notifications/messages';
import { planReminderDrafts } from '@/lib/notifications/plan-reminders';
import { DEFAULT_NOTIFICATION_PREFS, resolveNotificationPrefs, wantsEmail } from '@/lib/notifications/prefs';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_KINDS } from '@/lib/db/domain-values';

describe('Feature C: notification rules', () => {
  describe('GST calendar', () => {
    it('monthly: GSTR-1 on the 11th and GSTR-3B on the 20th, for the previous month (January wraps the year)', () => {
      expect(gstReturnsDueOn('2026-12-11', 'monthly', '29')).toEqual([
        { returnName: 'GSTR-1', periodLabel: 'November 2026', periodKey: '2026-11', dueDateIso: '2026-12-11' },
      ]);
      expect(gstReturnsDueOn('2027-01-20', 'monthly', '29')).toEqual([
        { returnName: 'GSTR-3B', periodLabel: 'December 2026', periodKey: '2026-12', dueDateIso: '2027-01-20' },
      ]);
      expect(gstReturnsDueOn('2026-12-13', 'monthly', '29')).toEqual([]);
    });

    it('quarterly: only after a quarter ends; GSTR-1 on the 13th, GSTR-3B on the 22nd or 24th by state', () => {
      expect(gstReturnsDueOn('2026-10-13', 'quarterly', '07')).toEqual([
        { returnName: 'GSTR-1', periodLabel: 'Jul–Sep 2026', periodKey: '2026-Q3', dueDateIso: '2026-10-13' },
      ]);
      expect(gstReturnsDueOn('2026-11-13', 'quarterly', '07')).toEqual([]); // not a quarter month
      expect(gstReturnsDueOn('2026-12-11', 'quarterly', '29')).toEqual([]); // monthly date ignored
      expect(gstReturnsDueOn('2027-04-22', 'quarterly', '27')[0]?.periodLabel).toBe('Jan–Mar 2027');
      expect(gstReturnsDueOn('2027-04-22', 'quarterly', '09')).toEqual([]); // UP is a 24th state
      expect(gstReturnsDueOn('2027-04-24', 'quarterly', '09')[0]?.periodKey).toBe('2027-Q1');
      expect(gstr3bQuarterlyDueDay('29')).toBe(22);
      expect(gstr3bQuarterlyDueDay('07')).toBe(24);
    });

    it('nothing for "not filing" or an unset frequency', () => {
      expect(gstReturnsDueOn('2026-12-11', 'not_filing', '29')).toEqual([]);
      expect(gstReturnsDueOn('2026-12-11', null, '29')).toEqual([]);
    });
  });

  describe('plan reminders', () => {
    const base = { subscription_plan: 'trial', subscription_status: 'trial', trial_ends_at: null, subscription_ends_at: null };
    const now = new Date('2026-12-08T04:00:00Z'); // 8 Dec IST

    it('trial: 3 days before (routine), the day before (urgent), ended within 3 days, nothing otherwise', () => {
      expect(planReminderDrafts({ ...base, trial_ends_at: new Date('2026-12-11T06:00:00Z') }, now)[0]).toMatchObject({
        kind: 'trial_ending',
        urgent: false,
      });
      expect(planReminderDrafts({ ...base, trial_ends_at: new Date('2026-12-09T06:00:00Z') }, now)[0]).toMatchObject({
        kind: 'trial_ending',
        urgent: true,
        title: 'Your free trial ends tomorrow',
      });
      expect(planReminderDrafts({ ...base, trial_ends_at: new Date('2026-12-10T06:00:00Z') }, now)).toEqual([]);
      expect(planReminderDrafts({ ...base, trial_ends_at: new Date('2026-12-07T06:00:00Z') }, now)[0]).toMatchObject({
        kind: 'plan_expired',
        title: 'Your free trial has ended',
      });
      expect(planReminderDrafts({ ...base, trial_ends_at: new Date('2026-12-01T06:00:00Z') }, now)).toEqual([]);
    });

    it('paid: 7 days and 1 day before; free, suspended and admin-expired accounts get nothing', () => {
      const paid = { ...base, subscription_plan: 'professional', subscription_status: 'active' };
      expect(planReminderDrafts({ ...paid, subscription_ends_at: new Date('2026-12-15T06:00:00Z') }, now)[0]?.title).toBe(
        'Your Professional plan expires in 7 days',
      );
      expect(planReminderDrafts({ ...paid, subscription_plan: 'free', subscription_ends_at: new Date('2026-12-15T06:00:00Z') }, now)).toEqual([]);
      expect(planReminderDrafts({ ...paid, subscription_status: 'suspended', subscription_ends_at: new Date('2026-12-15T06:00:00Z') }, now)).toEqual([]);
      expect(planReminderDrafts({ ...paid, subscription_status: 'expired', subscription_ends_at: new Date('2026-12-07T06:00:00Z') }, now)).toEqual([]);
    });
  });

  describe('preferences', () => {
    it('fills defaults tolerantly and ignores junk', () => {
      expect(resolveNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS);
      expect(resolveNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS);
      expect(resolveNotificationPrefs({ email: { money: 'no', gst: false }, digest: 'weekly' })).toEqual({
        email: { money: true, gst: false, account: true, team: true },
        digest: 'daily',
      });
    });

    it('a category switch beats everything; digest off only stops routine e-mails', () => {
      const off = resolveNotificationPrefs({ digest: 'off', email: { account: false } });
      expect(wantsEmail(off, 'money', false)).toBe(false);
      expect(wantsEmail(off, 'money', true)).toBe(true);
      expect(wantsEmail(off, 'account', true)).toBe(false);
    });
  });

  describe('catalog', () => {
    it('every kind has a category; staff never get GST or plan items; the CA gets GST and money', () => {
      for (const kind of NOTIFICATION_KINDS) expect(NOTIFICATION_CATEGORIES).toContain(NOTIFICATION_KIND_CATEGORY[kind]);
      expect(CATEGORY_ROLES.gst).toEqual(['owner', 'accountant']);
      expect(CATEGORY_ROLES.account).toEqual(['owner']);
      expect(categoriesForRole('owner')).toEqual(['money', 'gst', 'account', 'team']);
      expect(categoriesForRole('staff')).toEqual(['money', 'team']);
      expect(categoriesForRole('accountant')).toEqual(['money', 'gst', 'team']);
    });
  });

  describe('messages', () => {
    it('plurals, Indian money format and internal links only', () => {
      expect(invoicesOverdueDraft('2026-12-08', 1, 150_050).title).toBe('1 invoice became overdue today');
      expect(invoicesOverdueDraft('2026-12-08', 3, 150_050).body).toContain('₹1,500.50');
      expect(trialEndingDraft('2026-12-11', 3).link).toBe('/settings?tab=billing');
      expect(pdfArchivalFailedDraft('credit_note', 'abc', 'CN/1').link).toBe('/credit-notes/abc');
      expect(memberJoinedDraft('u', 'i', 'Priya', 'accountant').body).toBe(
        'They accepted your invitation and joined as Accountant (read-only).',
      );
      expect(paymentRejectedDraft('r', `  ${'x'.repeat(600)}  `).body.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('dates', () => {
    it('adds and diffs calendar days across months and leap years', () => {
      expect(addDaysIso('2028-02-27', 3)).toBe('2028-03-01');
      expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
      expect(diffDaysIso('2026-12-08', '2026-12-11')).toBe(3);
      expect(formatIsoDateShort('2026-12-08')).toBe('8 Dec 2026');
    });
  });
});
