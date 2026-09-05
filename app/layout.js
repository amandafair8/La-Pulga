import './globals.css'

export const metadata = {
  title: 'LA PULGA',
  description: 'La Pulga inventory and event management',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'LA PULGA', statusBarStyle: 'default' },
}

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>
}
