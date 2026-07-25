import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  LayoutTemplate,
  Plus,
  Printer,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, can, type SessionUser } from '../api/client.js';

type MaterialFormat = {
  label: string;
  width: number;
  height: number;
  dpi: number;
};

type MaterialExport = {
  id: string;
  export_type: 'png' | 'pdf' | 'jpeg';
  format_preset: string;
  width_px: number;
  height_px: number;
  dpi: number;
  size_bytes: number;
  created_at: string;
};

type MaterialProject = {
  id: string;
  campaign_id: string | null;
  campaign_name?: string | null;
  name: string;
  material_kind: MaterialDraft['materialKind'];
  format_preset: MaterialDraft['formatPreset'];
  orientation: MaterialDraft['orientation'];
  visual_style: MaterialDraft['visualStyle'];
  headline: string;
  body: string;
  call_to_action: string;
  website: string;
  advertiser: string;
  primary_color: string;
  accent_color: string;
  text_color: string;
  background_mode: MaterialDraft['backgroundMode'];
  status: 'draft' | 'ready';
  exports: MaterialExport[];
  updated_at: string;
};

type MaterialDashboard = {
  projects: MaterialProject[];
  campaigns: Array<{ id: string; name: string; advertiser: string; status: string }>;
  formats: Record<MaterialDraft['formatPreset'], MaterialFormat>;
};

type MaterialDraft = {
  id: string | null;
  campaignId: string | null;
  name: string;
  materialKind: 'flyer' | 'poster' | 'social' | 'tshirt' | 'card';
  formatPreset: 'a6' | 'a5' | 'a4' | 'a3' | 'square' | 'story' | 'tshirt';
  orientation: 'portrait' | 'landscape';
  visualStyle: 'broadcast' | 'editorial' | 'bold' | 'minimal' | 'community';
  headline: string;
  body: string;
  callToAction: string;
  website: string;
  advertiser: string;
  primaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundMode: 'gradient' | 'dark' | 'light' | 'accent';
  design: Record<string, unknown>;
  status: 'draft' | 'ready';
};

const defaultDraft: MaterialDraft = {
  id: null,
  campaignId: null,
  name: 'Neues Werbematerial',
  materialKind: 'flyer',
  formatPreset: 'a5',
  orientation: 'portrait',
  visualStyle: 'broadcast',
  headline: 'Deine Botschaft. Klar auf den Punkt.',
  body: 'Erstelle druckfertige Flyer, Poster, Social-Motive und Textildrucke direkt aus dem Open TV Studio.',
  callToAction: 'Jetzt mitmachen',
  website: 'zeitkante.de',
  advertiser: 'ZEITKANTE',
  primaryColor: '#07111f',
  accentColor: '#22d3ee',
  textColor: '#f8fafc',
  backgroundMode: 'gradient',
  design: {},
  status: 'draft',
};

const formatOrder: MaterialDraft['formatPreset'][] = ['a6', 'a5', 'a4', 'a3', 'square', 'story', 'tshirt'];
const styleOptions: Array<{ id: MaterialDraft['visualStyle']; label: string; description: string }> = [
  { id: 'broadcast', label: 'Broadcast', description: 'Dynamisch, digital und sendertypisch' },
  { id: 'editorial', label: 'Editorial', description: 'Ruhig und magazinartig' },
  { id: 'bold', label: 'Plakativ', description: 'Maximale Fernwirkung' },
  { id: 'minimal', label: 'Minimal', description: 'Reduziert und hochwertig' },
  { id: 'community', label: 'Community', description: 'Offen, nahbar und aktivierend' },
];

