"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Camera, Check, Code2, Copy, FileText, History, LoaderCircle, MessageCircle, Paperclip, Pencil, Plus, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { api, API_BASE } from "../../lib/api";
import { readChatStream } from "../../lib/chat-stream";
import { prepareImage } from "../../lib/chat-attachments";
import { deleteConversation, emptyStore, loadStore, modelMessages, newConversation, newId, persistStore, retryMessages, updateConversation, type Attachment, type ConversationStore, type Effort, type LocalMessage, type Persona } from "../../lib/conversations";
import ChatDialog from "./ChatDialog";
import RichContent, { safeContentUrl } from "./RichContent";

const personas = {
  daily: { title: "Smart Companion", subtitle: "Think & explore", heading: "Apa yang ingin kamu eksplorasi?", icon: MessageCircle, greeting: "Halo! 👋 Saya AET AI — teman cerdasmu di AET PCR. Mau tanya apa hari ini?", prompts: ["Bantu susun rencana belajar minggu ini", "Jelaskan konsep yang sedang saya pelajari", "Mari diskusikan ide proyek saya"] },
  report: { title: "Academic Writer", subtitle: "Research & write", heading: "Tulisan yang kuat dimulai dari ide.", icon: FileText, greeting: "Halo! 📝 Saya AET AI, siap membantu penulisan akademik Anda — dari struktur laporan hingga analisis data. Silakan mulai.", prompts: ["Bantu buat kerangka laporan praktikum", "Perbaiki struktur paragraf akademik ini", "Jelaskan cara menganalisis hasil percobaan"] },
  coding: { title: "Coding Expert", subtitle: "Build & understand", heading: "Mari bangun sesuatu yang bekerja.", icon: Code2, greeting: "Halo! 💻 Saya AET AI — siap bantu coding, debugging, dan penjelasan konsep teknis. Tempel kode atau tanya apa saja!", prompts: ["Bantu temukan masalah dalam kode saya", "Jelaskan konsep pemrograman ini", "Bantu rancang struktur proyek saya"] },
} as const;

const accepted = "image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Permintaan tidak berhasil. Silakan coba kembali.";

function Message({ message, onEdit }: { message: LocalMessage; onEdit?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [expandedImage, setExpandedImage] = useState<Attachment | null>(null);
  return <article className={`chat-message chat-message-${message.role}`} aria-label={message.role === "user" ? "Pesan Anda" : "Jawaban AET AI"}>
    <div className="chat-message-avatar" aria-hidden="true">{message.role === "user" ? "K" : "A"}</div>
    <div className="chat-message-body"><div className="chat-message-author">{message.role === "user" ? "Kamu" : "AET AI"}</div>
      {message.attachments?.map(item => <div className="chat-message-attachment" key={item.id}>
        {item.dataUrl && /^data:image\/(png|jpeg|webp);base64,/.test(item.dataUrl) ? <button type="button" className="chat-content-image" aria-label={`Perbesar lampiran ${item.name}`} onClick={() => setExpandedImage(item)}><Image src={item.dataUrl} width={320} height={200} unoptimized alt={item.name} style={{ maxWidth: "100%", height: "auto" }} /></button> : <><FileText size={16} /><span>{item.name}</span>{item.mimeType.startsWith("image/") && <small>Pratinjau tidak disimpan di riwayat</small>}</>}
      </div>)}
      {message.content ? <RichContent content={message.content} /> : message.state === "streaming" ? <div className="chat-thinking" aria-label="Menyiapkan jawaban"><i /><i /><i /></div> : null}
      {message.state === "incomplete" && <p className="chat-incomplete">Jawaban belum selesai. Teks ini tidak digunakan sebagai konteks jawaban berikutnya.</p>}
      {message.sources?.length ? <div className="chat-sources"><strong>Sumber dari alat</strong><ul>{message.sources.map((source, index) => { const url = safeContentUrl(source.url); return <li key={`${source.url}-${index}`}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}</a> : source.title}</li>; })}</ul></div> : null}
      {message.state !== "streaming" && <div className="chat-message-actions"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(message.content); setCopied(true); } catch { setCopied(false); } }} aria-label="Salin pesan">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Disalin" : "Salin"}</button>{onEdit && <button type="button" onClick={onEdit}><Pencil size={13} /> Edit</button>}</div>}
    </div>
    {expandedImage?.dataUrl && <ChatDialog title={expandedImage.name} onClose={() => setExpandedImage(null)}><Image src={expandedImage.dataUrl} width={1400} height={1000} unoptimized alt={expandedImage.name} style={{ width: "100%", height: "auto" }} /></ChatDialog>}
  </article>;
}

