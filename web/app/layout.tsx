import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { TxToaster } from '@/components/tx-toaster';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const jbmono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'EnergySwap · DEX on EnergyChain',
  description: 'Trade, provide liquidity, and analyze markets on the EnergyChain DEX.',
  metadataBase: new URL('http://localhost:3001'),
};

export const viewport: Viewport = {
  themeColor: '#06080d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`}>
      <body className="min-h-screen bg-ink-950 bg-mesh-1">
        <Providers>
          <Header />
          <main className="mx-auto max-w-[1480px] px-4 pb-12 pt-6">{children}</main>
          <Footer />
          <TxToaster />
        </Providers>
      </body>
    </html>
  );
}
