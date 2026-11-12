# Bill Matrix public-launch checklist

Development status confirmed on 12 November 2026. The Terms and Privacy Policy are review drafts. Replace the shared identity fields in `app/(marketing)/legal-page.tsx` once the information is verified.

## Business registration and grievance contact

- [ ] Registered legal name and entity type, supported by the applicable registration documents.
- [ ] Registered office address and applicable CIN, LLPIN or other identifier. Confirm supplier GST registration and disclosures where applicable.
- [ ] Designated privacy or grievance officer appointment, name, monitored official email and phone number.
- [ ] Confirm complaint intake, ownership and statutory response procedures. Scope SPDI Rule 5, applicable e-commerce disclosures and response times, and any intermediary duties with Indian counsel.
- [ ] Confirm the contracting party, legal-notice address, competent forum language, liability allocation, approved effective date and notice to existing users.

## Billing and refunds

- [ ] Approve the provisional duplicate, erroneous, failed and unfulfilled payment rules and cancellation treatment. Define when resolution means activation with consent versus refund.
- [ ] Confirm who reconciles UPI and bank transfers, approves refunds, issues receipts, and records reversals and disputes.
- [ ] Agree the refund communication timeline, supported repayment methods, bank processing expectations and fallback where the original channel cannot be used.
- [ ] Document how customers request cancellation, what happens to pending claims and already-paid access, and exceptions to the ordinary treatment of unused prepaid time.
- [ ] Show approved terms, the total price and applicable taxes before payment. Record the version of the terms accepted.

## Privacy, hosting and records

- [ ] Verify production vendors, controller/processor roles, hosting and backup regions, access by overseas staff or providers, transfer safeguards and service contracts. Update the Privacy Policy with actual production facts.
- [ ] Verify production cookie and analytics behaviour, and record the purpose, duration and control for each technology. Confirm sign-in, verification and password-recovery settings.
- [ ] Build a record-class schedule for accounts, drafts, final documents, payment proof, support tickets, audit and operational logs, and backups. Record the legal basis, retention trigger, period, owner and expiry procedure for each.
- [ ] Test owner verification, export, closure, personal-data erasure and legal holds. Use an approved closure schedule and remove any conflicting promises in Settings and the deployment runbook.
- [ ] Verify database restore and backup retention, document storage lifecycle and Object Lock settings, evidence-image handling, deletion from each provider and audit evidence.
- [ ] Verify CERT-In time synchronisation, log availability and retention in India, named contact, reportable incident escalation, and breach communications.
- [ ] Recheck DPDP commencement at launch. Prepare compliant notices, applicable consent records and withdrawal, rights and nomination handling, processor agreements, and incident reporting before relevant provisions apply.
- [ ] Review the operator and vendor details, retention periods and privacy statements with Indian counsel. Remove development markers only when replaced with verified facts and approved dates.
