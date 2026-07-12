import React from 'react';
export function AdminAuditPage() {
  return (
    <section className="panel">
      <h2>Audit-Log</h2>
      <input placeholder="Volltextsuche" />
      <p>Schreibende Aktionen werden als strukturierte Live-/Audit-Ereignisse persistiert.</p>
    </section>
  );
}
