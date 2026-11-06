import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(relPath: string): string {
  const fullPath = resolve(process.cwd(), relPath);
  return readFileSync(fullPath, 'utf8');
}

describe('payment architectural lock order and invariant tests', () => {
  it('enforces lock order in lib/invoices/payment-tx.ts (invoice lock before mutations and before payment lock in void)', () => {
    const src = readProjectFile('lib/invoices/payment-tx.ts');

    const lockInvIdx = src.indexOf('lockFinalizedInvoice(');
    const insertIdx = src.indexOf('.insert(');
    const updateIdx = src.indexOf('.update(');

    expect(lockInvIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);

    // In recordPaymentInTransaction, lockFinalizedInvoice is called before insert or update
    expect(lockInvIdx).toBeLessThan(insertIdx);
    expect(lockInvIdx).toBeLessThan(updateIdx);

    // In voidPaymentInTransaction, lockFinalizedInvoice is called before lockPayment
    const voidFnIdx = src.indexOf('function voidPaymentInTransaction');
    expect(voidFnIdx).toBeGreaterThan(-1);

    const voidSection = src.slice(voidFnIdx);
    const voidInvLockIdx = voidSection.indexOf('lockFinalizedInvoice(');
    const voidPaymentLockIdx = voidSection.indexOf('lockPayment(');
    const voidUpdateIdx = voidSection.indexOf('.update(');

    expect(voidInvLockIdx).toBeGreaterThan(-1);
    expect(voidPaymentLockIdx).toBeGreaterThan(-1);
    expect(voidUpdateIdx).toBeGreaterThan(-1);

    expect(voidInvLockIdx).toBeLessThan(voidPaymentLockIdx);
    expect(voidPaymentLockIdx).toBeLessThan(voidUpdateIdx);

    // No revalidatePath inside pure transaction module
    expect(src).not.toContain('revalidatePath');
  });

  it('enforces lock order in lib/invoices/void-credit-note-tx.ts (invoice -> credit note -> update)', () => {
    const src = readProjectFile('lib/invoices/void-credit-note-tx.ts');

    const lockInvIdx = src.indexOf('lockFinalizedInvoice(');
    const lockCnIdx = src.indexOf('lockFinalizedCreditNote(');
    const updateIdx = src.indexOf('.update(');

    expect(lockInvIdx).toBeGreaterThan(-1);
    expect(lockCnIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);

    expect(lockInvIdx).toBeLessThan(lockCnIdx);
    expect(lockCnIdx).toBeLessThan(updateIdx);

    expect(src).toContain('returning(');
    expect(src).toContain("'voided'");
    expect(src).not.toContain('revalidatePath');
  });

  it('enforces post-commit revalidation and removes ad-hoc SQL sums in payment Server Actions', () => {
    const actions = [
      'lib/actions/payments/record-payment.ts',
      'lib/actions/payments/void-payment.ts',
      'lib/actions/credit-notes/void-credit-note.ts',
    ];

    for (const relPath of actions) {
      const src = readProjectFile(relPath);
      expect(src).toContain('withTransactionRetry');

      const txIdx = src.indexOf('db.transaction(');
      const revalIdx = src.indexOf('revalidatePath(');

      expect(txIdx).toBeGreaterThan(-1);
      expect(revalIdx).toBeGreaterThan(-1);
      expect(revalIdx).toBeGreaterThan(txIdx);

      // No ad-hoc sql sums or raw float conversion
      expect(src).not.toContain('sql<');
      expect(src).not.toContain('paiseToRupees');
      expect(src).not.toContain('rupeesToPaise');
    }
  });

  it('uses recomputePaymentStatus in finalize-credit-note-tx.ts without ad-hoc sums or manual payment_status literals', () => {
    const src = readProjectFile('lib/invoices/finalize-credit-note-tx.ts');

    expect(src).toContain('recomputePaymentStatus(');
    expect(src).not.toContain('payment_status:');
    expect(src).not.toContain('sql<number>');
  });
});

