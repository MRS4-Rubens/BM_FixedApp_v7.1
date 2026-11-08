export function HowItWorks() {
  return (
    <section id="how" className="py-24 px-6 max-w-6xl mx-auto">
      <div className="text-center mb-16">
        <span className="reveal in inline-block text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-full px-4 py-1.5 mb-5 tracking-wide uppercase">
          🚀 Get Started
        </span>
        <h2 className="reveal in text-4xl md:text-5xl font-bold heading">Ready in four simple steps</h2>
        <p className="reveal in text-zinc-500 mt-4 text-lg">
          No configuration headaches. No code. <span className="text-zinc-700 font-medium">Just results.</span>
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-8 relative">
        <div className="reveal in text-center relative group">
          <div className="w-16 h-16 bg-gradient-to-br from-rose-500 to-pink-500 text-white rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-6 pulse-ring-rose transition-all duration-300 shadow-md hover:scale-110">
            1
          </div>
          <h3 className="font-semibold text-lg heading">Set up your business</h3>
          <p className="text-zinc-500 text-sm mt-2 leading-relaxed">
            Enter your GSTIN and business details once; we validate the GSTIN format.
          </p>
        </div>

        <div className="reveal in text-center relative group">
          <div className="w-16 h-16 bg-gradient-to-br from-amber-500 to-orange-500 text-white rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-6 pulse-ring-amber transition-all duration-300 shadow-md hover:scale-110">
            2
          </div>
          <h3 className="font-semibold text-lg heading">Add customers & products</h3>
          <p className="text-zinc-500 text-sm mt-2 leading-relaxed">
            Save them once and reuse them on every invoice.
          </p>
        </div>

        <div className="reveal in text-center relative group">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-500 text-white rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-6 pulse-ring-emerald transition-all duration-300 shadow-md hover:scale-110">
            3
          </div>
          <h3 className="font-semibold text-lg heading">Invoice & share</h3>
          <p className="text-zinc-500 text-sm mt-2 leading-relaxed">
            Pick a customer and items, finalize, then e-mail the PDF or share on WhatsApp.
          </p>
        </div>

        <div className="reveal in text-center relative group">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl flex items-center justify-center text-xl font-bold mx-auto mb-6 pulse-ring-indigo transition-all duration-300 shadow-md hover:scale-110">
            4
          </div>
          <h3 className="font-semibold text-lg heading">Track payments</h3>
          <p className="text-zinc-500 text-sm mt-2 leading-relaxed">
            Record payments, see what is outstanding, and send reminders in one click.
          </p>
        </div>
      </div>
    </section>
  )
}
