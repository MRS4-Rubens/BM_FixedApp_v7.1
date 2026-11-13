import { describe, expect, it } from 'vitest';
import { assertSafeMetadata } from '@/lib/audit/log';
import {
  buildProfileAuditChanges,
  lastFour,
  type ProfileSnapshot,
} from '@/lib/audit/profile-diff';

function createBaseSnapshot(): ProfileSnapshot {
  return {
    legal_name: 'Acme Technologies Pvt Ltd',
    trade_name: 'Acme Tech',
    gstin: '27AAPCA1234A1Z5',
    registration_type: 'regular',
    state_code: '27',
    bank_account_name: 'Acme Tech',
    bank_ifsc: 'HDFC0000123',
    bank_name: 'HDFC Bank',
    pan: 'AAPCA1234A',
    address_line1: '123 Tech Park',
    address_line2: 'Floor 4',
    city: 'Mumbai',
    pincode: '400001',
    phone: '9876543210',
    email: 'billing@acme.com',
    alternate_phone: null,
    nature_of_business: 'Software Development',
    invoice_tagline: null,
    bank_account_number: '12345678901234',
  };
}

describe('audit profile diff unit tests', () => {
  describe('lastFour', () => {
    it('returns the last four characters for standard account numbers', () => {
      expect(lastFour('12345678901234')).toBe('1234');
      expect(lastFour('9876 5432 1098')).toBe('1098');
    });

    it('returns **** for short or masked account numbers', () => {
      expect(lastFour('123')).toBe('****');
      expect(lastFour('1234')).toBe('****');
    });

    it('returns null for null values', () => {
      expect(lastFour(null)).toBeNull();
    });
  });

  describe('buildProfileAuditChanges', () => {
    it('returns null when there are no changes', () => {
      const prev = createBaseSnapshot();
      const next = createBaseSnapshot();
      expect(buildProfileAuditChanges(prev, next)).toBeNull();
    });

    it('treats whitespace, empty strings, and null as equivalent', () => {
      const prev = createBaseSnapshot();
      const next = {
        ...prev,
        trade_name: '   Acme Tech   ', // trimmed match
        alternate_phone: '   ',          // empty string -> null
      };
      expect(buildProfileAuditChanges(prev, next)).toBeNull();
    });

    it('records value diff for statutory / value fields like gstin and legal_name', () => {
      const prev = createBaseSnapshot();
      const next = {
        ...prev,
        gstin: '27AAPCA9999B1Z8',
        legal_name: 'Acme Solutions Pvt Ltd',
      };
      const diff = buildProfileAuditChanges(prev, next);
      expect(diff).not.toBeNull();
      expect(diff!.changed_fields).toEqual(['legal_name', 'gstin']);
      expect(diff!.changes).toEqual({
        legal_name: { from: 'Acme Technologies Pvt Ltd', to: 'Acme Solutions Pvt Ltd' },
        gstin: { from: '27AAPCA1234A1Z5', to: '27AAPCA9999B1Z8' },
      });
    });

    it('records only presence (changed_fields) for personal data (phone, email, address, pan)', () => {
      const prev = createBaseSnapshot();
      const next = {
        ...prev,
        phone: '9111122222',
        email: 'ceo@private-domain.com',
        address_line1: '99 Secret Residence Road',
        pan: 'ZZZPA9999Z',
      };
      const diff = buildProfileAuditChanges(prev, next);
      expect(diff).not.toBeNull();
      expect(diff!.changed_fields).toEqual(['pan', 'address_line1', 'phone', 'email']);
      expect(diff!.changes).toEqual({});

      // Assert that personal values NEVER appear anywhere in the serialized payload
      const serialized = JSON.stringify(diff);
      expect(serialized).not.toContain('9111122222');
      expect(serialized).not.toContain('ceo@private-domain.com');
      expect(serialized).not.toContain('99 Secret Residence Road');
      expect(serialized).not.toContain('ZZZPA9999Z');
    });

    it('records bank account changes as bank_account_last4 ONLY, never full account number', () => {
      const prev = createBaseSnapshot(); // '12345678901234'
      const next = {
        ...prev,
        bank_account_number: '98765432109876',
      };
      const diff = buildProfileAuditChanges(prev, next);
      expect(diff).not.toBeNull();
      expect(diff!.changed_fields).toEqual(['bank_account_number']);
      expect(diff!.changes).toEqual({
        bank_account_last4: { from: '1234', to: '9876' },
      });

      const serialized = JSON.stringify(diff);
      expect(serialized).not.toContain('12345678901234');
      expect(serialized).not.toContain('98765432109876');
      expect(JSON.stringify(diff!.changes)).not.toContain('bank_account_number');
    });

    it('handles multiple simultaneous value, presence, and masked field changes', () => {
      const prev = createBaseSnapshot();
      const next = {
        ...prev,
        legal_name: 'Acme Enterprise Ltd',
        city: 'Pune',
        bank_account_number: '5555444433332222',
      };
      const diff = buildProfileAuditChanges(prev, next);
      expect(diff).not.toBeNull();
      expect(diff!.changed_fields).toEqual(['legal_name', 'city', 'bank_account_number']);
      expect(diff!.changes.legal_name).toEqual({ from: 'Acme Technologies Pvt Ltd', to: 'Acme Enterprise Ltd' });
      expect(diff!.changes.city).toBeUndefined();
      expect(diff!.changes.bank_account_last4).toEqual({ from: '1234', to: '2222' });

      // Pass assertion test against metadata guard
      expect(() => assertSafeMetadata(diff!.changes)).not.toThrow();
    });
  });
});
