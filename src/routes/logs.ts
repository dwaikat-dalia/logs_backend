import { Router, Request, Response } from 'express';
import { db, pool } from '../db/database';
import { logs, logRollups } from '../db/schema';
import { validateLogEntry } from '../utils/validator';
import {
  and,
  eq,
  gte,
  ilike,
  sql,
  desc,
  asc,
} from 'drizzle-orm';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { performance } from 'perf_hooks';
import {
  encodeCursor,
  decodeCursor,
} from '../utils/cursor';

const router = Router();

// ==========================================
// 1. POST /logs
// ==========================================

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const requestStart = performance.now();

  const body = req.body;

  if (!body || !Array.isArray(body.logs)) {
    return res.status(400).json({
      error: "Request body must contain a 'logs' array",
    });
  }

  const entries = body.logs;

  if (entries.length === 0) {
    return res.status(400).json({
      error: 'Request body cannot be empty',
    });
  }

  const rejectedLogs: {
    index: number;
    reason: string;
  }[] = [];

  const csvRows: string[] = new Array(entries.length);

  let accepted = 0;

  // ------------------------------------------
  // Validation + CSV preparation
  // ------------------------------------------

  const prepareStart = performance.now();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    const errorMsg = validateLogEntry(entry);

    if (errorMsg) {
      rejectedLogs.push({
        index: i,
        reason: errorMsg,
      });

      continue;
    }

    const timestamp = new Date(entry.timestamp).toISOString();
    const level = entry.level;
    const service = entry.service;

    const message = String(entry.message)
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    const attributes = JSON.stringify(entry.attributes || {})
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    csvRows[i] =
      `${timestamp}\t${level}\t${service}\t${message}\t${attributes}`;

    accepted++;
  }

  const prepareTime = performance.now() - prepareStart;

  if (accepted === 0) {
    return res.status(400).json({
      accepted: 0,
      rejected: rejectedLogs,
    });
  }

  const csvData = csvRows
    .filter((row): row is string => row !== undefined)
    .join('\n');

  const csvSizeBytes = Buffer.byteLength(csvData, 'utf8');

  // ------------------------------------------
  // PostgreSQL connection
  // ------------------------------------------

  const connectionStart = performance.now();

  const client = await pool.connect();

  const connectionTime = performance.now() - connectionStart;

  try {
    // ----------------------------------------
    // COPY bulk insert
    // ----------------------------------------

    const copyStart = performance.now();

    const stream = client.query(
      copyFrom(
        `COPY logs
         (timestamp, level, service, message, attributes)
         FROM STDIN
         WITH (
           FORMAT text,
           DELIMITER E'\\t'
         )`
      )
    );

    const sourceStream = Readable.from([csvData]);

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);

      sourceStream.on('error', reject);

      sourceStream.pipe(stream);
    });

    const copyTime = performance.now() - copyStart;

    const totalTime = performance.now() - requestStart;

    console.log(
      `[INGEST] accepted=${accepted} ` +
      `rejected=${rejectedLogs.length} ` +
      `size=${(csvSizeBytes / 1024).toFixed(1)}KB ` +
      `prepare=${prepareTime.toFixed(2)}ms ` +
      `connection=${connectionTime.toFixed(2)}ms ` +
      `copy=${copyTime.toFixed(2)}ms ` +
      `total=${totalTime.toFixed(2)}ms`
    );

    return res.status(200).json({
      accepted,
      rejected: rejectedLogs,
    });

  } catch (err) {
    console.error('Error with COPY bulk insert logs:', err);

    return res.status(500).json({
      error: 'Internal server error while saving logs',
    });

  } finally {
    client.release();
  }
});

// ==========================================
// 2. GET /logs
// ==========================================

