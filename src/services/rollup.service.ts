import { db } from '../db/database';
import { sql } from 'drizzle-orm';

let refreshInProgress = false;

export async function refreshRollups(): Promise<void> {
  if (refreshInProgress) {
    console.log('[ROLLUP] refresh already in progress, skipping');
    return;
  }

  refreshInProgress = true;

  try {
    const existing = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM logs
        LIMIT 1
      ) AS has_logs
    `);

    const hasLogs = Boolean(existing.rows[0]?.has_logs);

    if (!hasLogs) {
      console.log('[ROLLUP] no logs found, skipping');
      return;
    }

    // --------------------------------------------------
    // 1m rollups — recent 6 hours
    // --------------------------------------------------

    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        bucket_size,
        count
      )
      SELECT
        date_trunc('minute', timestamp),
        service,
        level,
        '1m',
        count(*)::integer
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '6 hours'
        AND timestamp < NOW()
      GROUP BY
        date_trunc('minute', timestamp),
        service,
        level
      ON CONFLICT (
        bucket_size,
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    // --------------------------------------------------
    // 5m rollups — recent 2 days
    // --------------------------------------------------

    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        bucket_size,
        count
      )
      SELECT
        date_bin(
          INTERVAL '5 minutes',
          timestamp,
          TIMESTAMPTZ '1970-01-01'
        ),
        service,
        level,
        '5m',
        count(*)::integer
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '2 days'
        AND timestamp < NOW()
      GROUP BY
        date_bin(
          INTERVAL '5 minutes',
          timestamp,
          TIMESTAMPTZ '1970-01-01'
        ),
        service,
        level
      ON CONFLICT (
        bucket_size,
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    // --------------------------------------------------
    // 1h rollups — recent 7 days
    // --------------------------------------------------

    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        bucket_size,
        count
      )
      SELECT
        date_trunc('hour', timestamp),
        service,
        level,
        '1h',
        count(*)::integer
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '7 days'
        AND timestamp < NOW()
      GROUP BY
        date_trunc('hour', timestamp),
        service,
        level
      ON CONFLICT (
        bucket_size,
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    // --------------------------------------------------
    // 1d rollups — recent 31 days
    // --------------------------------------------------

    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        bucket_size,
        count
      )
      SELECT
        date_trunc('day', timestamp),
        service,
        level,
        '1d',
        count(*)::integer
      FROM logs
      WHERE timestamp >= NOW() - INTERVAL '31 days'
        AND timestamp < NOW()
      GROUP BY
        date_trunc('day', timestamp),
        service,
        level
      ON CONFLICT (
        bucket_size,
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    console.log('[ROLLUP] 1m + 5m + 1h + 1d rollups refreshed');
  } catch (error) {
    console.error('[ROLLUP] refresh failed:', error);
  } finally {
    refreshInProgress = false;
  }
}