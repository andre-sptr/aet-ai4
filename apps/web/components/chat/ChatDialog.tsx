"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function ChatDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("button, input, textarea, select, [tabindex='0']")?.focus();
    return () => { previous?.focus(); };
  }, []);
  if (typeof document === "undefined") return null;
  return createPortal(<div className="chat-dialog-shade" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="chat-dialog" onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex='0']");
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="chat-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="chat-icon" aria-label="Tutup dialog" onClick={onClose}><X size={20} /></button></div>
      {children}
    </div>
  </div>, document.body);
}
