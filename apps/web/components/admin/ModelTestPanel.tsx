"use client";

import { useState, type FormEvent } from "react";
import { FlaskConical, LoaderCircle } from "lucide-react";
import { api } from "../../lib/api";

export function ModelTestPanel() {
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ response?: string; error?: string; elapsedMs: number } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return; setBusy(true); setResult(null);
    const start = performance.now();
    try {
      const response = await api<{ response: string; elapsedMs: number }>("/v1/admin/ai/model-test", { method: "POST", body: JSON.stringify({ modelId: modelId.trim(), prompt: prompt.trim() }) });
      setResult(response);
    } catch (caught) { setResult({ error: caught instanceof Error ? caught.message : "Pengujian model gagal.", elapsedMs: Math.round(performance.now() - start) }); }
    finally { setBusy(false); }
  }
  return <section className="admin-model-panel"><form onSubmit={submit} aria-label="Uji model AI"><label className="admin-field"><span>Model ID</span><input aria-label="Model ID" name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="ID model yang didukung akun Sumopod Anda" required maxLength={160} pattern="[A-Za-z0-9][A-Za-z0-9._:/-]*" disabled={busy} /><small>Masukkan model dari akun operator. Provider dapat menolak ID yang tidak tersedia.</small></label><label className="admin-field"><span>Prompt singkat</span><textarea name="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} required maxLength={2000} disabled={busy} /></label><p className="admin-model-note">Permintaan hanya dikirim saat Anda menekan Test, menggunakan koneksi Sumopod dan API key yang tersimpan di backend. Kelola kredit dan batas penggunaan langsung di Sumopod.</p><button type="submit" className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <FlaskConical size={17} />}{busy ? "Menguji…" : "Test"}</button></form>
    {result && <div className="admin-model-result" aria-live="polite"><h2>Hasil pengujian</h2><p>Waktu respons: {(result.elapsedMs / 1000).toFixed(2)} detik</p>{result.error ? <p className="admin-feedback admin-feedback-error" role="alert">{result.error}</p> : <pre>{result.response}</pre>}</div>}
  </section>;
}
