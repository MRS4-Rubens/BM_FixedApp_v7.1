import Link from 'next/link'
import { BRAND_NAME } from '@/lib/config/brand'
import { cn } from '@/lib/utils'

const logos = {
  primary: { src: '/branding/invoice-bizfolio-primary.svg', width: 675, height: 140 },
  compact: { src: '/branding/invoice-bizfolio-compact.svg', width: 276, height: 60 },
  icon: { src: '/branding/invoice-bizfolio-icon.svg', width: 112, height: 120 },
} as const

export function InvoiceBizFolioLogo({ variant = 'compact', className, href, decorative = false }: {
  variant?: keyof typeof logos
  className?: string
  href?: '/' | '/dashboard'
  decorative?: boolean
}) {
  // Plain <img> on purpose (OPT-003: no next/image in this project). Static SVGs need no
  // optimisation; width/height reserve the space so the logo causes no layout shift.
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...logos[variant]}
      alt={decorative || href ? '' : BRAND_NAME}
      decoding="async"
      className={cn('block h-auto max-w-full object-contain', className)}
    />
  )

  return href ? (
    <Link href={href} aria-label={BRAND_NAME} className="inline-flex max-w-full shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600">
      {logo}
    </Link>
  ) : logo
}
