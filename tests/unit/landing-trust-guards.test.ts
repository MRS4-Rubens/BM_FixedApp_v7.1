import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { INDIAN_GST_STATES } from '@/lib/gst/indian-states'
import { PLAN_CATALOG } from '@/lib/subscriptions/plan-catalog'
import { estimateSavings, MINUTES_PER_INVOICE_IN_APP } from '@/components/landing/savings-estimate'

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')

describe('Landing trust pass: hero facts are true product facts', () => {
  const hero = read('components/landing/hero-section.tsx')

  it('has no "illustrative" usage figures', () => {
    expect(hero).not.toMatch(/illustrative/i)
    expect(hero).not.toMatch(/label: '(Businesses|Invoiced|Compliance)'/)
  })

  it('"36 States & UTs" matches the GST state registry', () => {
    expect(hero).toMatch(/target: 36, prefix: '', label: 'States & UTs covered'/)
    expect(INDIAN_GST_STATES).toHaveLength(36)
  })

  it('"4 GST & ITR Excel reports" matches the report builders in lib/excel', () => {
    expect(hero).toMatch(/target: 4, prefix: '', label: 'GST & ITR Excel reports'/)
    const builders = fs.readdirSync(path.resolve(process.cwd(), 'lib/excel')).filter((f) => /^build-.*\.ts$/.test(f))
    expect(builders).toHaveLength(4)
  })

  it('"₹0 to start" matches a free plan that exists', () => {
    expect(hero).toMatch(/target: 0, prefix: '₹', label: 'To start \(free plan\)'/)
    expect(PLAN_CATALOG.free).toBeDefined()
  })

  it('does not claim the GSTR-1 export is automatic', () => {
    expect(hero).not.toMatch(/auto-export/i)
    expect(hero).toContain('GSTR-1 Excel export is live')
  })
})

describe('Landing trust pass: header, footer and pricing', () => {
  it('uses "Start free" (not "trial") on the public header buttons', () => {
    const header = read('components/site-header.tsx')
    expect(header).not.toMatch(/Free Trial|Get Started Free/)
    expect(header.match(/<span>Start free<\/span>/g)).toHaveLength(2)
  })

  it('footer shows no e-mail address and no fake "Solutions" links', () => {
    const footer = read('components/site-footer.tsx')
    expect(footer).not.toMatch(/mailto:|SUPPORT_EMAIL/)
    expect(footer).not.toContain('>Solutions<')
    expect(footer).toContain('Contact support')
  })

  it('shows no price for a plan that is not on sale', () => {
    const pricing = read('components/landing/pricing-section.tsx')
    expect(PLAN_CATALOG.professional.purchasable).toBe(false)
    expect(pricing).not.toContain("formatPlanPrice('professional'")
  })
})

describe('Landing trust pass: savings calculator maths', () => {
  it('saves (manual minutes - 1) per invoice, priced at the visitor\'s own hourly cost', () => {
    expect(MINUTES_PER_INVOICE_IN_APP).toBe(1)
    // 150 invoices x 11 minutes saved = 27.5 h/month; x 12 x ₹300 = ₹99,000/year
    expect(estimateSavings({ invoicesPerMonth: 150, manualMinutesPerInvoice: 12, hourlyRateRupees: 300 }))
      .toEqual({ hoursSavedMonthly: 28, annualSavingsRupees: 99_000 })
  })

  it('never invents savings when there is nothing to save', () => {
    expect(estimateSavings({ invoicesPerMonth: 100, manualMinutesPerInvoice: 1, hourlyRateRupees: 500 }))
      .toEqual({ hoursSavedMonthly: 0, annualSavingsRupees: 0 })
  })

  it('has no hidden extras in the calculator (no fixed hourly rate or per-invoice bonus)', () => {
    const calc = read('components/landing/calculator-section.tsx')
    expect(calc).not.toMatch(/\* 450|\* 18\b|45 seconds/)
  })
})
