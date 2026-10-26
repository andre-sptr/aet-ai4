'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';

export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

export default function SafeImage({ src, alt, className = '', label = 'AET PCR' }: { src?: string | null; alt: string; className?: string; label?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const safe = safeImageUrl(src);
  if (!safe || failed === safe) return <div className={`image-fallback ${className}`} role="img" aria-label={`${alt} — gambar belum tersedia`}><ImageIcon size={30} strokeWidth={1.3} /><span>{label}</span></div>;
  return <Image src={safe} alt={alt} width={1200} height={800} unoptimized className={`safe-image ${className}`} onError={() => setFailed(safe)} />;
}
