// Pure maths for the landing-page savings calculator. Every input comes from the
// visitor's own sliders; the only fixed assumption is MINUTES_PER_INVOICE_IN_APP,
// which the page states openly next to the result.

/** Typical time to create an invoice in the app once customers and products are saved. */
export const MINUTES_PER_INVOICE_IN_APP = 1

export interface SavingsInput {
  invoicesPerMonth: number
  manualMinutesPerInvoice: number
  hourlyRateRupees: number
}

export interface SavingsEstimate {
  /** Hours saved per month, rounded to the nearest whole hour for display. */
  hoursSavedMonthly: number
  /** Rupees saved per year, rounded to the nearest rupee. */
  annualSavingsRupees: number
}

export function estimateSavings({ invoicesPerMonth, manualMinutesPerInvoice, hourlyRateRupees }: SavingsInput): SavingsEstimate {
  const minutesSavedPerInvoice = Math.max(0, manualMinutesPerInvoice - MINUTES_PER_INVOICE_IN_APP)
  const exactHoursMonthly = (invoicesPerMonth * minutesSavedPerInvoice) / 60

  return {
    hoursSavedMonthly: Math.round(exactHoursMonthly),
    annualSavingsRupees: Math.round(exactHoursMonthly * 12 * hourlyRateRupees),
  }
}
