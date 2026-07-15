import React from 'react';
import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { routes } from '../navigation.js';

export function NotFoundPage() {
  const location = useLocation();

  return (
    <section className="panel not-found-page">
      <div className="not-found-icon" aria-hidden="true">
        <SearchX size={28} />
      </div>
      <p className="eyebrow">Navigation</p>
      <h2>Seite nicht gefunden</h2>
      <p>
        Für <code>{location.pathname}</code> gibt es kein Modul. Der Pfad wurde nicht automatisch umgeleitet, damit
        fehlerhafte Verlinkungen sichtbar bleiben.
      </p>
      <div className="toolbar">
        <Link className="button primary-button" to={routes.dashboard}>
          <LayoutDashboard size={17} /> Dashboard öffnen
        </Link>
        <button className="ghost-button" type="button" onClick={() => window.history.back()}>
          <ArrowLeft size={17} /> Zurück
        </button>
      </div>
    </section>
  );
}
