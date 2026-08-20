import { db } from '../db/database';
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
}