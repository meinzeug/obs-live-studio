import React from 'react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export type DashboardTone = 'cyan' | 'green' | 'amber' | 'red' | 'violet' | 'slate';

export function SignalPill({
  tone = 'slate',
  pulse = false,
  children,
}: {
  tone?: DashboardTone;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`control-signal-pill ${tone} ${pulse ? 'pulse' : ''}`}>
      <i />
      {children}
    </span>
  );
}

export function ControlMetric({
  icon: Icon,
  eyebrow,
  value,
  detail,
  tone = 'slate',
  to,
}: {
  icon: LucideIcon;
  eyebrow: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  tone?: DashboardTone;
  to: string;
}) {
  return (
    <Link className={`control-metric ${tone}`} to={to}>
      <span className="control-metric-icon">
        <Icon size={20} />
      </span>
      <span className="control-metric-copy">
        <small>{eyebrow}</small>
        <strong>{value}</strong>
        <span>{detail}</span>
      </span>
      <ArrowUpRight className="control-metric-open" size={15} />
    </Link>
  );
}

export function ResourceDial({
  label,
  value,
  detail,
  history = [],
}: {
  label: string;
  value: number | null;
  detail: string;
  history?: number[];
}) {
  const normalized = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, Math.round(value)));
  const tone = normalized == null ? 'slate' : normalized >= 90 ? 'red' : normalized >= 75 ? 'amber' : 'cyan';
  return (
    <div className={`control-resource ${tone}`}>
      <span
        className="control-resource-ring"
        style={{ '--resource-value': `${normalized ?? 0}%` } as React.CSSProperties}
      >
        {normalized == null ? '–' : `${normalized}%`}
      </span>
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
        <Sparkline values={history} label={`${label}-Verlauf`} />
      </span>
    </div>
  );
}

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const safeValues = values.filter(Number.isFinite).slice(-36);
  if (safeValues.length < 2) return <span className="control-sparkline-placeholder" aria-hidden="true" />;
  const minimum = Math.min(...safeValues);
  const maximum = Math.max(...safeValues);
  const range = Math.max(1, maximum - minimum);
  const points = safeValues
    .map((value, index) => {
      const x = (index / Math.max(1, safeValues.length - 1)) * 100;
      const y = 27 - ((value - minimum) / range) * 23;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="control-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={points} />
    </svg>
  );
}

export function formatClock(milliseconds: number | null | undefined) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds ?? 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .filter((_, index) => hours > 0 || index > 0)
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

export function itemTitle(item: { title?: string; rules?: Record<string, unknown> } | null | undefined) {
  return String(item?.rules?.title ?? item?.title ?? '').trim() || 'Unbenannter Beitrag';
}
