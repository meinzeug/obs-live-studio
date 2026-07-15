import React from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function ResourceError({
  title,
  message,
  backTo,
  backLabel,
}: {
  title: string;
  message: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <section className="panel">
      <div className="status-message status-error" role="alert">
        <AlertTriangle size={20} />
        <div>
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
      </div>
      <Link className="button" to={backTo}>
        <ArrowLeft size={16} /> {backLabel}
      </Link>
    </section>
  );
}
