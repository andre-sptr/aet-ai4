'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Calendar, Clock, MapPin, Newspaper, RefreshCw, Users } from 'lucide-react';
import type { News, Event as AetEvent, TeamMember } from '@aet/contracts';
import { NewsSchema, EventSchema, TeamMemberSchema } from '@aet/contracts';
import { api } from '../lib/api';
import PublicShell, { EmptyState, PageIntro } from './PublicShell';
import SafeImage from './SafeImage';

export function dateLabel(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta', ...options }).format(new Date(value));
}

const newsCollectionSchema = NewsSchema.array();
const eventCollectionSchema = EventSchema.array();
const teamCollectionSchema = TeamMemberSchema.array();

function useCollection<T>(path: string, schema: { parse: (value: unknown) => T[] }) {
  const [data, setData] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<unknown>(path, { signal: controller.signal }).then(result => { const parsed = schema.parse(result); if (!controller.signal.aborted) { setData(parsed); setError(null); } }).catch(() => { if (!controller.signal.aborted) setError('Informasi belum dapat dimuat. Periksa koneksi lalu coba kembali.'); });
    return () => controller.abort();
  }, [path, revision, schema]);
  return { data, error, retry: () => { setError(null); setRevision(value => value + 1); } };
}

function CollectionStatus({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  if (error) return <div className="error-notice" role="alert"><p>{error}</p><button className="button button-secondary" onClick={retry}><RefreshCw size={14} />Coba lagi</button></div>;
  if (loading) return <div role="status" aria-live="polite"><p className="loading-label">Memuat informasi AET PCR…</p><div className="content-grid" aria-hidden="true">{[0, 1, 2].map(item => <div className="skeleton collection-skeleton" key={item} />)}</div></div>;
  return null;
}

export function NewsCollection() {
  const { data, error, retry } = useCollection<News>('/v1/news', newsCollectionSchema);
  return <PublicShell><PageIntro eyebrow="The AET Journal" title={<>Cerita, wawasan,<br /><span>dan langkah baru.</span></>} description="Kabar dari lingkungan AET PCR. Ikuti cerita komunitas, perkembangan teknologi, dan ide yang layak dibagikan." index="01 / BERITA" /><section className="site-container content-section"><div className="collection-toolbar"><strong>Semua artikel</strong>{data && <span>{data.length} artikel dipublikasikan</span>}</div><CollectionStatus loading={!data} error={error} retry={retry} />{!error && data && (data.length ? <div className="content-grid">{data.map(item => <Link href={`/news/${encodeURIComponent(item.slug)}/`} className="editorial-card" key={item.id}><div className="editorial-cover"><SafeImage src={item.imageUrl} alt={item.title} label="AET JOURNAL" /></div><div className="editorial-body"><div className="editorial-meta"><Calendar size={12} /><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></div><h2>{item.title}</h2><p>{item.summary || `${item.content.slice(0, 120)}…`}</p><div className="editorial-bottom"><span>Baca cerita</span><ArrowUpRight size={17} /></div></div></Link>)}</div> : <EmptyState icon={<Newspaper size={27} />} title="Cerita baru sedang disiapkan">Belum ada berita yang dipublikasikan. Kunjungi kembali halaman ini untuk kabar terbaru dari AET PCR.</EmptyState>)}</section></PublicShell>;
}

function eventState(event: AetEvent) {
  const start = Date.parse(event.startDate);
  const end = event.endDate ? Date.parse(event.endDate) : start;
  return Date.now() < start ? 'upcoming' : Date.now() <= end ? 'ongoing' : 'past';
}

export function EventsCollection() {
  const { data, error, retry } = useCollection<AetEvent>('/v1/events', eventCollectionSchema);
  return <PublicShell><PageIntro eyebrow="AET in motion" title={<>Terhubung lewat<br /><span>pengalaman bersama.</span></>} description="Agenda dan kegiatan Himpunan Mahasiswa AET PCR. Temukan kesempatan untuk belajar, bertemu, dan mengambil bagian." index="02 / KEGIATAN" /><section className="site-container content-section"><div className="collection-toolbar"><strong>Agenda komunitas</strong>{data && <span>{data.length} kegiatan · Urut berdasarkan tanggal</span>}</div><CollectionStatus loading={!data} error={error} retry={retry} />{!error && data && (data.length ? <div className="content-grid">{data.map(item => { const state = eventState(item); return <Link href={`/events/${encodeURIComponent(item.id)}/`} className="editorial-card" key={item.id}><div className="editorial-cover"><SafeImage src={item.imageUrl} alt={item.title} label="AET ACTIVITIES" /><div className="event-date"><span>{new Intl.DateTimeFormat('id-ID', { month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(item.startDate))}</span><strong>{new Intl.DateTimeFormat('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(item.startDate))}</strong></div></div><div className="editorial-body"><div className="editorial-meta"><span className={`status-badge ${state === 'past' ? 'neutral' : ''}`}>{state === 'past' ? 'Kegiatan lampau' : state === 'ongoing' ? 'Sedang berlangsung' : 'Akan datang'}</span><span>{new Intl.DateTimeFormat('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(item.startDate))}</span></div><h2>{item.title}</h2><div className="event-info"><span><Clock size={13} />{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(item.startDate))} WIB</span>{item.location && <span><MapPin size={13} />{item.location}</span>}</div><p>{item.description}</p><div className="editorial-bottom"><span>Detail kegiatan</span><ArrowUpRight size={17} /></div></div></Link>; })}</div> : <EmptyState icon={<Calendar size={27} />} title="Nantikan kegiatan berikutnya">Belum ada kegiatan yang ditambahkan. Jadwal dan informasi kegiatan akan tersedia di halaman ini.</EmptyState>)}</section></PublicShell>;
}

function socialLinks(value: unknown): [string, string][] {
  try {
    const data: unknown = typeof value === 'string' ? JSON.parse(value) : value;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    return Object.entries(data).filter((entry): entry is [string, string] => { if (typeof entry[1] !== 'string') return false; try { const url = new URL(entry[1]); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } });
  } catch { return []; }
}

export function TeamCollection() {
  const { data, error, retry } = useCollection<TeamMember>('/v1/team', teamCollectionSchema);
  return <PublicShell><PageIntro eyebrow="People behind the progress" title={<>Bergerak bersama.<br /><span>Bertumbuh sebagai AET.</span></>} description="Kenali orang-orang di balik Himpunan Mahasiswa AET Politeknik Caltex Riau. Membawa semangat kolaborasi dari ide menjadi aksi." index="03 / TIM AET" /><section className="site-container content-section"><div className="collection-toolbar"><strong>Struktur organisasi</strong><span>Himpunan Mahasiswa AET PCR</span></div><CollectionStatus loading={!data} error={error} retry={retry} />{!error && data && (data.length ? <div className="team-grid">{data.map(member => <article className="team-card" key={member.id}><div className="team-photo"><SafeImage src={member.photoUrl} alt={member.name} label={member.name.split(' ').slice(0, 2).map(word => word[0]).join('')} /></div><div className="team-body"><span>{member.position}</span><h2>{member.name}</h2>{member.bio && <p>{member.bio}</p>}<div className="team-socials">{socialLinks(member.socials).map(([label, href]) => <a href={href} key={label} target="_blank" rel="noopener noreferrer">{label}<ArrowUpRight size={12} /></a>)}</div></div></article>)}</div> : <EmptyState icon={<Users size={27} />} title="Kenali tim kami segera">Data struktur organisasi belum ditambahkan. Informasi anggota akan ditampilkan sesuai data resmi himpunan.</EmptyState>)}</section></PublicShell>;
}
