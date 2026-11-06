import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { invoices, creditNotes, invoiceLineItems, creditNoteLineItems } from '@/lib/db/schema';
import { createArchivalToken } from '@/lib/security/archival-token';
import { GET as invoiceRouteGet } from '@/app/api/invoices/[id]/archival-render/route';
import { GET as creditNoteRouteGet } from '@/app/api/credit-notes/[id]/archival-render/route';

const TEST_SECRET = '0123456789abcdef0123456789abcdef';

const memory = new Map<string, number>();

const dbState = {
  invoiceRow: null as Record<string, unknown> | null,
  creditNoteRow: null as Record<string, unknown> | null,
  originalInvoiceRow: null as Record<string, unknown> | null,
  lineItems: [] as Array<Record<string, unknown>>,
};

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getArchivalEnv: vi.fn(() => ({
      ARCHIVAL_SIGNING_SECRET: TEST_SECRET,
    })),
  };
});

vi.mock('@/lib/rate-limit/upstash', () => ({
  exportLimiter: {},
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getClientIp: () => '127.0.0.1',
}));

vi.mock('@/lib/security/archival-replay-guard', () => ({
  consumeArchivalJti: async (jti: string) => {
    if (memory.has(jti)) {
      return 'REPLAYED';
    }
    memory.set(jti, 1);
    return 'CONSUMED';
  },
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === invoices) {
            if (dbState.invoiceRow) {
              return Promise.resolve([dbState.invoiceRow]);
            }
            if (dbState.originalInvoiceRow) {
              return Promise.resolve([dbState.originalInvoiceRow]);
            }
            return Promise.resolve([]);
          }
          if (table === creditNotes) {
            return Promise.resolve(dbState.creditNoteRow ? [dbState.creditNoteRow] : []);
          }
          if (table === invoiceLineItems || table === creditNoteLineItems) {
            return {
              orderBy: () => Promise.resolve(dbState.lineItems),
            };
          }
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

vi.mock('@/lib/invoices/seller-snapshot', () => ({
  resolveSellerDetails: () => ({
    legalName: 'Test Seller Corp',
    tradeName: 'Test Seller',
    gstin: '27AABCU9603R1ZM',
    pan: 'AABCU9603R',
    stateCode: '27',
    stateName: 'Maharashtra',
    addressLine1: '123 MG Road',
    addressLine2: null,
    city: 'Mumbai',
    pincode: '400001',
    logoStorageKey: null,
  }),
  toInvoicePrintFields: () => ({}),
  toCreditNotePrintBusiness: () => ({}),
}));

vi.mock('@/lib/storage/logo', () => ({
  loadLogoDataUri: async () => null,
}));

vi.mock('@/components/app/invoices/invoice-print-view', () => ({
  InvoicePrintView: () => null,
}));

vi.mock('@/components/app/credit-notes/credit-note-print-view', () => ({
  CreditNotePrintView: () => null,
}));

vi.mock('@/lib/pdf/archival-html', () => ({
  buildArchivalHtmlDocument: () => '<!DOCTYPE html><html><body>Rendered HTML</body></html>',
}));

describe('Archival Render Routes (SEC-004)', () => {
  const invoiceId = '11111111-1111-4111-8111-111111111111';
  const creditNoteId = '22222222-2222-4222-8222-222222222222';
  const businessId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    memory.clear();
    dbState.invoiceRow = {
      id: invoiceId,
      business_id: businessId,
      invoice_number: 'INV-2026-0001',
      lifecycle_status: 'finalized',
      display_prefs_snapshot: null,
    };
    dbState.creditNoteRow = {
      id: creditNoteId,
      business_id: businessId,
      credit_note_number: 'CN-2026-0001',
      original_invoice_id: invoiceId,
      lifecycle_status: 'finalized',
    };
    dbState.originalInvoiceRow = {
      id: invoiceId,
      business_id: businessId,
      invoice_number: 'INV-2026-0001',
    };
    dbState.lineItems = [];
  });

  const assertHeaders = (res: Response) => {
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  };

  describe('Invoice route: /api/invoices/[id]/archival-render', () => {
    it('returns 200 with security headers and text/html on first valid token', async () => {
      const token = createArchivalToken('invoice', invoiceId);
      const req = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${token}`,
      );
      const res = await invoiceRouteGet(req, { params: Promise.resolve({ id: invoiceId }) });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      assertHeaders(res);
      await expect(res.text()).resolves.toContain('Rendered HTML');
    });

    it('returns 401 with security headers on second request with the same token (replay)', async () => {
      const token = createArchivalToken('invoice', invoiceId);
      const req1 = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${token}`,
      );
      const res1 = await invoiceRouteGet(req1, { params: Promise.resolve({ id: invoiceId }) });
      expect(res1.status).toBe(200);

      const req2 = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${token}`,
      );
      const res2 = await invoiceRouteGet(req2, { params: Promise.resolve({ id: invoiceId }) });
      expect(res2.status).toBe(401);
      assertHeaders(res2);
    });

    it('returns 401 with headers when token was minted for credit_note', async () => {
      const cnToken = createArchivalToken('credit_note', invoiceId);
      const req = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${cnToken}`,
      );
      const res = await invoiceRouteGet(req, { params: Promise.resolve({ id: invoiceId }) });
      expect(res.status).toBe(401);
      assertHeaders(res);
    });

    it('returns 404 with security headers when invoice does not exist', async () => {
      dbState.invoiceRow = null;
      dbState.originalInvoiceRow = null;
      const token = createArchivalToken('invoice', invoiceId);
      const req = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${token}`,
      );
      const res = await invoiceRouteGet(req, { params: Promise.resolve({ id: invoiceId }) });
      expect(res.status).toBe(404);
      assertHeaders(res);
    });

    it('returns 400 with security headers when invoice is not finalized (draft)', async () => {
      if (dbState.invoiceRow) {
        dbState.invoiceRow.lifecycle_status = 'draft';
      }
      const token = createArchivalToken('invoice', invoiceId);
      const req = new NextRequest(
        `http://localhost:3000/api/invoices/${invoiceId}/archival-render?token=${token}`,
      );
      const res = await invoiceRouteGet(req, { params: Promise.resolve({ id: invoiceId }) });
      expect(res.status).toBe(400);
      assertHeaders(res);
      await expect(res.text()).resolves.toBe('Invoice not finalized');
    });
  });

  describe('Credit note route: /api/credit-notes/[id]/archival-render', () => {
    it('returns 200 with security headers and text/html on first valid token', async () => {
      const token = createArchivalToken('credit_note', creditNoteId);
      const req = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${token}`,
      );
      const res = await creditNoteRouteGet(req, { params: Promise.resolve({ id: creditNoteId }) });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      assertHeaders(res);
      await expect(res.text()).resolves.toContain('Rendered HTML');
    });

    it('returns 401 with security headers on second request with the same token (replay)', async () => {
      const token = createArchivalToken('credit_note', creditNoteId);
      const req1 = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${token}`,
      );
      const res1 = await creditNoteRouteGet(req1, { params: Promise.resolve({ id: creditNoteId }) });
      expect(res1.status).toBe(200);

      const req2 = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${token}`,
      );
      const res2 = await creditNoteRouteGet(req2, { params: Promise.resolve({ id: creditNoteId }) });
      expect(res2.status).toBe(401);
      assertHeaders(res2);
    });

    it('returns 401 with headers when token was minted for invoice', async () => {
      const invToken = createArchivalToken('invoice', creditNoteId);
      const req = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${invToken}`,
      );
      const res = await creditNoteRouteGet(req, { params: Promise.resolve({ id: creditNoteId }) });
      expect(res.status).toBe(401);
      assertHeaders(res);
    });

    it('returns 404 with security headers when credit note does not exist', async () => {
      dbState.creditNoteRow = null;
      const token = createArchivalToken('credit_note', creditNoteId);
      const req = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${token}`,
      );
      const res = await creditNoteRouteGet(req, { params: Promise.resolve({ id: creditNoteId }) });
      expect(res.status).toBe(404);
      assertHeaders(res);
    });

    it('returns 400 with security headers when credit note is not finalized', async () => {
      if (dbState.creditNoteRow) {
        dbState.creditNoteRow.lifecycle_status = 'draft';
      }
      const token = createArchivalToken('credit_note', creditNoteId);
      const req = new NextRequest(
        `http://localhost:3000/api/credit-notes/${creditNoteId}/archival-render?token=${token}`,
      );
      const res = await creditNoteRouteGet(req, { params: Promise.resolve({ id: creditNoteId }) });
      expect(res.status).toBe(400);
      assertHeaders(res);
      await expect(res.text()).resolves.toBe('Credit note not finalized');
    });
  });
});
