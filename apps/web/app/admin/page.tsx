"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays, FlaskConical, Newspaper, Users } from "lucide-react";
import { api } from "../../lib/api";

const sections = [{ key: "news", title: "Berita & artikel", unit: "artikel", icon: Newspaper }, { key: "events", title: "Kegiatan & agenda", unit: "kegiatan", icon: CalendarDays }, { key: "team", title: "Struktur tim", unit: "anggota", icon: Users }];

export default function AdminDashboard() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all(sections.map(async (section) => [section.key, (await api<unknown[]>(`/v1/admin/${section.key}`)).length] as const)).then((values) => { if (active) setCounts(Object.fromEntries(values)); }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Ringkasan belum dapat dimuat."); });
    return () => { active = false; };
  }, [revision]);
  return <><div className="admin-page-heading"><div><p className="admin-eyebrow">Workspace overview</p><h1>Selamat datang kembali.</h1><p>Kelola informasi, kegiatan, dan orang-orang di balik AET PCR.</p></div><Link href="/" className="button button-secondary">Lihat website <ArrowUpRight size={16} /></Link></div>
    {error && <div className="admin-feedback admin-feedback-error" role="alert">{error} <button type="button" onClick={() => { setError(""); setRevision((n) => n + 1); }}>Coba lagi</button></div>}
    <div className="admin-summary-grid">{sections.map(({ key, title, unit, icon: Icon }) => <Link href={`/admin/${key}/`} className="admin-summary-card" key={key}><span>{title}<Icon size={20} /></span><strong aria-label={`${title}: ${counts?.[key] ?? "memuat"}`}>{counts ? counts[key] : "—"}</strong><small>Kelola {unit}<ArrowUpRight size={15} /></small></Link>)}</div>
    <div className="admin-guidance-grid"><section><h2>Buat pembaruan berikutnya</h2><p>Bagikan cerita dari komunitas. Tambahkan judul, ringkasan, konten, dan gambar sebelum mempublikasikannya.</p><Link href="/admin/news/">Tulis berita <ArrowUpRight size={15} /></Link></section><section><h2>Sebelum dipublikasikan</h2><ul><li>Periksa status Published agar konten tampil di website.</li><li>Pastikan tanggal kegiatan sudah sesuai waktu WIB.</li><li>Gunakan urutan anggota untuk mengatur struktur tim.</li><li>Jalankan rebuild frontend untuk URL detail baru atau berubah.</li></ul></section><section><FlaskConical size={21} /><h2>Kenali koneksi model Anda</h2><p>Uji satu model secara manual dari akun Sumopod, tanpa mengubah pemilihan model adaptif pada chat publik.</p><Link href="/admin/ai/">Buka uji model <ArrowUpRight size={15} /></Link></section></div>
  </>;
}
