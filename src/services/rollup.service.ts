import { db } from '../db/database';
import { sql } from 'drizzle-orm';

export async function refreshRollups(): Promise<void> {
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
      WHERE timestamp >= date_trunc('hour', NOW() - INTERVAL '24 hours')
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

    console.log('Rollups refreshed successfully.');
  } catch (error) {
    console.error('Failed to refresh rollups:', error);
  }
}