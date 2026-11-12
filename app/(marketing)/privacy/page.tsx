import type { Metadata } from 'next'
import { LegalContact, LegalPage, OperatorDetails } from '../legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Invoice BizFolio handles personal data, workspace records, and privacy requests.',
  alternates: { canonical: '/privacy' },
}

const sections = [
  {
    id: 'scope', title: 'Scope and responsibility',
    body: <>
      <p>This Policy explains how Invoice BizFolio handles personal data when you visit our website, sign in, use a business workspace, purchase a subscription, or contact us. Personal data is information about an identifiable individual. A business record can contain personal data, for example the name, address or GSTIN of an individual proprietor.</p>
      <p>Invoice BizFolio determines the purposes of processing for its own account administration, subscription billing, security and support. Where a business enters customer or other third-party information to prepare its records or send documents, the business determines why it uses that information and Invoice BizFolio processes it to operate the workspace and carry out authorised instructions. Invoice BizFolio may separately process information where necessary to protect the Service or meet its own legal obligations. Roles depend on the activity and applicable law.</p>
    </>,
  },
  {
    id: 'information', title: 'Information we handle',
    body: <ul>
      <li><strong>Account and authentication.</strong> Name, email address, authentication and session information, account identifiers, business association and role. Password entry is processed through Neon Auth for email/password sign-in.</li>
      <li><strong>Business profile.</strong> Legal and trade names, business type, GSTIN, PAN where present, addresses, state, postal code, email, phone, logo, preferences, and optional settlement details such as account name, number, bank and IFSC.</li>
      <li><strong>Customer and catalogue records.</strong> Customer names, addresses, phone numbers, emails and GSTINs as entered, along with products or services, HSN/SAC, units, rates and prices. Other parties’ details can appear in documents or free-text fields supplied by your business.</li>
      <li><strong>Invoices and payments.</strong> Draft and final invoices, linked credit notes, line items, recipient and seller details, dates, numbering, amounts and tax treatment. Payment entries can include amounts, dates, methods, transaction references and notes. These entries record customer payments in the workspace.</li>
      <li><strong>Subscription payments.</strong> Plan, billing period, amount, transfer method, UTR or other reference, submitted proof images, verification status and subscription history. Invoice BizFolio checkout uses UPI or bank transfer and does not collect card details or payment PINs through a card gateway.</li>
      <li><strong>Technical and support information.</strong> Device or browser information, IP address, request identifiers, time, errors and usage events. Account and financial actions may create audit records. We also process messages and supporting information you submit for feedback, assistance or closure.</li>
    </ul>,
  },
  {
    id: 'purposes', title: 'Purposes and grounds for processing',
    body: <>
      <p>We use personal data to authenticate users, provide and administer workspaces, calculate and store billing records, generate PDFs and exports, send requested documents and reminders, verify subscription payments, provide support, prevent abuse, diagnose errors and comply with applicable law. We use website usage information to understand and improve the site.</p>
      <p>We process data for the requested service and other purposes permitted or required by applicable law. Where the law requires consent, including for collection or use of sensitive information in applicable circumstances, we must obtain it in the required manner. Where the Digital Personal Data Protection Act, 2023 applies and the relevant provisions are in force, we rely on consent or a specific permitted use under that Act, as appropriate. We do not treat agreement to the Terms as blanket consent for unrelated processing.</p>
      <p>Businesses should provide appropriate notices and obtain any permission required to submit their customers’ personal data. Provide only information needed for the task. Keep passwords, one-time codes and unrelated personal information out of uploads, support emails and transaction notes.</p>
    </>,
  },
  {
    id: 'cookies', title: 'Cookies and analytics',
    body: <>
      <p>Authentication cookies maintain and protect your session. A preference cookie can remember whether the signed-in sidebar is collapsed. Your browser lets you inspect or clear cookies. Blocking required session cookies can prevent sign-in or interrupt account access.</p>
      <p>The website uses Vercel Analytics for site usage measurement. Hosting and monitoring systems can also process request and device information for security and troubleshooting. These functions are distinct from cookies used to keep a session active.</p>
    </>,
  },
  {
    id: 'sharing', title: 'Service providers and disclosures',
    body: <>
      <p>The development code includes the integrations below. The production provider list and configurations will be verified before launch. Each enabled provider receives information needed for its role.</p>
      <ul>
        <li><strong>Vercel and Neon.</strong> Website and application hosting, analytics, database and authentication.</li>
        <li><strong>iDrive e2 and CustomJS.</strong> Object storage for documents, logos and payment evidence, and PDF rendering. The information in a finalized document may be sent to the renderer in document form.</li>
        <li><strong>Resend.</strong> Email delivery for document sharing, payment reminders and operational messages. A requested message can include invoice information or an attached PDF.</li>
        <li><strong>Upstash and Sentry.</strong> Rate limiting and error monitoring, respectively. Operational providers receive technical data needed for those functions when enabled.</li>
      </ul>
      <p>Authorised staff may access information as needed for support, account administration, security or payment verification. We may disclose information where required by valid legal process or applicable law. We do not sell workspace records.</p>
      <p>When you choose to send a document or use WhatsApp, your recipients or the relevant messaging service may receive the information you share. Banks and UPI apps process your external payment under their own terms and privacy notices. Other third-party websites reached through links are governed by their own policies.</p>
    </>,
  },
  {
    id: 'locations', title: 'Storage locations and international processing',
    body: <>
      <p><strong>Production hosting and storage regions</strong> [TO BE CONFIRMED BEFORE PRODUCTION LAUNCH]. Depending on the provider and function, storage, support or processing may occur outside India. Transfers are subject to applicable legal restrictions and safeguards, including rules for sensitive personal data and location requirements for particular records.</p>
    </>,
  },
  {
    id: 'security', title: 'Security and incident response',
    body: <>
      <p>We use HTTPS, workspace-scoped authorisation and controlled access to stored files. Authentication and permissions restrict workspace access. Error monitoring is configured to reduce collection of personal data and redact sensitive fields. No security measure eliminates all risk.</p>
      <p>Report suspected unauthorised access or disclosure promptly to <LegalContact />. Where applicable law requires it, we will notify the competent authority and affected persons in the required manner and timeframe. We may retain incident records for investigation, legal obligations and protection of the Service.</p>
    </>,
  },
  {
    id: 'retention', title: 'Retention, erasure and legal holds',
    body: <>
      <ul>
        <li><strong>Statutory and transaction records.</strong> Invoices, credit notes, payment records and the business and customer details shown on them are kept for at least 8 years after the end of the financial year they belong to, as Indian GST, income-tax and company law require. A valid hold, proceeding or investigation may extend retention. Keeping a statutory copy does not require keeping unrelated profile information indefinitely.</li>
        <li><strong>Account and operational data.</strong> Retention depends on the service purpose, support or security needs, unresolved disputes, legal duties and the applicable provider systems. On a valid erasure request, we assess which data can be erased, which data must be retained, and whether anonymisation is appropriate and permitted. Backup copies may remain subject to restricted access until ordinary expiry or lawful removal.</li>
        <li><strong>Use of retained data.</strong> Information retained for a legal or security reason may still be used for that purpose. Retention of Invoice BizFolio’s own records is separate from your business’s duty to maintain its own books and documents.</li>
      </ul>
      <p>Closing a workspace or withdrawing consent does not automatically erase every invoice, transaction record, backup or audit log.</p>
      <p><strong>Post-closure deletion schedule.</strong> Data that is not a statutory record (for example your login account, team members, product catalogue, customers that never appeared on an invoice, logo and subscription payment screenshots) is erased within 30 days after your workspace is closed. <strong>Backup retention</strong> [BACKUP RETENTION PERIOD TO BE FINALIZED].</p>
    </>,
  },
  {
    id: 'closure', title: 'Export and account closure',
    body: <>
      <p>Workspace owners can use Settings → General → Download your data to export business profile, customer, product, invoice, credit-note, payment and subscription records in JSON. The export excludes credentials and internal storage information and does not package archived PDFs. Download available PDFs separately. Save the records you need before losing access.</p>
      <p>Use Settings → General → Request account closure, or write to <LegalContact />. The in-app request records the owner’s request for follow-up and asks for GSTIN confirmation. We may verify authority before acting. A request acknowledgement does not mean closure or deletion has already taken place. We will explain the next steps and any lawful retention that affects the request.</p>
    </>,
  },
  {
    id: 'rights', title: 'Privacy requests and grievances',
    body: <>
      <p>Write to <LegalContact /> to request access to or a copy of personal information, review or correct information you provided, request erasure, withdraw consent, or raise a grievance. Give your account email and enough context to locate the relevant record. Do not send your password, full bank account number or one-time codes. We may verify identity and authority before disclosing or changing data.</p>
      <p>Withdrawal applies to consent-based processing going forward and can affect features that require the information. It does not prevent processing or retention otherwise required or permitted by law. If a customer’s information appears in a business’s workspace, the business normally handles requests about its underlying records. You can contact us for assistance identifying the appropriate channel.</p>
      <p>Statutory rights and complaint channels apply as provided by the law in force. Once the relevant DPDP provisions commence, they include rights of access to specified information, correction and erasure, grievance redressal, and nomination. We address requests within the applicable legal timelines. You may use any competent authority or statutory grievance process available to you.</p>
    </>,
  },
  {
    id: 'communications', title: 'Communications and children',
    body: <>
      <p>We may send account, security, subscription and support communications needed to operate the Service. Workspace businesses decide when to send customer invoices and reminders. If we send optional marketing messages, you can use the opt-out provided or write to <LegalContact />. Opting out of marketing does not stop essential service communications.</p>
      <p>Invoice BizFolio accounts are for people aged 18 and above. The Service is not directed at children. Do not enter a child’s personal information unless it is necessary for a lawful business purpose and you have met any applicable notice, permission and other legal requirements.</p>
    </>,
  },
  {
    id: 'updates', title: 'Updates and contact',
    body: <>
      <p>We publish updated versions of this Policy on this page and give additional notice or seek fresh consent where required by law. For development-stage enquiries, email <LegalContact />.</p>
      <OperatorDetails />
    </>,
  },
]

export default function PrivacyPolicyPage() {
  return <LegalPage title="Privacy Policy" intro="This policy explains what information Invoice BizFolio handles, why it is used, and how to exercise your privacy rights." related={{ href: '/terms', label: 'Terms of Service' }} sections={sections} />
}
