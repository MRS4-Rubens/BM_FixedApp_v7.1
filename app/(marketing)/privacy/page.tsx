import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

export const metadata: Metadata = {
  title: 'Privacy Policy | Bill Matrix',
  description: 'Privacy Policy and data protection practices for Bill Matrix.',
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
          <p>
            In accordance with the Digital Personal Data Protection (DPDP) Act and Indian GST record-keeping requirements, you may export your data or request account deletion at any time from your workspace settings or by contacting{' '}
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
