'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Calendar, Clock, MapPin, Share2 } from 'lucide-react';
import type { News, Event as AetEvent } from '@aet/contracts';
import { NewsSchema, EventSchema } from '@aet/contracts';
import { api } from '../lib/api';
import PublicShell, { EmptyState } from './PublicShell';
import SafeImage from './SafeImage';
import RichContent from './chat/RichContent';
import { dateLabel } from './PublicCollections';

function ShareButton({ title }: { title: string }) {
  const [notice, setNotice] = useState('');
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title, url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); setNotice('Tautan disalin'); }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice('Salin alamat halaman dari browser untuk membagikan.'); }
  }
  return <div><button className="button button-secondary" onClick={share}><Share2 size={14} />Bagikan</button><span className="small" role="status">{notice}</span></div>;
}

export default function PublicDetail({ kind, routeKey }: { kind: 'news' | 'events'; routeKey: string }) {
  const [record, setRecord] = useState<News | AetEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<unknown>(`/v1/${kind}/${encodeURIComponent(routeKey)}`, { signal: controller.signal }).then(value => { const item = (kind === 'news' ? NewsSchema : EventSchema).parse(value); if (!item.published) throw new Error('Konten tidak dipublikasikan.'); if (!controller.signal.aborted) setRecord(item); }).catch(() => { if (!controller.signal.aborted) setError('Konten ini mungkin telah dihapus, belum dipublikasikan, atau layanan sedang tidak tersedia.'); });
    return () => controller.abort();
  }, [kind, routeKey]);
  const isNews = kind === 'news';
  const news = isNews ? record as News | null : null;
  const event = !isNews ? record as AetEvent | null : null;
  return <PublicShell>{error ? <section className="site-container article-unavailable"><EmptyState title="Konten tidak tersedia">{error}</EmptyState><Link href={`/${kind}/`} className="text-link"><ArrowLeft size={15} />Kembali ke {isNews ? 'berita' : 'kegiatan'}</Link></section> : !record ? <section className="site-container article-unavailable" role="status"><p className="loading-label">Memuat {isNews ? 'cerita' : 'kegiatan'}…</p><div className="skeleton" style={{ height: 100, maxWidth: 750, marginBottom: 25 }} /><div className="skeleton" style={{ height: 300 }} /></section> : <article><header className="article-header"><Link href={`/${kind}/`} className="article-back"><ArrowLeft size={15} />Kembali ke {isNews ? 'berita' : 'kegiatan'}</Link><div className="eyebrow"><span />{isNews ? 'The AET Journal' : 'AET Activities'}</div><h1>{record.title}</h1><div className="article-meta"><span><Calendar size={14} /><time dateTime={event?.startDate || record.createdAt}>{dateLabel(event?.startDate || record.createdAt, event ? { weekday: 'long' } : {})}</time></span>{event && <><span><Clock size={14} />{new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(event.startDate))}{event.endDate && ` – ${new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(event.endDate))}`} WIB</span>{event.location && <span><MapPin size={14} />{event.location}</span>}</>}</div></header>{record.imageUrl && <div className="article-cover"><SafeImage src={record.imageUrl} alt={record.title} /></div>}<div className="article-reading"><div className="article-content"><RichContent content={news?.content || event?.description || ''} /></div><div className="share-section"><span>{isNews ? 'Bagikan cerita ini ke temanmu.' : 'Ajak temanmu ikut mengambil bagian.'}</span><ShareButton title={record.title} /></div></div></article>}</PublicShell>;
}
