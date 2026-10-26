'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Landing from '../components/Landing';

const ChatWorkspace = dynamic(() => import('../components/chat/ChatWorkspace'), {
  loading: () => <main id="main-content" className="site-container content-section" role="status">Membuka ruang percakapan…</main>,
});

export default function HomePage() {
  const [persona, setPersona] = useState<'daily' | 'report' | 'coding' | null>(null);
  return persona ? <ChatWorkspace key={persona} initialPersona={persona} onBack={() => setPersona(null)} /> : <Landing onSelectPersona={setPersona} />;
}
