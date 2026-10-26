"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LoginForm } from "../../components/admin/LoginForm";
import "../../components/admin/admin.css";

export default function LoginPage() {
  const router = useRouter();
  return <main id="main-content" className="admin-login-shell"><a href="#login-heading" className="skip-link">Lewati ke formulir masuk</a><div className="admin-login-layout">
    <aside className="admin-login-story"><Link href="/" className="admin-wordmark" aria-label="AET AI beranda">aet<span>ai.</span></Link><div><p className="admin-eyebrow">AET Content Workspace</p><h2>Setiap cerita<br />dimulai dari sini.</h2><p>Ruang pengelola untuk menjaga informasi dan aktivitas komunitas AET PCR tetap terhubung.</p></div><small>POLITEKNIK CALTEX RIAU / PEKANBARU</small></aside>
    <section className="admin-login-panel"><p className="admin-eyebrow">Selamat datang kembali</p><h1 id="login-heading">Masuk ke workspace.</h1><p>Gunakan akun administrator untuk mengelola konten AET AI.</p><LoginForm onAuthenticated={() => router.replace("/admin/")} /><Link href="/" className="admin-back-link"><ArrowLeft size={15} />Kembali ke website AET AI</Link></section>
  </div></main>;
}
