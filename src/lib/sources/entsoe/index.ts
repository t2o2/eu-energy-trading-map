import pLimit from 'p-limit';
import { AREAS, BORDERS } from '../../domain/areas';
import type { AreaSnapshot, BorderFlow, GridSnapshot, ProductionType } from '../../domain/types';
import type { GridSource } from '../source';
import { formatPeriod, latestValue, NoDataError, query } from './client';
import { PSR_TO_PRODUCTION } from './psr';

/**
 * ENTSO-E publishes with a lag and some TSOs are slower than others, so we ask
 * for a window reaching back several hours and take the most recent point.
 */
const LOOKBACK_HOURS = 6;

/**
 * ~180 border calls plus ~110 area calls per refresh, against a documented
 * limit of 400 requests/minute per token. Ten in flight keeps us well under it
 * while still completing a cold refresh in a few seconds.
 */
const CONCURRENCY = 10;

function window(now: Date): { periodStart: string; periodEnd: string } {
  const start = new Date(now.getTime() - LOOKBACK_HOURS * 3600_000);
  // Ask slightly into the future so the current interval is always included.
  const end = new Date(now.getTime() + 3600_000);
  return { periodStart: formatPeriod(start), periodEnd: formatPeriod(end) };
}

/** Resolve a query to a single number, treating "no data" as null. */
async function scalar(
  fn: () => Promise<number | null>,
  onError: (err: unknown) => void,
): Promise<number | null> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof NoDataError)) onError(err);
    return null;
  }
}

export class EntsoeSource implements GridSource {
  readonly name = 'entsoe' as const;

  constructor(private readonly token: string) {}

  async fetchSnapshot(): Promise<GridSnapshot> {
    const now = new Date();
    const { periodStart, periodEnd } = window(now);
    const limit = pLimit(CONCURRENCY);
    const degraded = new Set<string>();

    const areaTasks = AREAS.map((area) =>
      limit(async () => {
        const generation: Partial<Record<ProductionType, number>> = {};

        // A75: actual generation per production type.
        await scalar(
          async () => {
            const series = await query(
              this.token,
              {
                documentType: 'A75',
                processType: 'A16',
                in_Domain: area.code,
                periodStart,
                periodEnd,
              },
              undefined,
            );
            for (const ts of series) {
              if (!ts.psrType || ts.isConsumption) continue;
              const type = PSR_TO_PRODUCTION[ts.psrType];
              if (!type) continue;
              const v = latestValue(ts, now);
              if (v === null) continue;
              generation[type] = (generation[type] ?? 0) + v;
            }
            return 0;
          },
          () => degraded.add(area.code),
        );

        // A65 / A16: actual total load.
        const load = await scalar(
          async () => {
            const series = await query(this.token, {
              documentType: 'A65',
              processType: 'A16',
              outBiddingZone_Domain: area.code,
              periodStart,
              periodEnd,
            });
            const values = series.map((ts) => latestValue(ts, now)).filter((v): v is number => v !== null);
            return values.length ? values.reduce((a, b) => a + b, 0) : null;
          },
          () => degraded.add(area.code),
        );

        // A44: day-ahead prices. Many areas have none; that is not degradation.
        const price = await scalar(
          async () => {
            const series = await query(this.token, {
              documentType: 'A44',
              in_Domain: area.code,
              out_Domain: area.code,
              periodStart,
              periodEnd,
            });
            for (const ts of series) {
              const v = latestValue(ts, now);
              if (v !== null) return v;
            }
            return null;
          },
          () => undefined,
        );

        const snapshot: AreaSnapshot = { area: area.code, generation, load, price };
        return snapshot;
      }),
    );

    const flowTasks = BORDERS.map((border) =>
      limit(async () => {
        const read = (from: string, to: string) =>
          scalar(
            async () => {
              const series = await query(this.token, {
                documentType: 'A11',
                in_Domain: to,
                out_Domain: from,
                periodStart,
                periodEnd,
              });
              for (const ts of series) {
                const v = latestValue(ts, now);
                if (v !== null) return v;
              }
              return null;
            },
            () => undefined,
          );

        const [ab, ba] = await Promise.all([read(border.a, border.b), read(border.b, border.a)]);
        if (ab === null && ba === null) return null;

        const forward = ab ?? 0;
        const reverse = ba ?? 0;
        const net = forward - reverse;
        const flow: BorderFlow =
          net >= 0
            ? { from: border.a, to: border.b, netMw: net, forwardMw: forward, reverseMw: reverse }
            : { from: border.b, to: border.a, netMw: -net, forwardMw: reverse, reverseMw: forward };
        return flow;
      }),
    );

    const [areas, flows] = await Promise.all([
      Promise.all(areaTasks),
      Promise.all(flowTasks),
    ]);

    return {
      timestamp: now.toISOString(),
      fetchedAt: now.toISOString(),
      source: 'entsoe',
      areas,
      flows: flows.filter((f): f is BorderFlow => f !== null),
      degraded: [...degraded],
    };
  }
}
