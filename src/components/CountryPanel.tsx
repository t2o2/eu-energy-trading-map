'use client';

import { AREA_BY_CODE, areaName } from '@/lib/domain/areas';
import {
  carbonIntensity,
  lowCarbonShare,
  PRODUCTION_TYPES,
  totalGeneration,
  type GridSnapshot,
  type ProductionType,
} from '@/lib/domain/types';
import { carbonColor, formatMw, FUEL_COLORS, FUEL_LABELS } from '@/lib/theme';

interface Props {
  snapshot: GridSnapshot;
  code: string;
  onClose: () => void;
}

export default function CountryPanel({ snapshot, code, onClose }: Props) {
  const area = snapshot.areas.find((a) => a.area === code);
  if (!area) return null;

  const meta = AREA_BY_CODE.get(code);
  const gen = totalGeneration(area);
  const ci = carbonIntensity(area);
  const clean = lowCarbonShare(area);

  const imports = snapshot.flows.filter((f) => f.to === code);
  const exports = snapshot.flows.filter((f) => f.from === code);
  const importMw = imports.reduce((a, f) => a + f.netMw, 0);
  const exportMw = exports.reduce((a, f) => a + f.netMw, 0);
  const netImport = importMw - exportMw;

  const rows = PRODUCTION_TYPES.map((t) => ({ type: t, mw: area.generation[t] ?? 0 }))
    .filter((r) => r.mw > 0)
    .sort((a, b) => b.mw - a.mw);

  const localTime = meta
    ? new Date(snapshot.timestamp).toLocaleTimeString('en-GB', {
        timeZone: meta.tz,
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <aside className="pointer-events-auto absolute right-0 top-0 z-20 flex h-full w-[360px] max-w-[92vw] flex-col overflow-y-auto border-l border-white/10 bg-[#0d1017]/95 backdrop-blur">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-[#0d1017]/95 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{areaName(code)}</h2>
          {localTime && (
            <p className="text-xs text-white/45">Local time {localTime}</p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="rounded px-2 py-1 text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </header>

      <div className="grid grid-cols-3 gap-px bg-white/10">
        <Stat label="Generation" value={formatMw(gen)} />
        <Stat label="Load" value={area.load !== null ? formatMw(area.load) : '—'} />
        <Stat
          label={netImport >= 0 ? 'Net import' : 'Net export'}
          value={formatMw(Math.abs(netImport))}
          tone={netImport >= 0 ? 'import' : 'export'}
        />
      </div>

      <section className="px-5 py-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-white/45">
            Carbon intensity
          </h3>
          {area.price !== null && (
            <span className="text-xs text-white/45 tabular-nums">
              {area.price.toFixed(1)} €/MWh
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ background: carbonColor(ci) }}
          />
          <span className="text-2xl font-semibold tabular-nums text-white">
            {ci !== null ? Math.round(ci) : '—'}
          </span>
          <span className="text-xs text-white/45">gCO₂eq/kWh</span>
          {clean !== null && (
            <span className="ml-auto text-xs text-emerald-300 tabular-nums">
              {Math.round(clean * 100)}% low-carbon
            </span>
          )}
        </div>
      </section>

      <section className="px-5 pb-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/45">
          Generation mix
        </h3>

        <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
          {rows.map((r) => (
            <div
              key={r.type}
              title={`${FUEL_LABELS[r.type]} ${formatMw(r.mw)}`}
              style={{ width: `${(r.mw / gen) * 100}%`, background: FUEL_COLORS[r.type] }}
            />
          ))}
        </div>

        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.type} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: FUEL_COLORS[r.type as ProductionType] }}
              />
              <span className="text-white/75">{FUEL_LABELS[r.type]}</span>
              <span className="ml-auto tabular-nums text-white/90">{formatMw(r.mw)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-white/40">
                {Math.round((r.mw / gen) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-white/10 px-5 py-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-white/45">
          Cross-border flows
        </h3>

        <FlowList title="Importing from" tone="import" items={imports.map((f) => ({ other: f.from, mw: f.netMw }))} />
        <FlowList title="Exporting to" tone="export" items={exports.map((f) => ({ other: f.to, mw: f.netMw }))} />
      </section>
    </aside>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'import' | 'export';
}) {
  const color =
    tone === 'import' ? 'text-sky-300' : tone === 'export' ? 'text-amber-300' : 'text-white';
  return (
    <div className="bg-[#0d1017] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 text-base font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function FlowList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'import' | 'export';
  items: { other: string; mw: number }[];
}) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.mw - a.mw);
  const max = sorted[0].mw;
  const color = tone === 'import' ? 'bg-sky-400/70' : 'bg-amber-400/70';

  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-[11px] text-white/40">{title}</div>
      <ul className="space-y-1">
        {sorted.map((i) => (
          <li key={i.other} className="flex items-center gap-2 text-sm">
            <span className="w-32 shrink-0 truncate text-white/75">{areaName(i.other)}</span>
            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${color}`}
                style={{ width: `${(i.mw / max) * 100}%` }}
              />
            </span>
            <span className="w-16 text-right tabular-nums text-white/85">{formatMw(i.mw)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
