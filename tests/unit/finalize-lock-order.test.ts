import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readProjectFile(relPath: string): string {
  const fullPath = resolve(process.cwd(), relPath);
  return readFileSync(fullPath, 'utf8');
}

describe('architectural lock order and transaction invariants', () => {
  it('enforces lock order and post-commit revalidation in finalize-invoice-tx.ts', () => {
    const src = readProjectFile('lib/invoices/finalize-invoice-tx.ts');

    const lockIdx = src.indexOf('lockDraftInvoice(');
    // Must be a real call, not text in a comment (a commented-out lockBusinessRow once hid an API-010 regression).
    const lockBizIdx = src.search(/^\s*const business = await lockBusinessRow\(tx, params\.businessId\);/m);
    expect(src).not.toMatch(/^\s*\/\/.*lockBusinessRow\(/m);
    const evalDateIdx = src.indexOf('evaluateInvoiceDate(');
    const quotaIdx = src.indexOf('assertInvoiceQuotaAvailable(');
    const getFyIdx = src.indexOf('getOrCreateCurrentFinancialYear(');
    const getNextNumIdx = src.indexOf('getNextInvoiceNumber(');

    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockBizIdx).toBeGreaterThan(-1);
    expect(evalDateIdx).toBeGreaterThan(-1);
    expect(quotaIdx).toBeGreaterThan(-1);
    expect(getFyIdx).toBeGreaterThan(-1);
    expect(getNextNumIdx).toBeGreaterThan(-1);

    // Global lock order: invoice -> business -> counters
    expect(lockIdx).toBeLessThan(lockBizIdx);
    expect(lockBizIdx).toBeLessThan(getNextNumIdx);

    // Quota evaluation order: evaluateInvoiceDate < assertInvoiceQuotaAvailable < getOrCreateCurrentFinancialYear
    expect(evalDateIdx).toBeLessThan(quotaIdx);
    expect(quotaIdx).toBeLessThan(getFyIdx);

    expect(src).not.toContain('getCurrentMonthRange');
    expect(src).not.toContain('canCreateInvoice(');

    expect(src).toContain('returning(');
    expect(src).toContain("'draft'");
    expect(src).not.toContain('revalidatePath');
  });

  it('enforces lock order (invoice -> credit note -> numbering) in finalize-credit-note-tx.ts', () => {
    const src = readProjectFile('lib/invoices/finalize-credit-note-tx.ts');

    const lockInvIdx = src.indexOf('lockFinalizedInvoice(');
    const lockCnIdx = src.indexOf('lockDraftCreditNote(');
    const getNextCnNumIdx = src.indexOf('getNextCreditNoteNumber(');

    expect(lockInvIdx).toBeGreaterThan(-1);
    expect(lockCnIdx).toBeGreaterThan(-1);
    expect(getNextCnNumIdx).toBeGreaterThan(-1);

    expect(lockInvIdx).toBeLessThan(lockCnIdx);
    expect(lockCnIdx).toBeLessThan(getNextCnNumIdx);

    const shareIdx = src.search(/\.for\(\s*['"]share['"]\s*\)/);
    expect(shareIdx).toBeGreaterThan(-1);
    expect(lockCnIdx).toBeLessThan(shareIdx);
    expect(shareIdx).toBeLessThan(getNextCnNumIdx);

    expect(src).toContain('returning(');
    expect(src).toContain("'draft'");
    expect(src).not.toContain('revalidatePath');
  });

  it('contains at least 3 .for(\'update\') row locks in document-locks.ts', () => {
    const src = readProjectFile('lib/invoices/document-locks.ts');
    const matches = src.match(/\.for\(\s*['"]update['"]\s*\)/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBeGreaterThanOrEqual(3);
  });

  it('wraps transactions in withTransactionRetry and delays revalidation until after commit', () => {
    const invoiceActionSrc = readProjectFile('lib/actions/invoices/finalize-invoice.ts');
    expect(invoiceActionSrc).toContain('withTransactionRetry');
    const invTxIdx = invoiceActionSrc.indexOf('db.transaction(');
    const invRevalIdx = invoiceActionSrc.indexOf('revalidatePath(');
    expect(invTxIdx).toBeGreaterThan(-1);
    expect(invRevalIdx).toBeGreaterThan(-1);
    expect(invRevalIdx).toBeGreaterThan(invTxIdx);

    const cnActionSrc = readProjectFile('lib/actions/credit-notes/finalize-credit-note.ts');
    expect(cnActionSrc).toContain('withTransactionRetry');
    const cnTxIdx = cnActionSrc.indexOf('db.transaction(');
    const cnRevalIdx = cnActionSrc.indexOf('revalidatePath(');
    expect(cnTxIdx).toBeGreaterThan(-1);
    expect(cnRevalIdx).toBeGreaterThan(-1);
    expect(cnRevalIdx).toBeGreaterThan(cnTxIdx);
  });
});
