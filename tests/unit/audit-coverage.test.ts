import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_EVENTS, type AuditEntityType } from '@/lib/audit/log';

function readProjectFile(relPath: string): string {
  const fullPath = resolve(process.cwd(), relPath);
  return readFileSync(fullPath, 'utf8');
}

describe('audit coverage and architectural invariants (source scan)', () => {
  it('(a) tx.insert(auditLog) appears ONLY in lib/audit/log.ts', () => {
    const filesToScan = [
      'lib/invoices/finalize-invoice-tx.ts',
      'lib/invoices/finalize-credit-note-tx.ts',
      'lib/invoices/payment-tx.ts',
      'lib/invoices/void-credit-note-tx.ts',
      'lib/actions/subscriptions/process-request.ts',
      'lib/actions/subscriptions/update-business-subscription.ts',
      'lib/business/save-profile-tx.ts',
      'lib/actions/business/upload-logo.ts',
      'lib/actions/business/remove-logo.ts',
      'lib/actions/invoices/finalize-invoice.ts',
      'lib/actions/credit-notes/finalize-credit-note.ts',
      'lib/actions/payments/record-payment.ts',
      'lib/actions/payments/void-payment.ts',
      'lib/actions/credit-notes/void-credit-note.ts',
    ];

    for (const relPath of filesToScan) {
      const src = readProjectFile(relPath);
      expect(src).not.toContain('insert(auditLog)');
    }

    const auditLogSrc = readProjectFile('lib/audit/log.ts');
    expect(auditLogSrc).toContain('insert(auditLog)');
  });

  it('(b) each of the target modules contains writeAudit() with expected call counts', () => {
    const modules: { path: string; minCalls: number }[] = [
      { path: 'lib/invoices/finalize-invoice-tx.ts', minCalls: 1 },
      { path: 'lib/invoices/finalize-credit-note-tx.ts', minCalls: 1 },
      { path: 'lib/invoices/payment-tx.ts', minCalls: 2 },
      { path: 'lib/invoices/void-credit-note-tx.ts', minCalls: 1 },
      { path: 'lib/actions/subscriptions/process-request.ts', minCalls: 2 },
      { path: 'lib/actions/subscriptions/update-business-subscription.ts', minCalls: 1 },
      { path: 'lib/business/save-profile-tx.ts', minCalls: 2 },
      { path: 'lib/actions/business/upload-logo.ts', minCalls: 1 },
      { path: 'lib/actions/business/remove-logo.ts', minCalls: 1 },
    ];

    for (const { path, minCalls } of modules) {
      const src = readProjectFile(path);
      const matches = src.match(/writeAudit\(/g);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(minCalls);
    }
  });

  it('(c) in each tx module, writeAudit() appears AFTER the document lock call', () => {
    // 1. finalize-invoice-tx: lockDraftInvoice -> writeAudit
    const invSrc = readProjectFile('lib/invoices/finalize-invoice-tx.ts');
    const invLockIdx = invSrc.indexOf('lockDraftInvoice(');
    const invAuditIdx = invSrc.indexOf('writeAudit(');
    expect(invLockIdx).toBeGreaterThan(-1);
    expect(invAuditIdx).toBeGreaterThan(invLockIdx);

    // 2. finalize-credit-note-tx: lockDraftCreditNote -> writeAudit
    const cnSrc = readProjectFile('lib/invoices/finalize-credit-note-tx.ts');
    const cnLockIdx = cnSrc.indexOf('lockDraftCreditNote(');
    const cnAuditIdx = cnSrc.indexOf('writeAudit(');
    expect(cnLockIdx).toBeGreaterThan(-1);
    expect(cnAuditIdx).toBeGreaterThan(cnLockIdx);

    // 3. payment-tx: recordPayment (lockFinalizedInvoice -> writeAudit), voidPayment (lockPayment -> writeAudit)
    const paySrc = readProjectFile('lib/invoices/payment-tx.ts');
    const payRecordIdx = paySrc.indexOf('function recordPaymentInTransaction');
    const payVoidIdx = paySrc.indexOf('function voidPaymentInTransaction');
    expect(payRecordIdx).toBeGreaterThan(-1);
    expect(payVoidIdx).toBeGreaterThan(payRecordIdx);

    const recordSection = paySrc.slice(payRecordIdx, payVoidIdx);
    expect(recordSection.indexOf('writeAudit(')).toBeGreaterThan(recordSection.indexOf('lockFinalizedInvoice('));

    const voidSection = paySrc.slice(payVoidIdx);
    expect(voidSection.indexOf('writeAudit(')).toBeGreaterThan(voidSection.indexOf('lockPayment('));

    // 4. void-credit-note-tx: lockFinalizedCreditNote -> writeAudit
    const voidCnSrc = readProjectFile('lib/invoices/void-credit-note-tx.ts');
    expect(voidCnSrc.indexOf('writeAudit(')).toBeGreaterThan(voidCnSrc.indexOf('lockFinalizedCreditNote('));
  });

  it('(d) no transaction module in lib/invoices/*-tx.ts imports next/headers or next/cache', () => {
    const txModules = [
      'lib/invoices/finalize-invoice-tx.ts',
      'lib/invoices/finalize-credit-note-tx.ts',
      'lib/invoices/payment-tx.ts',
      'lib/invoices/void-credit-note-tx.ts',
    ];

    for (const relPath of txModules) {
      const src = readProjectFile(relPath);
      expect(src).not.toContain("from 'next/headers'");
      expect(src).not.toContain('from "next/headers"');
      expect(src).not.toContain("from 'next/cache'");
      expect(src).not.toContain('from "next/cache"');
    }
  });

  it('(e) every entityType and action literal in code exists in AUDIT_EVENTS registry', () => {
    const filesToScan = [
      'lib/invoices/finalize-invoice-tx.ts',
      'lib/invoices/finalize-credit-note-tx.ts',
      'lib/invoices/payment-tx.ts',
      'lib/invoices/void-credit-note-tx.ts',
      'lib/actions/subscriptions/process-request.ts',
      'lib/actions/subscriptions/update-business-subscription.ts',
      'lib/business/save-profile-tx.ts',
      'lib/actions/business/upload-logo.ts',
      'lib/actions/business/remove-logo.ts',
    ];

    for (const relPath of filesToScan) {
      const src = readProjectFile(relPath);
      const entityMatches = [...src.matchAll(/entityType:\s*'([^']+)'/g)];
      const actionMatches = [...src.matchAll(/action:\s*'([^']+)'/g)];

      expect(entityMatches.length).toBe(actionMatches.length);

      for (let i = 0; i < entityMatches.length; i++) {
        const entity = entityMatches[i][1] as AuditEntityType;
        const action = actionMatches[i][1];

        expect(AUDIT_EVENTS).toHaveProperty(entity);
        const allowedActions = (AUDIT_EVENTS[entity] as readonly string[]) || [];
        expect(allowedActions).toContain(action);
      }
    }
  });

  it('(f) preserves frozen legacy (entity, action) pairs', () => {
    const payVoidSrc = readProjectFile('lib/invoices/payment-tx.ts');
    expect(payVoidSrc).toContain("entityType: 'payment'");
    expect(payVoidSrc).toContain("action: 'void'");

    const cnVoidSrc = readProjectFile('lib/invoices/void-credit-note-tx.ts');
    expect(cnVoidSrc).toContain("entityType: 'credit_note'");
    expect(cnVoidSrc).toContain("action: 'void'");

    const subOverrideSrc = readProjectFile('lib/actions/subscriptions/update-business-subscription.ts');
    expect(subOverrideSrc).toContain("entityType: 'business'");
    expect(subOverrideSrc).toContain("action: 'subscription_manual_override'");
  });
});

