import type { Metadata } from 'next'
import Link from 'next/link'
import { TRIAL_DURATION_DAYS } from '@/lib/subscriptions/entitlements'
import { LegalContact, LegalPage, OperatorDetails, legalLink } from '../legal-page'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Terms governing Invoice BizFolio GST billing, subscriptions and workspace use.',
  alternates: { canonical: '/terms' },
}

const sections = [
  {
    id: 'agreement', title: 'Agreement and scope',
    body: <>
      <p>These Terms govern the use of Invoice BizFolio, the web-based GST billing and reporting service (the Service). “You” means the account holder and, where an account is used for a business, the business that the account holder is authorised to represent. A “workspace” is the business account in which records and settings are maintained. “Business Data” means information you or your authorised users supply to the Service and records created from that information.</p>
      <p>By accepting these Terms electronically or using the Service after these Terms are made available to you, you agree to them to the extent permitted by law. If you do not agree, do not use the Service. The <Link className={legalLink} href="/privacy">Privacy Policy</Link> describes how personal data is handled. Acceptance of these Terms does not replace any separate consent required by law.</p>
    </>,
  },
  {
    id: 'account', title: 'Eligibility, ownership and security',
    body: <>
      <p>You must be at least 18, legally capable of contracting, and authorised to act for any business you register. Use your own credentials and an email address you can access. Keep registration and contact details accurate and protect your password, mailbox and devices. Notify us promptly of suspected unauthorised access at <LegalContact />.</p>
      <p>The workspace owner is responsible for assigning and reviewing access where the Service permits it, removing access that is no longer authorised, and instructing permitted users on lawful use. Use available roles only within their assigned authority. We may verify authority before changing workspace ownership, disclosing records or acting on a closure request.</p>
    </>,
  },
  {
    id: 'use', title: 'Permitted and prohibited use',
    body: <>
      <p>Use the Service for lawful business billing, recordkeeping and related work. You must have authority to submit Business Data and to share documents with the intended recipients.</p>
      <ul>
        <li>Do not create fictitious transactions, false GST documents or duplicate documents intended to mislead, or impersonate a business or taxpayer.</li>
        <li>Do not access other workspaces without authority, bypass access or plan controls, disrupt the Service, or introduce malicious software.</li>
        <li>Do not use the Service to send unlawful, deceptive or unsolicited messages, infringe rights, or upload information you are not entitled to disclose.</li>
      </ul>
    </>,
  },
  {
    id: 'gst', title: 'GST calculations and invoice review',
    body: <>
      <p>The Service helps you prepare GST invoices and credit notes, apply calculations to the information and settings you supply, record receipts, and generate reports and exports. Feature availability depends on your plan. Invoice BizFolio provides software tools and does not act as your Chartered Accountant, tax practitioner, legal adviser, government portal or tax-filing agent.</p>
      <p>Before finalising or issuing a document, verify the supplier and recipient details, GSTIN, invoice date and series, HSN/SAC, place of supply, tax treatment and rate, discounts, totals, payment details and any transaction-specific particulars. A format or checksum check does not establish active registration, ownership of a GSTIN, or eligibility for a tax treatment. Review your invoice terms as well.</p>
      <p>Verify current requirements for your business with official sources or a qualified adviser. A PDF, number, GST calculation, or spreadsheet export does not confer government approval or guarantee statutory acceptance, credit eligibility or correct tax treatment. Where required, obtain any statutory invoice reference number, e-way bill, signature or declaration separately and file returns and pay taxes through the applicable channels. The Service does not submit filings or remit taxes for you.</p>
    </>,
  },
  {
    id: 'documents', title: 'Drafts, corrections and sharing',
    body: <>
      <p>A draft is for review. Finalisation assigns a document number and locks core document fields in the Service. Check for duplicates, including documents issued outside Invoice BizFolio, before finalising. You are the issuer and remain responsible for deciding whether, when and how to issue or correct a document.</p>
      <p>Preserve the original and its history. Use the credit-note workflow where appropriate. If law requires a debit note, cancellation, return amendment or other action outside the Service, complete it separately. Deleting a draft or changing a payment or credit-note status in the Service does not cancel a document or amend a GST return.</p>
      <p>Verify recipient addresses, phone numbers and attachments before sharing by email, WhatsApp, download or print. Keep copies of final documents and check that third-party delivery succeeded. Recording a customer payment updates workspace records. It does not move, verify or settle money between you and your customer.</p>
    </>,
  },
  {
    id: 'plans', title: 'Plans, trials and prices',
    body: <>
      <p>Invoice BizFolio offers a Free plan and a {TRIAL_DURATION_DAYS}-day trial, subject to eligibility and the features and limits shown for each plan. Review the available paid plan and exact price at checkout. A plan or feature marked coming soon is not available to purchase or use merely because it is displayed.</p>
      <p>A trial does not authorise a charge. When a trial or paid period expires, paid-only features may be restricted under the applicable Free plan limits. Prices, taxes, limits and features for future purchases may change. The amount shown for the selected term at checkout applies to that purchase. An annual equivalent displayed per month is a comparison figure. The annual price is paid for the full term.</p>
    </>,
  },
  {
    id: 'payment', title: 'Payment, verification and renewal',
    body: <>
      <p>Paid plans are prepaid for the selected monthly or annual term. Pay the amount to the recipient shown at checkout using the available UPI or bank transfer option. Submit the transaction reference and any requested evidence through the Service. Do not share payment credentials, PINs, one-time codes or unrelated financial details. Bank or UPI provider terms apply to the transfer itself.</p>
      <p>Submitting a payment reference is a request for verification. Paid access is activated or extended after verification and approval. Incorrect, duplicate, incomplete or unsuccessful transfers may delay or prevent activation. If money was debited or a claim was rejected, contact <LegalContact /> before paying again and keep the transaction reference.</p>
      <p>There is no automatic debit or renewal under the current payment flow. To renew, select a term, make a new transfer and submit it for verification. Approval may extend a currently valid term. Plan changes depend on available options and confirmation of the resulting access period.</p>
    </>,
  },
  {
    id: 'cancellation', title: 'Provisional refund and cancellation policy',
    body: <>
      <p>This proposed policy is subject to approval before launch. Applicable statutory rights and remedies continue to apply.</p>
      <ul>
        <li><strong>Duplicate or incorrect payment.</strong> A verified duplicate payment for the same purchase would qualify for a refund. A verified overpayment caused by a technical or processing error would be corrected or the excess refunded.</li>
        <li><strong>Failed or unfulfilled purchase.</strong> If funds are debited and the subscription is not activated or provided, we would investigate the transfer. If the funds reached us, we would resolve the failure by providing the purchased access with your agreement or refunding the payment, as appropriate. If the funds did not reach us, we would explain what we can verify and direct you to the bank or payment provider for any reversal it controls.</li>
        <li><strong>Cancellation and prepaid access.</strong> There is currently no automatic renewal. To stop renewing, do not make a further payment. Contact support to request cancellation or resolve a pending claim. Under the proposed policy, paid access ordinarily continues through the paid period, subject to applicable law, agreed terms and lawful access restrictions. Voluntary cancellation after activation would not automatically qualify for a prorated refund. Duplicate or incorrect payments, undelivered service, agreed exceptions and remedies required by law are handled separately.</li>
        <li><strong>Requests and timing.</strong> Email <LegalContact /> with the plan, amount, payment date and reference. Do not send banking credentials. We would verify eligibility, communicate the expected processing and bank settlement timeframe, and ordinarily return eligible refunds through the original payment method where possible. Any mandatory timeframe applies.</li>
      </ul>
      <p>Closing a workspace and resolving a payment dispute are separate requests.</p>
    </>,
  },
  {
    id: 'ownership', title: 'Software licence and Business Data',
    body: <>
      <p>During your authorised access, you may use the Service for your own business. Rights in the Service, its code, design and branding remain with their respective owners. These Terms do not transfer software or brand ownership or grant a right to resell the Service or use its branding as your own. Restrictions are subject to rights you cannot lawfully waive.</p>
      <p>As between you and Invoice BizFolio, you retain your rights in Business Data and may use and share the documents you generate for your lawful business purposes. Third-party rights in supplied content continue to apply. You authorise us and our service providers to process Business Data as necessary to operate, support, secure and deliver the Service, carry out your instructions, and comply with law. This permission continues after closure only to the extent needed for those lawful purposes.</p>
    </>,
  },
  {
    id: 'records', title: 'Exports, backups and statutory records',
    body: <>
      <p>Maintain independent, readable copies of the records you must keep. Owners can request a JSON export from Settings → General → Download your data. Obtain PDFs separately where available. An export does not replace a complete set of books, backups, or documents required by a tax authority.</p>
      <p>For applicable GST records, section 36 of the CGST Act generally requires retention for 72 months from the due date of the annual return for the relevant year. Longer periods can apply, including for specified proceedings or investigations. Company and income-tax obligations depend on your entity and circumstances. Check applicable requirements for electronic backups and retrieval, and export before closure or changes that may affect access.</p>
    </>,
  },
  {
    id: 'availability', title: 'Availability, third parties and security',
    body: <>
      <p>Availability can be affected by maintenance, infrastructure or network failures, provider restrictions, or issues with your device or credentials. External providers support hosting, sign-in, PDF creation, storage, email and other functions. Their interruptions may delay delivery or access. Third-party services you choose to use, including WhatsApp and payment providers, apply their own terms.</p>
      <p>We use access controls and other safeguards described in the <Link className={legalLink} href="/privacy">Privacy Policy</Link>. Use supported browsers, secure your own systems, keep separate records, and report faults promptly. We do not guarantee uninterrupted access, delivery, or recovery of every record.</p>
    </>,
  },
  {
    id: 'termination', title: 'Suspension, termination and closure',
    body: <>
      <p>We may restrict or suspend access where reasonably necessary to address a material breach, misuse, non-payment, security risk, or legal requirement. Where reasonably practicable and lawful, we will explain the reason and how to contact us. Immediate action may be necessary to protect users or records.</p>
      <p>The owner may request closure in Settings → General → Request account closure or through <LegalContact />. We verify authority and handle the request as described in the Privacy Policy. A request is not immediate deletion. Access can end while records remain subject to applicable law, security needs or legal holds. Export records before closure. Accrued obligations and provisions that by their nature continue, including data rights, payment disputes and legal remedies, survive termination.</p>
    </>,
  },
  {
    id: 'liability', title: 'Warranties, liability and indemnity',
    body: <>
      <p>To the extent permitted by law, the Service is supplied as available, without implied warranties of fitness for a particular purpose or error-free operation. You remain responsible for checking your inputs and issued records, complying with tax obligations, and taking reasonable steps to reduce losses.</p>
      <p>To the extent permitted by law, neither party is liable for indirect or consequential loss arising from use of the Service. Responsibility for direct loss is determined under applicable law. These Terms do not exclude liability for fraud or wilful misconduct, or limit liability or remedies that cannot lawfully be excluded or limited.</p>
      <p>To the extent permitted by law, you are responsible for reasonable costs and losses from third-party claims to the extent caused by your unlawful use, infringing content or material breach. This does not cover losses caused by our own acts or omissions. We will notify you of such a claim where practicable and cooperate reasonably in its resolution.</p>
    </>,
  },
  {
    id: 'changes', title: 'Changes, interruptions and interpretation',
    body: <>
      <p>We may update the Service and these Terms as features or legal requirements change. We will publish revised Terms with an updated date and give notice of material changes as required by law. Where law requires fresh acceptance, we will seek it. Changes do not take away mandatory rights.</p>
      <p>Neither party is responsible for delay caused by circumstances beyond its reasonable control, to the extent allowed by law. This does not discharge accrued obligations or mandatory duties. If a provision is unenforceable, the remainder continues to apply where it can operate independently. Delay in enforcing a right does not waive it. These Terms and any applicable purchase terms form the agreement for the Service, subject to any separately signed agreement and mandatory law.</p>
    </>,
  },
  {
    id: 'disputes', title: 'Governing law, grievances and notices',
    body: <>
      <p>Indian law governs these Terms. For a dispute or grievance, contact <LegalContact /> with your account email, a description and the resolution sought. Do not send passwords or payment credentials. We may use your registered email for account and legal notices.</p>
      <p>You may pursue remedies before a court, consumer commission or other competent forum with jurisdiction under applicable law. Contacting support does not waive or delay a statutory remedy.</p>
      <OperatorDetails />
    </>,
  },
]

export default function TermsOfServicePage() {
  return <LegalPage title="Terms of Service" intro="These terms explain what Invoice BizFolio provides, how subscriptions work, and your responsibilities when issuing and keeping GST records." related={{ href: '/privacy', label: 'Privacy Policy' }} sections={sections} />
}
