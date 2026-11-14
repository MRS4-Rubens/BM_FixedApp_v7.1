export type TaglineTone = 'black' | 'blue' | 'slate';

export function TaglinePill({ text, tone }: { text: string; tone: TaglineTone }) {
  if (!text) {
    return null;
  }
  const sizeClass = text.length > 60 ? 'text-[11px]' : 'text-[12px]';
  const toneClass =
    tone === 'black'
      ? 'border-black text-black'
      : tone === 'blue'
        ? 'border-[#0e3f94] text-[#0e3f94]'
        : 'border-slate-400 text-slate-800';

  return (
    <span
      className={`inline-block max-w-full rounded-full border bg-white px-3 py-[2px] font-semibold uppercase tracking-wide leading-tight whitespace-nowrap ${sizeClass} ${toneClass}`}
    >
      {text}
    </span>
  );
}

export function resolveHeaderSubline(inv: {
  invoice_tagline?: string | null;
  nature_of_business?: string | null;
}): { kind: 'tagline'; text: string } | { kind: 'nature'; text: string } | null {
  const trimmedTagline = inv.invoice_tagline?.trim();
  if (trimmedTagline) {
    return { kind: 'tagline', text: trimmedTagline };
  }
  const trimmedNature = inv.nature_of_business?.trim();
  if (trimmedNature) {
    return { kind: 'nature', text: trimmedNature };
  }
  return null;
}

export function ContactLine({
  address,
  phones,
  className,
}: {
  address: string;
  phones: string[];
  className?: string;
}) {
  const cleanAddress = address.trim();
  const cleanPhones = phones.map((p) => p.trim()).filter(Boolean);
  const phoneText = cleanPhones.length ? `Ph No.: ${cleanPhones.join(', ')}` : '';

  if (!cleanAddress && !phoneText) {
    return null;
  }

  return (
    <p className={className}>
      {cleanAddress}
      {/* The diamond travels WITH the phone number: if the line wraps, "◆ Ph No.: …" moves down together
          instead of leaving a dangling diamond at the end of the address line. */}
      {phoneText && (
        <span className="whitespace-nowrap">
          {cleanAddress && (
            <>
              {' '}
              <span aria-hidden="true" className="mx-1 inline-block align-middle text-[13px] leading-none">
                ◆
              </span>{' '}
            </>
          )}
          {phoneText}
        </span>
      )}
    </p>
  );
}
