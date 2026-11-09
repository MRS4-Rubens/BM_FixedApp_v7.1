import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Lora, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SentryInit } from '@/components/sentry-init'
import { siteOrigin, isIndexableDeployment } from '@/lib/seo/routes'

const lora = Lora({
  variable: '--font-lora',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
})
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const DEFAULT_TITLE = 'Bill Matrix — Smart GST Invoicing for Indian Businesses'
const DEFAULT_DESCRIPTION =
  'Bill Matrix is a GST invoicing and business-management platform built for small and medium businesses across India.'

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  applicationName: 'Bill Matrix',
  title: {
    default: DEFAULT_TITLE,
    template: '%s | Bill Matrix',
  },
  description: DEFAULT_DESCRIPTION,
  icons: {
    icon: [
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'Bill Matrix',
    locale: 'en_IN',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: isIndexableDeployment()
    ? { index: true, follow: true }
    : { index: false, follow: false },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#1e2a4a',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning // Browser extensions can still inject attributes into <html>
      data-scroll-behavior="smooth"
      className={`${lora.variable} ${geistMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <SentryInit />
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

