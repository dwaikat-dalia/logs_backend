import { db } from '../db/database';
import { sql } from 'drizzle-orm';

let refreshInProgress = false;

export async function refreshRollups(): Promise<void> {
  // Prevent overlapping rollup jobs
  if (refreshInProgress) {
    console.log('[ROLLUP] refresh already in progress, skipping');
    return;
  }

  refreshInProgress = true;

  try {
    // --------------------------------------------------
    // Check whether logs and rollups exist
    // --------------------------------------------------

    const existing = await db.execute(sql`
      SELECT
        EXISTS (
          SELECT 1
          FROM logs
          LIMIT 1
        ) AS has_logs,

        EXISTS (
          SELECT 1
          FROM log_rollups
          LIMIT 1
        ) AS has_rollups
    `);

    const hasLogs = Boolean(existing.rows[0]?.has_logs);
    const hasRollups = Boolean(existing.rows[0]?.has_rollups);

    // --------------------------------------------------
    // No logs yet
    // --------------------------------------------------

    if (!hasLogs) {
      console.log('[ROLLUP] no logs found, skipping');
      return;
    }

    // --------------------------------------------------
    // First run after logs have been inserted
    // Build historical rollups for all existing logs
    // --------------------------------------------------

    if (!hasRollups) {
      console.log(
        '[ROLLUP] logs found but rollups are empty - building historical rollups'
      );

      await db.execute(sql`
        INSERT INTO log_rollups (
          bucket_start,
          service,
          level,
          count
        )
        SELECT
          date_trunc('hour', timestamp) AS bucket_start,
          service,
          level,
          count(*)::integer AS count
        FROM logs
        GROUP BY
          date_trunc('hour', timestamp),
          service,
          level
        ON CONFLICT (
          bucket_start,
          service,
          level
        )
        DO UPDATE SET
          count = EXCLUDED.count;
      `);

      console.log('[ROLLUP] historical backfill completed');

      return;
    }

    // --------------------------------------------------
    // Normal refresh
    //
    // Refresh previous + current hour.
    // This keeps recent data accurate without
    // repeatedly scanning the entire logs table.
    // --------------------------------------------------

    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        count
      )
      SELECT
        date_trunc('hour', timestamp) AS bucket_start,
        service,
        level,
        count(*)::integer AS count
      FROM logs
      WHERE timestamp >=
            date_trunc('hour', NOW()) - INTERVAL '1 hour'
        AND timestamp <
            date_trunc('hour', NOW()) + INTERVAL '1 hour'
      GROUP BY
        date_trunc('hour', timestamp),
        service,
        level
      ON CONFLICT (
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    console.log('[ROLLUP] recent hours refreshed');

  } catch (error) {
    console.error('[ROLLUP] refresh failed:', error);
  } finally {
    refreshInProgress = false;
  }
}
/*import { db } from '../db/database';
import { sql } from 'drizzle-orm';

let refreshInProgress = false;

export async function refreshRollups(): Promise<void> {
  // Prevent overlapping rollup jobs
  if (refreshInProgress) {
    console.log('Rollup refresh already in progress, skipping.');
    return;
  }

  refreshInProgress = true;

  try {
    await db.execute(sql`
      INSERT INTO log_rollups (
        bucket_start,
        service,
        level,
        count
      )
      SELECT
        date_trunc('hour', timestamp) AS bucket_start,
        service,
        level,
        count(*) AS count
      FROM logs
      WHERE timestamp >= date_trunc('hour', NOW()) - INTERVAL '1 hour'
        AND timestamp < date_trunc('hour', NOW()) + INTERVAL '1 hour'
      GROUP BY
        date_trunc('hour', timestamp),
        service,
        level
      ON CONFLICT (
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        count = EXCLUDED.count;
    `);

    console.log('Current-hour rollups refreshed successfully.');
  } catch (error) {
    console.error('Failed to refresh rollups:', error);
  } finally {
    refreshInProgress = false;
  }
}*/