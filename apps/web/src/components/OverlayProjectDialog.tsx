import React, { useEffect, useState } from 'react';
import { LayoutTemplate, Monitor, X } from 'lucide-react';

export type OverlayTemplateId =
  | 'main-news'
  | 'breaking-news'
  | 'lower-third'
  | 'ticker'
  | 'maintenance'
  | 'fullscreen-graphic'
  | 'live-studio';

export type OverlayProjectInput = {
  name: string;
  template: OverlayTemplateId;
  width: 1920 | 1080;
  height: 1080 | 1920;
};

export const overlayTemplates: Array<{
  id: OverlayTemplateId;
  label: string;
  description: string;
}> = [
  { id: 'main-news', label: 'Hauptnachrichten', description: 'Vollformat für Titel, Zusammenfassung und Quelle.' },
  { id: 'breaking-news', label: 'Eilmeldung', description: 'Aufmerksamkeitsstarkes Layout für aktuelle Meldungen.' },
  { id: 'lower-third', label: 'Bauchbinde', description: 'Kompakte Einblendung im unteren Bildbereich.' },
  { id: 'ticker', label: 'Laufband', description: 'Kontinuierlicher Nachrichtenticker am Bildrand.' },
  {
    id: 'fullscreen-graphic',
    label: 'Vollbildgrafik',
    description: 'Fläche für Zahlenkarten, Bilder und Erklärgrafiken.',
  },
  { id: 'live-studio', label: 'Live-Studio', description: 'Overlay für zugeschaltete Smartphone- und Webkameras.' },
  { id: 'maintenance', label: 'Pausenbild', description: 'Hinweisgrafik für Unterbrechungen und Wartung.' },
];

export function overlayTemplateLabel(template: string) {
  return overlayTemplates.find((item) => item.id === template)?.label ?? template;
}

type Props = {
  mode: 'create' | 'edit';
  busy?: boolean;
  error?: string;
  initial?: Partial<OverlayProjectInput>;
  onClose: () => void;
  onSubmit: (input: OverlayProjectInput) => void | Promise<void>;
};

const defaultInput: OverlayProjectInput = {
  name: '',
  template: 'main-news',
  width: 1920,
  height: 1080,
};

export function OverlayProjectDialog({ mode, busy = false, error = '', initial, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<OverlayProjectInput>({ ...defaultInput, ...initial });

  useEffect(() => {
    setForm({ ...defaultInput, ...initial });
  }, [initial?.name, initial?.template, initial?.width, initial?.height, mode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const valid = form.name.trim().length > 0 && form.name.trim().length <= 120;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="overlay-dialog-title">
      <form
        className="modal-card overlay-project-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !busy) void onSubmit({ ...form, name: form.name.trim() });
        }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Overlay-Projekt</p>
            <h3 id="overlay-dialog-title">
              <LayoutTemplate size={19} /> {mode === 'create' ? 'Neues Overlay anlegen' : 'Overlay-Einstellungen'}
            </h3>
          </div>
          <button type="button" className="ghost-button icon-button" onClick={onClose} aria-label="Schließen">
            <X size={17} />
          </button>
        </div>

        <label>
          Name des Overlays
          <input
            autoFocus
            maxLength={120}
            placeholder="z. B. Hauptnachrichten – Abend"
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
          />
          <small>{form.name.length}/120 Zeichen</small>
        </label>

        <fieldset className="overlay-template-picker" disabled={mode === 'edit'}>
          <legend>Vorlage</legend>
          <div className="overlay-template-options">
            {overlayTemplates.map((template) => (
              <label
                className={`overlay-template-option ${form.template === template.id ? 'selected' : ''}`}
                key={template.id}
              >
                <input
                  type="radio"
                  name="overlay-template"
                  checked={form.template === template.id}
                  onChange={() => setForm((value) => ({ ...value, template: template.id }))}
                />
                <span>
                  <strong>{template.label}</strong>
                  <small>{template.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="overlay-resolution-picker" disabled={mode === 'edit'}>
          <legend>Format</legend>
          <label className={form.width === 1920 ? 'selected' : ''}>
            <input
              type="radio"
              name="overlay-resolution"
              checked={form.width === 1920}
              onChange={() => setForm((value) => ({ ...value, width: 1920, height: 1080 }))}
            />
            <Monitor size={18} />
            <span>
              <strong>Querformat</strong>
              <small>1920 × 1080 · Standard für OBS</small>
            </span>
          </label>
          <label className={form.width === 1080 ? 'selected' : ''}>
            <input
              type="radio"
              name="overlay-resolution"
              checked={form.width === 1080}
              onChange={() => setForm((value) => ({ ...value, width: 1080, height: 1920 }))}
            />
            <Monitor className="portrait-monitor" size={18} />
            <span>
              <strong>Hochformat</strong>
              <small>1080 × 1920 · Shorts und vertikale Streams</small>
            </span>
          </label>
        </fieldset>

        {mode === 'edit' && (
          <p className="muted overlay-dialog-note">
            Vorlage und Format bleiben nach der Erstellung fest, damit veröffentlichte Versionen und OBS-Quellen
            kompatibel bleiben.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button className="primary-button" type="submit" disabled={!valid || busy}>
            {busy ? 'Speichert …' : mode === 'create' ? 'Overlay erstellen' : 'Änderungen speichern'}
          </button>
        </div>
      </form>
    </div>
  );
}
