export interface MailSinkMessage {
  readonly subject: string;
  readonly html: string;
}

export interface MailSink {
  waitForMessage(to: string, timeoutMs?: number): Promise<MailSinkMessage>;
}

/**
 * Extracts a verification URL from an email HTML body.
 * Looks for an HTTPS link whose path or query parameters indicate email verification
 * and optionally matches allowed hosts (e.g. Neon Auth or App domain).
 */
export function extractVerificationUrl(html: string, allowedHosts?: string[]): string {
  if (!html) {
    throw new Error('Email body is empty; cannot extract verification URL');
  }

  // Regex to extract href attributes from <a> tags, or bare https links
  const hrefRegex = /href\s*=\s*["'](https:\/\/[^"'\s<>]+)["']/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    if (match[1]) matches.push(match[1]);
  }

  // Fallback: search for bare https links
  if (matches.length === 0) {
    const rawUrlRegex = /https:\/\/[^\s"'<>]+/gi;
    while ((match = rawUrlRegex.exec(html)) !== null) {
      matches.push(match[0]);
    }
  }

  const normalizedAllowedHosts = allowedHosts?.map((h) => h.toLowerCase()) ?? [];

  for (const urlStr of matches) {
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname.toLowerCase();

      if (normalizedAllowedHosts.length > 0 && !normalizedAllowedHosts.includes(host)) {
        continue;
      }

      const pathAndQuery = `${parsed.pathname}${parsed.search}`.toLowerCase();
      const isVerification =
        pathAndQuery.includes('verify') ||
        pathAndQuery.includes('verification') ||
        pathAndQuery.includes('confirm') ||
        pathAndQuery.includes('token') ||
        pathAndQuery.includes('auth');

      if (isVerification) {
        return urlStr;
      }
    } catch {
      // Ignore invalid URL matches
    }
  }

  throw new Error('No valid verification URL found in email body');
}

export class MailosaurSink implements MailSink {
  constructor(
    private readonly apiKey: string,
    private readonly serverId: string,
  ) {
    if (!apiKey || !serverId) {
      throw new Error('MailosaurSink requires both apiKey and serverId');
    }
  }

  generateTestEmail(prefix = 'e2e'): string {
    return `${prefix}-${Date.now()}@${this.serverId}.mailosaur.net`;
  }

  async waitForVerificationEmail(to: string, timeoutMs = 60_000): Promise<string> {
    const msg = await this.waitForMessage(to, timeoutMs);
    return extractVerificationUrl(msg.html);
  }

  async waitForMessage(to: string, timeoutMs = 60_000): Promise<MailSinkMessage> {
    const authHeader = `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`;
    const url = 'https://mailosaur.com/api/messages/await';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentTo: to,
        server: this.serverId,
        timeout: timeoutMs,
      }),
    });

    if (!response.ok) {
      throw new Error(`Mailosaur API request failed with status: ${response.status}`);
    }

    const data = (await response.json()) as {
      subject?: string;
      html?: { body?: string };
      text?: { body?: string };
    };

    const subject = data.subject ?? '';
    const html = data.html?.body ?? data.text?.body ?? '';

    return {
      subject,
      html,
    };
  }
}

