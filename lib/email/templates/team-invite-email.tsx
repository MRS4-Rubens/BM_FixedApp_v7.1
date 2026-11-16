import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Text, Heading, Hr, Link } from '@react-email/components';

export interface TeamInviteEmailProps {
  businessName: string;
  inviterName: string;
  inviteUrl: string;
  /** Pre-formatted IST date, e.g. "23 Nov 2026". */
  expiresOn: string;
}

export const TeamInviteEmail = ({ businessName, inviterName, inviteUrl, expiresOn }: TeamInviteEmailProps) => (
  <Html>
    <Head />
    <Preview>{`${inviterName} invited you to join ${businessName} on Invoice BizFolio`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>You&apos;re invited to join {businessName}</Heading>

        <Section style={section}>
          <Text style={text}>
            <strong>{inviterName}</strong> has invited you to work on <strong>{businessName}</strong> as a team
            member on Invoice BizFolio. You will be able to create invoices, record payments and manage customers and
            products for this business.
          </Text>

          <Section style={btnSection}>
            <Link href={inviteUrl} style={button}>
              Accept invitation
            </Link>
          </Section>

          <Text style={small}>
            This invitation works once and expires on <strong>{expiresOn}</strong>. Sign in, or create your account,
            with this same e-mail address to accept it.
          </Text>

          <Hr style={hr} />

          <Text style={small}>
            If the button does not work, copy this link into your browser:
            <br />
            <Link href={inviteUrl} style={plainLink}>
              {inviteUrl}
            </Link>
          </Text>
          <Text style={small}>
            If you were not expecting this invitation, you can ignore this e-mail. Nothing changes unless you accept
            it.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '40px 20px',
  borderRadius: '8px',
  marginTop: '20px',
  marginBottom: '20px',
  boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
};

const h1 = {
  color: '#4f46e5',
  fontSize: '22px',
  fontWeight: 'bold',
  padding: '0',
  margin: '0 0 20px 0',
  textAlign: 'center' as const,
};

const section = { padding: '0 10px' };

const text = { color: '#525f7f', fontSize: '15px', lineHeight: '24px', textAlign: 'left' as const };

const small = { color: '#64748b', fontSize: '13px', lineHeight: '20px', textAlign: 'left' as const };

const btnSection = { textAlign: 'center' as const, margin: '25px 0' };

const button = {
  backgroundColor: '#4f46e5',
  borderRadius: '6px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '12px 28px',
};

const plainLink = { color: '#4f46e5', fontSize: '12px', wordBreak: 'break-all' as const };

const hr = { borderColor: '#e6ebf1', margin: '20px 0' };
