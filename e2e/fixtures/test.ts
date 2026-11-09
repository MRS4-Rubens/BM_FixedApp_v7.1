import { test as baseTest, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { AuthModal } from '../pages/AuthModal';
import { SettingsPage } from '../pages/SettingsPage';
import { CustomersPage } from '../pages/CustomersPage';
import { ProductsPage } from '../pages/ProductsPage';
import { InvoiceFormPage } from '../pages/InvoiceFormPage';
import { InvoiceDetailPage } from '../pages/InvoiceDetailPage';
import { CreditNotePage } from '../pages/CreditNotePage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { ReportsPage } from '../pages/ReportsPage';
import { AdminPage } from '../pages/AdminPage';

const journeyStateSchema = z.object({
  runId: z.string(),
  userEmail: z.string().email(),
  userPassword: z.string(),
  businessName: z.string(),
  businessGstin: z.string(),
  businessState: z.string(),
  customerName: z.string(),
  customerGstin: z.string(),
  productName: z.string(),
  invoiceId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  creditNoteId: z.string().optional(),
  utr: z.string(),
  adminEmail: z.string().email(),
});

export type JourneyState = z.infer<typeof journeyStateSchema>;

const STATE_DIR = path.resolve(process.cwd(), 'e2e/.state');
const STATE_FILE = path.join(STATE_DIR, 'journey.json');

export function saveJourneyState(state: JourneyState): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function loadJourneyState(): JourneyState {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(`Journey state file not found at ${STATE_FILE}. Ensure 01-journey.spec.ts ran first.`);
  }
  const content = fs.readFileSync(STATE_FILE, 'utf-8');
  const parsed = journeyStateSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new Error(`Invalid journey state schema: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

interface TestFixtures {
  authModal: AuthModal;
  settingsPage: SettingsPage;
  customersPage: CustomersPage;
  productsPage: ProductsPage;
  invoiceFormPage: InvoiceFormPage;
  invoiceDetailPage: InvoiceDetailPage;
  creditNotePage: CreditNotePage;
  checkoutPage: CheckoutPage;
  reportsPage: ReportsPage;
  adminPage: AdminPage;
}

export const test = baseTest.extend<TestFixtures>({
  authModal: async ({ page }, provide) => {
    await provide(new AuthModal(page));
  },
  settingsPage: async ({ page }, provide) => {
    await provide(new SettingsPage(page));
  },
  customersPage: async ({ page }, provide) => {
    await provide(new CustomersPage(page));
  },
  productsPage: async ({ page }, provide) => {
    await provide(new ProductsPage(page));
  },
  invoiceFormPage: async ({ page }, provide) => {
    await provide(new InvoiceFormPage(page));
  },
  invoiceDetailPage: async ({ page }, provide) => {
    await provide(new InvoiceDetailPage(page));
  },
  creditNotePage: async ({ page }, provide) => {
    await provide(new CreditNotePage(page));
  },
  checkoutPage: async ({ page }, provide) => {
    await provide(new CheckoutPage(page));
  },
  reportsPage: async ({ page }, provide) => {
    await provide(new ReportsPage(page));
  },
  adminPage: async ({ page }, provide) => {
    await provide(new AdminPage(page));
  },
});

export { expect };

