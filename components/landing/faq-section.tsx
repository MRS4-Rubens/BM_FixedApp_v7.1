import { ChevronDown, CircleHelp } from 'lucide-react'

const questions = [
  {
    question: 'How long does onboarding take?',
    answer: 'Sign up, enter your business details and GSTIN, and start invoicing in a few minutes.',
  },
  {
    question: 'Can I export data for my CA?',
    answer: 'Yes. In Reports, you can download a sales report in Excel and share it with your CA. Excel exports are available on Essentials Pro and during the free trial.',
  },
  {
    question: 'Is my business data secure?',
    answer: 'HTTPS encrypts traffic, and our database and storage providers encrypt data at rest. Each business can access only its own records.',
  },
  {
    question: 'Is WhatsApp sharing free?',
    answer: 'WhatsApp invoice sharing is included with Essentials Pro and during the free trial.',
  },
]

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-24 border-t border-stone-200/80 bg-[#fcfaf6] px-5 py-8 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 text-center sm:mb-5">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
            <CircleHelp aria-hidden="true" className="size-3.5" />
            FAQ
          </p>
          <h2 id="faq-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-1.5 text-base leading-relaxed text-slate-600 sm:text-lg">
            Quick answers about setup, reports, data security, and invoice sharing.
          </p>
        </div>

        <div className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white p-1 shadow-xs">
          {questions.map(({ question, answer }) => (
            <details key={question} className="group px-1.5 py-1 sm:px-2">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-lg font-medium leading-snug text-slate-950 transition-colors hover:bg-stone-50 group-open:bg-stone-100 group-open:text-stone-950 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-600 sm:px-3.5 sm:text-xl [&::-webkit-details-marker]:hidden">
                {question}
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 group-open:border-stone-300 group-open:text-stone-800">
                  <ChevronDown aria-hidden="true" className="size-4 group-open:rotate-180 motion-safe:transition-transform" />
                </span>
              </summary>
              <p className="max-w-3xl px-2.5 pb-2.5 pt-2 text-base leading-relaxed text-slate-600 sm:px-3.5">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
