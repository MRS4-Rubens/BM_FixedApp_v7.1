import { describe, expect, it } from 'vitest';
import {
  generateWhatsAppInvoiceUrl,
  normalizeIndianPhoneNumber,
  type WhatsAppInvoiceData,
} from '@/lib/subscriptions/whatsapp';

describe('WhatsApp Click-to-Chat (CLEAN-002)', () => {
  describe('normalizeIndianPhoneNumber', () => {
    it('normalizes 10-digit Indian numbers with country code 91', () => {
      expect(normalizeIndianPhoneNumber('9876543210')).toBe('919876543210');
      expect(normalizeIndianPhoneNumber('98765 43210')).toBe('919876543210');
      expect(normalizeIndianPhoneNumber('+91-98765-43210')).toBe('919876543210');
    });

    it('preserves already prefixed 12-digit numbers', () => {
      expect(normalizeIndianPhoneNumber('919876543210')).toBe('919876543210');
      expect(normalizeIndianPhoneNumber('+919876543210')).toBe('919876543210');
    });

    it('returns null for empty or invalid numbers', () => {
      expect(normalizeIndianPhoneNumber(null)).toBeNull();
      expect(normalizeIndianPhoneNumber(undefined)).toBeNull();
      expect(normalizeIndianPhoneNumber('')).toBeNull();
      expect(normalizeIndianPhoneNumber('12345')).toBeNull();
    });
  });

  describe('generateWhatsAppInvoiceUrl', () => {
    const sampleData: WhatsAppInvoiceData = {
      customerName: 'Ramesh Patel',
      customerPhone: '9876543210',
      invoiceNumber: 'INV/2026/001',
      invoiceDate: '2026-10-15T00:00:00.000Z',
      dueDate: '2026-10-25T00:00:00.000Z',
      grandTotalPaise: 499900,
      businessName: 'Patel Trading Co.',
    };

    it('generates a URL without any http/https link to the app and without UPI mentions', () => {
      const url = generateWhatsAppInvoiceUrl(sampleData);
      expect(url).toContain('https://wa.me/919876543210?text=');

      // Decode the message payload
      const textParam = new URL(url).searchParams.get('text') ?? '';

      // Must not contain http/https links to the authenticated web app
      expect(textParam).not.toMatch(/https?:\/\//i);

      // Must not contain UPI payment mentions (which were previously broken/fictional)
      expect(textParam).not.toMatch(/\bupi\b/i);
    });

    it('formats dates with IST format (day, short month, year)', () => {
      const url = generateWhatsAppInvoiceUrl(sampleData);
      const textParam = new URL(url).searchParams.get('text') ?? '';

      expect(textParam).toContain('15 Oct 2026');
      expect(textParam).toContain('25 Oct 2026');
    });

    it('falls back to api.whatsapp.com/send if phone is not provided', () => {
      const url = generateWhatsAppInvoiceUrl({
        ...sampleData,
        customerPhone: null,
      });

      expect(url.startsWith('https://api.whatsapp.com/send?text=')).toBe(true);
    });
  });
});
