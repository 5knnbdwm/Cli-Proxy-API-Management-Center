/**
 * Quota ledger: one row per credential with every limit it reports, plus a
 * per-provider summary of the headline (weekly) window.
 *
 * Pure functions over the timeline lane builder, so every provider's payload is
 * parsed in exactly one place and the ledger can't disagree with the timeline.
 */

import type { QuotaFileEntry } from './logic';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { buildTimelineLane, type TimelineLimit } from './quotaTimelineModel';

/** The summary headline is the longest window up to a week: the one capacity planning is about. */
const HEADLINE_PERIOD_HOURS = 24 * 7;

export interface LedgerRow {
  entry: QuotaFileEntry;
  /** Every limit the credential reports, in provider order. Empty until loaded. */
  limits: TimelineLimit[];
  /** The credential's headline window, or null if not loaded or not reported. */
  headline: TimelineLimit | null;
}

export interface LedgerSummary {
  provider: QuotaProviderType;
  rows: LedgerRow[];
  /** Label of the headline window, taken from the first credential that reports one. */
  label: string | null;
  /** Sum of remaining headline percent across credentials that reported it. */
  remainingTotal: number;
  /** 100 per credential in the group, reported or not. */
  capacityTotal: number;
  /** Soonest upcoming headline reset across the group. */
  nextResetMs: number | null;
}

/** Build a ledger row. `name`/`displayName` only feed the lane and are irrelevant here. */
export function buildLedgerRow(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined
): LedgerRow {
  const lane = buildTimelineLane({
    name: entry.file.name,
    displayName: entry.file.name,
    provider: entry.type,
    quota,
    maxPeriodHours: HEADLINE_PERIOD_HOURS,
  });
  const headline =
    lane.anchorMs === null
      ? null
      : (lane.limits.find(
          (limit) => limit.resetAtMs === lane.anchorMs && limit.periodHours === lane.periodHours
        ) ?? null);
  return { entry, limits: lane.limits, headline };
}

/**
 * Group rows by provider, keeping the order rows arrive in (so the page's sort
 * mode decides both group order and row order within a group).
 */
export function summarizeLedger(rows: readonly LedgerRow[], now: number): LedgerSummary[] {
  const groups = new Map<QuotaProviderType, LedgerRow[]>();
  rows.forEach((row) => {
    const group = groups.get(row.entry.type) ?? [];
    group.push(row);
    groups.set(row.entry.type, group);
  });

  return Array.from(groups, ([provider, groupRows]) => {
    const headlines = groupRows
      .map((row) => row.headline)
      .filter((headline): headline is TimelineLimit => headline !== null);
    const upcoming = headlines
      .map((headline) => headline.resetAtMs)
      .filter((resetAtMs): resetAtMs is number => resetAtMs !== null && resetAtMs > now);
    return {
      provider,
      rows: groupRows,
      label: headlines[0]?.label ?? null,
      remainingTotal: headlines.reduce((sum, headline) => sum + headline.remaining, 0),
      capacityTotal: groupRows.length * 100,
      nextResetMs: upcoming.length > 0 ? Math.min(...upcoming) : null,
    };
  });
}
