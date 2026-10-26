"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, CalendarDays, FlaskConical, LayoutDashboard, LogOut, Menu, Newspaper, Users } from "lucide-react";
import { api } from "../../lib/api";
import { AdminDialog } from "./AdminDialog";
import "./admin.css";

const links = [
  { href: "/admin/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/news/", label: "Berita", icon: Newspaper },
  { href: "/admin/events/", label: "Kegiatan", icon: CalendarDays },
  { href: "/admin/team/", label: "Struktur tim", icon: Users },
  { href: "/admin/ai/", label: "Uji model AI", icon: FlaskConical },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; username: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    api<{ user: { id: string; username: string } }>("/v1/auth/me").then((data) => { if (active) setUser(data.user); }).catch((caught: unknown) => {
      if (!active) return;
      const status = caught && typeof caught === "object" && "status" in caught ? caught.status : undefined;
      if (status === 401) router.replace("/login/");
      else setError(caught instanceof Error ? caught.message : "Sesi tidak dapat diperiksa. Periksa koneksi API.");
    }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [router, revision]);
  async function logout() {
    setLeaving(true); setError("");
    try { await api("/v1/auth/logout", { method: "POST", body: "{}" }); setUser(null); router.replace("/login/"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal keluar. Coba lagi."); setLeaving(false); }
  }
  const navigation = <><p className="admin-rail-label">Kelola workspace</p><nav className="admin-navigation" aria-label="Navigasi administrator">{links.map(({ href, label, icon: Icon }) => {
    const active = href === "/admin/" ? pathname.replace(/\/$/, "") === "/admin" : pathname.startsWith(href.replace(/\/$/, ""));
    return <Link key={href} href={href} onClick={() => setMenu(false)} aria-current={active ? "page" : undefined}><Icon size={18} />{label}</Link>;
  })}</nav><div className="admin-rail-actions"><Link href="/"><ArrowUpRight size={17} />Lihat website</Link><button type="button" disabled={leaving} onClick={logout}><LogOut size={17} />{leaving ? "Keluar…" : "Keluar dari admin"}</button></div></>;
  if (checking) return <main id="main-content" className="admin-session-state" role="status">Memeriksa sesi administrator…</main>;
  if (!user) return <main id="main-content" className="admin-session-state"><h1>Masuk ke workspace</h1>{error ? <><p role="alert">{error}</p><button type="button" className="button button-secondary" onClick={() => { setChecking(true); setError(""); setRevision((n) => n + 1); }}>Coba lagi</button></> : <p>Anda memerlukan sesi administrator untuk membuka halaman ini.</p>}<Link href="/login/" className="button button-primary">Ke halaman masuk</Link></main>;
  return <div className="aet-admin"><a className="skip-link" href="#main-content">Lewati navigasi admin</a><aside className="admin-rail"><Link href="/admin/" className="admin-wordmark">aet<span>ai.</span><small>CONTENT WORKSPACE</small></Link>{navigation}</aside>
    <div className="admin-mobile-header"><Link className="admin-wordmark" href="/admin/">aet<span>ai.</span></Link><button type="button" className="icon-button" aria-label="Buka menu admin" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={22} /></button></div>
    {menu && <AdminDialog title="AET Admin" onClose={() => setMenu(false)}>{navigation}</AdminDialog>}
    <div className="admin-body"><header className="admin-topbar"><span><LayoutDashboard size={15} />AET Admin <span aria-hidden="true">/</span> Content workspace</span><span>{user.username}<span className="admin-avatar" aria-hidden="true">{user.username.slice(0, 2).toUpperCase()}</span></span></header><main id="main-content" className="admin-content">{error && <p role="alert" className="admin-feedback admin-feedback-error">{error}</p>}{children}</main></div>
  </div>;
}
