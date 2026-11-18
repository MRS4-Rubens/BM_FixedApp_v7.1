import { Check, Sparkles } from 'lucide-react'

const comparisons = [
  { capability: 'GST calculation', billMatrix: 'Automatic GST calculation', manual: 'Set up formulas and check totals' },
  { capability: 'ITR-ready export', billMatrix: 'Download an Excel sales report', manual: 'Compile and format sales data' },
  { capability: 'Payment follow-up', billMatrix: 'Overdue invoice alerts in your dashboard', manual: 'Track dues and follow up separately' },
  { capability: 'Invoice sharing', billMatrix: 'Download the PDF or share on WhatsApp', manual: 'Export and attach files manually' },
  { capability: 'Business insights', billMatrix: 'Sales dashboard and reports', manual: 'Build and maintain summaries' },
]

export function ComparisonTable() {
  return (
    <section aria-labelledby="comparison-heading" className="bg-[#f2f8f6] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-center sm:mb-5">
          <h2 id="comparison-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Why businesses switch to <span className="block whitespace-nowrap text-teal-800">Invoice BizFolio</span>
          </h2>
          <p id="comparison-summary" className="mx-auto mt-2 max-w-2xl text-pretty text-base leading-relaxed text-slate-600 sm:text-lg">
            Compare everyday billing tasks in Invoice BizFolio with doing them by hand or in a spreadsheet.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <table aria-labelledby="comparison-heading" aria-describedby="comparison-summary" className="w-full table-fixed text-left text-sm leading-snug sm:text-base">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="w-[29%] px-2 py-2.5 font-semibold text-slate-900 sm:px-4">Capability</th>
                <th scope="col" className="w-[36%] bg-teal-100/75 px-2 py-2.5 font-semibold text-teal-900 sm:px-4">
                  <span className="flex items-center gap-1.5">
                    <Sparkles aria-hidden="true" className="hidden size-4 shrink-0 sm:block" />
                    Invoice BizFolio
                  </span>
                </th>
                <th scope="col" className="px-2 py-2.5 font-semibold text-slate-700 sm:px-4">Manual workflow</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {comparisons.map(({ capability, billMatrix, manual }) => (
                <tr key={capability}>
                  <th scope="row" className="px-2 py-2.5 align-top font-medium text-slate-950 sm:px-4 sm:py-3">
                    {capability}
                  </th>
                  <td className="bg-teal-50/80 px-2 py-2.5 align-top text-emerald-800 sm:px-4 sm:py-3">
                    <span className="flex items-start gap-1.5">
                      <Check aria-hidden="true" className="mt-0.5 hidden size-4 shrink-0 sm:block" />
                      {billMatrix}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 align-top text-slate-600 sm:px-4 sm:py-3">{manual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
