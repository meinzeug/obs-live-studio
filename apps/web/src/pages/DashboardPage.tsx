import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';
export function DashboardPage() {
  const [d, setD] = useState<any>();
  useEffect(() => {
    api('/api/dashboard').then(setD);
  }, []);
  return (
    <section className="panel">
      <h2>Dashboard</h2>
      <p>Status: {d?.status ?? 'lädt'}</p>
      <p>
        Neue Artikel: {d?.counts?.newArticles ?? 0} · Freigegeben: {d?.counts?.approved ?? 0}
      </p>
      <p>
        OBS: {d?.obs?.status ?? 'unbekannt'} · Playback: {d?.playback?.status ?? 'idle'}
      </p>
    </section>
  );
}
