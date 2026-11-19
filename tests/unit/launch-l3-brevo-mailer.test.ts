import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createBrevoMailer, parseAddress } from '@/lib/email/mailer';

// LAUNCH-L3 (docs/LAUNCH_CHECKLIST.md 2.9): Resend → Brevo web API.

function okFetch(body: unknown = { messageId: '<abc@smtp-relay.brevo.com>' }, status = 201) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('parseAddress', () => {
  it('accepts a bare address, Name <email> and "Name" <email>', () => {
    expect(parseAddress('a@b.co')).toEqual({ email: 'a@b.co' });
    expect(parseAddress('Invoice BizFolio <yourapp@gmail.com>')).toEqual({ email: 'yourapp@gmail.com', name: 'Invoice BizFolio' });
    expect(parseAddress('"Asha K" <asha@shop.in>')).toEqual({ email: 'asha@shop.in', name: 'Asha K' });
  });

  it('rejects things that are not one address', () => {
    expect(parseAddress('not an email')).toBeNull();
    expect(parseAddress('a@b.co, c@d.co')).toBeNull();
    expect(parseAddress('')).toBeNull();
  });
});

describe('createBrevoMailer', () => {
  it('posts to the Brevo API over HTTPS with the api-key header (not SMTP)', async () => {
    const fetchMock = okFetch();
    const result = await createBrevoMailer('key-123', fetchMock).emails.send({
      from: 'Invoice BizFolio <yourapp@gmail.com>',
      to: ['owner@shop.in'],
      subject: 'Hello',
      text: 'Plain body',
    });
    expect(result).toEqual({ data: { id: '<abc@smtp-relay.brevo.com>' }, error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('key-123');
    const body = sentBody(fetchMock);
    expect(body.sender).toEqual({ email: 'yourapp@gmail.com', name: 'Invoice BizFolio' });
    expect(body.to).toEqual([{ email: 'owner@shop.in' }]);
    expect(body.textContent).toBe('Plain body');
    expect(body.htmlContent).toBe('<pre>Plain body</pre>');
  });

  it('renders React e-mails to HTML and plain text', async () => {
    const fetchMock = okFetch();
    await createBrevoMailer('k', fetchMock).emails.send({
      from: 'a@b.co',
      to: 'c@d.co',
      subject: 'S',
      react: React.createElement('p', null, 'Your daily update & more'),
    });
    const body = sentBody(fetchMock);
    expect(String(body.htmlContent)).toContain('Your daily update &amp; more');
    expect(String(body.textContent)).toContain('Your daily update & more');
  });

  it('sends reply-to, base64 attachments, and only X- custom headers', async () => {
    const fetchMock = okFetch();
    await createBrevoMailer('k', fetchMock).emails.send({
      from: 'a@b.co',
      to: 'c@d.co',
      subject: 'S',
      text: 'T',
      replyTo: '"Asha" <asha@shop.in>',
      headers: { 'List-Unsubscribe': '<mailto:x@y.z>', 'X-App-Kind': 'feedback' },
      attachments: [{ filename: 'screen.png', content: Buffer.from('png-bytes') }],
    });
    const body = sentBody(fetchMock);
    expect(body.replyTo).toEqual({ email: 'asha@shop.in', name: 'Asha' });
    expect(body.headers).toEqual({ 'X-App-Kind': 'feedback' });
    expect(body.attachment).toEqual([{ name: 'screen.png', content: Buffer.from('png-bytes').toString('base64') }]);
  });

  it('returns (never throws) a short error without the API key when Brevo rejects the e-mail', async () => {
    const fetchMock = okFetch({ code: 'unauthorized', message: 'Key not found: key-123-secret' }, 401);
    const result = await createBrevoMailer('key-123-secret', fetchMock).emails.send({ from: 'a@b.co', to: 'c@d.co', subject: 'S', text: 'T' });
    expect(result.data).toBeNull();
    expect(result.error?.name).toBe('unauthorized');
    expect(result.error?.message).toContain('401');
    expect(result.error?.message.length).toBeLessThanOrEqual(200);
    expect(result.error?.message).not.toContain('key-123-secret');
  });

  it('returns a network or timeout error instead of throwing', async () => {
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect((await createBrevoMailer('k', network).emails.send({ from: 'a@b.co', to: 'c@d.co', subject: 'S', text: 'T' })).error?.name).toBe('network');

    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    });
    expect((await createBrevoMailer('k', timeout).emails.send({ from: 'a@b.co', to: 'c@d.co', subject: 'S', text: 'T' })).error?.name).toBe('timeout');
  });

  it('defaults reply-to to the real sender, so Reply never goes to the brevosend.com address (launch 3.8)', async () => {
    const fetchMock = okFetch();
    await createBrevoMailer('k', fetchMock).emails.send({ from: 'Invoice BizFolio <yourapp@gmail.com>', to: 'c@d.co', subject: 'S', text: 'T' });
    expect(sentBody(fetchMock).replyTo).toEqual({ email: 'yourapp@gmail.com', name: 'Invoice BizFolio' });
  });

  it('keeps an explicit reply-to (feedback replies go to the user who wrote it)', async () => {
    const fetchMock = okFetch();
    await createBrevoMailer('k', fetchMock).emails.send({ from: 'Invoice BizFolio <yourapp@gmail.com>', to: 'c@d.co', subject: 'S', text: 'T', replyTo: 'asha@shop.in' });
    expect(sentBody(fetchMock).replyTo).toEqual({ email: 'asha@shop.in' });
  });

  it('refuses a bad sender or recipient without calling Brevo', async () => {
    const fetchMock = okFetch();
    const mailer = createBrevoMailer('k', fetchMock);
    expect((await mailer.emails.send({ from: 'nope', to: 'c@d.co', subject: 'S', text: 'T' })).error?.name).toBe('invalid_sender');
    expect((await mailer.emails.send({ from: 'a@b.co', to: ['ok@d.co', 'bad'], subject: 'S', text: 'T' })).error?.name).toBe('invalid_recipient');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
