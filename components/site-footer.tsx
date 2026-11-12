import Link from 'next/link'
import { InvoiceBizFolioLogo } from '@/components/brand/invoice-bizfolio-logo'
import { BRAND_NAME } from '@/lib/config/brand'
import { ArrowUpRight, Mail } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/config/contact'

const navigation = [
  { href: '/#features', label: 'GST invoicing engine' },
  { href: '/#dashboard', label: 'Live tax simulator' },
  { href: '/#calculator', label: 'ROI calculator' },
  { href: '/#pricing', label: 'Pricing plans' },
]

const solutions = [
  'Retail & wholesale',
  'E-commerce & D2C brands',
  'Manufacturing & export',
  'IT & professional services',
  'Chartered accountants',
]

const linkStyle = 'rounded-sm transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-300'
const headingStyle = 'mb-2.5 text-sm font-bold uppercase tracking-wide text-white'

export function SiteFooter() {
  return (
    <footer className="border-t border-indigo-300/15 bg-[radial-gradient(ellipse_at_top_left,#171a31_0%,#0a0e1a_58%)] px-5 pt-8 pb-[calc(6rem+env(safe-area-inset-bottom))] text-slate-300 sm:px-8 md:pb-6 lg:pt-10">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 border-b border-slate-700/70 pb-6 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:gap-x-7">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <Link href="/" className={`inline-flex items-center gap-2.5 ${linkStyle}`}>
              <InvoiceBizFolioLogo variant="icon" decorative className="w-9" />
              <span className="text-xl font-bold tracking-tight text-white">
                Invoice <span className="text-orange-300">BizFolio</span>
              </span>
            </Link>
            <p className="mt-3 max-w-sm text-base leading-relaxed text-slate-300">
              GST invoicing, payment tracking, and sales reporting for Indian businesses, traders, and founders.
            </p>
            <Link href="/#pricing" className={`mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-950/70 px-3 py-1 text-sm font-semibold text-emerald-200 ${linkStyle}`}>
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
              Free plan available
            </Link>
          </div>

          <nav aria-label="Product">
            <h2 className={headingStyle}>Product</h2>
            <ul className="space-y-1.5 text-base leading-snug text-slate-400">
              {navigation.map(({ href, label }) => (
                <li key={href}><Link href={href} className={linkStyle}>{label}</Link></li>
              ))}
              <li>
                <Link href="/dashboard" className={`inline-flex items-center gap-1 font-semibold text-indigo-300 ${linkStyle}`}>
                  Merchant portal
                  <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className={headingStyle}>Solutions</h2>
            <ul className="space-y-1.5 text-base leading-snug text-slate-400">
              {solutions.map(solution => <li key={solution}>{solution}</li>)}
            </ul>
          </div>

          <div className="col-span-2 min-w-0 sm:col-span-1">
            <h2 className={headingStyle}>Trust &amp; support</h2>
            <ul className="mb-1.5 space-y-1.5 text-base leading-snug text-slate-400">
              <li>Encrypted connections</li>
              <li>Private business workspaces</li>
            </ul>
            <a href={`mailto:${SUPPORT_EMAIL}`} className={`inline-flex max-w-full items-center gap-1.5 text-base text-indigo-300 ${linkStyle}`}>
              <Mail aria-hidden="true" className="size-4 shrink-0" />
              <span className="wrap-anywhere">{SUPPORT_EMAIL}</span>
            </a>
            <p className="mt-1.5 text-sm text-slate-400">Bengaluru, Karnataka, India</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-3.5 text-sm leading-relaxed text-slate-400">
          <p>© {new Date().getFullYear()} {BRAND_NAME}. All rights reserved.</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
            <Link href="/privacy" className={linkStyle}>Privacy policy</Link>
            <Link href="/terms" className={linkStyle}>Terms of service</Link>
          </nav>
        </div>
      </div>
    </footer>
  )
}
