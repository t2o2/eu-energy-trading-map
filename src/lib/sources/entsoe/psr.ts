import type { ProductionType } from '../../domain/types';

/** ENTSO-E PsrType (B01-B25) mapped onto our display categories. */
export const PSR_TO_PRODUCTION: Record<string, ProductionType> = {
  B01: 'biomass',
  B02: 'lignite', // Fossil Brown coal/Lignite
  B03: 'gas', // Fossil Coal-derived gas
  B04: 'gas', // Fossil Gas
  B05: 'coal', // Fossil Hard coal
  B06: 'oil', // Fossil Oil
  B07: 'oil', // Fossil Oil shale
  B08: 'coal', // Fossil Peat
  B09: 'geothermal',
  B10: 'pumpedStorage', // Hydro Pumped Storage
  B11: 'hydro', // Hydro Run-of-river and poundage
  B12: 'hydro', // Hydro Water Reservoir
  B13: 'other', // Marine
  B14: 'nuclear',
  B15: 'other', // Other renewable
  B16: 'solar',
  B17: 'waste',
  B18: 'wind', // Wind Offshore
  B19: 'wind', // Wind Onshore
  B20: 'other',
  B25: 'other', // Energy storage
};
