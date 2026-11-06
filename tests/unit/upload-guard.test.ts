import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(relativeWorkspacePath: string): string {
  return readFileSync(resolve(process.cwd(), relativeWorkspacePath), 'utf8');
}

describe('Upload Security Architectural Guards (SEC-002)', () => {
  const claimSource = readSource('lib/actions/subscriptions/submit-payment-claim.ts');
  const logoSource = readSource('lib/actions/business/upload-logo.ts');
  const feedbackSource = readSource('lib/actions/feedback/send-feedback.ts');
  const idriveSource = readSource('lib/storage/idrive.ts');
  const logoRouteSource = readSource('app/api/business/[id]/logo/route.ts');
  const claimScreenshotUrlSource = readSource('lib/actions/subscriptions/get-claim-screenshot-url.ts');
  const archiveInvoiceSource = readSource('lib/storage/archive-invoice.ts');
  const archiveCreditNoteSource = readSource('lib/storage/archive-credit-note.ts');
  const invoicePdfUrlSource = readSource('lib/actions/invoices/get-archived-pdf-url.ts');
  const creditNotePdfUrlSource = readSource('lib/actions/credit-notes/get-archived-credit-note-pdf-url.ts');

  it('verifies submit-payment-claim.ts adheres to upload security rules', () => {
    expect(claimSource).toContain('@/lib/security/upload');
    expect(claimSource).toContain('requireValidUpload(');
    expect(claimSource).not.toContain('mimeType.split');
    expect(claimSource).not.toContain('Buffer.from(');
    expect(claimSource).not.toMatch(/uploadFileToStorage\([^)]*screenshot_mime/);
    expect(claimSource).toContain("contentDisposition: 'attachment'");
  });

  it('verifies upload-logo.ts adheres to upload security, rate limiting, and transaction order', () => {
    expect(logoSource).toContain('@/lib/security/upload');
    expect(logoSource).toContain('requireValidUpload(');
    expect(logoSource).not.toContain('mimeType.split');
    expect(logoSource).not.toContain('Buffer.from(');
    expect(logoSource).toContain("contentDisposition: 'attachment'");
    expect(logoSource).toContain('rateLimit');

    // Step-0 / COMP-001 Logo Retention Rule: the previous logo is only deleted after the DB swap commits,
    // and only through the snapshot-aware helper. A raw delete of previousKey must never come back.
    const txIndex = logoSource.indexOf('db.transaction(');
    const deleteIndex = logoSource.indexOf('deleteLogoObjectIfUnreferenced(businessId, previousKey');
    expect(txIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(txIndex);
    expect(logoSource).not.toContain('deleteFileFromStorage(previousKey');
  });

  it('verifies send-feedback.ts adheres to upload security rules', () => {
    expect(feedbackSource).toContain('@/lib/security/upload');
    expect(feedbackSource).toContain('requireValidUpload(');
    expect(feedbackSource).not.toContain('mimeType.split');
    expect(feedbackSource).not.toContain('Buffer.from(');
  });

  it('verifies storage helper defines ContentDisposition and ResponseContentDisposition', () => {
    expect(idriveSource).toContain('ContentDisposition');
    expect(idriveSource).toContain('ResponseContentDisposition');
  });

  it('verifies logo route contains nosniff and does NOT contain svg', () => {
    expect(logoRouteSource.toLowerCase()).not.toContain('svg');
    expect(logoRouteSource).toContain('nosniff');
  });

  it('verifies claim screenshot URL action enables forced download for user-uploaded screenshots', () => {
    expect(claimScreenshotUrlSource).toContain('forceDownload: true');
  });

  it('verifies archive modules and invoice/credit-note PDF signed URLs do NOT contain forceDownload', () => {
    expect(archiveInvoiceSource).not.toContain('forceDownload');
    expect(archiveCreditNoteSource).not.toContain('forceDownload');
    expect(invoicePdfUrlSource).not.toContain('forceDownload');
    expect(creditNotePdfUrlSource).not.toContain('forceDownload');
  });
});

