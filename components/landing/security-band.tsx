import { FileDown, Headphones, Landmark, Lock, ShieldCheck } from 'lucide-react'

const pillars = [
  {
    icon: Lock,
    title: 'Encryption',
    description: 'HTTPS protects traffic. Stored data and files are encrypted.',
    badge: 'HTTPS',
    accent: 'border-indigo-100 bg-indigo-50 text-indigo-800',
  },
  {
    icon: ShieldCheck,
    title: 'Locked invoices',
    description: 'Finalized invoices stay locked. Record corrections with GST credit notes.',
    badge: 'Credit notes',
    accent: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  },
  {
    icon: Landmark,
    title: 'Private workspaces',
    description: 'Each business can access only its own invoices, customers, and reports.',
    badge: 'Scoped access',
    accent: 'border-amber-100 bg-amber-50 text-amber-900',
  },
  {
    icon: FileDown,
    title: 'Data export',
    description: 'Business owners can download their account data from Settings.',
    badge: 'Owners only',
    accent: 'border-violet-100 bg-violet-50 text-violet-800',
  },
  {
    icon: Headphones,
    title: 'Email support',
    description: 'Get help through the support email listed in the app.',
    badge: 'In-app contact',
    accent: 'border-sky-100 bg-sky-50 text-sky-900',
  },
]

export function SecurityBand() {
  return (
    <section aria-labelledby="security-heading" className="bg-[#f2f5ef] px-5 pb-5 pt-8 sm:px-8 sm:pb-6 sm:pt-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-center sm:mb-5">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            <ShieldCheck aria-hidden="true" className="size-3.5" />
            Security
          </p>
          <h2 id="security-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Security &amp; trust
          </h2>
          <p className="mx-auto mt-1.5 max-w-lg text-base leading-relaxed text-slate-700">
            Keep your GST records private, accurate, and accessible.
          </p>
        </div>

        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5 lg:gap-3">
          {pillars.map(({ icon: Icon, title, description, badge, accent }) => (
            <li
              key={title}
              className="rounded-2xl border border-[#dce5d8] bg-white p-3 shadow-xs sm:last:col-span-2 lg:last:col-span-1 xl:p-3.5"
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${accent}`}>
                  <Icon aria-hidden="true" className="size-[1.125rem]" />
                </span>
                <span className={`whitespace-nowrap rounded-[0.3rem] border px-1.5 py-0.5 text-xs font-semibold ${accent}`}>
                  {badge}
                </span>
              </div>
              <div>
                <h3 className="text-[1.0625rem] font-bold leading-tight tracking-tight text-slate-950 xl:text-lg">{title}</h3>
                <p className="mt-1 text-sm leading-snug text-slate-700">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
