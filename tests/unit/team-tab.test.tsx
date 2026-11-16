import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/actions/team/get-team', () => ({
  getTeam: vi.fn(),
}));
vi.mock('@/lib/actions/team/invite-team-member', () => ({
  inviteTeamMember: vi.fn(),
}));
vi.mock('@/lib/actions/team/resend-team-invite', () => ({
  resendTeamInvite: vi.fn(),
}));
vi.mock('@/lib/actions/team/revoke-team-invite', () => ({
  revokeTeamInvite: vi.fn(),
}));
vi.mock('@/lib/actions/team/remove-team-member', () => ({
  removeTeamMember: vi.fn(),
}));

import { SeatSummary } from '@/components/app/settings/team-tab/seat-summary';
import { InviteForm } from '@/components/app/settings/team-tab/invite-form';
import { InviteLinkPanel } from '@/components/app/settings/team-tab/invite-link-panel';
import { MembersList } from '@/components/app/settings/team-tab/members-list';
import { PendingInvites } from '@/components/app/settings/team-tab/pending-invites';
import type {
  TeamSeats,
  TeamMember,
  TeamInvite,
  InviteLinkResult,
} from '@/components/app/settings/team-tab/types';

describe('Team Tab Components (A2-TEAM-UI)', () => {
  describe('SeatSummary', () => {
    it('renders "2 of 3 users" when limit is 3 and used is 2', () => {
      const seats: TeamSeats = {
        used: 2,
        limit: 3,
        members: 1,
        openInvites: 1,
        overLimit: false,
      };
      const html = renderToStaticMarkup(
        React.createElement(SeatSummary, { seats })
      );
      expect(html).toContain('2 of 3 users');
      expect(html).not.toContain('allows 3 users but your team has');
    });

    it('renders "Unlimited" when limit is null', () => {
      const seats: TeamSeats = {
        used: 5,
        limit: null,
        members: 4,
        openInvites: 1,
        overLimit: false,
      };
      const html = renderToStaticMarkup(
        React.createElement(SeatSummary, { seats })
      );
      expect(html).toContain('Unlimited');
      expect(html).toContain('5 users');
    });

    it('shows overLimit warning and upgrade CTA when overLimit is true', () => {
      const seats: TeamSeats = {
        used: 4,
        limit: 3,
        members: 4,
        openInvites: 0,
        overLimit: true,
      };
      const html = renderToStaticMarkup(
        React.createElement(SeatSummary, { seats, onSwitchTab: vi.fn() })
      );
      expect(html).toContain('Your plan allows 3 users but your team has 4.');
      expect(html).toContain('Upgrade Plan');
    });
  });

  describe('InviteForm', () => {
    it('is disabled and shows reason when canInvite is false', () => {
      const html = renderToStaticMarkup(
        React.createElement(InviteForm, {
          canInvite: false,
          cannotInviteReason: 'Upgrade your plan to invite more team members.',
          onInviteSuccess: vi.fn(),
        })
      );
      expect(html).toContain('disabled=""');
      expect(html).toContain('Upgrade your plan to invite more team members.');
    });

    it('is enabled when canInvite is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(InviteForm, {
          canInvite: true,
          cannotInviteReason: null,
          onInviteSuccess: vi.fn(),
        })
      );
      expect(html).toContain('type="email"');
      expect(html).toContain('Send invite');
    });
  });

  describe('InviteLinkPanel', () => {
    it('shows "couldn\'t send" text and link when emailSent is false', () => {
      const result: InviteLinkResult = {
        invitationId: 'inv_123',
        email: 'staff@example.com',
        expiresAt: '2026-11-20T10:00:00.000Z',
        emailSent: false,
        inviteUrl: 'https://example.com/invite/token123',
      };
      const html = renderToStaticMarkup(
        React.createElement(InviteLinkPanel, {
          result,
          businessName: 'Acme Traders',
          onDone: vi.fn(),
        })
      );
      expect(html).toContain("We couldn&#x27;t send the e-mail. Share this link with staff@example.com instead.");
      expect(html).toContain('https://example.com/invite/token123');
    });

    it('contains WhatsApp href with encoded invite URL and business name', () => {
      const inviteUrl = 'https://example.com/invite/tokenABC';
      const result: InviteLinkResult = {
        invitationId: 'inv_456',
        email: 'staff2@example.com',
        expiresAt: '2026-11-20T10:00:00.000Z',
        emailSent: true,
        inviteUrl,
      };
      const html = renderToStaticMarkup(
        React.createElement(InviteLinkPanel, {
          result,
          businessName: 'Acme Corp',
          onDone: vi.fn(),
        })
      );
      const expectedText = encodeURIComponent(`Join Acme Corp on Invoice BizFolio: ${inviteUrl}`);
      expect(html).toContain(`https://wa.me/?text=${expectedText}`);
      expect(html).toContain('target="_blank"');
    });
  });

  describe('MembersList', () => {
    it('shows Remove button only for staff rows, never for owner or "You"', () => {
      const members: TeamMember[] = [
        {
          id: 'user_owner',
          name: 'Owner Boss',
          email: 'owner@example.com',
          role: 'owner',
          isYou: true,
          createdAt: '2026-11-01T10:00:00.000Z',
        },
        {
          id: 'user_staff_1',
          name: 'Staff Alice',
          email: 'alice@example.com',
          role: 'staff',
          isYou: false,
          createdAt: '2026-11-10T10:00:00.000Z',
        },
      ];
      const html = renderToStaticMarkup(
        React.createElement(MembersList, {
          members,
          onMemberRemoved: vi.fn(),
        })
      );
      // Owner has "You" badge and no remove button
      expect(html).toContain('Owner Boss');
      expect(html).toContain('alice@example.com');
      // "Remove" button should appear for Alice (in both desktop and mobile views = 2)
      // but never for the owner row (which would add another 2 if rendered)
      const removeButtons = html.match(/>Remove<\/button>/g);
      expect(removeButtons).not.toBeNull();
      expect(removeButtons?.length).toBe(2); // 1 desktop + 1 mobile card for Alice
    });
  });

  describe('PendingInvites', () => {
    it('shows "Expired" badge when invite is expired', () => {
      const invites: TeamInvite[] = [
        {
          id: 'inv_expired',
          email: 'expired@example.com',
          role: 'staff',
          expiresAt: '2026-11-10T10:00:00.000Z',
          sentAt: '2026-11-03T10:00:00.000Z',
          isExpired: true,
        },
      ];
      const html = renderToStaticMarkup(
        React.createElement(PendingInvites, {
          invites,
          onInviteRevoked: vi.fn(),
          onResendSuccess: vi.fn(),
        })
      );
      expect(html).toContain('expired@example.com');
      expect(html).toContain('Expired');
    });

    it('shows empty state when there are no pending invites', () => {
      const html = renderToStaticMarkup(
        React.createElement(PendingInvites, {
          invites: [],
          onInviteRevoked: vi.fn(),
          onResendSuccess: vi.fn(),
        })
      );
      expect(html).toContain('No pending invites.');
    });
  });
});
