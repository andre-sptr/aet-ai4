import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import '../components/chat/chat.css';

const jakarta = localFont({ src: '../public/fonts/plus-jakarta-sans-latin.woff2', variable: '--font-jakarta', display: 'swap', weight: '200 800' });

export const metadata: Metadata = {
  title: { default: 'AET AI — Asisten Cerdas Mahasiswa AET PCR', template: '%s · AET AI' },
  description: 'Ruang berpikir mahasiswa AET Politeknik Caltex Riau. Diskusi, penulisan akademik, dan pengembangan kode dalam satu workspace.',
  icons: { icon: '/favicon.png' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body className={jakarta.variable}>{children}</body></html>;
}
