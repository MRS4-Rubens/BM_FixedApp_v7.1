import { Buffer } from 'node:buffer';
import type * as React from 'react';
import { render } from '@react-email/components';
import { getEmailEnv } from '@/lib/env';
import { scrubString } from '@/lib/observability/sentry-redaction';

/**
 * LAUNCH-L3: provider-neutral mailer, backed by the Brevo transactional e-mail API.
 *
 * The call shape (`getMailer().emails.send(message, options)` → `{ data, error }`) matches the previous Resend
 * client, so the senders and their test fakes did not change behaviour. Switching provider later touches this file
 * only. Brevo is called over HTTPS (port 443): Render Free blocks SMTP ports 25/465/587.
 *
 * Differences from Resend, accepted for the pilot:
 *  - No documented idempotency key. Double sends are already prevented in the database (e-mail claims), so
 *    `options.idempotencyKey` is accepted but not sent.
 *  - Brevo ignores standard headers such as List-Unsubscribe; only `X-…` custom headers are forwarded. The only
 *    sender that sets List-Unsubscribe (customer e-mails) is switched off (lib/config/features.ts).
 */

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 15_000;
const MAX_ERROR_TEXT_CHARS = 200;

export interface MailAttachment {
  readonly filename: string;
  readonly content: Buffer | string;
  readonly contentType?: string;
}

export interface MailMessage {
  /** `email@domain` or `Display Name <email@domain>` (quotes around the name are allowed). */
  readonly from: string;
  readonly to: string | readonly string[];
  readonly subject: string;
  readonly react?: React.ReactElement;
  readonly html?: string;
  readonly text?: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly attachments?: readonly MailAttachment[];
}

export interface MailSendOptions {
  readonly idempotencyKey?: string;
}

export interface MailError {
  readonly name: string;
  readonly message: string;
}

export interface MailSendResult {
  readonly data: { readonly id: string } | null;
  readonly error: MailError | null;
}

export interface Mailer {
  readonly emails: { send(message: MailMessage, options?: MailSendOptions): Promise<MailSendResult> };
}

interface BrevoAddress {
  email: string;
  name?: string;
}

/** Parses `email` or `Name <email>` / `"Name" <email>`. Returns null when no address can be found. */
export function parseAddress(raw: string): BrevoAddress | null {
  const value = raw.trim();
  const angled = /^(.*)<([^<>\s]+@[^<>\s]+)>$/.exec(value);
  if (angled) {
    const name = (angled[1] ?? '').trim().replace(/^"(.*)"$/, '$1').trim();
    const email = (angled[2] ?? '').trim();
    return name === '' ? { email } : { email, name: name.slice(0, 70) };
  }
  return /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(value) ? { email: value } : null;
}

function failure(name: string, message: string): MailSendResult {
  return { data: null, error: { name, message: scrubString(message).slice(0, MAX_ERROR_TEXT_CHARS) } };
}

type BuildOutcome = { readonly ok: true; readonly body: Record<string, unknown> } | { readonly ok: false; readonly error: MailError };

async function buildBody(message: MailMessage): Promise<BuildOutcome> {
  const sender = parseAddress(message.from);
  if (sender === null) return { ok: false, error: { name: 'invalid_sender', message: 'The sender address is not valid.' } };

  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).map((entry) => parseAddress(entry));
  if (recipients.length === 0 || recipients.some((entry) => entry === null)) {
    return { ok: false, error: { name: 'invalid_recipient', message: 'A recipient address is not valid.' } };
  }

  const htmlContent = message.html ?? (message.react ? await render(message.react) : undefined);
  const textContent = message.text ?? (message.react ? await render(message.react, { plainText: true }) : undefined);
  if (htmlContent === undefined && textContent === undefined) {
    return { ok: false, error: { name: 'missing_content', message: 'The e-mail has no content.' } };
  }

  const body: Record<string, unknown> = {
    sender,
    to: recipients,
    subject: message.subject,
    // Brevo requires htmlContent without a template; a text-only message is wrapped in <pre>.
    htmlContent: htmlContent ?? `<pre>${escapeHtml(textContent ?? '')}</pre>`,
    ...(textContent !== undefined ? { textContent } : {}),
  };

  if (message.replyTo) {
    const replyTo = parseAddress(message.replyTo);
    if (replyTo) body.replyTo = replyTo;
  }

  const customHeaders = Object.fromEntries(
    Object.entries(message.headers ?? {}).filter(([name]) => /^x-/i.test(name)),
  );
  if (Object.keys(customHeaders).length > 0) body.headers = customHeaders;

  if (message.attachments && message.attachments.length > 0) {
    body.attachment = message.attachments.map((item) => ({
      name: item.filename,
      content: Buffer.isBuffer(item.content) ? item.content.toString('base64') : Buffer.from(item.content).toString('base64'),
    }));
  }
  return { ok: true, body };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createBrevoMailer(apiKey: string, fetchImpl: typeof fetch = fetch): Mailer {
  return {
    emails: {
      async send(message: MailMessage): Promise<MailSendResult> {
        const built = await buildBody(message);
        if (!built.ok) return failure(built.error.name, built.error.message);
        let response: Response;
        try {
          response = await fetchImpl(BREVO_SEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'api-key': apiKey },
            body: JSON.stringify(built.body),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
        } catch (error: unknown) {
          const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
          return failure(timedOut ? 'timeout' : 'network', timedOut ? 'E-mail provider timed out.' : 'E-mail provider request failed.');
        }

        if (!response.ok) {
          let code = `http_${response.status}`;
          let detail = '';
          try {
            const parsed = (await response.json()) as { code?: unknown; message?: unknown };
            if (typeof parsed.code === 'string') code = parsed.code;
            // Never let the API key reach logs, even if the provider echoes it back.
            if (typeof parsed.message === 'string') detail = parsed.message.split(apiKey).join('[redacted]');
          } catch {
            // Non-JSON error body: keep the status code only.
          }
          return failure(code, `Brevo rejected the e-mail (${response.status})${detail ? `: ${detail}` : ''}`);
        }

        let id = '';
        try {
          const parsed = (await response.json()) as { messageId?: unknown };
          if (typeof parsed.messageId === 'string') id = parsed.messageId;
        } catch {
          // A 2xx without a JSON body still means accepted.
        }
        return { data: { id }, error: null };
      },
    },
  };
}

let instance: Mailer | undefined;

/** Lazily constructed mailer. Throws EnvConfigError if the e-mail variables are invalid. */
export function getMailer(): Mailer {
  instance ??= createBrevoMailer(getEmailEnv().BREVO_API_KEY);
  return instance;
}
