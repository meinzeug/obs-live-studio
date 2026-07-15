import React from 'react';
import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { routes } from '../routes.js';

export function NotFoundPage() {
  const location = useLocation();
  return (
    <section className="panel not-found-page" aria-labelledby="not-found-title">
      <div className="not-found-icon" aria-hidden="true">
        <SearchX size={32} />
      </div>
      <p className="eyebrow">Navigation</p>
      <h2 id="not-found-title">Seite nicht gefunden</h2>
      <p>
        Der Pfad <code>{location.pathname}</code> gehört zu keinem aktiven Modul. Die Anwendung leitet unbekannte URLs
        nicht mehr still auf das Dashboard um.
      </p>
      <div className="toolbar">
        <button type="button" onClick={() => window.history.back()}>
          <ArrowLeft size={17} /> Zurück
        </button>
        <Link className="button primary-button" to={routes.dashboard}>
          <LayoutDashboard size={17} /> Dashboard öffnen
        </Link>
      </div>
    </section>
  );
}
