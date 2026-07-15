import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { ResourceError } from '../components/ResourceState.js';
import { Loading } from '../components/Status.js';
import { routes } from '../navigation.js';
import { ArticleDetailPage } from './ArticleDetailPage.js';
import type { SessionUser } from '../api/client.js';

export function ArticleDetailRoutePage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setState('loading');
    setMessage('');
    api(`/api/articles/${id}`)
      .then((article) => {
        if (!active) return;
        setState(article ? 'ready' : 'missing');
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : String(error));
        setState((error as { status?: number }).status === 404 ? 'missing' : 'error');
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (state === 'loading') return <Loading label="Nachricht wird geladen …" />;
  if (state === 'missing') {
    return (
      <ResourceError
        title="Nachricht nicht gefunden"
        message="Der Beitrag wurde gelöscht oder der aufgerufene Link ist ungültig."
        backTo={routes.articles}
        backLabel="Zurück zu Nachrichten"
      />
    );
  }
  if (state === 'error') {
    return (
      <ResourceError
        title="Nachricht konnte nicht geladen werden"
        message={message || 'Beim Laden des Beitrags ist ein unbekannter Fehler aufgetreten.'}
        backTo={routes.articles}
        backLabel="Zurück zu Nachrichten"
      />
    );
  }
  return <ArticleDetailPage user={user} />;
}
