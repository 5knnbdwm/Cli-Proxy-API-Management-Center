/**
 * Ledger view: a summary strip with one tile per provider (combined headline
 * quota, one bar segment per credential, soonest reset), then one row per
 * credential listing every limit it reports.
 *
 * Denser than the card grid: every credential's limits line up in columns, so
 * which account to burn next reads at a glance.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import { buildLedgerRow, summarizeLedger, type LedgerRow } from '../ledgerModel';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import styles from './QuotaLedger.module.scss';

export interface QuotaLedgerProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  now: number;
  canRefresh: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
}

const levelClass = (remaining: number | null) =>
  remaining === null
    ? styles.fillUnknown
    : remaining >= QUOTA_PROGRESS_HIGH_THRESHOLD
      ? styles.fillHigh
      : remaining >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
        ? styles.fillMedium
        : styles.fillLow;

const percent = (value: number) => `${Math.round(value)}%`;

function Bar({ remaining }: { remaining: number | null }) {
  return (
    <span className={styles.track}>
      <span
        className={`${styles.fill} ${levelClass(remaining)}`}
        style={{ width: `${remaining ?? 0}%` }}
      />
    </span>
  );
}

function ResetText({ resetAtMs, now }: { resetAtMs: number | null; now: number }) {
  const { t, i18n } = useTranslation();
  if (resetAtMs === null || resetAtMs <= now) {
    return <span className={styles.muted}>{t('quota_management.ledger_no_reset')}</span>;
  }
  return (
    <span className={styles.reset}>
      <span className={styles.relative}>
        {formatRelativeInstant(resetAtMs, now, i18n.language)}
      </span>
      <span className={styles.muted}>{formatInstantShort(resetAtMs)}</span>
    </span>
  );
}

function ProviderIcon({
  type,
  resolvedTheme,
}: {
  type: QuotaProviderType;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  const typeLabel = getTypeLabel(t, type);
  return (
    <span
      className={styles.iconWrap}
      style={
        isThemeSurfaceIconProvider(type)
          ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
          : undefined
      }
    >
      {iconSrc ? (
        <img src={iconSrc} alt="" className={styles.icon} />
      ) : (
        <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}

/** Translated label for a limit; Meta stores i18n keys, every other provider stores text. */
const useLimitLabel = () => {
  const { t } = useTranslation();
  return (provider: QuotaProviderType, label: string) => (provider === 'meta' ? t(label) : label);
};

export function QuotaLedger({
  entries,
  quotaFor,
  resolvedTheme,
  now,
  canRefresh,
  onRefresh,
}: QuotaLedgerProps) {
  const { t } = useTranslation();
  const limitLabel = useLimitLabel();
  const summaries = useMemo(
    () =>
      summarizeLedger(
        entries.map((entry) => buildLedgerRow(entry, quotaFor(entry))),
        now
      ),
    [entries, quotaFor, now]
  );

  return (
    <div className={styles.ledger}>
      <section className={styles.summary} aria-label={t('quota_management.ledger_summary')}>
        {summaries.map((summary) => (
          <article key={summary.provider} className={styles.tile}>
            <header className={styles.tileHead}>
              <ProviderIcon type={summary.provider} resolvedTheme={resolvedTheme} />
              <span className={styles.tileTitle}>{getTypeLabel(t, summary.provider)}</span>
              <span className={styles.muted}>
                {t('quota_management.meta_credentials', { count: summary.rows.length })}
              </span>
            </header>
            <div className={styles.tileLabel}>
              {summary.label ? limitLabel(summary.provider, summary.label) : '--'}
            </div>
            <div className={styles.tileValue}>
              <span className={styles.tileNumber}>{percent(summary.remainingTotal)}</span>
              <span className={styles.muted}>
                {t('quota_management.ledger_of', { total: percent(summary.capacityTotal) })}
              </span>
            </div>
            <div className={styles.segments}>
              {summary.rows.map((row) => (
                <Bar
                  key={getQuotaCacheKey(row.entry.file)}
                  remaining={row.headline?.remaining ?? null}
                />
              ))}
            </div>
            <ResetText resetAtMs={summary.nextResetMs} now={now} />
          </article>
        ))}
      </section>

      {summaries.map((summary) => (
        <section key={summary.provider} className={styles.group}>
          <h3 className={styles.groupTitle}>
            {getTypeLabel(t, summary.provider)}
            <span className={styles.muted}>{summary.rows.length}</span>
          </h3>
          <ul className={styles.rows}>
            {summary.rows.map((row) => (
              <LedgerRowItem
                key={getQuotaCacheKey(row.entry.file)}
                row={row}
                quota={quotaFor(row.entry)}
                now={now}
                canRefresh={canRefresh && !row.entry.file.disabled}
                onRefresh={() => onRefresh(row.entry)}
                limitLabel={limitLabel}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface LedgerRowItemProps {
  row: LedgerRow;
  quota: QuotaCardState | undefined;
  now: number;
  canRefresh: boolean;
  onRefresh: () => void;
  limitLabel: (provider: QuotaProviderType, label: string) => string;
}

function LedgerRowItem({ row, quota, now, canRefresh, onRefresh, limitLabel }: LedgerRowItemProps) {
  const { t } = useTranslation();
  const { entry, limits } = row;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const displayName = getQuotaDisplayName(entry.file);

  return (
    <li className={styles.row}>
      <span className={styles.name} title={displayName}>
        {displayName}
      </span>

      <div className={styles.limits} aria-busy={loading}>
        {status === 'error' ? (
          <span className={styles.error} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, {
              message: resolveQuotaErrorMessage(
                t,
                quota?.errorStatus,
                quota?.error || t('common.unknown_error')
              ),
            })}
          </span>
        ) : status === 'success' && limits.length > 0 ? (
          limits.map((limit, index) => (
            <div key={`${limit.label}:${index}`} className={styles.limit}>
              <div className={styles.limitHead}>
                <span className={styles.limitLabel}>{limitLabel(entry.type, limit.label)}</span>
                <span className={styles.limitPercent}>{percent(limit.remaining)}</span>
              </div>
              <Bar remaining={limit.remaining} />
              <ResetText resetAtMs={limit.resetAtMs} now={now} />
            </div>
          ))
        ) : (
          <span className={styles.muted}>
            {status === 'success'
              ? t('quota_management.ledger_no_limits')
              : t(`${adapter.i18nPrefix}.${loading ? 'loading' : 'idle'}`)}
          </span>
        )}
      </div>

      <button
        type="button"
        className={styles.refresh}
        onClick={onRefresh}
        disabled={isQuotaRefreshDisabled(canRefresh, loading, false)}
        title={t('auth_files.quota_refresh_hint')}
      >
        <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
        {t('auth_files.quota_refresh_single')}
      </button>
    </li>
  );
}
