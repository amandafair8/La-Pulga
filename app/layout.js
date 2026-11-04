import './globals.css'
import './packing.css'
import NavEnhancer from './NavEnhancer'

export const metadata = {
  title: 'LA PULGA',
  description: 'La Pulga inventory and event management',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'LA PULGA', statusBarStyle: 'default' },
}

export const viewport = {
  themeColor: '#0047AB',
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({ children }) {
  return <html lang="en"><body><NavEnhancer/>{children}</body></html>
}
