// Shared header building blocks for the Pro invoice templates (2, 3, 4).
// The RULES (logo box, name sizes, gaps, separator) live here so all three templates stay consistent;
// each template passes its own colours/borders so it keeps its own look. Template 1 does not use these.

import {
  A4_HEADER_WIDTH_PX,
  A5_HEADER_WIDTH_PX,
  availableNameWidthPx,
  fitBrandName,
  logoRenderWidthPx,
  type BrandNameLayout,
} from '@/lib/invoices/brand-name-fit';

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

/**
 * Thin vertical divider used between address and phone, and between Invoice No and Date.
 * It is as tall as the capital letters and takes the text colour at half strength.
 */
export function MetaDivider() {
  return <span aria-hidden="true" className="mx-2 inline-block h-[0.8em] w-px bg-current align-[-0.05em] opacity-50" />;
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
      {/* The divider travels WITH the phone number: if the line wraps, "| Ph No.: …" moves down together
          instead of leaving a dangling divider at the end of the address line. */}
      {phoneText && (
        <span className="whitespace-nowrap">
          {cleanAddress && <MetaDivider />}
          {phoneText}
        </span>
      )}
    </p>
  );
}

/**
 * Logo + business name as ONE horizontally centred group.
 * - Logo box: 52px tall, at most 156px wide (3:1); the image is scaled to fit, never cropped or stretched.
 * - Fixed 12px gap; a longer name widens the group, so the logo moves left on its own.
 * - items-center lines the logo's centre up with the centre of the name block (measured in the HDR review).
 * - At least 1cm of clear space on each side (px-[1cm]).
 * - Line breaks and size come from the space actually available (lib/invoices/brand-name-fit.ts): one line at the
 *   largest size that fits, otherwise balanced lines. The PDF can't measure, so two layouts are prepared, for A4 width
 *   and for the narrower in-app A5 preview, and a container query shows the one matching the real width.
 * The name carries the template's colour/letter-spacing via `nameClassName`.
 */
export function BrandLockup({
  logoSrc,
  name,
  nameClassName,
}: {
  logoSrc: string | null;
  name: string;
  nameClassName: string;
}) {
  const logoWidth = logoRenderWidthPx(logoSrc);
  const wide = fitBrandName(name, availableNameWidthPx(A4_HEADER_WIDTH_PX, logoWidth));
  const narrow = fitBrandName(name, availableNameWidthPx(A5_HEADER_WIDTH_PX, logoWidth));
  const sameLayout = wide.fontPx === narrow.fontPx && wide.lines.join('\n') === narrow.lines.join('\n');

  const renderName = (layout: BrandNameLayout, visibility: string) => (
    <h1
      data-hdr="name"
      className={`min-w-0 text-center font-black uppercase leading-[1.12] [overflow-wrap:anywhere] ${layout.sizeClass} ${nameClassName} ${visibility}`}
    >
      {layout.lines.map((line, i) => (
        <span key={i} className="block">
          {line}
        </span>
      ))}
    </h1>
  );

  return (
    // @container: the layouts switch on THIS box's width (A4 layout from 748px, A5 layout below).
    <div className="@container w-full">
      <div data-hdr="lockup" className="flex w-full items-center justify-center gap-3 px-[1cm]">
        {logoSrc && (
          <div data-hdr="logo" className="flex h-[52px] max-w-[156px] shrink-0 items-center justify-center select-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoSrc} alt="Business logo" className="block h-[52px] w-auto max-w-[156px] object-contain" />
          </div>
        )}
        {sameLayout ? (
          renderName(wide, '')
        ) : (
          <>
            {renderName(wide, '@max-[747px]:hidden')}
            {renderName(narrow, 'hidden @max-[747px]:block')}
          </>
        )}
      </div>
    </div>
  );
}
