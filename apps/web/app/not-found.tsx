import Link from 'next/link';
import PublicShell, { EmptyState } from '../components/PublicShell';
export default function NotFound() { return <PublicShell><section className="site-container article-unavailable"><EmptyState title="Halaman tidak ditemukan">Tautan mungkin telah berubah atau halaman belum tersedia.</EmptyState><Link className="button button-primary" href="/">Kembali ke beranda</Link></section></PublicShell>; }
