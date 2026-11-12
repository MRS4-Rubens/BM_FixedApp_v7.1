import { ChartNoAxesColumnIncreasing, FileSpreadsheet, FolderOpen, MessageCircle, Receipt, ReceiptText, Smartphone, Sparkles } from 'lucide-react'

const features = [
  {
    icon: ReceiptText,
    title: 'GST-compliant invoicing',
    description: 'Create invoices with automatic CGST, SGST, or IGST calculations, HSN codes, and GST-ready templates.',
    accent: 'from-indigo-600 to-indigo-800',
    wide: true,
  },
  {
    icon: FileSpreadsheet,
    title: 'ITR-ready Excel export',
    description: 'Download a sales report in Excel to prepare your income tax filing or share with your CA.',
    accent: 'from-amber-700 to-orange-700',
  },
  {
    icon: ChartNoAxesColumnIncreasing,
    title: 'Sales analytics',
    description: 'Track sales and revenue across reporting periods.',
    accent: 'from-emerald-600 to-emerald-800',
  },
  {
    icon: FolderOpen,
    title: 'Products & customers',
    description: 'Save product and customer details once, then reuse them on new invoices.',
    accent: 'from-violet-600 to-purple-800',
  },
  {
    icon: Receipt,
    title: 'Credit notes & payments',
    description: 'Issue GST credit notes and record full or partial payments against invoices.',
    accent: 'from-rose-600 to-pink-800',
  },
  {
    icon: MessageCircle,
    title: 'Invoice sharing & reminders',
    description: 'Email invoice PDFs, share invoices over WhatsApp, and send payment reminders.',
    accent: 'from-sky-600 to-blue-800',
    wide: true,
  },
  {
    icon: Smartphone,
    title: 'Desktop, tablet & mobile',
    description: 'Manage your billing from any of your devices.',
    accent: 'from-teal-600 to-cyan-800',
  },
]

export function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-24 bg-[#fcfaf6] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-center sm:mb-5">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
            <Sparkles aria-hidden="true" className="size-3.5" />
            Features
          </p>
          <h2 id="features-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Everything your business needs
          </h2>
          <p className="mt-1.5 text-base leading-relaxed text-slate-700 sm:text-lg">
            From first invoice to final filing — <strong className="font-bold text-slate-950">one platform.</strong>
          </p>
        </div>

        <ul className="grid gap-2.5 md:grid-cols-3 md:gap-3">
          {features.map(({ icon: Icon, title, description, accent, wide }) => (
            <li
              key={title}
              className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] content-start items-center gap-x-3 gap-y-2.5 rounded-2xl border border-stone-200 bg-white p-3.5 shadow-xs transition-[border-color,box-shadow,translate] duration-200 hover:border-stone-300 hover:shadow-[0_8px_22px_-12px_#57534e40] motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none md:p-4 ${wide ? 'md:col-span-2' : ''}`}
            >
              <span className={`grid size-10 place-items-center rounded-xl border border-black/10 bg-linear-to-br text-white shadow-[inset_0_1px_0_#ffffff38,0_2px_4px_#0f172a20] ${accent}`}>
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <h3 className="text-lg font-normal leading-tight tracking-tight text-slate-950 sm:text-[1.3125rem]">{title}</h3>
              <p className="col-span-2 text-base leading-snug text-slate-600">{description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
