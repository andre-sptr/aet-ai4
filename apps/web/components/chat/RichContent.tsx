"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Maximize2, ExternalLink, ChevronDown } from "lucide-react";
import type { Source } from "../../lib/conversations";
import ChatDialog from "./ChatDialog";

export function safeContentUrl(value: string | undefined, image = false): string | undefined {
  if (!value || value.length > 2048) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    if (!image && url.protocol === "mailto:") return url.href;
  } catch { /* Invalid URLs are displayed as text, never executed. */ }
  return undefined;
}

function Diagram({ chart }: { chart: string }) {
  const id = `aet-diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [image, setImage] = useState<string>();
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let active = true, objectUrl: string | undefined;
    async function render() {
      if (chart.length > 30_000) { if (active) setError(true); return; }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", flowchart: { htmlLabels: false }, maxTextSize: 30_000, suppressErrorRendering: true });
        const { svg } = await mermaid.render(id, chart);
        if (!active || svg.length > 1_000_000) return;
        // Render SVG as an image document, not injected HTML or an interactive SVG DOM.
        objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setImage(objectUrl); setError(false);
      } catch { if (active) setError(true); }
    }
    void render();
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [chart, id]);
  return <div className="chat-diagram">
    {error ? <p>Diagram tidak dapat ditampilkan. Kode sumber tetap tersedia di bawah.</p> : image ? <><Image src={image} width={900} height={600} alt="Diagram Mermaid" unoptimized style={{ width: "100%", height: "auto" }} /><button type="button" onClick={() => setExpanded(true)} className="chat-small-button"><Maximize2 size={14} /> Perbesar diagram</button></> : <p role="status">Menyiapkan diagram…</p>}
    <details><summary>Kode diagram</summary><pre>{chart}</pre></details>
    {expanded && image && <ChatDialog title="Diagram" onClose={() => setExpanded(false)}><Image src={image} width={1400} height={1000} unoptimized alt="Diagram Mermaid diperbesar" style={{ width: "100%", height: "auto" }} /></ChatDialog>}
  </div>;
}

function Code({ className, children }: { className?: string; children?: ReactNode }) {
  const language = /language-([\w-]+)/.exec(className || "")?.[1];
  const value = String(children).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (language === "mermaid") return <Diagram chart={value} />;
  if (!language && !value.includes("\n")) return <code>{children}</code>;
  const lineCount = value.split("\n").length;
  const longCode = lineCount > 18;
  return <section className={`chat-code${expanded ? " is-expanded" : ""}`} aria-label={`${language || "text"} code example`}>
    <div className="chat-code-heading">
      <span className="chat-code-language"><i aria-hidden="true" />{language || "text"}</span>
      <div className="chat-code-actions">
        {longCode && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><ChevronDown size={13} className={expanded ? "is-rotated" : ""} />{expanded ? "Ringkas" : `${lineCount} baris`}</button>}
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } }} aria-label="Salin kode"><span>{copied ? <Check size={13} /> : <Copy size={13} />}</span>{copied ? "Disalin" : "Salin kode"}</button>
      </div>
    </div>
    <div className={`chat-code-content${longCode && !expanded ? " is-clamped" : ""}`} role="region" aria-label={`Kode ${language || "teks"}`} tabIndex={0}>
      <SyntaxHighlighter language={language || "text"} style={oneDark} PreTag="div" showLineNumbers={lineCount > 4} lineNumberStyle={{ minWidth: "2.8em", paddingRight: "1.1em", color: "#64748b", textAlign: "right" }} customStyle={{ margin: 0, borderRadius: 0, background: "#111b2d", fontSize: "0.82rem", lineHeight: 1.7, padding: "16px 18px" }} codeTagProps={{ style: { fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)" } }}>{value}</SyntaxHighlighter>
    </div>
  </section>;
}

function ContentImage({ src, alt }: { src?: string; alt?: string }) {
  const url = safeContentUrl(src, true);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="chat-image-fallback">{alt || "Gambar tidak tersedia"}</span>;
  return <>
    <button type="button" className="chat-content-image" aria-label={`Perbesar ${alt || "gambar"}`} onClick={() => setExpanded(true)}><Image src={url} width={960} height={640} unoptimized alt={alt || "Gambar dalam jawaban"} onError={() => setFailed(true)} style={{ width: "100%", height: "auto" }} /></button>
    {expanded && <ChatDialog title={alt || "Gambar"} onClose={() => setExpanded(false)}><Image src={url} width={1400} height={1000} unoptimized alt={alt || "Gambar diperbesar"} style={{ width: "100%", height: "auto" }} /></ChatDialog>}
  </>;
}

export function SourceReferences({ sources }: { sources: Source[] }) {
  const validSources = sources.slice(0, 12);
  if (!validSources.length) return null;
  return <section className="chat-sources" aria-label="Referensi sumber">
    <div className="chat-sources-heading"><span className="chat-sources-mark"><ExternalLink size={14} /></span><div><strong>Referensi</strong><span>{validSources.length} sumber pendukung</span></div></div>
    <ol className="chat-source-list">
      {validSources.map((source, index) => {
        const url = safeContentUrl(source.url);
        let domain = "Sumber eksternal";
        try { if (url) domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* Keep the safe fallback label. */ }
        return <li key={`${source.url}-${index}`}>
          <span className="chat-source-index">{index + 1}</span>
          <div className="chat-source-detail"><strong>{source.title || domain}</strong><span>{domain}</span></div>
          {url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Buka sumber ${source.title || domain}`}><ExternalLink size={14} /></a> : <span className="chat-source-unavailable">URL tidak tersedia</span>}
        </li>;
      })}
    </ol>
  </section>;
}

export default function RichContent({ content }: { content: string }) {
  return <div className="rich-content"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, strict: "ignore" }]]} urlTransform={value => safeContentUrl(value) || ""} components={{
    code: Code,
    pre: ({ children }) => <div className="chat-pre">{children}</div>,
    a: ({ href, children }) => { const safe = safeContentUrl(href); return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}<ExternalLink className="chat-inline-link-icon" size={12} aria-hidden="true" /></a> : <span>{children}</span>; },
    img: ({ src, alt }) => <ContentImage src={typeof src === "string" ? src : undefined} alt={alt} />,
    table: ({ children }) => <div className="chat-table" role="region" aria-label="Tabel dalam jawaban" tabIndex={0}><table>{children}</table></div>,
    th: ({ children }) => <th scope="col">{children}</th>,
    input: ({ checked, type }) => type === "checkbox" ? <input type="checkbox" checked={Boolean(checked)} disabled aria-label="Status tugas" readOnly /> : null,
    hr: () => <hr className="chat-markdown-divider" />,
  }}>{content}</ReactMarkdown></div>;
}
