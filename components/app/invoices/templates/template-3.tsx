import { amountInWordsFromPaise } from '@/lib/pdf/number-to-words';
import { paiseToRupees, formatPaiseAsInr } from '@/lib/money';
import { getStateAbbrByCode, stateTaxLabel } from '@/lib/gst/indian-states';
import { InvoiceTemplateProps } from './template-1';
import { formatIstDate } from '@/lib/invoices/ist-date';
import { SignatureMark, isSignatureDataUri, AUTHORISED_SIGNATORY_LABEL } from './signature-mark';
import { resolveHeaderSubline, TaglinePill, ContactLine } from './header-parts';

// ============================================================================
// CONFIGURABLE DESIGN SYSTEM VARIABLES FOR TEMPLATE 3 (MANUAL PAD STYLE)
// Modify these variables to adjust borders, spacing, colors, or sizes
// ============================================================================
const PAD_STYLES = {
  // Skeleton / Frame style (Navy Blue color palette matching the pre-printed paper)
  skeletonColor: 'text-[#0e3f94]',
  skeletonBorder: 'border-[#0e3f94]',
  bgHeaderBadge: 'bg-[#0e3f94]',

  // Filled data style (Charcoal/black font representation of typed text)
  dataTextColor: 'text-zinc-900',
  dataFont: 'font-mono font-bold tracking-wide text-xs uppercase',

  // Typography for pre-printed components
  fontTitle: 'text-3xl font-black tracking-[0.1em] text-[#0e3f94] uppercase',
  fontHeaderLabels: 'text-[11px] font-black uppercase text-[#0e3f94]',
  fontPreprinted: 'text-[11px] font-bold text-[#0e3f94]',
  fontTableHead: 'text-[11px] font-black text-[#0e3f94] text-center uppercase p-1.5',
  fontTableBody: 'text-[11px] text-center font-bold p-1.5',

  // Layout spacing
  spacingSection: 'mb-4',
  spacingGrid: 'p-2',
};

