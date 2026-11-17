import * as React from 'react';
import { Html, Head, Preview, Body, Container, Section, Text, Heading, Hr, Link } from '@react-email/components';

export interface NotificationEmailItem {
  readonly title: string;
  readonly body: string;
  /** Absolute URL into the app, or null. */
  readonly url: string | null;
}

export interface NotificationEmailProps {
  readonly businessName: string;
  /** "Your daily update" for the summary, or the single item's title for an urgent e-mail. */
  readonly heading: string;
  readonly items: readonly NotificationEmailItem[];
  /** How many more items exist beyond `items` (the summary shows at most 20). */
  readonly moreCount: number;
  readonly settingsUrl: string;
  readonly appUrl: string;
}

/** Feature C: one template for both the daily summary and an urgent single-item e-mail. */
export const NotificationEmail = ({ businessName, heading, items, moreCount, settingsUrl, appUrl }: NotificationEmailProps) => (
  <Html>
    <Head />
    <Preview>{items.length === 1 ? items[0]?.title ?? heading : `${heading}: ${items.length + moreCount} things need your attention`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>{businessName}</Text>
        <Heading style={h1}>{heading}</Heading>

        <Section style={section}>
          {items.map((item, index) => (
            <Section key={index} style={itemBox}>
              <Text style={itemTitle}>{item.title}</Text>
              <Text style={text}>{item.body}</Text>
              {item.url ? (
                <Link href={item.url} style={itemLink}>
                  Open in Invoice BizFolio →
                </Link>
              ) : null}
            </Section>
          ))}
          {moreCount > 0 ? (
            <Text style={text}>
              …and {moreCount} more. <Link href={appUrl} style={itemLink}>See all in the app</Link>.
            </Text>
          ) : null}

          <Hr style={hr} />
          <Text style={small}>
            You receive these e-mails because you are a member of {businessName} on Invoice BizFolio. You can choose
            which e-mails you get, or turn the daily summary off, in{' '}
            <Link href={settingsUrl} style={plainLink}>
              Settings → Notifications
            </Link>
            .
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
  padding: '32px 20px',
  borderRadius: '8px',
  marginTop: '20px',
  marginBottom: '20px',
  maxWidth: '560px',
};

const eyebrow = { color: '#6366f1', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' as const, margin: '0 0 4px' };
const h1 = { color: '#0f172a', fontSize: '22px', fontWeight: 800, margin: '0 0 16px' };
const section = { padding: '0' };
const itemBox = { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', marginBottom: '10px' };
const itemTitle = { color: '#0f172a', fontSize: '15px', fontWeight: 700, margin: '0 0 4px' };
const text = { color: '#334155', fontSize: '14px', lineHeight: '22px', margin: '0 0 6px' };
const itemLink = { color: '#4f46e5', fontSize: '14px', fontWeight: 600, textDecoration: 'none' };
const hr = { borderColor: '#e2e8f0', margin: '20px 0' };
const small = { color: '#64748b', fontSize: '12px', lineHeight: '18px' };
const plainLink = { color: '#4f46e5' };
