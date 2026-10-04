import { describe, expect, test } from 'bun:test';
import { buildLedgerRow, summarizeLedger } from '../src/features/quota/ledgerModel';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import type { QuotaCardState } from '../src/features/quota/providers';

const NOW = Date.UTC(2026, 9, 4, 12);
const HOUR = 60 * 60 * 1000;

const entry = (type: QuotaFileEntry['type'], name: string): QuotaFileEntry =>
  ({ type, file: { name } }) as QuotaFileEntry;

const codexQuota = (weeklyUsed: number, weeklyResetMs: number) =>
  ({
    status: 'success',
    windows: [
      {
        id: 'five-hour',
        label: '5-hour',
        usedPercent: 10,
        resetAtMs: NOW + 2 * HOUR,
        periodHours: 5,
      },
      {
        id: 'weekly',
        label: 'Weekly',
        usedPercent: weeklyUsed,
        resetAtMs: weeklyResetMs,
        periodHours: 168,
      },
    ],
  }) as unknown as QuotaCardState;

describe('quota ledger', () => {
  test('rows list every limit with its reset and use the weekly window as headline', () => {
    const row = buildLedgerRow(entry('codex', 'a.json'), codexQuota(30, NOW + 48 * HOUR));

    expect(row.limits).toEqual([
      { label: '5-hour', remaining: 90, resetAtMs: NOW + 2 * HOUR, periodHours: 5 },
      { label: 'Weekly', remaining: 70, resetAtMs: NOW + 48 * HOUR, periodHours: 168 },
    ]);
    expect(row.headline?.label).toBe('Weekly');
  });

  test('summary adds headline remaining per provider and finds the soonest reset', () => {
    const rows = [
      buildLedgerRow(entry('codex', 'a.json'), codexQuota(30, NOW + 48 * HOUR)),
      buildLedgerRow(entry('codex', 'b.json'), codexQuota(80, NOW + 24 * HOUR)),
      buildLedgerRow(entry('codex', 'c.json'), undefined),
    ];

    const [summary] = summarizeLedger(rows, NOW);

    expect(summary).toMatchObject({
      provider: 'codex',
      label: 'Weekly',
      remainingTotal: 90,
      capacityTotal: 300,
      nextResetMs: NOW + 24 * HOUR,
    });
    expect(summary.rows.map((row) => row.headline?.remaining ?? null)).toEqual([70, 20, null]);
  });

  test('groups keep the order rows arrive in', () => {
    const rows = [
      buildLedgerRow(entry('codex', 'a.json'), undefined),
      buildLedgerRow(entry('claude', 'b.json'), undefined),
      buildLedgerRow(entry('codex', 'c.json'), undefined),
    ];

    expect(summarizeLedger(rows, NOW).map((summary) => summary.provider)).toEqual([
      'codex',
      'claude',
    ]);
  });
});