router.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      service,
      level,
      since,
      until,
      q,
      cursor,
      limit = '100',
    } = req.query;

    // ----------------------------------------
    // Validate limit
    // ----------------------------------------

    const parsedLimit = Number(limit);

    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit <= 0 ||
      parsedLimit > 1000
    ) {
      return res.status(400).json({
        error: 'Invalid limit parameter. Must be between 1 and 1000.',
      });
    }

    // ----------------------------------------
    // Validate level
    // ----------------------------------------

    const validLevels = [
      'debug',
      'info',
      'warn',
      'error',
    ];

    if (
      level !== undefined &&
      (
        typeof level !== 'string' ||
        !validLevels.includes(level)
      )
    ) {
      return res.status(400).json({
        error: 'Invalid level parameter.',
      });
    }

    // ----------------------------------------
    // Validate dates
    // ----------------------------------------

    let sinceDate: Date | undefined;
    let untilDate: Date | undefined;

    if (since !== undefined) {
      if (typeof since !== 'string') {
        return res.status(400).json({
          error: 'Invalid since timestamp.',
        });
      }

      sinceDate = new Date(since);

      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({
          error: 'Invalid since timestamp.',
        });
      }
    }

    if (until !== undefined) {
      if (typeof until !== 'string') {
        return res.status(400).json({
          error: 'Invalid until timestamp.',
        });
      }

      untilDate = new Date(until);

      if (isNaN(untilDate.getTime())) {
        return res.status(400).json({
          error: 'Invalid until timestamp.',
        });
      }
    }

    if (sinceDate && untilDate && untilDate <= sinceDate) {
      return res.status(400).json({
        error: "'until' must be later than 'since'.",
      });
    }

    // ----------------------------------------
    // Build conditions
    // ----------------------------------------

    const conditions = [];

    if (service) {
      if (typeof service !== 'string') {
        return res.status(400).json({
          error: 'Invalid service parameter.',
        });
      }

      conditions.push(eq(logs.service, service));
    }

    if (level) {
      conditions.push(
        eq(logs.level, level as string)
      );
    }

    if (sinceDate) {
      conditions.push(
        gte(logs.timestamp, sinceDate)
      );
    }

    if (untilDate) {
      conditions.push(
        sql`${logs.timestamp} < ${untilDate}`
      );
    }

    // ----------------------------------------
    // Message search
    // ----------------------------------------

    if (q) {
      if (typeof q !== 'string') {
        return res.status(400).json({
          error: 'Invalid q parameter.',
        });
      }

      conditions.push(
        ilike(logs.message, `%${q}%`)
      );
    }

    // ----------------------------------------
    // Attribute filters
    // ----------------------------------------

    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('attr.')) {
        continue;
      }

      if (typeof value !== 'string') {
        return res.status(400).json({
          error: `Invalid attribute filter: ${key}`,
        });
      }

      const attributeKey = key.substring(5);

      if (!attributeKey) {
        return res.status(400).json({
          error: 'Invalid attribute key.',
        });
      }

      conditions.push(
        sql`${logs.attributes}->>${attributeKey} = ${value}`
      );
    }

    // ----------------------------------------
    // Cursor
    // ----------------------------------------

    if (cursor) {
      try {
        const decoded = decodeCursor(
          cursor as string
        );

        conditions.push(
          sql`(
            ${logs.timestamp},
            ${logs.id}
          ) < (
            ${decoded.timestamp},
            ${decoded.id}
          )`
        );

      } catch {
        return res.status(400).json({
          error: 'Invalid or malformed cursor.',
        });
      }
    }

    // ----------------------------------------
    // Query
    // ----------------------------------------

    const results = await db
      .select()
      .from(logs)
      .where(
        conditions.length > 0
          ? and(...conditions)
          : undefined
      )
      .orderBy(
        desc(logs.timestamp),
        desc(logs.id)
      )
      .limit(parsedLimit + 1);

    // ----------------------------------------
    // Cursor response
    // ----------------------------------------

    let nextCursor: string | null = null;

    if (results.length > parsedLimit) {
      const lastReturned =
        results[parsedLimit - 1];

      results.pop();

      nextCursor = encodeCursor({
        timestamp:
          lastReturned.timestamp.toISOString(),
        id: lastReturned.id,
      });
    }

    return res.status(200).json({
      logs: results,
      next_cursor: nextCursor,
    });

  } catch (err) {
    console.error(
      'Error fetching logs:',
      err
    );

    return res.status(500).json({
      error:
        'Internal server error while fetching logs',
    });
  }
});

