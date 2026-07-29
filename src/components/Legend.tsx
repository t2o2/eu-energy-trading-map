'use client';

import { CARBON_STOPS } from '@/lib/theme';

export default function Legend({ source }: { source: 'mock' | 'entsoe' }) {
  return (
    <div className="pointer-events-auto absolute bottom-6 left-5 z-20 w-60 rounded-lg border border-white/10 bg-[#0d1017]/90 p-3 text-xs backdrop-blur">
      <div className="mb-1 font-medium text-white/70">Carbon intensity</div>
      <div className="flex h-2 overflow-hidden rounded-full">
        {CARBON_STOPS.map(([stop, color]) => (
          <div key={stop} className="flex-1" style={{ background: color }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-white/40">
        <span>0</span>
        <span>gCO₂eq/kWh</span>
        <span>900+</span>
      </div>

      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1.5 font-medium text-white/70">Flows</div>
        <div className="flex items-center gap-2 text-white/55">
          <span className="h-0.5 w-6 rounded bg-[#ffd980]" />
          <span>Land border</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-white/55">
          <span className="h-0.5 w-6 rounded bg-[#7fd8ff]" />
          <span>Subsea cable</span>
        </div>
        <div className="mt-1.5 text-[10px] text-white/35">
          Arrow length and thickness scale with MW. Pulses show direction.
        </div>
      </div>

      {source === 'mock' && (
        <div className="mt-3 rounded border border-amber-400/25 bg-amber-400/10 px-2 py-1.5 text-[10px] leading-snug text-amber-200/90">
          Simulated data. Set <code className="text-amber-100">ENTSOE_TOKEN</code> to switch to live
          ENTSO-E figures.
        </div>
      )}
    </div>
  );
}