export default function ChatWorkspace({ initialPersona, onBack }: { initialPersona: Persona; onBack: () => void }) {
  const config = personas[initialPersona];
  const Icon = config.icon;
  const [store, setStore] = useState<ConversationStore>(() => emptyStore(initialPersona));
  const storeRef = useRef(store);
  const saveAllowed = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [effort, setEffort] = useState<Effort>("normal");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [rename, setRename] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewAttachment, setViewAttachment] = useState<Attachment | null>(null);
  const request = useRef<AbortController | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const active = store.conversations.find(item => item.id === store.activeId) || store.conversations[0];

  const commit = useCallback((next: ConversationStore, write = true) => {
    storeRef.current = next; setStore(next);
    if (write && saveAllowed.current) {
      try { persistStore(localStorage, initialPersona, next); }
      catch { setStorageError("Riwayat tidak dapat disimpan. Percakapan tetap tersedia selama halaman ini terbuka."); }
    }
  }, [initialPersona]);

  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      try { const saved = loadStore(localStorage, initialPersona); saveAllowed.current = true; commit(saved, false); }
      catch (failure) { saveAllowed.current = false; setStorageError(errorMessage(failure)); }
      setLoaded(true);
    });
    return () => { mounted = false; request.current?.abort(); uploadRequest.current?.abort(); };
  }, [commit, initialPersona]);

  useEffect(() => { bottomRef.current?.scrollIntoView?.({ behavior: "auto", block: "end" }); }, [active.messages.length, busy]);

  function storeMessages(messages: LocalMessage[], conversationId: string, write = true) {
    const current = storeRef.current.conversations.find(item => item.id === conversationId);
    if (!current) return;
    const first = messages.find(item => item.role === "user")?.content.trim();
    commit(updateConversation(storeRef.current, { ...current, messages, title: current.title === "Percakapan baru" && first ? first.slice(0, 65) : current.title, updatedAt: new Date().toISOString() }), write);
  }

  async function generate(history: LocalMessage[]) {
    if (busy || request.current || !history.length) return;
    const lastUser = history.findLast(item => item.role === "user");
    if (!lastUser?.content.trim() && !lastUser?.attachments?.some(item => item.dataUrl || item.text)) { setError("Lampirkan kembali gambar dari perangkat sebelum mengulangi pesan ini."); return; }
    const conversationId = storeRef.current.activeId;
    const controller = new AbortController(); request.current = controller;
    const answer: LocalMessage = { id: newId(), role: "assistant", content: "", state: "streaming" };
    let currentMessages = [...history, answer];
    let complete = false;
    setBusy(true); setError(""); setStatus("Menghubungkan ke AET AI…");
    storeMessages(currentMessages, conversationId, false);
    try {
      const context = modelMessages(history);
      if (!context.length) throw new Error("Lampiran atau konteks terlalu panjang. Kurangi jumlah dokumen lalu coba kembali.");
      const response = await fetch(`${API_BASE}/v1/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ persona: initialPersona, effort, messages: context }), signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const detail = payload.error && typeof payload.error === "object" ? payload.error : payload;
        throw new Error(typeof detail.message === "string" ? detail.message : response.status === 429 ? "Terlalu banyak permintaan. Tunggu sebentar sebelum mencoba kembali." : "Layanan AI belum dapat memproses permintaan ini.");
      }
      if (!response.body) throw new Error("Server tidak mengirim aliran jawaban.");
      await readChatStream(response.body, frame => {
        if (request.current !== controller) return;
        if (frame.event === "status") setStatus(frame.data.message);
        if (frame.event === "tool") setStatus(typeof frame.data.message === "string" ? frame.data.message : "Menggunakan alat…");
        if (frame.event === "delta") { answer.content += frame.data.text; if (answer.content.length > 100_000) throw new Error("Jawaban melebihi batas panjang. Coba pertanyaan yang lebih spesifik."); currentMessages = [...history, { ...answer }]; storeMessages(currentMessages, conversationId, false); }
        if (frame.event === "sources") { answer.sources = frame.data.sources; currentMessages = [...history, { ...answer }]; storeMessages(currentMessages, conversationId, false); }
        if (frame.event === "done") complete = true;
      }, controller.signal);
      if (!complete || !answer.content.trim()) { complete = false; throw new Error("Server belum memberikan jawaban yang lengkap. Silakan coba kembali."); }
    } catch (failure) {
      if (request.current === controller) setError(controller.signal.aborted ? "Permintaan dihentikan. Jawaban parsial tidak dipakai sebagai konteks." : errorMessage(failure));
    } finally {
      if (request.current === controller) {
        answer.state = complete && !controller.signal.aborted ? "complete" : "incomplete";
        storeMessages([...history, { ...answer }], conversationId);
        request.current = null; setBusy(false); setStatus("");
        inputRef.current?.focus();
      }
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || request.current || uploading || uploadRequest.current || !loaded || (!input.trim() && !attachments.length)) return;
    const current = storeRef.current.conversations.find(item => item.id === storeRef.current.activeId)!;
    const editIndex = editId ? current.messages.findIndex(item => item.id === editId && item.role === "user") : -1;
    const previous = editIndex >= 0 ? current.messages.slice(0, editIndex) : current.messages;
    const user: LocalMessage = { id: editIndex >= 0 ? editId! : newId(), role: "user", content: input.trim(), state: "complete", ...(attachments.length ? { attachments } : {}) };
    const messages = [...previous, user];
    storeMessages(messages, current.id); setInput(""); setAttachments([]); setEditId(null);
    void generate(messages);
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]; event.target.value = "";
    if (!selected || busy || request.current || uploading || uploadRequest.current) return;
    if (attachments.length >= 4) { setError("Maksimal empat lampiran per pesan."); return; }
    if (selected.size > 5 * 1024 * 1024) { setError("Ukuran lampiran maksimal 5 MB."); return; }
    const controller = new AbortController(); uploadRequest.current = controller;
    setUploading(true); setError("");
    try {
      const file = await prepareImage(selected);
      const result = await api<{ attachment: Attachment }>("/v1/attachments/extract", { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file, signal: controller.signal });
      if (uploadRequest.current === controller && !controller.signal.aborted) setAttachments(items => [...items, result.attachment]);
    } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
    finally { if (uploadRequest.current === controller) { uploadRequest.current = null; setUploading(false); } }
  }

  function stopAndLeave() {
    request.current?.abort(); uploadRequest.current?.abort(); onBack();
  }
  function createConversation() {
    if (busy) return;
    const item = newConversation(initialPersona);
    commit(updateConversation(storeRef.current, item)); setInput(""); setAttachments([]); setError(""); setEditId(null); setHistoryOpen(false); inputRef.current?.focus();
  }
  function editMessage(message: LocalMessage) {
    setEditId(message.id); setInput(message.content); setAttachments(message.attachments?.filter(item => item.text || item.dataUrl) || []); inputRef.current?.focus();
  }

  const history = store.conversations.filter(item => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className={`chat-workspace persona-${initialPersona}`}>
    <a href="#chat-main" className="chat-skip">Lewati ke percakapan</a>
    <aside className="chat-sidebar">
      <button type="button" className="chat-brand" onClick={stopAndLeave}>AET<span>AI</span><small>YOUR THINKING PARTNER</small></button>
      <button type="button" className="chat-new" onClick={createConversation} disabled={busy || !loaded}><Plus size={17} /> Percakapan baru</button>
      <div className="chat-sidebar-label">RUANG PERCAKAPAN</div><div className="chat-persona"><Icon size={18} /><div><strong>{config.title}</strong><small>{config.subtitle}</small></div></div>
      <div className="chat-sidebar-label">RIWAYAT DI BROWSER INI</div>
      <input aria-label="Cari riwayat percakapan" className="chat-history-search" placeholder="Cari percakapan…" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="chat-sidebar-history">{history.map(item => <button type="button" key={item.id} disabled={busy} aria-current={item.id === active.id ? "true" : undefined} onClick={() => { commit({ ...storeRef.current, activeId: item.id }); setError(""); setEditId(null); setInput(""); setAttachments([]); }}>{item.title}</button>)}</div>
      <div className="chat-sidebar-footer"><Link href="/">Beranda</Link><Link href="/news/">Berita AET</Link><p>Percakapan tersimpan lokal di perangkat ini.</p></div>
    </aside>
    <main id="chat-main" className="chat-main">
      <header className="chat-topbar"><div className="chat-topbar-title"><button type="button" className="chat-icon" aria-label="Kembali ke beranda" onClick={stopAndLeave}><ArrowLeft size={19} /></button><span className="chat-persona-mark"><Icon size={17} /></span><div><h1>{config.title}</h1><p>AET AI · Adaptif untuk kebutuhanmu</p></div></div><div className="chat-topbar-actions"><button type="button" className="chat-icon" aria-label="Percakapan baru" onClick={createConversation} disabled={busy || !loaded}><Plus size={18} /></button><button type="button" className="chat-icon" aria-label="Buka riwayat" onClick={() => setHistoryOpen(true)} disabled={!loaded}><History size={18} /></button><button type="button" className="chat-icon" aria-label="Ganti nama percakapan" onClick={() => { setRename(active.title); setRenameOpen(true); }} disabled={busy || !loaded}><Pencil size={16} /></button><button type="button" className="chat-icon chat-danger" aria-label="Hapus percakapan" onClick={() => setDeleteId(active.id)} disabled={busy || !loaded}><Trash2 size={17} /></button></div></header>
      <div className="chat-scroll" aria-label="Percakapan"><div className="chat-reading">
        {!active.messages.length && <section className="chat-start"><div className="chat-eyebrow"><span />{config.subtitle}</div><h2>{config.heading}</h2><p>Berikan konteks dan kembangkan pemikiranmu bersama AET AI.</p><div className="chat-prompts">{config.prompts.map(prompt => <button type="button" key={prompt} onClick={() => { setInput(prompt); inputRef.current?.focus(); }}>{prompt}<ArrowUpRight size={14} /></button>)}</div><div className="chat-greeting"><Icon size={18} /><p>{config.greeting}</p></div></section>}
        {active.messages.map(message => <Message key={message.id} message={message} onEdit={message.role === "user" && !busy ? () => editMessage(message) : undefined} />)}
        <div ref={bottomRef} />
      </div></div>
      <div className="chat-composer-area"><div className="chat-composer-inner">
        {error && <div className="chat-feedback chat-feedback-error" role="alert">{error}{active.messages.some(message => message.role === "user") && <button type="button" onClick={() => void generate(retryMessages(active.messages))} disabled={busy}><RotateCcw size={13} /> Coba ulang</button>}</div>}
        {storageError && <p className="chat-feedback chat-feedback-error" role="alert">{storageError}</p>}
        {editId && <div className="chat-feedback">Mengedit pesan. Jawaban setelah pesan ini akan diganti.<button type="button" onClick={() => { setEditId(null); setInput(""); setAttachments([]); }}>Batal edit</button></div>}
        {attachments.length > 0 && <div className="chat-pending-attachments">{attachments.map(item => <div key={item.id}><button type="button" className="chat-attachment-name" onClick={() => item.dataUrl ? setViewAttachment(item) : undefined}>{item.dataUrl ? <Image src={item.dataUrl} alt="" width={38} height={38} unoptimized /> : <FileText size={20} />}<span>{item.name}</span></button><button type="button" className="chat-icon" aria-label={`Hapus lampiran ${item.name}`} onClick={() => setAttachments(items => items.filter(attachment => attachment.id !== item.id))}><X size={15} /></button></div>)}</div>}
        <form onSubmit={submit} className="chat-composer"><label htmlFor="aet-chat-input" className="sr-only">Pesan untuk {config.title}</label><textarea id="aet-chat-input" ref={inputRef} placeholder={`Kirim pesan ke ${config.title}…`} value={input} maxLength={20_000} rows={2} disabled={busy || !loaded} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
          <div className="chat-composer-toolbar"><div className="chat-composer-tools"><button type="button" className="chat-icon" aria-label="Lampirkan dokumen atau gambar" disabled={busy || uploading || !loaded} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle size={18} className="chat-spin" /> : <Paperclip size={18} />}</button><button type="button" className="chat-icon" aria-label="Ambil gambar dari kamera" disabled={busy || uploading || !loaded} onClick={() => cameraRef.current?.click()}><Camera size={18} /></button><span>Shift + Enter untuk baris baru</span></div>
            <div className="chat-composer-controls"><fieldset className="chat-effort" disabled={busy}><legend className="sr-only">Mode respons</legend>{([['fast', 'Fast', 'Cepat'], ['normal', 'Normal', 'Seimbang'], ['think', 'Think', 'Analisis mendalam']] as const).map(([value, label, description]) => <label key={value} className={effort === value ? "selected" : ""} title={description}><input type="radio" name="chat-effort" value={value} checked={effort === value} onChange={() => setEffort(value)} /><span>{label}</span></label>)}</fieldset><button type={busy ? "button" : "submit"} className="chat-send" aria-label={busy ? "Hentikan jawaban" : "Kirim pesan"} disabled={!busy && (uploading || !loaded || !input.trim() && !attachments.length)} onClick={busy ? () => request.current?.abort() : undefined}>{busy ? <Square size={16} /> : <Send size={17} />}</button></div>
          </div>
        </form>
        <input ref={fileRef} type="file" accept={accepted} onChange={selectFile} hidden aria-label="Pilih lampiran" /><input ref={cameraRef} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={selectFile} hidden aria-label="Pilih foto kamera" />
        {uploading && <p role="status" className="chat-progress">Memvalidasi dan membaca lampiran…</p>}{busy && <p role="status" aria-live="polite" className="chat-progress">{status}</p>}
        <p className="chat-disclaimer">AI dapat melakukan kesalahan. Periksa kembali informasi penting.</p>
      </div></div>
    </main>
    {historyOpen && <ChatDialog title="Percakapan tersimpan" onClose={() => setHistoryOpen(false)}><p className="chat-dialog-note">Riwayat per mode tersimpan di browser ini.</p><button type="button" className="chat-new" disabled={busy} onClick={createConversation}><Plus size={16} /> Percakapan baru</button><input className="chat-history-search" aria-label="Cari percakapan tersimpan" placeholder="Cari percakapan…" value={search} onChange={event => setSearch(event.target.value)} /><div className="chat-dialog-history">{history.map(item => <div key={item.id}><button type="button" disabled={busy} aria-current={item.id === active.id ? "true" : undefined} onClick={() => { commit({ ...storeRef.current, activeId: item.id }); setHistoryOpen(false); setInput(""); setAttachments([]); setError(""); setEditId(null); }}>{item.title}</button><button type="button" className="chat-icon chat-danger" disabled={busy} aria-label={`Hapus ${item.title}`} onClick={() => { setHistoryOpen(false); setDeleteId(item.id); }}><Trash2 size={16} /></button></div>)}</div></ChatDialog>}
    {renameOpen && <ChatDialog title="Ganti nama percakapan" onClose={() => setRenameOpen(false)}><form onSubmit={event => { event.preventDefault(); if (!rename.trim()) return; const current = storeRef.current.conversations.find(item => item.id === storeRef.current.activeId)!; commit(updateConversation(storeRef.current, { ...current, title: rename.trim().slice(0, 100) })); setRenameOpen(false); }}><label className="chat-field">Nama percakapan<input value={rename} maxLength={100} required onChange={event => setRename(event.target.value)} /></label><div className="chat-dialog-actions"><button type="button" onClick={() => setRenameOpen(false)}>Batal</button><button type="submit" className="chat-primary">Simpan nama</button></div></form></ChatDialog>}
    {deleteId && <ChatDialog title="Hapus percakapan ini?" onClose={() => setDeleteId(null)}><p>Percakapan <strong>{store.conversations.find(item => item.id === deleteId)?.title}</strong> akan dihapus dari browser ini. Tindakan ini tidak dapat dibatalkan.</p><div className="chat-dialog-actions"><button type="button" onClick={() => setDeleteId(null)}>Batal</button><button type="button" className="chat-delete" onClick={() => { commit(deleteConversation(storeRef.current, deleteId, initialPersona)); setDeleteId(null); setError(""); setInput(""); setAttachments([]); setEditId(null); }}>Hapus percakapan</button></div></ChatDialog>}
    {viewAttachment?.dataUrl && <ChatDialog title={viewAttachment.name} onClose={() => setViewAttachment(null)}><Image src={viewAttachment.dataUrl} width={1400} height={1000} unoptimized alt={viewAttachment.name} style={{ width: "100%", height: "auto" }} /></ChatDialog>}
  </div>;
}
