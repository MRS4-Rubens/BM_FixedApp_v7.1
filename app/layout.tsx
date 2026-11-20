import type { Metadata, Viewport } from 'next'
import { Lora, Geist_Mono } from 'next/font/google'
import './globals.css'
import './desktop-workspace.css'
import { SentryInit } from '@/components/sentry-init'
import { BRAND_DESCRIPTION, BRAND_NAME, BRAND_THEME_COLOR, BRAND_TITLE } from '@/lib/config/brand'
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

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  applicationName: BRAND_NAME,
  title: {
    default: BRAND_TITLE,
    template: `%s | ${BRAND_NAME}`,
  },
  description: BRAND_DESCRIPTION,
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-light-32x32.png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-dark-32x32.png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: BRAND_NAME,
    locale: 'en_IN',
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: BRAND_TITLE,
    description: BRAND_DESCRIPTION,
  },
  robots: isIndexableDeployment()
    ? { index: true, follow: true }
    : { index: false, follow: false },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: BRAND_THEME_COLOR,
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
      </body>
    </html>
  )
}

