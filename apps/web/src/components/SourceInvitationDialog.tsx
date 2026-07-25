import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Link2, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '../api/client.js';

type Invitation = {
  id: string;
  displayName: string;
  showTitle: string;
  sourceName: string;
  expiresAt: string;
  acceptedAt?: string | null;
  sourceId?: string | null;
  status: 'open' | 'accepted' | 'expired' | 'revoked';
  createdAt: string;
  invitationUrl?: string;
};

const statusText = {
  open: 'Offen',
  accepted: 'Angenommen',
  expired: 'Abgelaufen',
  revoked: 'Widerrufen',
};

export function SourceInvitationDialog({ onClose, onUpdated }: { onClose: () => void; onUpdated: () => void }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [showTitle, setShowTitle] = useState('Live-Zuschaltung');
  const [sourceName, setSourceName] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(48);
  const [createdUrl, setCreatedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api<{ invitations: Invitation[] }>('/api/live/invitations');
      setInvitations(result.invitations);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }, []);

  useEffect(() => {
    void load();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [load, onClose]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(createdUrl);
    } catch {
      setError('Der Link konnte nicht in die Zwischenablage kopiert werden.');
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!displayName.trim() || !showTitle.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const invitation = await api<Invitation>('/api/live/invitations', {
        method: 'POST',
        body: JSON.stringify({
          displayName: displayName.trim(),
          showTitle: showTitle.trim(),
          sourceName: sourceName.trim() || undefined,
          expiresInHours,
        }),
      });
      setCreatedUrl(invitation.invitationUrl ?? '');
      setDisplayName('');
      setSourceName('');
      await load();
      onUpdated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(invitation: Invitation) {
    if (
      busy ||
      !window.confirm(`Einladung für „${invitation.displayName}“ wirklich widerrufen? Der Link wird sofort ungültig.`)
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/api/live/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="source-invite-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-invite-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Zuschaltung vorbereiten</p>
            <h2 id="source-invite-title"><UserPlus size={20} /> Gast einladen</h2>
            <span>Erstellt einen einmaligen, zeitlich begrenzten Zugang samt Live-Quelle.</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Einladungen schließen"><X size={18} /></button>
        </header>

        <form className="source-invite-form" onSubmit={create}>
          <label>
            Name des Gastes
            <input
              autoFocus
              required
              minLength={2}
              maxLength={120}
              value={displayName}
              placeholder="z. B. Reporterin Rathaus"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            Sendung / Anlass
            <input
              required
              minLength={2}
              maxLength={160}
              value={showTitle}
              onChange={(event) => setShowTitle(event.target.value)}
            />
          </label>
          <label>
            Quellenname (optional)
            <input
              maxLength={120}
              value={sourceName}
              placeholder="wird sonst automatisch erzeugt"
              onChange={(event) => setSourceName(event.target.value)}
            />
          </label>
          <label>
            Link gültig
            <select value={expiresInHours} onChange={(event) => setExpiresInHours(Number(event.target.value))}>
              <option value={2}>2 Stunden</option>
              <option value={12}>12 Stunden</option>
              <option value={48}>2 Tage</option>
              <option value={168}>7 Tage</option>
            </select>
          </label>
          <button className="primary-button" disabled={busy || !displayName.trim() || !showTitle.trim()}>
            <Link2 size={15} /> {busy ? 'Wird erstellt …' : 'Sicheren Link erstellen'}
          </button>
        </form>

        {createdUrl && (
          <div className="source-invite-result">
            <CheckCircle2 size={19} />
            <div>
              <strong>Einladungslink ist bereit</strong>
              <small>Aus Sicherheitsgründen wird dieser geheime Link nur jetzt vollständig angezeigt.</small>
              <input readOnly value={createdUrl} onFocus={(event) => event.currentTarget.select()} />
            </div>
            <button onClick={() => void copyUrl()}><Copy size={15} /> Kopieren</button>
          </div>
        )}

        {error && <p className="source-chat-error">{error}</p>}

        <div className="source-invite-list">
          <strong>Letzte Einladungen</strong>
          {!invitations.length && <p className="muted">Noch keine Einladungen vorhanden.</p>}
          {invitations.map((invitation) => (
            <article key={invitation.id}>
              <span className={`source-invite-status ${invitation.status}`}>{statusText[invitation.status]}</span>
              <div>
                <strong>{invitation.displayName}</strong>
                <small>{invitation.sourceName} · bis {new Date(invitation.expiresAt).toLocaleString('de-DE')}</small>
              </div>
              {invitation.status === 'open' && (
                <button
                  className="danger"
                  disabled={busy}
                  title="Einladung widerrufen"
                  onClick={() => void revoke(invitation)}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
