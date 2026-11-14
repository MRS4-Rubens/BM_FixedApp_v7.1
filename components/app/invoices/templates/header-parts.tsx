// Shared header building blocks for the Pro invoice templates (2, 3, 4).
// The RULES (logo box, name sizes, gaps, separator) live here so all three templates stay consistent;
// each template passes its own colours/borders so it keeps its own look. Template 1 does not use these.

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

/** Split words into `count` lines so the longest line (in characters) is as short as possible. */
function balanceWords(words: string[], count: number): string[] {
  const n = words.length;
  if (count <= 1 || n <= 1) return [words.join(' ')];
  const lineLen = (from: number, to: number) => words.slice(from, to).join(' ').length;
  // best[k][i] = smallest possible "longest line" when words[i..] are laid out on k lines.
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(n));
  for (let i = 0; i < n; i++) best[1][i] = lineLen(i, n);
  for (let k = 2; k <= count; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const worst = Math.max(lineLen(i, j), best[k - 1][j]);
        if (worst < best[k][i]) {
          best[k][i] = worst;
          cut[k][i] = j;
        }
      }
    }
  }
  const lines: string[] = [];
  let i = 0;
  for (let k = Math.min(count, n); k > 1 && i < n; k--) {
    const j = cut[k][i];
    lines.push(words.slice(i, j).join(' '));
    i = j;
  }
  if (i < n) lines.push(words.slice(i).join(' '));
  return lines;
}

/**
 * Lays out the business name. Names can be up to 200 characters and a tax invoice must never cut the legal
 * name, so: up to 28 characters stay on one line; longer names are split into 2–4 lines of balanced length
 * (we pick the line breaks ourselves so the name block is exactly as wide as its longest line, which keeps
 * the logo gap and the centring exact). The size steps down with the longest line; two or more lines are
 * capped at 22px so a two-line name is no taller than the 52px logo.
 * Sizes are calibrated from measurement: a capital letter in these fonts averages ~0.81em incl. spacing.
 * Literal class strings so Tailwind and the print stylesheet pick them up.
 */
export function layoutBrandName(name: string): { lines: string[]; sizeClass: string } {
  const clean = name.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  let lines = [clean];
  if (clean.length > 28) {
    let count = 2;
    lines = balanceWords(words, count);
    while (count < 4 && Math.max(...lines.map((l) => l.length)) > 32) {
      count += 1;
      lines = balanceWords(words, count);
    }
  }
  const longest = Math.max(...lines.map((l) => l.length));
  const multi = lines.length > 1;
  let sizeClass: string;
  if (longest <= 24) sizeClass = multi ? 'text-[22px]' : 'text-[26px]';
  else if (longest <= 28) sizeClass = multi ? 'text-[22px]' : 'text-[23px]';
  else if (longest <= 32) sizeClass = 'text-[20px]';
  else if (longest <= 38) sizeClass = 'text-[17px]';
  else if (longest <= 46) sizeClass = 'text-[14px]';
  else sizeClass = 'text-[13px]';
  return { lines, sizeClass };
}

/**
 * Logo + business name as ONE horizontally centred group.
 * - Logo box: 52px tall, at most 156px wide (3:1); the image is scaled to fit, never cropped or stretched.
 * - Fixed 12px gap; a longer name widens the group, so the logo moves left on its own.
 * - items-center lines the logo's centre up with the centre of the name block (measured in the HDR review).
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
  const { lines, sizeClass } = layoutBrandName(name);
  return (
    <div data-hdr="lockup" className="flex w-full items-center justify-center gap-3">
      {logoSrc && (
        <div data-hdr="logo" className="flex h-[52px] max-w-[156px] shrink-0 items-center justify-center select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="Business logo" className="block h-[52px] w-auto max-w-[156px] object-contain" />
        </div>
      )}
      <h1
        data-hdr="name"
        className={`min-w-0 text-center font-black uppercase leading-[1.12] [overflow-wrap:anywhere] ${sizeClass} ${nameClassName}`}
      >
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </h1>
    </div>
  );
}
