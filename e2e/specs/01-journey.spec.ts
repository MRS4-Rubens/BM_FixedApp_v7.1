import { test, expect } from '../fixtures/test';
import * as path from 'path';
import { z } from 'zod';
import { generateTestIdentity } from '../support/identity';
import { makeGstin } from '../support/gstin';
import { FIXTURES } from '../support/money';
import { getExpectedInvoiceNumberPattern, getIndianFinancialYear } from '../support/financial-year';
import { loadE2eEnv } from '../support/env';
import { bigintPaise, markEmailVerified, queryRows } from '../support/db';
import { saveJourneyState, type JourneyState } from '../fixtures/test';
import { parseGstr1Workbook } from '../support/xlsx';
import { e2eExtraHttpHeaders } from '../support/http-headers';
import { gotoApp, waitForAppUrl } from '../support/navigation';

test.describe.configure({ mode: 'serial' });

test.describe('01 - Full Core Journey (Serial Desktop)', () => {
  const identity = generateTestIdentity();

  const businessState = '27'; // Maharashtra
  const businessGstin = makeGstin(businessState);
  const customerGstin = makeGstin(businessState); // Intra-state supply
  const productName = 'E2E Widget';

  let invoiceId = '';
  let invoiceNumber = '';
  let creditNoteId = '';

  test('executes end-to-end multi-tenant lifecycle from signup to statutory export', async ({
    page,
    browser,
    authModal,
    settingsPage,
    customersPage,
    productsPage,
    invoiceFormPage,
    invoiceDetailPage,
    creditNotePage,
    checkoutPage,
    reportsPage,
  }) => {
    const env = loadE2eEnv(process.env);
    // ── Step 1: Signup and Email Verification ────────────────────────────────
    await test.step('Step 1: Signup and verification', async () => {
      await authModal.openSignup();
      await authModal.fillSignup({
        ownerName: identity.ownerName,
        email: identity.email,
        password: identity.password,
      });
      await authModal.submitSignup();

      if (env.E2E_EXPECT_VERIFICATION_REQUIRED) {
        await authModal.expectVerificationNotice();

        // Assert login cannot get in before verification: it opens the code screen instead (LAUNCH-L4)
        await authModal.openLogin();
        await authModal.fillLogin(identity.email, identity.password);
        await authModal.submitLogin();
        await authModal.expectCodeScreen();

        // Verify account via DB helper (guarded write)
        if (env.E2E_VERIFY_MODE === 'db') {
          await markEmailVerified(identity.email, env);
        }

        // Login after verification
        await authModal.openLogin();
        await authModal.fillLogin(identity.email, identity.password);
        await authModal.submitLogin();
      }

      await waitForAppUrl(page, /\/(dashboard|settings)/, 20_000);
    });

    // ── Step 2: Business Profile Setup ───────────────────────────────────────
    await test.step('Step 2: Business profile configuration', async () => {
      await settingsPage.goto();
      await settingsPage.fillProfile({
        legalName: identity.businessName,
        gstin: businessGstin,
        stateCode: businessState,
        addressLine1: '123 Tech Park',
        city: 'Mumbai',
        pincode: '400001',
      });
      await settingsPage.saveProfile();
      await settingsPage.expectSaved();

      // Verify persistence on reload
      await settingsPage.goto();
      await expect(settingsPage.gstinInput).toHaveValue(businessGstin);
      await expect(settingsPage.stateSelect).toHaveValue(businessState);
    });

    // ── Step 3: Customer and Product Creation ───────────────────────────────
    await test.step('Step 3: Add Customer and Product', async () => {
      const customerName = `Client ${identity.runId.slice(-6)}`;
      await customersPage.gotoNew();
      await customersPage.createCustomer({
        name: customerName,
        gstin: customerGstin,
        stateCode: businessState,
        addressLine1: '456 Commercial Way',
        city: 'Pune',
        pincode: '411001',
      });
      await customersPage.expectCreated();

      await productsPage.gotoNew();
      await productsPage.createProduct({
        name: productName,
        hsn: '8471',
        unitPriceRupees: FIXTURES.PRODUCT_UNIT_PRICE_PAISE / 100, // 1000.00
        uom: 'PCS',
        taxRateOptionText: '18%',
      });
      await productsPage.expectCreated();
    });

    // ── Step 4: Draft Invoice Creation & Oracle Check ────────────────────────
    await test.step('Step 4: Draft invoice creation and oracle validation', async () => {
      const customerName = `Client ${identity.runId.slice(-6)}`;
      await invoiceFormPage.gotoNew();
      await invoiceFormPage.selectCustomer(customerName);
      await invoiceFormPage.selectProduct(productName, FIXTURES.INVOICE_QTY);

      // Verify on-screen totals match exact oracle before save
      const taxable = await invoiceFormPage.getOnScreenTaxablePaise();
      const cgst = await invoiceFormPage.getOnScreenCgstPaise();
      const sgst = await invoiceFormPage.getOnScreenSgstPaise();
      const total = await invoiceFormPage.getOnScreenGrandTotalPaise();

      expect(taxable).toBe(FIXTURES.INVOICE_TAXABLE_PAISE);
      expect(cgst).toBe(FIXTURES.INVOICE_CGST_PAISE);
      expect(sgst).toBe(FIXTURES.INVOICE_SGST_PAISE);
      expect(total).toBe(FIXTURES.INVOICE_TOTAL_PAISE);

      invoiceId = await invoiceFormPage.saveDraft();
      expect(invoiceId).toBeTruthy();

      // Read-only staging DB check for draft state
      const draftRows = await queryRows(
        `SELECT id, business_id, lifecycle_status, subtotal_paise, total_cgst_paise, total_sgst_paise, grand_total_paise
         FROM invoices WHERE id = $1`,
        [invoiceId],
        z.object({
          id: z.string(),
          business_id: z.string(),
          lifecycle_status: z.string(),
          subtotal_paise: bigintPaise,
          total_cgst_paise: bigintPaise,
          total_sgst_paise: bigintPaise,
          grand_total_paise: bigintPaise,
        }),
        env,
      );

      expect(draftRows).toHaveLength(1);
      expect(draftRows[0]?.lifecycle_status).toBe('draft');
      expect(draftRows[0]?.subtotal_paise).toBe(FIXTURES.INVOICE_TAXABLE_PAISE);
      expect(draftRows[0]?.total_cgst_paise).toBe(FIXTURES.INVOICE_CGST_PAISE);
      expect(draftRows[0]?.total_sgst_paise).toBe(FIXTURES.INVOICE_SGST_PAISE);
      expect(draftRows[0]?.grand_total_paise).toBe(FIXTURES.INVOICE_TOTAL_PAISE);
    });

    // ── Step 5: Finalization & Statutory Numbering ───────────────────────────
    await test.step('Step 5: Finalize invoice and verify statutory numbering', async () => {
      await gotoApp(page, `/invoices/${invoiceId}`);
      await invoiceFormPage.finalize();

      await waitForAppUrl(page, new RegExp(`/invoices/${invoiceId}`), 15_000);
      await invoiceDetailPage.goto(invoiceId);

      invoiceNumber = await invoiceDetailPage.getInvoiceNumber();
      const expectedPattern = getExpectedInvoiceNumberPattern(1, getIndianFinancialYear());
      expect(invoiceNumber).toMatch(expectedPattern);

      // Verify immutable state in database
      const finalizedRows = await queryRows(
        `SELECT id, invoice_number, lifecycle_status, grand_total_paise FROM invoices WHERE id = $1`,
        [invoiceId],
        z.object({
          id: z.string(),
          invoice_number: z.string(),
          lifecycle_status: z.string(),
          grand_total_paise: bigintPaise,
        }),
        env,
      );
      expect(finalizedRows[0]?.lifecycle_status).toBe('finalized');
      expect(finalizedRows[0]?.invoice_number).toBe(invoiceNumber);

      if (env.E2E_EXPECT_ARCHIVAL) {
        const deadline = Date.now() + 60_000; // PDF render alone may take up to 25 s (PDF_RENDER_TIMEOUT_MS)
        let finalStatus = 'pending';
        let s3Key: string | null = null;
        while (Date.now() < deadline) {
          const rows = await queryRows(
            `SELECT archival_status::text AS archival_status, pdf_storage_key FROM invoices WHERE id = $1`,
            [invoiceId],
            z.object({
              archival_status: z.string(),
              pdf_storage_key: z.string().nullable(),
            }),
            env,
          );
          finalStatus = rows[0]?.archival_status ?? 'pending';
          s3Key = rows[0]?.pdf_storage_key ?? null;
          if (finalStatus === 'archived' && s3Key !== null) {
            break;
          }
          if (finalStatus === 'failed') {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        expect(finalStatus).toBe('archived');
        expect(s3Key).toBeTruthy();
      }
    });

    // ── Step 6: Payment 1 (Partial Payment) ──────────────────────────────────
    await test.step('Step 6: Record payment 1 and verify partial status', async () => {
      await invoiceDetailPage.goto(invoiceId);
      await invoiceDetailPage.recordPayment(FIXTURES.PAYMENT_1_PAISE / 100); // ₹1,500.00

      // The balance re-renders after the server action revalidates the page; poll instead of reading once.
      await expect
        .poll(() => invoiceDetailPage.getBalancePaise(), { timeout: 15_000 })
        .toBe(FIXTURES.BALANCE_AFTER_PAYMENT_1_PAISE); // 204000 paise

      await expect.poll(() => invoiceDetailPage.getPaymentStatusText(), { timeout: 15_000 }).toBe('partially paid');

      const pRows = await queryRows(
        `SELECT SUM(amount_paise) as total_paid FROM payments WHERE invoice_id = $1 AND status = 'active'`,
        [invoiceId],
        z.object({ total_paid: bigintPaise }),
        env,
      );
      expect(pRows[0]?.total_paid).toBe(FIXTURES.PAYMENT_1_PAISE);
    });

    // ── Step 7: Credit Note and Payment 2 (Settlement) ────────────────────────
    await test.step('Step 7: Issue credit note and settle balance', async () => {
      await invoiceDetailPage.goto(invoiceId);
      await invoiceDetailPage.openCreditNote();

      await creditNotePage.setQuantity(FIXTURES.CREDIT_NOTE_QTY); // 1 unit
      await creditNotePage.finalize();

      const cnUrl = page.url();
      const cnMatch = cnUrl.match(/\/credit-notes\/([0-9a-fA-F-]+)/);
      creditNoteId = cnMatch ? cnMatch[1]! : '';
      expect(creditNoteId).toBeTruthy();

      // Return to invoice detail: net balance should now be ₹860.00 (86000 paise)
      await invoiceDetailPage.goto(invoiceId);
      const balanceAfterCn = await invoiceDetailPage.getBalancePaise();
      expect(balanceAfterCn).toBe(FIXTURES.BALANCE_AFTER_CN_PAISE);

      // Payment 2 for the exact remainder (₹860.00)
      await invoiceDetailPage.recordPayment(FIXTURES.PAYMENT_2_PAISE / 100);
      await expect.poll(() => invoiceDetailPage.getBalancePaise(), { timeout: 15_000 }).toBe(0);
      await expect.poll(() => invoiceDetailPage.getPaymentStatusText(), { timeout: 15_000 }).toBe('paid');
    });

    // ── Step 8: Trial includes statutory exports ─────────────────────────────
    // Product rule (lib/subscriptions/entitlements.ts getPlanEntitlements): an ACTIVE trial gets every Essentials
    // feature, including Excel exports. The locked path (free/expired plans -> 403 REPORT_EXPORT_LOCKED) is covered
    // by the entitlement unit tests; the E2E database helper is read-only, so it cannot expire the trial here.
    await test.step('Step 8: Active trial can export GSTR-1 (UI link + API)', async () => {
      await reportsPage.goto();
      await reportsPage.expectExportAvailable();

      // Direct API check of the exact URL the page links to (it carries the required startDate/endDate),
      // using the browser context's session cookies.
      const exportHref = await reportsPage.gstr1ExportButton.getAttribute('href');
      expect(exportHref).toMatch(/^\/api\/reports\/export\?type=gstr1&/);
      const apiRes = await page.request.get(exportHref!);
      expect(apiRes.status()).toBe(200);
      const body = await apiRes.body();
      expect(body.subarray(0, 2).toString('latin1')).toBe('PK'); // .xlsx is a ZIP container
    });

    // ── Step 9: Submit Payment Claim ────────────────────────────────────────
    await test.step('Step 9: Submit payment claim', async () => {
      // FE-005: record every request made while on checkout; assert afterwards (an expect() thrown inside an
      // event listener does not reliably fail the test).
      const checkoutRequestUrls: string[] = [];
      const onCheckoutRequest = (request: { url: () => string }) => {
        checkoutRequestUrls.push(request.url());
      };
      page.on('request', onCheckoutRequest);

      try {
        await checkoutPage.goto();

        // FE-005: the business is new here (no pending claim yet), so the UPI QR must be shown, generated
        // locally as an SVG data: URL.
        await expect(checkoutPage.qrImage).toBeVisible({ timeout: 10_000 });
        expect(await checkoutPage.qrImage.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);

        await checkoutPage.submitClaim(identity.utr);
        await checkoutPage.expectSuccess();

        // Reload to ensure single pending claim is enforced
        await checkoutPage.goto();
        await checkoutPage.expectPendingNotice();
      } finally {
        page.off('request', onCheckoutRequest);
      }

      const thirdPartyQrRequests = checkoutRequestUrls.filter((url) =>
        /qrserver\.com|chart\.googleapis\.com|quickchart\.io/i.test(url),
      );
      expect(thirdPartyQrRequests).toEqual([]);
    });

    // ── Step 10: Admin Approval ─────────────────────────────────────────────
    await test.step('Step 10: Super admin approves claim', async () => {
      const adminStorage = path.resolve(process.cwd(), 'e2e/.auth/admin.json');
      const adminContext = await browser.newContext({
        extraHTTPHeaders: e2eExtraHttpHeaders(),
        storageState: adminStorage,
        baseURL: env.E2E_BASE_URL,
      });
      const adminPageObj = new (await import('../pages/AdminPage')).AdminPage(await adminContext.newPage());

      await adminPageObj.goto();
      await adminPageObj.approveClaimByUtr(identity.utr);
      await adminContext.close();
    });

    // ── Step 11: Export Success & XLSX Verification ──────────────────────────
    await test.step('Step 11: User export succeeds and GSTR-1 content verified', async () => {
      await reportsPage.goto();
      await reportsPage.expectExportAvailable();

      const xlsxBuffer = await reportsPage.triggerGstr1Download();
      expect(xlsxBuffer.length).toBeGreaterThan(1000);

      const parsed = await parseGstr1Workbook(xlsxBuffer);
      expect(parsed.b2b.length).toBeGreaterThanOrEqual(1);

      const b2bItem = parsed.b2b.find((r) => r.invoiceNumber === invoiceNumber);
      expect(b2bItem).toBeDefined();
      expect(b2bItem?.taxableValuePaise).toBe(FIXTURES.INVOICE_TAXABLE_PAISE);
      expect(b2bItem?.invoiceValuePaise).toBe(FIXTURES.INVOICE_TOTAL_PAISE);

      expect(parsed.cdnr.length).toBeGreaterThanOrEqual(1);
      const cdnrItem = parsed.cdnr[0];
      expect(cdnrItem?.taxableValuePaise).toBe(FIXTURES.CREDIT_NOTE_TAXABLE_PAISE);
      expect(cdnrItem?.noteValuePaise).toBe(FIXTURES.CREDIT_NOTE_TOTAL_PAISE);
    });

    // ── Step 12: Persist Storage & Journey State ─────────────────────────────
    await test.step('Step 12: Persist storage and journey state', async () => {
      const userAuthFile = path.resolve(process.cwd(), 'e2e/.auth/user.json');
      await page.context().storageState({ path: userAuthFile });

      const state: JourneyState = {
        runId: identity.runId,
        userEmail: identity.email,
        userPassword: identity.password,
        businessName: identity.businessName,
        businessGstin,
        businessState,
        customerName: `Client ${identity.runId.slice(-6)}`,
        customerGstin,
        productName,
        invoiceId,
        invoiceNumber,
        creditNoteId,
        utr: identity.utr,
        adminEmail: env.E2E_ADMIN_EMAIL,
      };
      saveJourneyState(state);
    });
  });
});

