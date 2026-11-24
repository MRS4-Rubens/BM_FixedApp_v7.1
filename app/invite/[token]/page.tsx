import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { MailCheck, ShieldAlert, Users } from 'lucide-react';
import { db } from '@/lib/db/client';
import { businessInvitations, businesses } from '@/lib/db/schema';
import { getRequestSession } from '@/lib/auth/request-session';
import { getCurrentAppUser } from '@/lib/auth/session';
import { hashInviteToken } from '@/lib/team/invite-token';
import { isWellFormedInviteToken, maskEmail } from '@/lib/team/invite-format';
import { evaluateAccept } from '@/lib/team/accept-rules';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo';
import { AcceptInviteButton, SwitchAccountButton } from './invite-actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team invitation',
  robots: { index: false, follow: false },
};

/**
 * Feature A: landing page for a team invite link (/invite/<token>). Public (not behind the auth proxy) because
 * the invitee may not have an account yet. It only EXPLAINS the state; the accept action re-checks everything.
 * The invited address is shown masked, because whoever holds the link sees this page.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isWellFormedInviteToken(token)) {
    return <InvalidInvite />;
  }

  const [invite] = await db
    .select({
      status: businessInvitations.status,
      role: businessInvitations.role,
      email: businessInvitations.email,
      expiresAt: businessInvitations.expires_at,
      businessId: businessInvitations.business_id,
      acceptedBy: businessInvitations.accepted_by,
      legalName: businesses.legal_name,
      tradeName: businesses.trade_name,
    })
    .from(businessInvitations)
    .innerJoin(businesses, eq(businesses.id, businessInvitations.business_id))
    .where(eq(businessInvitations.token_hash, hashInviteToken(token)))
    .limit(1);
  if (!invite) {
    return <InvalidInvite />;
  }

  const businessName = invite.tradeName?.trim() || invite.legalName;
  const invitedAs = maskEmail(invite.email);
  const now = new Date();
  const session = (await getRequestSession())?.data;

  if (!session?.user) {
    if (invite.status === 'revoked') return <Notice title="Invite cancelled" body="This invite was cancelled by the business owner." />;
    if (invite.status === 'accepted') return <Notice title="Invite already used" body="This invite has already been accepted. Log in to continue." showLogin />;
    if (invite.expiresAt.getTime() <= now.getTime()) {
      return <Notice title="Invite expired" body="This invite has expired. Ask the business owner to send you a new one." />;
    }
    return (
      <InviteShell>
        <InviteHeading businessName={businessName} />
        <p className="text-sm text-muted-foreground">
          This invite was sent to <strong className="font-mono text-foreground">{invitedAs}</strong>. Log in or create
          your account with that e-mail address to join. It expires on {formatIstDate(invite.expiresAt, { day: 'numeric', month: 'short', year: 'numeric' })}.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            href={`/invite/${token}/continue?mode=login`}
            className="btn-shine-navy inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90"
          >
            Log in to accept
          </Link>
          <Link
            href={`/invite/${token}/continue?mode=signup`}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-bold text-foreground hover:bg-muted"
          >
            Create an account
          </Link>
        </div>
      </InviteShell>
    );
  }

  const appUser = await getCurrentAppUser();
  const decision = evaluateAccept(
    {
      status: invite.status,
      email: invite.email,
      expiresAt: invite.expiresAt,
      businessId: invite.businessId,
      acceptedBy: invite.acceptedBy,
    },
    {
      appUserId: appUser.id,
      businessId: appUser.business_id,
      sessionEmail: session.user.email ?? null,
      emailVerified: session.user.emailVerified === true,
    },
    now,
  );

  if (decision.ok) {
    return (
      <InviteShell>
        <InviteHeading businessName={businessName} />
        {invite.role === 'accountant' ? (
          <p className="text-sm text-muted-foreground">
            You will join as an <strong className="text-foreground">accountant with read-only access</strong>. You can
            view invoices, credit notes, payments and reports, and download PDFs and GST / ITR exports. You cannot
            change anything.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You will join as a <strong className="text-foreground">team member</strong>. You can create invoices, record
            payments and manage customers and products. Business settings and billing stay with the owner.
          </p>
        )}
        <AcceptInviteButton token={token} businessName={businessName} />
      </InviteShell>
    );
  }

  switch (decision.code) {
    case 'ALREADY_MEMBER':
      return <Notice title="You're already in" body={decision.message} dashboard />;
    case 'EMAIL_MISMATCH':
      return (
        <InviteShell>
          <InviteHeading businessName={businessName} />
          <Callout tone="warning">
            This invite is for <strong className="font-mono">{invitedAs}</strong>, but you are signed in as{' '}
            <strong className="font-mono">{session.user.email}</strong>.
          </Callout>
          <SwitchAccountButton continueHref={`/invite/${token}/continue?mode=login`} />
        </InviteShell>
      );
    case 'EMAIL_NOT_VERIFIED':
      return (
        <InviteShell>
          <InviteHeading businessName={businessName} />
          <Callout tone="info">{decision.message}</Callout>
        </InviteShell>
      );
    default:
      return <Notice title="This invite can't be used" body={decision.message} dashboard={appUser.business_id !== null} />;
  }
}

function InviteShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <InvoiceBizFolioLogo />
        {children}
      </div>
    </main>
  );
}

function InviteHeading({ businessName }: { businessName: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true">
        <Users className="size-5" />
      </span>
      <div>
        <h1 className="text-lg font-bold text-foreground font-heading">Join {businessName}</h1>
        <p className="text-sm text-muted-foreground">You have been invited to this business on Invoice BizFolio.</p>
      </div>
    </div>
  );
}

function Callout({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
  const Icon = tone === 'warning' ? ShieldAlert : MailCheck;
  return (
    <div
      className={
        tone === 'warning'
          ? 'flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200'
          : 'flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground'
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

function Notice({
  title,
  body,
  dashboard = false,
  showLogin = false,
}: {
  title: string;
  body: string;
  dashboard?: boolean;
  showLogin?: boolean;
}) {
  return (
    <InviteShell>
      <h1 className="text-lg font-bold text-foreground font-heading">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {dashboard && (
        <Link href="/dashboard" className="btn-shine-navy inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90">
          Go to dashboard
        </Link>
      )}
      {showLogin && (
        <Link href="/login" className="btn-shine-navy inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90">
          Log in
        </Link>
      )}
      {!dashboard && !showLogin && (
        <Link href="/" className="text-sm font-semibold text-primary hover:underline">
          Go to the home page
        </Link>
      )}
    </InviteShell>
  );
}

function InvalidInvite() {
  return (
    <Notice
      title="Invite link not valid"
      body="This invite link is not valid. It may have been mistyped, replaced by a newer invite, or cancelled. Ask the business owner to send you a new one."
    />
  );
}