function projectToDraft(project: MaterialProject): MaterialDraft {
  return {
    id: project.id,
    campaignId: project.campaign_id,
    name: project.name,
    materialKind: project.material_kind,
    formatPreset: project.format_preset,
    orientation: project.orientation,
    visualStyle: project.visual_style,
    headline: project.headline,
    body: project.body,
    callToAction: project.call_to_action,
    website: project.website,
    advertiser: project.advertiser,
    primaryColor: project.primary_color,
    accentColor: project.accent_color,
    textColor: project.text_color,
    backgroundMode: project.background_mode,
    design: {},
    status: project.status,
  };
}

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AdvertisingMaterialsPage({ user }: { user: SessionUser }) {
  const [dashboard, setDashboard] = useState<MaterialDashboard | null>(null);
  const [draft, setDraft] = useState<MaterialDraft>(defaultDraft);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const allowed = can(user, 'broadcast:write');
  const selected = dashboard?.projects.find((project) => project.id === draft.id) ?? null;
  const format = dashboard?.formats[draft.formatPreset];

  async function load(selectId?: string | null) {
    try {
      const next = await api<MaterialDashboard>('/api/advertising-materials');
      setDashboard(next);
      const project = next.projects.find((item) => item.id === (selectId ?? draft.id));
      if (project) setDraft(projectToDraft(project));
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy('save');
    setMessage('');
    setError('');
    try {
      const body = JSON.stringify({
        campaignId: draft.campaignId,
        name: draft.name,
        materialKind: draft.materialKind,
        formatPreset: draft.formatPreset,
        orientation: draft.orientation,
        visualStyle: draft.visualStyle,
        headline: draft.headline,
        body: draft.body,
        callToAction: draft.callToAction,
        website: draft.website,
        advertiser: draft.advertiser,
        primaryColor: draft.primaryColor,
        accentColor: draft.accentColor,
        textColor: draft.textColor,
        backgroundMode: draft.backgroundMode,
        design: draft.design,
        status: draft.status,
      });
      const saved = await api<MaterialProject>(
        draft.id ? `/api/advertising-materials/${draft.id}` : '/api/advertising-materials',
        { method: draft.id ? 'PUT' : 'POST', body },
      );
      setDraft(projectToDraft(saved));
      setMessage(draft.id ? 'Werbematerial gespeichert.' : 'Werbematerial-Projekt erstellt.');
      await load(saved.id);
      return saved;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function render(exportType: 'pdf' | 'png' | 'jpeg') {
    const project = await save();
    if (!project) return;
    setBusy(`render-${exportType}`);
    setMessage('');
    try {
      const item = await api<MaterialExport & { downloadUrl: string }>(
        `/api/advertising-materials/${project.id}/render`,
        { method: 'POST', body: JSON.stringify({ exportType }) },
      );
      setMessage(`${exportType.toUpperCase()} wurde druckfertig gerendert.`);
      await load(project.id);
      window.location.assign(item.downloadUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy('');
    }
  }

  const previewStyle = useMemo(
    () =>
      ({
        '--material-primary': draft.backgroundMode === 'light' ? '#eef5f7' : draft.primaryColor,
        '--material-accent': draft.accentColor,
        '--material-text': draft.backgroundMode === 'light' ? '#07111f' : draft.textColor,
        '--material-ratio':
          format && draft.orientation === 'landscape' && !['story', 'tshirt'].includes(draft.formatPreset)
            ? `${format.height} / ${format.width}`
            : format
              ? `${format.width} / ${format.height}`
              : '1 / 1.414',
      }) as React.CSSProperties,
    [draft, format],
  );

  return (
    <main className="page advertising-materials-page">
      <section className="materials-hero">
        <div>
          <p className="eyebrow">Werbung · Designwerkstatt</p>
          <h1>Werbematerial</h1>
          <p>
            Druckfertige Flyer, Poster, Social-Motive und Textildrucke aus Kampagnen erstellen – mit Vorschau und
            Export in 300 DPI.
          </p>
        </div>
        <div className="materials-hero-actions">
          <button onClick={() => void load()} disabled={Boolean(busy)}>
            <RefreshCw size={16} /> Aktualisieren
          </button>
          <button className="primary-button" onClick={() => setDraft({ ...defaultDraft })}>
            <Plus size={17} /> Neues Motiv
          </button>
        </div>
      </section>

      {(message || error) && (
        <p className={`status-message ${error ? 'status-error' : 'status-ok'}`}>{error || message}</p>
      )}

      <section className="materials-workbench">
        <aside className="materials-project-rail">
          <div className="panel-heading">
            <h2>Projekte</h2>
            <span className="state-pill">{dashboard?.projects.length ?? 0}</span>
          </div>
          <div className="materials-project-list">
            {(dashboard?.projects ?? []).map((project) => (
              <button
                key={project.id}
                className={draft.id === project.id ? 'active' : ''}
                onClick={() => setDraft(projectToDraft(project))}
              >
                {project.material_kind === 'tshirt' ? <Shirt size={19} /> : <FileImage size={19} />}
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.format_preset.toUpperCase()} · {project.exports.length} Exporte
                  </small>
                </span>
              </button>
            ))}
            {!dashboard?.projects.length && <p className="muted">Noch kein Werbematerial angelegt.</p>}
          </div>
        </aside>

        <section className="materials-editor">
          <div className="materials-editor-title">
            <div>
              <p className="eyebrow">Motiv gestalten</p>
              <h2>{draft.name}</h2>
            </div>
            <span className="state-pill">{draft.id ? draft.status : 'Neu'}</span>
          </div>

          <div className="materials-editor-grid">
            <div className="materials-form">
              <label>
                <span>Projektname</span>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </label>
              <label>
                <span>Kampagne übernehmen</span>
                <select
                  value={draft.campaignId ?? ''}
                  onChange={(event) => {
                    const campaign = dashboard?.campaigns.find((item) => item.id === event.target.value);
                    setDraft({
                      ...draft,
                      campaignId: event.target.value || null,
                      advertiser: campaign?.advertiser || draft.advertiser,
                    });
                  }}
                >
                  <option value="">Ohne Kampagnenbindung</option>
                  {(dashboard?.campaigns ?? []).map((campaign) => (
                    <option key={campaign.id} value={campaign.id}>
                      {campaign.name} · {campaign.status}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="materials-format-picker">
                <legend>Ausgabeformat</legend>
                {formatOrder.map((formatId) => {
                  const option = dashboard?.formats[formatId];
                  return (
                    <button
                      type="button"
                      key={formatId}
                      className={draft.formatPreset === formatId ? 'active' : ''}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          formatPreset: formatId,
                          materialKind:
                            formatId === 'tshirt'
                              ? 'tshirt'
                              : formatId === 'square' || formatId === 'story'
                                ? 'social'
                                : formatId === 'a3' || formatId === 'a4'
                                  ? 'poster'
                                  : 'flyer',
                        })
                      }
                    >
                      {formatId === 'tshirt' ? <Shirt size={18} /> : <LayoutTemplate size={18} />}
                      <strong>{option?.label ?? formatId.toUpperCase()}</strong>
                      <small>
                        {option?.width} × {option?.height}
                      </small>
                    </button>
                  );
                })}
              </fieldset>

              {!['story', 'tshirt'].includes(draft.formatPreset) && (
                <div className="materials-segmented">
                  <button
                    type="button"
                    className={draft.orientation === 'portrait' ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, orientation: 'portrait' })}
                  >
                    Hochformat
                  </button>
                  <button
                    type="button"
                    className={draft.orientation === 'landscape' ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, orientation: 'landscape' })}
                  >
                    Querformat
                  </button>
                </div>
              )}

              <label className="materials-wide">
                <span>Überschrift</span>
                <textarea
                  rows={2}
                  value={draft.headline}
                  onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                />
              </label>
              <label className="materials-wide">
                <span>Informationstext</span>
                <textarea
                  rows={4}
                  value={draft.body}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                />
              </label>
              <label>
                <span>Handlungsaufforderung</span>
                <input
                  value={draft.callToAction}
                  onChange={(event) => setDraft({ ...draft, callToAction: event.target.value })}
                />
              </label>
              <label>
                <span>Webseite / Kontakt</span>
                <input value={draft.website} onChange={(event) => setDraft({ ...draft, website: event.target.value })} />
              </label>
              <label>
                <span>Absender</span>
                <input
                  value={draft.advertiser}
                  onChange={(event) => setDraft({ ...draft, advertiser: event.target.value })}
                />
              </label>
              <label>
                <span>Hintergrund</span>
                <select
                  value={draft.backgroundMode}
                  onChange={(event) =>
                    setDraft({ ...draft, backgroundMode: event.target.value as MaterialDraft['backgroundMode'] })
                  }
                >
                  <option value="gradient">Studio-Verlauf</option>
                  <option value="dark">Dunkel</option>
                  <option value="light">Hell</option>
                  <option value="accent">Akzentfläche</option>
                </select>
              </label>

              <fieldset className="materials-style-picker materials-wide">
                <legend>Designstil</legend>
                {styleOptions.map((style) => (
                  <button
                    type="button"
                    key={style.id}
                    className={draft.visualStyle === style.id ? 'active' : ''}
                    onClick={() => setDraft({ ...draft, visualStyle: style.id })}
                  >
                    <Sparkles size={16} />
                    <span>
                      <strong>{style.label}</strong>
                      <small>{style.description}</small>
                    </span>
                  </button>
                ))}
              </fieldset>

              <div className="materials-colors materials-wide">
                {[
                  ['primaryColor', 'Grundfarbe'],
                  ['accentColor', 'Akzent'],
                  ['textColor', 'Text'],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}</span>
                    <input
                      type="color"
                      value={String(draft[key as keyof MaterialDraft])}
                      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
            </div>

            <aside className="materials-preview-pane">
              <div className={`material-preview style-${draft.visualStyle}`} style={previewStyle}>
                <div className="material-preview-border" />
                <div className="material-preview-kicker">OPEN TV STUDIO · LIVE · DIGITAL</div>
                <div className="material-preview-advertiser">{draft.advertiser || 'ZEITKANTE'}</div>
                <h3>{draft.headline || 'Überschrift'}</h3>
                <p>{draft.body}</p>
                {draft.callToAction && <strong className="material-preview-cta">{draft.callToAction}</strong>}
                <footer>{draft.website}</footer>
              </div>
              <div className="materials-output-meta">
                <span>
                  <Printer size={15} /> {format?.dpi ?? 300} DPI
                </span>
                <span>
                  {format?.width ?? 0} × {format?.height ?? 0} px
                </span>
                <span>Beschnittsicherer Innenrahmen</span>
              </div>
              <div className="materials-export-actions">
                <button disabled={!allowed || Boolean(busy)} onClick={() => void save()}>
                  <CheckCircle2 size={16} /> Speichern
                </button>
                <button disabled={!allowed || Boolean(busy)} onClick={() => void render('png')}>
                  <FileImage size={16} /> PNG
                </button>
                <button className="primary-button" disabled={!allowed || Boolean(busy)} onClick={() => void render('pdf')}>
                  <FileText size={16} /> Druck-PDF
                </button>
              </div>
            </aside>
          </div>

          {draft.id && (
            <section className="materials-export-history">
              <div className="panel-heading">
                <h3>Letzte Exporte</h3>
                <span className="state-pill">{selected?.exports.length ?? 0}</span>
              </div>
              <div>
                {(selected?.exports ?? []).slice(0, 8).map((item) => (
                  <a key={item.id} href={`/api/advertising-materials/exports/${item.id}`}>
                    {item.export_type === 'pdf' ? <FileText size={17} /> : <FileImage size={17} />}
                    <span>
                      <strong>{item.export_type.toUpperCase()} · {item.format_preset.toUpperCase()}</strong>
                      <small>
                        {item.width_px} × {item.height_px} · {sizeLabel(item.size_bytes)} ·{' '}
                        {new Date(item.created_at).toLocaleString('de-DE')}
                      </small>
                    </span>
                    <Download size={16} />
                  </a>
                ))}
              </div>
            </section>
          )}

          {draft.id && (
            <div className="materials-delete-row">
              <button
                className="danger"
                disabled={!allowed || Boolean(busy)}
                onClick={() => {
                  if (!window.confirm(`„${draft.name}“ archivieren?`)) return;
                  setBusy('delete');
                  void api(`/api/advertising-materials/${draft.id}`, { method: 'DELETE' })
                    .then(async () => {
                      setDraft({ ...defaultDraft });
                      await load(null);
                    })
                    .catch((requestError) =>
                      setError(requestError instanceof Error ? requestError.message : String(requestError)),
                    )
                    .finally(() => setBusy(''));
                }}
              >
                <Trash2 size={16} /> Projekt archivieren
              </button>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
