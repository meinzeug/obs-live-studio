import React from 'react';
import { can, type SessionUser } from '../api/client.js';
import { Forbidden } from '../components/Status.js';
export function AdminUsersPage({ user }: { user: SessionUser }) {
  return (
    <section className="panel">
      <h2>Benutzer</h2>
      {!can(user, 'admin:write') && <Forbidden />}
      <p>
        Administration mit letztem-Admin-Schutz erfolgt serverseitig. Benutzeranlage, Rollen, Sessions und
        Passwort-Reset sind für API-Erweiterungen vorbereitet.
      </p>
    </section>
  );
}
