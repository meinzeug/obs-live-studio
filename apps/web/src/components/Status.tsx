import React from 'react';
import { AlertTriangle, LoaderCircle, LockKeyhole } from 'lucide-react';
export function Loading({ label = 'Lade Daten …' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={20} className="spin" />
      {label}
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="status-message status-error" role="alert">
      <AlertTriangle size={20} />
      <div>
        <strong>Fehler</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
export function Forbidden({ label = 'Keine Berechtigung für diese Aktion.' }: { label?: string }) {
  return (
    <div className="status-message status-warn">
      <LockKeyhole size={20} />
      <div>
        <strong>Nur Lesen</strong>
        <p>{label}</p>
      </div>
    </div>
  );
}