// ==========================================
// 3. GET /logs/aggregate
// ==========================================
// ==========================================
// 3. مسار التجميع الإحصائي (GET /logs/aggregate)
// ==========================================
router.get('/aggregate', async (req: Request, res: Response): Promise<any> => {
  try {
    const {
      service,
      level,
      since,
      until,
      q,
      bucket,
      group_by,
    } = req.query;

    // ----------------------------------------
    // Required parameters
    // ----------------------------------------

    if (typeof since !== 'string') {
      return res.status(400).json({
        error: 'since is required.',
      });
    }

    if (typeof until !== 'string') {
      return res.status(400).json({
        error: 'until is required.',
      });
    }

    if (typeof bucket !== 'string') {
      return res.status(400).json({
        error: 'bucket is required.',
      });
    }

    // ----------------------------------------
    // Validate timestamps
    // ----------------------------------------

    const sinceDate = new Date(since);
    const untilDate = new Date(until);

    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid since timestamp.',
      });
    }

    if (isNaN(untilDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid until timestamp.',
      });
    }

    if (untilDate <= sinceDate) {
      return res.status(400).json({
        error: "'until' must be later than 'since'.",
      });
    }

    // ----------------------------------------
    // Validate bucket
    // ----------------------------------------

    const validBuckets = ['1m', '5m', '1h', '1d'];

    if (!validBuckets.includes(bucket)) {
      return res.status(400).json({
        error: 'Invalid bucket. Must be 1m, 5m, 1h, or 1d.',
      });
    }

    // ----------------------------------------
    // Validate group_by
    // ----------------------------------------

    if (
      group_by !== undefined &&
      group_by !== 'service' &&
      group_by !== 'level'
    ) {
      return res.status(400).json({
        error: 'Invalid group_by. Must be service or level.',
      });
    }

    // ----------------------------------------
    // Validate level
    // ----------------------------------------

    const validLevels = ['debug', 'info', 'warn', 'error'];

    if (
      level !== undefined &&
      (
        typeof level !== 'string' ||
        !validLevels.includes(level)
      )
    ) {
      return res.status(400).json({
        error: 'Invalid level parameter.',
      });
    }

    // ----------------------------------------
    // Validate service
    // ----------------------------------------

    if (
      service !== undefined &&
      typeof service !== 'string'
    ) {
      return res.status(400).json({
        error: 'Invalid service parameter.',
      });
    }

    // ----------------------------------------
    // Detect attribute filters
    // ----------------------------------------

    const hasAttributeFilter = Object.keys(req.query).some((key) =>
      key.startsWith('attr.')
    );

    // ==================================================
    // ROLLUP PATH
    //
    // Use the pre-computed aggregate table for ALL
    // supported bucket sizes:
    //
    //   1m -> log_rollups
    //   5m -> log_rollups
    //   1h -> log_rollups
    //   1d -> log_rollups
    //
    // q and attr.* cannot use the rollup because the
    // rollup table does not contain message/attributes.
    // ==================================================

    const canUseRollup =
      validBuckets.includes(bucket) &&
      !q &&
      !hasAttributeFilter;

    if (canUseRollup) {
      const rollupConditions = [
        // IMPORTANT:
        // Select ONLY the requested resolution.
        eq(logRollups.bucketSize, bucket),

        // Requested time range.
        gte(logRollups.bucketStart, sinceDate),
        sql`${logRollups.bucketStart} < ${untilDate}`,
      ];

      // ----------------------------------------
      // Optional service filter
      // ----------------------------------------

      if (service !== undefined) {
        rollupConditions.push(
          eq(logRollups.service, service as string)
        );
      }

      // ----------------------------------------
      // Optional level filter
      // ----------------------------------------

      if (level !== undefined) {
        rollupConditions.push(
          eq(logRollups.level, level as string)
        );
      }

      // ----------------------------------------
      // group_by = service
      // ----------------------------------------

      if (group_by === 'service') {
        const results = await db
          .select({
            start: logRollups.bucketStart,
            group: logRollups.service,
            count: sql<number>`sum(${logRollups.count})`,
          })
          .from(logRollups)
          .where(and(...rollupConditions))
          .groupBy(
            logRollups.bucketStart,
            logRollups.service
          )
          .orderBy(
            asc(logRollups.bucketStart)
          );

        return res.status(200).json({
          buckets: results.map((row) => ({
            start: row.start,
            group: row.group,
            count: Number(row.count),
          })),
        });
      }

      // ----------------------------------------
      // group_by = level
      // ----------------------------------------

      if (group_by === 'level') {
        const results = await db
          .select({
            start: logRollups.bucketStart,
            group: logRollups.level,
            count: sql<number>`sum(${logRollups.count})`,
          })
          .from(logRollups)
          .where(and(...rollupConditions))
          .groupBy(
            logRollups.bucketStart,
            logRollups.level
          )
          .orderBy(
            asc(logRollups.bucketStart)
          );

        return res.status(200).json({
          buckets: results.map((row) => ({
            start: row.start,
            group: row.group,
            count: Number(row.count),
          })),
        });
      }

      // ----------------------------------------
      // No group_by
      // ----------------------------------------

      const results = await db
        .select({
          start: logRollups.bucketStart,
          group: sql<string | null>`NULL`,
          count: sql<number>`sum(${logRollups.count})`,
        })
        .from(logRollups)
        .where(and(...rollupConditions))
        .groupBy(
          logRollups.bucketStart
        )
        .orderBy(
          asc(logRollups.bucketStart)
        );

      return res.status(200).json({
        buckets: results.map((row) => ({
          start: row.start,
          group: row.group,
          count: Number(row.count),
        })),
      });
    }

    // ==================================================
    // RAW LOGS PATH
    //
    // Used only when the rollup cannot answer the query:
    //
    // - q
    // - attr.*
    //
    // The normal 1m/5m/1h/1d aggregation DOES NOT come
    // here anymore.
    // ==================================================

    const conditions = [
      gte(logs.timestamp, sinceDate),
      sql`${logs.timestamp} < ${untilDate}`,
    ];

    // ----------------------------------------
    // Service filter
    // ----------------------------------------

    if (service !== undefined) {
      conditions.push(
        eq(logs.service, service as string)
      );
    }

    // ----------------------------------------
    // Level filter
    // ----------------------------------------

    if (level !== undefined) {
      conditions.push(
        eq(logs.level, level as string)
      );
    }

    // ----------------------------------------
    // Message search
    // ----------------------------------------

    if (q) {
      if (typeof q !== 'string') {
        return res.status(400).json({
          error: 'Invalid q parameter.',
        });
      }

      conditions.push(
        ilike(logs.message, `%${q}%`)
      );
    }

    // ----------------------------------------
    // Attribute filters
    // ----------------------------------------

    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('attr.')) {
        continue;
      }

      if (typeof value !== 'string') {
        return res.status(400).json({
          error: `Invalid attribute filter: ${key}`,
        });
      }

      const attributeKey = key.substring(5);

      if (!attributeKey) {
        return res.status(400).json({
          error: 'Invalid attribute key.',
        });
      }

      conditions.push(
        sql`${logs.attributes}->>${attributeKey} = ${value}`
      );
    }

    // ----------------------------------------
    // Raw time bucket
    // ----------------------------------------

    const timeBucket = (() => {
      switch (bucket) {
        case '1m':
          return sql`
            date_trunc('minute', ${logs.timestamp})
          `;

        case '5m':
          return sql`
            to_timestamp(
              floor(
                extract(epoch from ${logs.timestamp}) / 300
              ) * 300
            )
          `;

        case '1h':
          return sql`
            date_trunc('hour', ${logs.timestamp})
          `;

        case '1d':
          return sql`
            date_trunc('day', ${logs.timestamp})
          `;

        default:
          throw new Error('Invalid bucket');
      }
    })();

    // ----------------------------------------
    // Raw aggregation
    // ----------------------------------------

    let results;

    if (group_by === 'service') {
      results = await db
        .select({
          start: timeBucket,
          group: logs.service,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(and(...conditions))
        .groupBy(
          timeBucket,
          logs.service
        )
        .orderBy(
          asc(timeBucket)
        );

    } else if (group_by === 'level') {
      results = await db
        .select({
          start: timeBucket,
          group: logs.level,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(and(...conditions))
        .groupBy(
          timeBucket,
          logs.level
        )
        .orderBy(
          asc(timeBucket)
        );

    } else {
      results = await db
        .select({
          start: timeBucket,
          group: sql<string | null>`NULL`,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(and(...conditions))
        .groupBy(timeBucket)
        .orderBy(
          asc(timeBucket)
        );
    }

    return res.status(200).json({
      buckets: results.map((row) => ({
        start: row.start,
        group: row.group,
        count: Number(row.count),
      })),
    });

  } catch (err) {
    console.error('Error aggregating logs:', err);

    return res.status(500).json({
      error: 'Internal server error while aggregating logs',
    });
  }
});
export default router;