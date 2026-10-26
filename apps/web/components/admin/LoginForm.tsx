"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { api } from "../../lib/api";

export function LoginForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setBusy(true);
    try {
      await api("/v1/auth/login", { method: "POST", body: JSON.stringify({ username: username.trim(), password }) });
      setPassword("");
      onAuthenticated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Tidak dapat masuk. Silakan coba lagi."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="admin-login-form" aria-label="Masuk administrator">
    {error && <p className="admin-feedback admin-feedback-error" role="alert">{error}</p>}
    <label className="admin-field"><span>Username</span><input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={100} required disabled={busy} placeholder="Username administrator" /></label>
    <label className="admin-field"><span>Password</span><input type="password" name="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={256} required disabled={busy} placeholder="Masukkan password" /></label>
    <button className="button button-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={17} className="animate-spin" />Memverifikasi…</> : <>Masuk dashboard <ArrowRight size={16} /></>}</button>
  </form>;
}
