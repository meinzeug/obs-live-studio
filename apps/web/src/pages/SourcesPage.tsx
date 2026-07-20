import React, { useEffect, useState } from 'react';
import {
  Activity,
  FlaskConical,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCw,
  Rss,
  Wifi,
  WifiOff,
  WandSparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';
import { sourceHealthRoute } from '../navigation.js';
export function SourcesPage({ user }: { user: SessionUser }) {
  const writable = can(user, 'sources:write');
  const [sources, setSources] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: 'Lokaler Testfeed',
    url: `${location.origin}/test-feed.xml`,
    type: 'rss',
    category: 'Nachrichten',
    region: 'Deutschland',
    language: 'de',
    description: '',
    trustLevel: 50,
    fetchIntervalSeconds: 900,
  });
  const [msg, setMsg] = useState('');
  const [formBusy, setFormBusy] = useState('');
  const [workingSource, setWorkingSource] = useState<string | null>(null);
  async function load() {
    try {
      setSources(await api('/api/sources'));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setFormBusy('save');
    try {
      await api('/api/sources', { method: 'POST', body: JSON.stringify(form) });
      setMsg('Quelle gespeichert');
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setFormBusy('');
    }
  }
  async function test() {
    setFormBusy('test');
    try {
      const r = await api<any>('/api/sources/test', {
        method: 'POST',
        body: JSON.stringify({ url: form.url, type: form.type }),
      });
      setMsg(`Verbindung erfolgreich: ${r.detected}`);
      return r;
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setFormBusy('');
    }
  }
  async function suggestWithAi() {
    setFormBusy('ai');
    setMsg('Quelle wird geprüft und von der KI eingeordnet …');
    try {
      const tested = await api<any>('/api/sources/test', {
        method: 'POST',
        body: JSON.stringify({ url: form.url, type: form.type }),
      });
      const result = await api<any>('/api/ai/source-suggestion', {
        method: 'POST',
        body: JSON.stringify({
          url: form.url,
          name: form.name,
          detectedType: tested.detected,
          preview: (tested.preview ?? []).slice(0, 5).map((item: any) => ({
            title: typeof item.title === 'string' ? item.title.slice(0, 500) : undefined,
            excerpt:
              typeof (item.excerpt ?? item.text) === 'string' ? (item.excerpt ?? item.text).slice(0, 2000) : undefined,
            url: typeof item.url === 'string' ? item.url.slice(0, 2000) : undefined,
          })),
        }),
      });
      setForm((current) => ({
        ...current,
        name: result.output.name,
        type: result.output.type,
        category: result.output.category,
        region: result.output.region,
        language: result.output.language,
        description: result.output.description,
        trustLevel: result.output.trustLevel,
        fetchIntervalSeconds: result.output.fetchIntervalSeconds,
      }));
      setMsg(
        `KI-Vorschlag von ${result.model} (${result.tier === 'free' ? 'kostenlos' : 'bezahlt'}): ${result.output.rationale}`,
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setFormBusy('');
    }
  }
  async function toggle(source: any) {
    setWorkingSource(source.id);
    try {
      await api(`/api/sources/${source.id}/active`, {
        method: 'POST',
        body: JSON.stringify({ active: !source.active }),
      });
      setMsg(`Quelle „${source.name}“ wurde ${source.active ? 'pausiert' : 'aktiviert'}.`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingSource(null);
    }
  }
  async function refresh(source: any) {
    setWorkingSource(source.id);
    try {
      const result = await api<{ message: string }>(`/api/sources/${source.id}/refresh`, { method: 'POST' });
      setMsg(`${source.name}: ${result.message}`);
      await load();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkingSource(null);
    }
  }
  return (
    <section className="panel">
      <div className="page-title">
        <div>
          <p className="eyebrow">Ingest</p>
          <h2>Quellen</h2>
          <p>Feeds, Webseiten und YouTube-Kanäle verwalten, pausieren und bei Bedarf sofort neu abrufen.</p>
        </div>
        <button className="icon-button ghost-button" onClick={load} title="Aktualisieren" aria-label="Aktualisieren">
          <RefreshCw size={18} />
        </button>
      </div>
      {!writable && <Forbidden />}
      <div className="form-surface source-form">
        <label>
          Name
          <input
            disabled={Boolean(formBusy)}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          URL
          <input
            type="url"
            disabled={Boolean(formBusy)}
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
        </label>
        <label>
          Quellentyp
          <select
            disabled={Boolean(formBusy)}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="rss">RSS</option>
            <option value="atom">Atom</option>
            <option value="feed">Feed automatisch</option>
            <option value="website">Webseite</option>
            <option value="youtube-channel">YouTube-Kanal</option>
          </select>
        </label>
        {form.type === 'youtube-channel' && (
          <p className="notice">
            YouTube-Kanalquellen werden automatisch nach neuen Uploads gescannt und in „YouTube Videos“ übernommen.
            Erlaubt sind Kanal-URLs, @Handles oder direkte Channel-Feed-URLs.
          </p>
        )}
        <label>
          Sprache
          <input
            disabled={Boolean(formBusy)}
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          />
        </label>
        <label>
          Ressort
          <input
            disabled={Boolean(formBusy)}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          />
        </label>
        <label>
          Region
          <input
            disabled={Boolean(formBusy)}
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          />
        </label>
        <label>
          Beschreibung
          <input
            disabled={Boolean(formBusy)}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Vertrauen (0–100)
          <input
            type="number"
            min="0"
            max="100"
            disabled={Boolean(formBusy)}
            value={form.trustLevel}
            onChange={(e) => setForm({ ...form, trustLevel: Number(e.target.value) })}
          />
        </label>
        <label>
          Abrufintervall (Sekunden)
          <input
            type="number"
            min="300"
            max="86400"
            disabled={Boolean(formBusy)}
            value={form.fetchIntervalSeconds}
            onChange={(e) => setForm({ ...form, fetchIntervalSeconds: Number(e.target.value) })}
          />
        </label>
        <div className="source-form-actions">
          <button disabled={!writable || Boolean(formBusy)} onClick={() => void test()}>
            <FlaskConical size={17} /> Testen
          </button>
          <button disabled={!writable || Boolean(formBusy)} onClick={() => void suggestWithAi()}>
            <WandSparkles size={17} /> {formBusy === 'ai' ? 'KI prüft …' : 'KI-Zauberstab'}
          </button>
          <button className="primary-button" disabled={!writable || Boolean(formBusy)} onClick={() => void save()}>
            <Plus size={17} /> {formBusy === 'save' ? 'Wird angelegt …' : 'Anlegen'}
          </button>
        </div>
      </div>
      {msg && <p role="status">{msg}</p>}
      <div className="section-heading">
        <h3>Konfigurierte Quellen</h3>
        <span className="count-pill">{sources.length}</span>
      </div>
      {sources.length > 0 ? (
        <div className="source-grid">
          {sources.map((source) => {
            const working = workingSource === source.id;
            return (
              <article className="source-card" key={source.id}>
                <div>
                  <div className="card-header">
                    <h3>{source.name}</h3>
                    <span className={`state-pill ${source.active ? 'success' : 'warning'}`}>
                      {source.active ? <Wifi size={12} /> : <WifiOff size={12} />}
                      {source.active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </div>
                  <p className="card-meta">{source.url}</p>
                  <p className="muted">
                    {source.type === 'youtube-channel' ? 'YouTube-Kanal' : `Vertrauen ${source.trust_level}/100`} ·
                    Intervall {source.fetch_interval_seconds}s · maximal {source.max_articles}{' '}
                    {source.type === 'youtube-channel' ? 'Videos' : 'Beiträge'}
                  </p>
                </div>
                <div className="card-footer">
                  <span className={source.last_error ? 'error-text' : 'muted'}>
                    {source.last_error
                      ? `${source.last_error}${source.consecutive_errors ? ` · ${source.consecutive_errors} Fehler` : ''}`
                      : source.last_success_at
                        ? `Zuletzt erfolgreich ${new Date(source.last_success_at).toLocaleString('de-DE')}`
                        : 'Noch nicht abgerufen'}
                  </span>
                  <div className="toolbar">
                    <Link className="button" to={sourceHealthRoute({ source: source.id })}>
                      <Activity size={16} /> Monitor
                    </Link>
                    <button disabled={!can(user, 'sources:write') || working} onClick={() => void refresh(source)}>
                      <RotateCw size={16} /> Jetzt abrufen
                    </button>
                    <button disabled={!can(user, 'sources:write') || working} onClick={() => void toggle(source)}>
                      {source.active ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                      {source.active ? 'Pausieren' : 'Aktivieren'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <Rss size={24} />
            <p>Noch keine Quellen angelegt.</p>
          </div>
        </div>
      )}
    </section>
  );
}
