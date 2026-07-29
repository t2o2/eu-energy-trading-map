import type { GridHistory, GridSnapshot } from '../domain/types';

/**
 * A data source produces snapshots of the European grid, either the current
 * instant or a run of frames for the time slider. Implementations must never
 * throw for partial failures; they report unusable areas via
 * `GridSnapshot.degraded` instead.
 */
export interface GridSource {
  readonly name: 'mock' | 'entsoe';
  fetchSnapshot(): Promise<GridSnapshot>;
  fetchHistory(): Promise<GridHistory>;
}
