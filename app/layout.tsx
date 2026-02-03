import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import { ClerkProviderWrapper } from '@/components/auth/ClerkWrapper'
import './globals.css'
import Provider from './provider'
import { Toaster } from '@/components/ui/sonner'
import Header from './_components/Header' // IMPORT Header

const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
  preload: true
})

export const metadata: Metadata = {
  title: 'Migoo - Create AI Video Courses',
  description: 'Professional AI-powered video course creation platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={outfit.variable}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body className={`${outfit.className} antialiased`}>
        <ClerkProviderWrapper>
          <Header /> {/* ADD Header here, outside Provider */}
          <Provider>
            {children}
            <Toaster position='top-center' richColors />
          </Provider>
        </ClerkProviderWrapper>
      </body>
    </html>
  )
}