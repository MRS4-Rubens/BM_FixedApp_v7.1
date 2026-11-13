import { describe, expect, it } from 'vitest';
import {
  DATA_EXPORT_FORMAT,
  DATA_EXPORT_VERSION,
  EXPORT_FIELD_DENYLIST,
  shouldOmitField,
  sanitizeExportRecord,
  sanitizeExportValue,
} from '@/lib/account/data-export';

describe('OPT-002a Data Export Unit Tests', () => {
  it('defines the correct export format and version constants', () => {
    expect(DATA_EXPORT_FORMAT).toBe('bill-matrix-data-export');
    expect(DATA_EXPORT_VERSION).toBe(1);
  });

  describe('shouldOmitField', () => {
    it('omits all fields in EXPORT_FIELD_DENYLIST', () => {
      for (const field of EXPORT_FIELD_DENYLIST) {
        expect(shouldOmitField(field)).toBe(true);
      }
    });

    it('omits storage key patterns', () => {
      expect(shouldOmitField('pdf_storage_key')).toBe(true);
      expect(shouldOmitField('logo_storage_key')).toBe(true);
      expect(shouldOmitField('signature_storage_key')).toBe(true);
      expect(shouldOmitField('logo_storage_key_snapshot')).toBe(true);
      expect(shouldOmitField('signature_storage_key_snapshot')).toBe(true);
      expect(shouldOmitField('screenshot_key')).toBe(true);
      expect(shouldOmitField('cloud_storage_key')).toBe(true);
    });

    it('allows standard business and operational fields', () => {
      expect(shouldOmitField('id')).toBe(false);
      expect(shouldOmitField('legal_name')).toBe(false);
      expect(shouldOmitField('gstin')).toBe(false);
      expect(shouldOmitField('invoice_number')).toBe(false);
      expect(shouldOmitField('total_paise')).toBe(false);
      expect(shouldOmitField('line_items')).toBe(false);
      expect(shouldOmitField('created_at')).toBe(false);
      expect(shouldOmitField('role')).toBe(false);
    });
  });

  describe('sanitizeExportRecord & sanitizeExportValue', () => {
    it('strips all sensitive infrastructure and auth keys from a fixture object', () => {
      const fixture = {
        id: 'inv_123',
        business_id: 'biz_abc',
        invoice_number: 'INV/2026-27/001',
        total_paise: 118000,
        // Blocked keys:
        auth_user_id: 'usr_secret_auth_id',
        screenshot_key: 'screenshots/inv_123.png',
        pdf_storage_key: 'archives/inv_123.pdf',
        logo_storage_key: 'logos/biz_abc.png',
        signature_storage_key: 'signatures/sig.png',
        logo_storage_key_snapshot: 'logos/snap.png',
        signature_storage_key_snapshot: 'signatures/snap.png',
        archival_attempts: 1,
        archival_claimed_at: new Date('2026-04-01T10:00:00Z'),
        archival_status: 'archived',
        archived_at: new Date('2026-04-01T10:05:00Z'),
        // Allowed nested date:
        created_at: new Date('2026-04-01T09:00:00Z'),
      };

      const sanitized = sanitizeExportRecord(fixture);

      expect(sanitized).toEqual({
        id: 'inv_123',
        business_id: 'biz_abc',
        invoice_number: 'INV/2026-27/001',
        total_paise: 118000,
        created_at: '2026-04-01T09:00:00.000Z',
      });

      // Assert each blocked key is undefined
      expect(sanitized.auth_user_id).toBeUndefined();
      expect(sanitized.screenshot_key).toBeUndefined();
      expect(sanitized.pdf_storage_key).toBeUndefined();
      expect(sanitized.logo_storage_key).toBeUndefined();
      expect(sanitized.signature_storage_key).toBeUndefined();
      expect(sanitized.logo_storage_key_snapshot).toBeUndefined();
      expect(sanitized.signature_storage_key_snapshot).toBeUndefined();
      expect(sanitized.archival_attempts).toBeUndefined();
      expect(sanitized.archival_claimed_at).toBeUndefined();
      expect(sanitized.archival_status).toBeUndefined();
      expect(sanitized.archived_at).toBeUndefined();
    });

    it('recursively sanitizes nested arrays and objects', () => {
      const complexFixture = {
        id: 'doc_1',
        metadata: {
          visible_note: 'Thanks for business',
          pdf_storage_key: 'nested/key.pdf',
          auth_user_id: 'nested_auth',
        },
        items: [
          {
            id: 'item_1',
            name: 'Consulting',
            screenshot_key: 'items/item_1.png',
          },
        ],
      };

      const sanitized = sanitizeExportRecord(complexFixture);

      expect(sanitized).toEqual({
        id: 'doc_1',
        metadata: {
          visible_note: 'Thanks for business',
        },
        items: [
          {
            id: 'item_1',
            name: 'Consulting',
          },
        ],
      });
    });

    it('handles dates, bigints, and primitives properly', () => {
      const now = new Date();
      expect(sanitizeExportValue(now)).toBe(now.toISOString());
      expect(sanitizeExportValue(BigInt(100))).toBe(100);
      expect(sanitizeExportValue('hello')).toBe('hello');
      expect(sanitizeExportValue(12345)).toBe(12345);
      expect(sanitizeExportValue(null)).toBeNull();
      expect(sanitizeExportValue(undefined)).toBeUndefined();
    });

    it('verifies line_items are nested inside invoices and credit_notes structure', () => {
      const invoiceWithLineItems = {
        id: 'inv_001',
        invoice_number: 'INV/2026/001',
        total_paise: 50000,
        line_items: [
          {
            id: 'li_1',
            description: 'Item A',
            quantity: 2,
            rate_paise: 25000,
          },
        ],
      };

      const sanitized = sanitizeExportRecord(invoiceWithLineItems);
      expect(sanitized.line_items).toBeDefined();
      expect(Array.isArray(sanitized.line_items)).toBe(true);
      expect((sanitized.line_items as unknown[])).toHaveLength(1);
    });
  });
});

