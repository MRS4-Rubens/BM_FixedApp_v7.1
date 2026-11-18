import type { ReactNode } from 'react'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

export const legalLink = 'font-medium text-indigo-700 underline decoration-indigo-200 underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'

export function LegalContact() {
  return <a className={legalLink} href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
}

const operatorDetails = [
  ['Registered legal name', '[TO BE CONFIRMED]'],
  ['Registered office address', '[TO BE UPDATED AFTER BUSINESS REGISTRATION]'],
  ['CIN, LLPIN or other registration ID', '[TO BE ADDED, IF APPLICABLE]'],
  ['Designated privacy or grievance officer', '[TO BE APPOINTED / CONFIRMED]'],
  ['Official privacy or grievance email', '[TO BE FINALIZED]'],
  ['Official contact number', '[TO BE FINALIZED]'],
]

export function OperatorDetails() {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
      <p className="mb-2 font-semibold text-slate-950">Operator and grievance details pending verification</p>
      <dl className="space-y-2 text-sm">
        {operatorDetails.map(([label, value]) => (
          <div key={label}>
            <dt className="font-medium text-slate-900">{label}</dt>
            <dd className="text-slate-600">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

type LegalSection = { id: string; title: string; body: ReactNode }

export function LegalPage({ title, intro, related, sections }: {
  title: string
  intro: string
  related: { href: '/privacy' | '/terms'; label: string }
  sections: readonly LegalSection[]
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-12 pt-24 sm:px-8 sm:pb-16 sm:pt-28">
      <article className="grid gap-7 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-x-10">
        <header className="lg:col-start-2">
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Development draft. Last updated <time dateTime="2026-11-18">18 November 2026</time>.
          </p>
          <p className="mt-2 max-w-prose rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Effective date [TO BE CONFIRMED BEFORE PRODUCTION LAUNCH]. This draft is for review before public release.
          </p>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-slate-700">{intro}</p>
        </header>

        <nav aria-label="On this page" className="self-start rounded-2xl border border-stone-200 bg-white px-4 py-3 lg:row-start-2">
          <p className="font-semibold text-slate-950">On this page</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-snug text-slate-700 sm:max-lg:grid sm:max-lg:grid-cols-2 sm:max-lg:gap-x-7">
            {sections.map(({ id, title }) => (
              <li key={id}><a className={legalLink} href={`#${id}`}>{title}</a></li>
            ))}
          </ol>
          <p className="mt-3 border-t border-stone-200 pt-2.5 text-sm"><Link className={legalLink} href={related.href}>{related.label}</Link></p>
        </nav>

        <div className="min-w-0 max-w-prose lg:col-start-2">
          {sections.map(({ id, title, body }, index) => (
            <section key={id} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-b border-stone-200 py-4 first:pt-0 last:border-b-0 sm:py-5">
              <h2 id={`${id}-title`} className="text-lg font-semibold leading-snug text-slate-950 sm:text-xl">{index + 1}. {title}</h2>
              <div className="mt-2 space-y-2.5 text-base leading-relaxed text-slate-700 [&_a]:wrap-anywhere [&_li+li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">{body}</div>
            </section>
          ))}
          <p className="mt-4 text-sm"><Link className={legalLink} href={related.href}>{related.label}</Link></p>
        </div>
      </article>
    </main>
  )
}
