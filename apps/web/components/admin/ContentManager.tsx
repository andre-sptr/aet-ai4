"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Edit3, LoaderCircle, Plus, Save, Trash2, Upload } from "lucide-react";
import { API_BASE, api } from "../../lib/api";
import SafeImage from "../SafeImage";
import { AdminDialog } from "./AdminDialog";
import { emptyForm, formPayload, makeSlug, rowToForm, type ContentForm, type ContentKind, type ContentRow } from "./content";

const labels = {
  news: { heading: "Berita & artikel", description: "Kelola cerita dan informasi yang tampil di AET Journal.", singular: "berita", empty: "Belum ada berita. Mulai bagikan cerita dari komunitas." },
  events: { heading: "Kegiatan & agenda", description: "Susun informasi kegiatan, jadwal, dan lokasi untuk komunitas.", singular: "kegiatan", empty: "Belum ada kegiatan. Tambahkan agenda komunitas berikutnya." },
  team: { heading: "Tim & struktur", description: "Perbarui profil, jabatan, dan urutan anggota organisasi.", singular: "anggota", empty: "Belum ada anggota. Tambahkan profil pengurus organisasi." },
};

export function ContentManager({ kind }: { kind: ContentKind }) {
  const config = labels[kind];
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ContentRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<ContentRow | null>(null);
  const [form, setForm] = useState<ContentForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api<ContentRow[]>(`/v1/admin/${kind}`)); }
    catch (caught) { setFeedback({ error: true, message: caught instanceof Error ? caught.message : "Data belum dapat dimuat." }); }
    finally { setLoading(false); }
  }, [kind]);
  useEffect(() => { void load(); }, [load]);
  function open(row: ContentRow | "new") { setForm(row === "new" ? emptyForm() : rowToForm(row)); setFormError(""); setEditing(row); }
  function update<K extends keyof ContentForm>(key: K, value: ContentForm[K]) { setForm((current) => ({ ...current, [key]: value })); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editing || busy || uploading) return;
    setBusy(true); setFormError("");
    try {
      const payload = formPayload(kind, form);
      await api(`/v1/admin/${kind}${editing === "new" ? "" : `/${encodeURIComponent(editing.id)}`}`, { method: editing === "new" ? "POST" : "PATCH", body: JSON.stringify(payload) });
      setEditing(null); setFeedback({ error: false, message: `${config.singular[0].toUpperCase()}${config.singular.slice(1)} berhasil disimpan.` });
      await load();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Penyimpanan gagal. Coba lagi."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting) return; setBusy(true);
    try { await api(`/v1/admin/${kind}/${encodeURIComponent(deleting.id)}`, { method: "DELETE" }); setDeleting(null); setFeedback({ error: false, message: "Data berhasil dihapus." }); await load(); }
    catch (caught) { setFeedback({ error: true, message: caught instanceof Error ? caught.message : "Penghapusan gagal." }); setDeleting(null); }
    finally { setBusy(false); }
  }
  async function togglePublication(row: ContentRow) {
    setBusy(true);
    try { await api(`/v1/admin/${kind}/${encodeURIComponent(row.id)}`, { method: "PATCH", body: JSON.stringify({ published: !row.published }) }); setFeedback({ error: false, message: row.published ? "Konten dikembalikan ke draf." : "Konten dipublikasikan. Rute detail baru memerlukan rebuild frontend." }); await load(); }
    catch (caught) { setFeedback({ error: true, message: caught instanceof Error ? caught.message : "Status tidak dapat diubah." }); }
    finally { setBusy(false); }
  }
  async function upload(file?: File) {
    if (!file) return; setUploading(true); setFormError("");
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Gambar maksimal 5 MB.");
      const response = await fetch(`${API_BASE}/v1/uploads`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file });
      const data: { url?: string; error?: { message?: string } } = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error?.message || "Gambar tidak dapat diunggah. Penyimpanan mungkin belum dikonfigurasi.");
      update(kind === "team" ? "photoUrl" : "imageUrl", data.url);
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Unggah gambar gagal."); }
    finally { setUploading(false); }
  }
  const filtered = rows.filter((row) => `${row.title ?? row.name ?? ""} ${row.position ?? row.slug ?? ""}`.toLocaleLowerCase("id").includes(search.toLocaleLowerCase("id")));
  const input = (key: keyof ContentForm, label: string, options: { required?: boolean; type?: string; wide?: boolean; hint?: string; maxLength?: number } = {}) => <label className={`admin-field ${options.wide ? "admin-field-wide" : ""}`} key={key}><span>{label}</span>{options.type === "textarea" ? <textarea aria-label={label} rows={key === "content" ? 12 : 4} value={String(form[key])} onChange={(event) => update(key, event.target.value)} required={options.required} maxLength={options.maxLength} disabled={busy} /> : <input aria-label={label} type={options.type ?? "text"} value={String(form[key])} onChange={(event) => {
    const value = options.type === "number" ? Number(event.target.value) : event.target.value;
    if (key === "title" && kind === "news" && editing === "new" && (!form.slug || form.slug === makeSlug(form.title))) setForm((current) => ({ ...current, title: String(value), slug: makeSlug(String(value)) }));
    else update(key, value);
  }} required={options.required} maxLength={options.maxLength} min={options.type === "number" ? 0 : undefined} step={options.type === "number" ? 1 : undefined} disabled={busy} />}{options.hint && <small>{options.hint}</small>}</label>;
  return <>
    <div className="admin-page-heading"><div><p className="admin-eyebrow">Content workspace</p><h1>{config.heading}</h1><p>{config.description}</p></div><button type="button" className="button button-primary" onClick={() => open("new")}><Plus size={17} />Tambah {config.singular}</button></div>
    {kind !== "team" && <p className="admin-static-note">Konten baru atau perubahan URL detail memerlukan rebuild dan deployment frontend. Draf dan konten yang dihapus akan ditolak API meskipun halaman statis lama masih tersimpan.</p>}
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`admin-feedback ${feedback.error ? "admin-feedback-error" : "admin-feedback-success"}`}>{feedback.message}</p>}
    <section className="admin-collection" aria-label={`Daftar ${config.singular}`}><div className="admin-collection-toolbar"><h2>Daftar {config.singular} <span>{rows.length}</span></h2><label className="sr-only" htmlFor="admin-content-search">Cari {config.singular}</label><input id="admin-content-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Cari ${config.singular}…`} /></div>
      {loading ? <p className="admin-loading" role="status"><LoaderCircle size={18} className="animate-spin" />Memuat data…</p> : !filtered.length ? <div className="admin-empty"><h3>{rows.length ? "Tidak ada hasil pencarian." : "Cerita berikutnya dimulai di sini."}</h3><p>{rows.length ? "Coba kata kunci lain." : config.empty}</p>{feedback?.error && <button type="button" className="button button-secondary" onClick={() => void load()}>Muat ulang</button>}</div> : <ul className="admin-content-list">{filtered.map((row) => <li key={row.id}><div className="admin-row-text"><h3>{row.title ?? row.name}</h3><p>{kind === "team" ? `${row.position} · Urutan ${row.order ?? 0}` : kind === "events" && row.startDate ? `${new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(row.startDate))} WIB${row.location ? ` · ${row.location}` : ""}` : `/${row.slug}/`}</p>{kind !== "team" && <span className={`admin-status ${row.published ? "is-published" : ""}`}>{row.published ? "Published" : "Draf"}</span>}</div><div className="admin-row-actions">{kind !== "team" && <button type="button" className="admin-text-button" disabled={busy} onClick={() => void togglePublication(row)}>{row.published ? "Jadikan draf" : "Publikasikan"}</button>}<button type="button" className="icon-button" aria-label={`Edit ${row.title ?? row.name}`} onClick={() => open(row)}><Edit3 size={17} /></button><button type="button" className="icon-button admin-delete-button" aria-label={`Hapus ${row.title ?? row.name}`} onClick={() => setDeleting(row)}><Trash2 size={17} /></button></div></li>)}</ul>}
    </section>
    {editing && <AdminDialog title={`${editing === "new" ? "Tambah" : "Edit"} ${config.singular}`} onClose={() => setEditing(null)} busy={busy || uploading}><form onSubmit={save} className="admin-editor">
      {formError && <p role="alert" className="admin-feedback admin-feedback-error">{formError}</p>}
      <div className="admin-form-grid">
        {kind === "news" && <>{input("title", "Judul berita", { required: true, maxLength: 200 })}{input("slug", "Slug / URL", { required: true, hint: "Huruf kecil, angka, dan tanda hubung. Perubahan slug memerlukan rebuild.", maxLength: 120 })}{input("summary", "Ringkasan", { wide: true, type: "textarea", maxLength: 1000 })}{input("content", "Konten artikel", { type: "textarea", wide: true, required: true, hint: "Mendukung Markdown: heading, daftar, tautan, gambar, dan tabel.", maxLength: 100000 })}</>}
        {kind === "events" && <>{input("title", "Nama kegiatan", { required: true, maxLength: 200 })}{input("location", "Lokasi", { maxLength: 300 })}{input("startDate", "Waktu mulai (WIB)", { type: "datetime-local", required: true })}{input("endDate", "Waktu selesai (WIB, opsional)", { type: "datetime-local" })}{input("description", "Deskripsi kegiatan", { type: "textarea", required: true, wide: true, hint: "Tanggal selalu disimpan dalam UTC dan ditampilkan dalam WIB.", maxLength: 100000 })}</>}
        {kind === "team" && <>{input("name", "Nama lengkap", { required: true, maxLength: 150 })}{input("position", "Jabatan", { required: true, maxLength: 150 })}{input("order", "Urutan tampilan", { type: "number", hint: "Angka lebih kecil ditampilkan terlebih dahulu." })}{input("bio", "Bio singkat", { type: "textarea", wide: true, maxLength: 4000 })}{input("socials", "Tautan sosial (JSON)", { type: "textarea", wide: true, hint: 'Contoh: {"instagram":"https://instagram.com/nama"}', maxLength: 4000 })}</>}
        <div className="admin-field admin-field-wide"><span>{kind === "team" ? "Foto anggota" : "Gambar konten"}</span><div className="admin-image-input"><SafeImage src={kind === "team" ? form.photoUrl : form.imageUrl} alt={kind === "team" ? "Pratinjau foto anggota" : "Pratinjau gambar konten"} className="admin-image-preview" label="Pratinjau" /><div>{input(kind === "team" ? "photoUrl" : "imageUrl", "URL gambar", { type: "url", maxLength: 2048 })}<label className="admin-upload-label"><Upload size={15} />{uploading ? "Mengunggah…" : "Unggah gambar"}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label><small>JPEG, PNG, atau WebP, maksimal 5 MB. Unggah memerlukan penyimpanan yang sudah dikonfigurasi.</small></div></div></div>
        {kind !== "team" && <label className="admin-publish-field admin-field-wide"><input type="checkbox" checked={form.published} onChange={(event) => update("published", event.target.checked)} disabled={busy} /><span><strong>Published</strong><small>Tampilkan konten di website publik.</small></span></label>}
      </div><div className="admin-form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)} disabled={busy || uploading}>Batal</button><button type="submit" className="button button-primary" disabled={busy || uploading}>{busy ? <LoaderCircle className="animate-spin" size={17} /> : <Save size={17} />}{busy ? "Menyimpan…" : "Simpan perubahan"}</button></div>
    </form></AdminDialog>}
    {deleting && <AdminDialog title={`Hapus ${config.singular}?`} onClose={() => setDeleting(null)} busy={busy}><p className="admin-confirm-copy">“{deleting.title ?? deleting.name}” akan dihapus. Tindakan ini tidak dapat dibatalkan.</p><div className="admin-form-actions"><button type="button" className="button button-secondary" onClick={() => setDeleting(null)} disabled={busy}>Batal</button><button type="button" className="button button-danger" onClick={() => void remove()} disabled={busy}>{busy ? "Menghapus…" : "Ya, hapus"}</button></div></AdminDialog>}
  </>;
}
