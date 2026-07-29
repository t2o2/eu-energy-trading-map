import type { GridSnapshot } from '../domain/types';

/**
 * A data source produces one complete snapshot of the European grid.
 * Implementations must never throw for partial failures; they report unusable
 * areas via `GridSnapshot.degraded` instead.
 */
export interface GridSource {
  readonly name: 'mock' | 'entsoe';
  fetchSnapshot(): Promise<GridSnapshot>;
}
