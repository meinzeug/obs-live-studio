import React from 'react';
export function Loading({ label = 'Lade Daten …' }: { label?: string }) {
  return <div className="panel muted">{label}</div>;
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="panel error">
      <b>Fehler</b>
      <p>{message}</p>
    </div>
  );
}
export function Forbidden({ label = 'Keine Berechtigung für diese Aktion.' }: { label?: string }) {
  return (
    <div className="panel warn">
      <b>Nur Lesen</b>
      <p>{label}</p>
    </div>
  );
}
