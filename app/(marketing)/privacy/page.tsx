import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

export const metadata: Metadata = {
  title: 'Privacy Policy | Bill Matrix',
  description: 'Privacy Policy and data protection practices for Bill Matrix.',
  alternates: {
    canonical: '/privacy',
  },
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24 text-zinc-800">
      <h1 className="text-3xl font-extrabold tracking-tight text-zinc-950 sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        Effective Date: April 1, 2026
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-zinc-700">
        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">1. Information We Collect</h2>
          <p>
            We collect account credentials (name and email address), business profile details (legal name, GSTIN, address, and bank settlement details), and invoicing records created within your workspace to provide GST invoicing, PDF archival, and statutory reporting services.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">2. Data Security &amp; Tenant Isolation</h2>
          <p>
            All business data is logically isolated per tenant workspace, encrypted in transit and at rest, and archived securely for statutory retention compliance. We never sell your business or customer data to third parties.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-bold text-zinc-900">3. Data Retention &amp; Deletion Requests</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Statutory records:</strong> invoices, credit notes, payment records and the business and customer
              details shown on them are kept for at least 8 years after the end of the financial year they belong to, as
              required by Indian GST, income-tax and company law (longer if a tax proceeding about that year is pending).
              They are stored in a write-protected archive and deleted after the retention period ends.
            </li>
            <li>
              <strong>Everything else</strong> (your login account, team members, product catalogue, customers that never
              appeared on an invoice, logo and subscription payment screenshots) is erased within 30 days after your
              workspace is closed.
            </li>
            <li>
              <strong>Export:</strong> business owners can download their data from
              Settings → General → Download your data.
            </li>
            <li>
              <strong>Closure:</strong> request it from Settings → General → Request account closure, or email{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-indigo-600 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </li>
          </ul>
        </section>
      </div>
    </main>
  )
}
