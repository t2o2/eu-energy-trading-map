import type { ProductionType } from './domain/types';

/** Fuel colours, roughly aligned with ENTSO-E's own palette conventions. */
export const FUEL_COLORS: Record<ProductionType, string> = {
  nuclear: '#e5567a',
  hydro: '#2a7fd4',
  pumpedStorage: '#5aa9e6',
  wind: '#3fc1a0',
  solar: '#f2c14e',
  biomass: '#77a34a',
  geothermal: '#c17f4a',
  waste: '#8f7a66',
  gas: '#e08b3f',
  coal: '#5c5148',
  lignite: '#7d6b56',
  oil: '#4a4a4a',
  other: '#8a8a8a',
};

export const FUEL_LABELS: Record<ProductionType, string> = {
  nuclear: 'Nuclear',
  hydro: 'Hydro',
  pumpedStorage: 'Pumped storage',
  wind: 'Wind',
  solar: 'Solar',
  biomass: 'Biomass',
  geothermal: 'Geothermal',
  waste: 'Waste',
  gas: 'Gas',
  coal: 'Hard coal',
  lignite: 'Lignite',
  oil: 'Oil',
  other: 'Other',
};

/**
 * Carbon intensity ramp, green (clean) to red (dirty), in gCO2eq/kWh.
 * Stops chosen so a typical French hour reads deep green and a Polish hour
 * reads deep red.
 */
export const CARBON_STOPS: [number, string][] = [
  [0, '#1a9850'],
  [100, '#66bd63'],
  [200, '#a6d96a'],
  [350, '#fee08b'],
  [500, '#fdae61'],
  [700, '#f46d43'],
  [900, '#d73027'],
];

export function carbonColor(gPerKwh: number | null): string {
  if (gPerKwh === null) return '#3a3f4a';
  let color = CARBON_STOPS[0][1];
  for (const [stop, c] of CARBON_STOPS) {
    if (gPerKwh >= stop) color = c;
  }
  return color;
}

export function formatMw(mw: number): string {
  if (Math.abs(mw) >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw)} MW`;
}
