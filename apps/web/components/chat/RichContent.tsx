"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Maximize2 } from "lucide-react";
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
  if (language === "mermaid") return <Diagram chart={value} />;
  if (!language && !value.includes("\n")) return <code>{children}</code>;
  return <div className="chat-code">
    <div className="chat-code-heading"><span>{language || "text"}</span><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } }} aria-label="Salin kode">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Disalin" : "Salin"}</button></div>
    <SyntaxHighlighter language={language || "text"} style={oneDark} PreTag="div" customStyle={{ margin: 0, borderRadius: 0, background: "#0f172a", fontSize: "0.85rem" }}>{value}</SyntaxHighlighter>
  </div>;
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

export default function RichContent({ content }: { content: string }) {
  return <div className="rich-content"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, strict: "ignore" }]]} urlTransform={value => safeContentUrl(value) || ""} components={{
    code: Code,
    pre: ({ children }) => <div className="chat-pre">{children}</div>,
    a: ({ href, children }) => { const safe = safeContentUrl(href); return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>; },
    img: ({ src, alt }) => <ContentImage src={typeof src === "string" ? src : undefined} alt={alt} />,
    table: ({ children }) => <div className="chat-table"><table>{children}</table></div>,
  }}>{content}</ReactMarkdown></div>;
}
