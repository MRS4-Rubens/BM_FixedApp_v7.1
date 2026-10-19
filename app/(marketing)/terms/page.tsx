import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

export const metadata: Metadata = {
  title: 'Terms of Service | Bill Matrix',
  description: 'Terms of Service for Bill Matrix GST Invoicing & Compliance Platform.',
}

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-zinc-800">
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Effective Date: April 1, 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-700">
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Bill Matrix, you agree to be bound by these Terms of Service and all applicable Indian laws and regulations, including Goods and Services Tax (GST) compliance rules where applicable to your business.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">2. Account &amp; Business Data Accuracy</h2>
          <p>
            You are solely responsible for the accuracy of the business profile, GSTIN, HSN/SAC codes, tax slabs, bank details, and customer billing information entered into your Bill Matrix workspace. Finalized tax invoices and credit notes are immutable statutory records.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">3. Subscriptions &amp; Billing</h2>
          <p>
            Paid subscription tiers (Essentials and Professional) are billed on a monthly or annual cycle as selected during checkout. Verified subscription renewals extend your active plan validity period.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">4. Contact &amp; Support</h2>
          <p>
            For questions regarding these Terms of Service, please contact us at{' '}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-semibold text-indigo-600 hover:underline"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
