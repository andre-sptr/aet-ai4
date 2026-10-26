'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const links = [{ href: '/', label: 'Beranda' }, { href: '/news/', label: 'Berita' }, { href: '/events/', label: 'Kegiatan' }, { href: '/team/', label: 'Tim AET' }];

export function Brand({ admin = false }: { admin?: boolean }) {
  return <Link href={admin ? '/admin/' : '/'} className="brand" aria-label={`AET ${admin ? 'Admin' : 'AI'} — ${admin ? 'Dashboard' : 'Beranda'}`}><Image src="/favicon.png" width={42} height={42} alt="Logo AET PCR" unoptimized /><span><strong>AET <span>{admin ? 'Admin' : 'AI'}</span><i aria-hidden="true" /></strong><small>{admin ? 'Content workspace' : 'Politeknik Caltex Riau'}</small></span></Link>;
}

export function PublicNavigation() {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) { dialog.current?.showModal(); document.body.style.overflow = 'hidden'; }
    else { dialog.current?.close(); document.body.style.overflow = ''; }
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 800) setOpen(false); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const active = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href.replace(/\/$/, ''));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <><a href="#main-content" className="skip-link">Langsung ke konten</a><header className="public-header"><div className="site-container nav-inner"><Brand /><nav className="desktop-nav" aria-label="Navigasi utama">{links.map(link => <Link href={link.href} key={link.href} aria-current={active(link.href) ? 'page' : undefined}>{link.label}</Link>)}</nav><div className="nav-actions"><Link className="button button-primary nav-cta" href="/#pilih-mode">Mulai dengan AI <ArrowUpRight size={16} /></Link><button ref={trigger} className="icon-button mobile-menu-button" aria-label="Buka navigasi" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(true)}><Menu size={22} /></button></div></div></header><dialog id="mobile-navigation" ref={dialog} className="nav-dialog" onCancel={close} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]');
    if (!items?.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onClick={event => { if (event.target === event.currentTarget) close(); }} aria-labelledby="mobile-nav-title"><div className="dialog-heading"><h2 id="mobile-nav-title">Jelajahi AET</h2><button className="icon-button" onClick={close} aria-label="Tutup navigasi"><X size={22} /></button></div><nav className="mobile-nav" aria-label="Navigasi mobile">{links.map(link => <Link href={link.href} onClick={close} key={link.href} aria-current={active(link.href) ? 'page' : undefined}>{link.label}<ArrowUpRight size={18} /></Link>)}<Link href="/#pilih-mode" className="button button-primary" onClick={close}>Mulai dengan AI <ArrowUpRight size={18} /></Link></nav><p className="muted small">Himpunan Mahasiswa AET PCR</p></dialog></>;
}

export function PublicFooter() {
  return <footer className="public-footer"><div className="site-container"><div className="footer-top"><div><Brand /><p>Ruang bertemu ide, teknologi,<br />dan komunitas AET PCR.</p></div><nav aria-label="Navigasi footer"><Link href="/news/">Berita</Link><Link href="/events/">Kegiatan</Link><Link href="/team/">Tim AET</Link><a href="https://tet.pcr.ac.id/" target="_blank" rel="noopener noreferrer">Website program studi <ArrowUpRight size={14} /></a></nav></div><div className="footer-bottom"><p>© {new Date().getFullYear()} Association of Electronics Telecommunication</p><span>Politeknik Caltex Riau · Pekanbaru</span></div></div></footer>;
}

export default function PublicShell({ children }: { children: React.ReactNode }) {
  return <><PublicNavigation /><main id="main-content">{children}</main><PublicFooter /></>;
}

export function PageIntro({ eyebrow, title, description, index }: { eyebrow: string; title: React.ReactNode; description: string; index: string }) {
  return <section className="page-intro"><div className="site-container"><div className="eyebrow"><span />{eyebrow}</div><div className="intro-row"><div><h1>{title}</h1><p>{description}</p></div><span className="page-index">{index}</span></div></div></section>;
}

export function EmptyState({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return <div className="empty-state">{icon && <div className="empty-state-icon">{icon}</div>}<h2>{title}</h2><p>{children}</p></div>;
}