export function InvoiceTemplate3({ invoice, businessStateCode, hasWatermark, displayPrefs }: InvoiceTemplateProps) {
  const { discEnabled, showHsn, enableFixedRows, fixedRowsCount, showSignatory } = displayPrefs;
  const signatureSrc = isSignatureDataUri(invoice.signature_data_uri) ? invoice.signature_data_uri : null;
  const isIntra = invoice.total_igst_paise === 0;
  const taxLabel = stateTaxLabel(businessStateCode);

  const customerStateAbbr = getStateAbbrByCode(invoice.place_of_supply_state_code);


  // Dynamically group line items by active GST rate
  const taxGroups: Record<number, { taxable: number; cgst: number; sgst: number; igst: number }> = {};

  invoice.lineItems.forEach(item => {
    const rate = Number(item.tax_rate_percentage) || 0;
    const taxable = item.taxable_value_paise || 0;
    const cgst = item.cgst_paise || 0;
    const sgst = item.sgst_paise || 0;
    const igst = item.igst_paise || 0;

    if (rate > 0 && (cgst > 0 || sgst > 0 || igst > 0)) {
      if (!taxGroups[rate]) {
        taxGroups[rate] = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      }
      taxGroups[rate].taxable += taxable;
      taxGroups[rate].cgst += cgst;
      taxGroups[rate].sgst += sgst;
      taxGroups[rate].igst += igst;
    }
  });

  // Sort active rates numerically in ascending order
  const activeRates = Object.keys(taxGroups)
    .map(Number)
    .sort((a, b) => a - b);

  // Split invoice terms into individual lines and separate last item, cleaning leading numbers
  const termsLines = (invoice.invoice_terms
    ? invoice.invoice_terms.split('\n')
    : [
      'Goods once sold will not be taken back strictly.',
      'Payment to be made within 30 days from the date of invoice.',
      'Interest @ 24% per annum will be charged on overdue invoices until payment is received.'
    ]
  )
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);

  const otherTerms = termsLines.slice(0, -1);
  const lastTerm = termsLines[termsLines.length - 1] || '';

  const logoSrc = invoice.logo_base64 || invoice.logo_url || null;
  const subline = resolveHeaderSubline(invoice);

  // Format full address and phone details in a single line
  const cityPin = [
    invoice.city ? invoice.city.toUpperCase() : null,
    invoice.pincode || null,
  ].filter(Boolean).join('-');

  const addressParts = [
    invoice.address_line1,
    invoice.address_line2,
    cityPin,
  ].filter(Boolean).join(', ');

  const phones = [invoice.phone, invoice.alternate_phone].filter(Boolean) as string[];
  const hasContact = Boolean(addressParts || phones.length > 0);

  return (
    <div className={`template-3-root border-2 ${PAD_STYLES.skeletonBorder} p-4 bg-white print:p-0 print:border-none print:shadow-none`}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap');

        .template-3-root {
          font-family: 'Century Schoolbook', 'Century', 'Lora', 'TeX Gyre Schola', 'Libre Baskerville', serif !important;
        }

        @media print {
          @page { size: auto; margin: 0.6cm; }
          body { background-color: white !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Top Header Section */}
      <div className="flex flex-col">
        {/* Topmost Row (GSTIN, Tax Invoice, Invoice No) */}
        <div className="flex justify-between items-center w-full leading-none mb-3">
          <div className="text-[12px] font-black uppercase text-[#0e3f94] leading-none whitespace-nowrap">
            GSTIN : <span className={`${PAD_STYLES.dataTextColor} font-mono uppercase`}>{invoice.seller_gstin_snapshot ? invoice.seller_gstin_snapshot.toUpperCase() : '—'}</span>
          </div>
          <div className="text-center leading-none">
            <h2 className="text-[14px] font-black uppercase text-[#0e3f94] tracking-wider underline underline-offset-2 leading-none">Tax Invoice</h2>
          </div>
          <div className="text-[12px] font-black uppercase text-[#0e3f94] text-right leading-none whitespace-nowrap">
            Invoice No: <span className={`${PAD_STYLES.dataTextColor} font-mono uppercase`}>{invoice.invoice_number}</span>
          </div>
        </div>

        {/* Business Branding & Details Block */}
        <div className="flex flex-col items-center text-center w-full leading-none -mt-[4px]">
          {/* Brand Block: Wraps Title + Subline (Width dynamically adapts to max(Title, Subline)) */}
          <div className="relative inline-flex flex-col items-center mt-1">
            {logoSrc && (
              // Logo height: with a tagline the pill sits under the name, so the logo must fit between the top-left
              // GSTIN and the name's baseline (measured: TAG-B review). Without a tagline it keeps its full size.
              <div className={`absolute bottom-[-5.5px] right-full mr-[7px] w-[140px] ${subline?.kind === 'tagline' ? 'h-[44px]' : 'h-[64px]'} flex items-end justify-end p-0 select-none overflow-hidden`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoSrc}
                  alt="Logo"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}

            {/* Line 1: Business Title */}
            <h1 className={`${PAD_STYLES.fontTitle} whitespace-nowrap`}>{invoice.business_name}</h1>

            {/* Line 2: Dynamic Nature of Business Subline */}
            {subline?.kind === 'nature' && (
              <p className="text-[10px] font-black tracking-widest text-[#0e3f94] mt-[5px] uppercase whitespace-nowrap">
                ({subline.text})
              </p>
            )}
          </div>

          {subline?.kind === 'tagline' && (
            <div className="mt-[6px] flex justify-center max-w-full">
              <TaglinePill text={subline.text} tone="blue" />
            </div>
          )}

          {hasContact && (
            <div className="flex justify-center mt-[9px]">
              <ContactLine
                className="text-[11px] font-bold text-gray-700 leading-tight border-t border-[#0e3f94] pt-[7px] text-center"
                address={addressParts}
                phones={phones}
              />
            </div>
          )}
        </div>
      </div>

      {/* Dotted Delineation Fields (Buyer details in a Single Row) */}
      <div className="mt-[7px] mb-[9px] text-[11px] font-bold text-[#0e3f94] leading-relaxed">
        <div className="flex justify-between items-end gap-2.5">
          {/* BILL TO */}
          <div className="flex flex-1 items-end min-w-0">
            <span className="shrink-0 pr-1">BILL TO :</span>
            <div className="flex-1 border-b border-dotted border-[#0e3f94] px-[7px] min-h-5 text-left truncate">
              <span className={PAD_STYLES.dataTextColor}>{invoice.billing_name_snapshot || '—'}</span>
            </div>
          </div>

          {/* GSTIN */}
          <div className="flex items-end w-40 shrink-0">
            <span className="shrink-0 pr-1">GSTIN :</span>
            <div className="flex-1 border-b border-dotted border-[#0e3f94] px-1 min-h-5 text-left font-mono">
              <span className={`${PAD_STYLES.dataTextColor} uppercase`}>{invoice.billing_gstin_snapshot ? invoice.billing_gstin_snapshot.toUpperCase() : '—'}</span>
            </div>
          </div>

          {/* State (2-letter abbreviation) */}
          <div className="flex items-end w-16 shrink-0">
            <span className="shrink-0 pr-1">State :</span>
            <div className="flex-1 border-b border-dotted border-[#0e3f94] px-1 min-h-5 text-center font-mono">
              <span className={`${PAD_STYLES.dataTextColor} uppercase`}>{customerStateAbbr ? customerStateAbbr.toUpperCase() : '—'}</span>
            </div>
          </div>

          {/* Code (2 digits) */}
          <div className="flex items-end w-16 shrink-0">
            <span className="shrink-0 pr-1">Code :</span>
            <div className="flex-1 border-b border-dotted border-[#0e3f94] px-1 min-h-5 text-center font-mono">
              <span className={PAD_STYLES.dataTextColor}>{invoice.place_of_supply_state_code || '—'}</span>
            </div>
          </div>

          {/* DATE */}
          <div className="flex items-end w-28 shrink-0">
            <span className="shrink-0 pr-1">DATE :</span>
            <div className="flex-1 border-b border-dotted border-[#0e3f94] px-1 min-h-5 text-center">
              <span className={PAD_STYLES.dataTextColor}>
                {invoice.invoice_date ? formatIstDate(invoice.invoice_date) : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Line Items Table (Attached to Sub-Middle) */}
      <table className="w-full border-collapse mb-0">
        <thead className="border-x-2 border-t-2 border-[#0e3f94]">
          <tr className="border-b border-[#0e3f94] bg-slate-50/50">
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-10 whitespace-nowrap">S.No</th>
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase whitespace-nowrap">DESCRIPTION OF GOODS</th>
            {showHsn && (
              <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-16 whitespace-nowrap">HSN/SAC</th>
            )}
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-10 whitespace-nowrap">Qty</th>
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-18 whitespace-nowrap">Rate {invoice.gst_rate_type === 'inclusive' ? '(GST Incl)' : '(GST Excl)'}</th>
            {discEnabled && (
              <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-12 whitespace-nowrap">Disc(%)</th>
            )}
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-30 whitespace-nowrap">Taxable Value</th>
            <th className="border-r border-[#0e3f94] p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-14 whitespace-nowrap">GST %</th>
            <th className="p-1.5 text-[11px] font-black text-[#0e3f94] text-center uppercase w-24 whitespace-nowrap">Net Amount</th>
          </tr>
        </thead>
        <tbody className="border-x-2 border-[#0e3f94]">
          {invoice.lineItems.map((item, idx) => {
            const qty = Number(item.quantity);
            const grossPaise = qty * item.unit_price_paise;
            const discountPct = grossPaise > 0 ? (item.discount_paise / grossPaise) * 100 : 0;
            const isEven = idx % 2 === 1;

            return (
              <tr
                key={item.id}
                className={`border-b border-slate-300 hover:bg-slate-50/20 ${isEven ? 'bg-slate-100/60' : 'bg-white'
                  }`}
              >
                {/* S.No */}
                <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center`}>
                  {idx + 1}
                </td>

                {/* Description */}
                <td className={`border-r border-slate-300 text-left py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>
                  {item.description}
                </td>

                {/* HSN/SAC */}
                {showHsn && (
                  <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-mono whitespace-nowrap`}>
                    {item.hsn_sac_code || '—'}
                  </td>
                )}

                {/* Qty */}
                <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-bold`}>
                  {item.quantity}
                </td>

                {/* Rate */}
                <td className={`border-r border-slate-300 text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>
                  {paiseToRupees(item.unit_price_paise).toFixed(2)}
                </td>

                {/* Disc(%) */}
                {discEnabled && (
                  <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center`}>
                    {discountPct > 0 ? `${discountPct.toFixed(1)}%` : '0%'}
                  </td>
                )}

                {/* Taxable Value */}
                <td className={`border-r border-slate-300 text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>
                  {paiseToRupees(item.taxable_value_paise).toFixed(2)}
                </td>

                {/* GST % */}
                <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-mono`}>
                  {Number(item.tax_rate_percentage)}%
                </td>

                {/* Net Amount */}
                <td className={`text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>
                  {paiseToRupees(item.line_total_paise).toFixed(2)}
                </td>
              </tr>
            );
          })}
          {(() => {
            const actualRowsCount = invoice.lineItems.length;
            const padCount = enableFixedRows && actualRowsCount < fixedRowsCount ? fixedRowsCount - actualRowsCount : 0;
            return Array.from({ length: padCount }).map((_, i) => {
              const sNo = actualRowsCount + i + 1;
              const isEven = (actualRowsCount + i) % 2 === 1;
              return (
                <tr
                  key={`pad-${i}`}
                  className={`border-b border-slate-300 hover:bg-slate-50/20 ${isEven ? 'bg-slate-100/60' : 'bg-white'}`}
                >
                  <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center`}>{sNo}</td>
                  <td className={`border-r border-slate-300 text-left py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>&nbsp;</td>
                  {showHsn && (
                    <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-mono whitespace-nowrap`}>&nbsp;</td>
                  )}
                  <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-bold`}>&nbsp;</td>
                  <td className={`border-r border-slate-300 text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>&nbsp;</td>
                  {discEnabled && (
                    <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center`}>&nbsp;</td>
                  )}
                  <td className={`border-r border-slate-300 text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>&nbsp;</td>
                  <td className={`border-r border-slate-300 py-0.5 px-1.5 text-[11px] ${PAD_STYLES.dataTextColor} text-center font-mono`}>&nbsp;</td>
                  <td className={`text-right py-0.5 px-1.5 text-[11px] font-bold ${PAD_STYLES.dataTextColor}`}>&nbsp;</td>
                </tr>
              );
            });
          })()}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-b-2 border-[#0e3f94]">
            {/* Left: Bank Details (Spanning from S.No to Qty with ZERO left border) */}
            <td
              colSpan={(showHsn ? 1 : 0) + 3}
              className="py-[3px] px-1 text-[12px] font-bold text-[#0e3f94] align-bottom border-r-2 border-slate-500 border-l-0"
            >
              <div className="space-y-[1px]">
                <span className="text-[13px] font-black border-b border-[#0e3f94] pb-[1px] mb-[3px] inline-block uppercase whitespace-nowrap">
                  BANK DETAILS:
                </span>
                {invoice.bank_name || invoice.bank_account_number || invoice.bank_ifsc ? (
                  <>
                    {invoice.bank_name && (
                      <div className="whitespace-nowrap">
                        Bank Name : <span className={`${PAD_STYLES.dataTextColor} truncate`}>{invoice.bank_name}</span>
                      </div>
                    )}
                    {invoice.bank_account_number && (
                      <div className="whitespace-nowrap">
                        Account No. : <span className={`${PAD_STYLES.dataTextColor} font-mono`}>{invoice.bank_account_number}</span>
                      </div>
                    )}
                    {invoice.bank_ifsc && (
                      <div className="whitespace-nowrap">
                        IFSC Code : <span className={`${PAD_STYLES.dataTextColor} font-mono uppercase`}>{invoice.bank_ifsc.toUpperCase()}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-slate-600 italic font-normal py-0.5">
                    Bank details not configured
                  </div>
                )}
              </div>
            </td>

            {/* Right: Invoice Summary Box (Spanning precisely from RATE to NET AMOUNT) */}
            <td colSpan={(discEnabled ? 1 : 0) + 4} className="p-0 align-bottom border-r-2 border-slate-500">
              {(() => {
                const formatTaxSummary = (paise: number) => {
                  if (paise === 0) {
                    return <span className="text-slate-300 dark:text-slate-700 font-normal select-none">–</span>;
                  }
                  return paiseToRupees(paise).toFixed(2);
                };

                return (
                  <table className="w-full text-[11px] font-bold text-[#0e3f94] border-collapse">
                    <tbody>
                      {/* Taxable Value */}
                      <tr className="border-b border-[#0e3f94]">
                        <td colSpan={2} className="py-[3px] px-1 text-[11px] font-bold uppercase text-[#0e3f94]">Taxable Value</td>
                        <td className="py-[3px] pr-2 pl-1 text-right text-[12px] font-bold text-zinc-950 whitespace-nowrap">
                          {paiseToRupees(invoice.subtotal_paise).toFixed(2)}
                        </td>
                      </tr>

                      {/* Add CGST & SGST (Intra State Only) */}
                      {isIntra && (
                        <>
                          <tr className="border-b border-[#0e3f94] bg-slate-50/30">
                            <td colSpan={2} className="py-[3px] px-1">
                              <div className="flex items-center gap-[6px]">
                                <span className="shrink-0 font-bold">Add. CGST</span>
                                <div className="text-[9px] font-semibold flex flex-wrap items-center gap-[4px] text-[#0e3f94] whitespace-nowrap">
                                  {activeRates.length > 0 ? (
                                    activeRates.map((rate, i) => (
                                      <span key={rate} className="flex items-center gap-[4px]">
                                        {i > 0 && <span className="text-[#0e3f94]/40 font-normal">|</span>}
                                        <span>{rate / 2}%:{paiseToRupees(taxGroups[rate].cgst).toFixed(2)}</span>
                                      </span>
                                    ))
                                  ) : (
                                    <span>-</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-[3px] pr-2 pl-3 text-right text-zinc-950 font-bold whitespace-nowrap">
                              {formatTaxSummary(invoice.total_cgst_paise)}
                            </td>
                          </tr>
                          <tr className="border-b border-[#0e3f94] bg-slate-50/30">
                            <td colSpan={2} className="py-[3px] px-1">
                              <div className="flex items-center gap-[6px]">
                                <span className="shrink-0 font-bold">Add. {taxLabel}</span>
                                <div className="text-[9px] font-semibold flex flex-wrap items-center gap-[4px] text-[#0e3f94] whitespace-nowrap">
                                  {activeRates.length > 0 ? (
                                    activeRates.map((rate, i) => (
                                      <span key={rate} className="flex items-center gap-[4px]">
                                        {i > 0 && <span className="text-[#0e3f94]/40 font-normal">|</span>}
                                        <span>{rate / 2}%:{paiseToRupees(taxGroups[rate].sgst).toFixed(2)}</span>
                                      </span>
                                    ))
                                  ) : (
                                    <span>-</span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-[3px] pr-2 pl-3 text-right text-zinc-950 font-bold whitespace-nowrap">
                              {formatTaxSummary(invoice.total_sgst_paise)}
                            </td>
                          </tr>
                        </>
                      )}

                      {/* Add IGST (Inter State Only) */}
                      {!isIntra && (
                        <tr className="border-b border-[#0e3f94]">
                          <td colSpan={2} className="py-[3px] px-1">
                            <div className="flex items-center gap-[6px]">
                              <span className="shrink-0 font-bold">Add. IGST</span>
                              <div className="text-[9px] font-semibold flex flex-wrap items-center gap-[4px] text-[#0e3f94] whitespace-nowrap">
                                {activeRates.length > 0 ? (
                                  activeRates.map((rate, i) => (
                                    <span key={rate} className="flex items-center gap-[4px]">
                                      {i > 0 && <span className="text-[#0e3f94]/40 font-normal">|</span>}
                                      <span>{rate}%:{paiseToRupees(taxGroups[rate].igst).toFixed(2)}</span>
                                    </span>
                                  ))
                                ) : (
                                  <span>-</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-[3px] pr-2 pl-3 text-right text-zinc-950 font-bold whitespace-nowrap">
                            {formatTaxSummary(invoice.total_igst_paise)}
                          </td>
                        </tr>
                      )}

                      {/* Round Off */}
                      <tr className="border-b border-[#0e3f94]">
                        <td colSpan={2} className="py-[3px] px-1 italic font-semibold">Rounded off (+/-)</td>
                        <td className="py-[3px] pr-2 pl-1 text-right font-bold text-zinc-950 whitespace-nowrap">
                          {(() => {
                            const diffPaise = invoice.grand_total_paise - (invoice.subtotal_paise + invoice.total_tax_paise);
                            const diffRupees = diffPaise / 100;
                            return diffRupees === 0 ? '0.00' : (diffRupees >= 0 ? "+" : "") + diffRupees.toFixed(2);
                          })()}
                        </td>
                      </tr>

                      {/* Grand Total */}
                      <tr className="bg-slate-100 font-black">
                        <td colSpan={2} className="py-[5px] px-1.5 text-[11px] font-black uppercase text-[#0e3f94]">Grand Total</td>
                        <td className="py-[5px] pr-2 pl-1.5 text-right text-[13px] font-extrabold text-[#0e3f94] font-mono whitespace-nowrap">
                          {formatPaiseAsInr(invoice.grand_total_paise)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Full-width Attached Amount in Words Row */}
      <div className="py-0.5 text-[13px] font-bold text-[#0e3f94] leading-tight border-b-2 border-[#0e3f94] mb-1">
        Amount in Words : <span className={`${PAD_STYLES.dataTextColor} italic font-bold`}>{amountInWordsFromPaise(invoice.grand_total_paise)}.</span>
      </div>

      {/* Footer Info & Signatures */}
      <div className="text-[11px] font-bold text-[#0e3f94] pt-[1px]">
        {/* Row 1: Header / Title */}
        <div className="flex justify-between items-start uppercase leading-tight mb-1">
          <span className="tracking-wider">Terms &amp; Conditions:</span>
          {showSignatory && (
            <span className="font-black">For {invoice.business_name}</span>
          )}
        </div>

        {/* Row 2: Other Terms & Stamp Placeholder */}
        <div className="flex justify-between items-end mb-[1px]">
          <div className="flex-1 pr-2">
            {otherTerms.length > 0 && (
              <ul className="list-none pl-0 space-y-[0.5px] text-[10px] font-medium text-black">
                {otherTerms.map((term, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <span className="shrink-0 text-slate-500 font-bold select-none">→</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* Dynamic Signature area / Stamp placeholder */}
          {showSignatory && (
            signatureSrc ? (
              <div className="shrink-0 ml-2 w-36 h-10 flex items-end justify-center">
                <SignatureMark src={signatureSrc} />
              </div>
            ) : (
              <div className="shrink-0 h-6 w-36 flex items-center justify-center select-none pointer-events-none ml-2">
                <span className="font-mono text-zinc-300 border border-zinc-200 text-[10px] px-2 py-0.5 rounded tracking-wider uppercase whitespace-nowrap">STAMP / SIGNATURE</span>
              </div>
            )
          )}
        </div>

        {/* Row 3: Last Term aligned with Dashed Signature Line */}
        <div className="flex justify-between items-center text-[10px] font-medium text-black">
          <div className="flex-1 pr-2 flex items-start gap-1">
            <span className="shrink-0 text-slate-500 font-bold select-none">→</span>
            <span>{lastTerm}</span>
          </div>
          {showSignatory && (
            <div className="shrink-0 pl-2 flex flex-col items-center justify-end">
              <div className="border-t border-dashed border-[#0e3f94] w-36"></div>
              <span className="mt-[1px] text-[9px] uppercase tracking-wider leading-none">
                {AUTHORISED_SIGNATORY_LABEL}
              </span>
            </div>
          )}
        </div>
      </div>

      {hasWatermark && (
        <div className="mt-2 pt-1 border-t border-slate-300 text-center select-none print:mt-1">
          <p className="text-[9px] font-medium text-slate-500 tracking-wider">
            Generated via Invoice BizFolio (Free Tier)
          </p>
        </div>
      )}
    </div>
  );
}
