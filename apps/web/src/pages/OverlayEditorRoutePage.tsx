import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type SessionUser } from '../api/client.js';
import { ResourceError } from '../components/ResourceState.js';
import { Loading } from '../components/Status.js';
import { routes } from '../navigation.js';
import { isResourceId } from '../resource-id.js';
import { OverlayEditorPage } from './OverlayEditorPage.js';

export function OverlayEditorRoutePage({ user }: { user: SessionUser }) {
  const { id } = useParams();
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setMessage('');
    if (!isResourceId(id)) {
      setState('missing');
      return () => {
        active = false;
      };
    }
    setState('loading');
    api<{ project?: unknown }>(`/api/overlays/${id}`)
      .then((result) => {
        if (!active) return;
        setState(result?.project ? 'ready' : 'missing');
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

  if (state === 'loading') return <Loading label="Overlay wird geladen …" />;
  if (state === 'missing') {
    return (
      <ResourceError
        title="Overlay nicht gefunden"
        message="Das Overlay wurde gelöscht oder der aufgerufene Link ist ungültig."
        backTo={routes.overlays}
        backLabel="Zurück zu Overlays"
      />
    );
  }
  if (state === 'error') {
    return (
      <ResourceError
        title="Overlay konnte nicht geladen werden"
        message={message || 'Beim Laden des Overlays ist ein unbekannter Fehler aufgetreten.'}
        backTo={routes.overlays}
        backLabel="Zurück zu Overlays"
      />
    );
  }
  return <OverlayEditorPage user={user} />;
}
