import { describe, expect, it } from 'vitest';
import { buildUpiPaymentUri, formatUpiAmount } from '@/lib/payments/upi-intent';

describe('UPI Intent URI Builder (FE-005)', () => {
  it('generates exact URI for canonical subscription sample', () => {
    const uri = buildUpiPaymentUri({
      payeeVpa: 'billmatrix@okaxis',
      payeeName: 'Bill Matrix Pvt Ltd',
      amountPaise: 39900,
      note: 'BM Sub Essentials Pro Plan monthly',
    });

    expect(uri).toBe(
      'upi://pay?pa=billmatrix@okaxis&pn=Bill%20Matrix%20Pvt%20Ltd&am=399.00&cu=INR&tn=BM%20Sub%20Essentials%20Pro%20Plan%20monthly'
    );
  });

  describe('formatUpiAmount', () => {
    it('formats positive paise values to exact 2-decimal rupee strings', () => {
      expect(formatUpiAmount(1)).toBe('0.01');
      expect(formatUpiAmount(50)).toBe('0.50');
      expect(formatUpiAmount(100)).toBe('1.00');
      expect(formatUpiAmount(39900)).toBe('399.00');
      expect(formatUpiAmount(349900)).toBe('3499.00');
      expect(formatUpiAmount(499900)).toBe('4999.00');
    });

    it('throws error for non-positive or non-safe-integer values', () => {
      expect(() => formatUpiAmount(0)).toThrow('Amount in paise must be a positive safe integer');
      expect(() => formatUpiAmount(-1)).toThrow('Amount in paise must be a positive safe integer');
      expect(() => formatUpiAmount(1.5)).toThrow('Amount in paise must be a positive safe integer');
      expect(() => formatUpiAmount(NaN)).toThrow('Amount in paise must be a positive safe integer');
      expect(() => formatUpiAmount(Infinity)).toThrow('Amount in paise must be a positive safe integer');
    });
  });

  describe('buildUpiPaymentUri validation & encoding', () => {
    it('writes the VPA verbatim and rejects VPAs with characters that would need encoding', () => {
      const base = { payeeName: 'Bill Matrix', amountPaise: 39900, note: 'Subscription' };
      expect(buildUpiPaymentUri({ ...base, payeeVpa: 'bill.matrix-1@okicici' })).toContain('pa=bill.matrix-1@okicici&');
      for (const bad of ['no-at-sign', 'a b@okaxis', 'x&am=1@okaxis', 'name@ok axis', 'name@@okaxis', 'n@1bank']) {
        expect(() => buildUpiPaymentUri({ ...base, payeeVpa: bad })).toThrow('Payee VPA is not a valid UPI ID');
      }
    });

    it('throws when required fields are missing or whitespace-only', () => {
      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: '',
          payeeName: 'Bill Matrix',
          amountPaise: 39900,
          note: 'Subscription',
        })
      ).toThrow('Payee VPA is required');

      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: '   ',
          payeeName: 'Bill Matrix',
          amountPaise: 39900,
          note: 'Subscription',
        })
      ).toThrow('Payee VPA is required');

      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: 'admin@okaxis',
          payeeName: '',
          amountPaise: 39900,
          note: 'Subscription',
        })
      ).toThrow('Payee name is required');

      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: 'admin@okaxis',
          payeeName: '   ',
          amountPaise: 39900,
          note: 'Subscription',
        })
      ).toThrow('Payee name is required');

      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: 'admin@okaxis',
          payeeName: 'Bill Matrix',
          amountPaise: 39900,
          note: '',
        })
      ).toThrow('Payment note is required');

      expect(() =>
        buildUpiPaymentUri({
          payeeVpa: 'admin@okaxis',
          payeeName: 'Bill Matrix',
          amountPaise: 39900,
          note: '   ',
        })
      ).toThrow('Payment note is required');
    });

    it('correctly encodes special characters (&, =, #, ?) in payee name and note', () => {
      const uri = buildUpiPaymentUri({
        payeeVpa: 'admin@okaxis',
        payeeName: 'Bill & Matrix #1? = Top',
        amountPaise: 59900,
        note: 'Plan #1 & Sub? yes=true',
      });

      expect(uri).toContain('pn=Bill%20%26%20Matrix%20%231%3F%20%3D%20Top');
      expect(uri).toContain('tn=Plan%20%231%20%26%20Sub%3F%20yes%3Dtrue');
      expect(uri).not.toContain('+');
    });

    it('caps note at 50 characters', () => {
      const longNote = 'A'.repeat(80);
      const uri = buildUpiPaymentUri({
        payeeVpa: 'admin@okaxis',
        payeeName: 'Bill Matrix',
        amountPaise: 39900,
        note: longNote,
      });

      const params = new URL(uri);
      const tn = params.searchParams.get('tn');
      expect(tn).toBe('A'.repeat(50));
      expect(tn?.length).toBe(50);
    });

    it('never uses + for spaces anywhere in the URI', () => {
      const uri = buildUpiPaymentUri({
        payeeVpa: 'admin@okaxis',
        payeeName: 'Bill Matrix Pvt Ltd India',
        amountPaise: 39900,
        note: 'BM Sub Essentials Pro Plan monthly billing',
      });

      expect(uri.includes('+')).toBe(false);
      expect(uri).toContain('Bill%20Matrix%20Pvt%20Ltd%20India');
      expect(uri).toContain('BM%20Sub%20Essentials%20Pro%20Plan%20monthly%20billing');
    });
  });
});

