"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function AdminDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="admin-dialog" aria-labelledby="admin-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="admin-dialog-heading"><h2 id="admin-dialog-title">{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Tutup dialog"><X size={20} /></button></div>
    {children}
  </dialog>;
}
