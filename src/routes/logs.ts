import { Router, Request, Response } from 'express';
import { db, pool } from '../db/database';
import { logs } from '../db/schema';
import { validateLogEntry,escapeCopyText } from '../utils/validator';
import {
  and,
  eq,
  gte,
  ilike,
  sql,
  desc,
  asc,
} from 'drizzle-orm';
import { performance } from 'perf_hooks';
import {
  encodeCursor,
  decodeCursor,
} from '../utils/cursor';
import { Readable } from 'stream';
import { from as copyFrom } from 'pg-copy-streams';
const router = Router();
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

  // Build only accepted rows.
  // This avoids creating a sparse array and then running .filter().
  const csvRows: string[] = [];

  let accepted = 0;

  // ------------------------------------------
  // PostgreSQL COPY text escaping
  // ------------------------------------------

  const escapeCopyText = (value: string): string =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

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

    const message = escapeCopyText(
      String(entry.message)
    );

    const attributes = escapeCopyText(
      JSON.stringify(entry.attributes || {})
    );

    csvRows.push(
      `${timestamp}\t${level}\t${service}\t${message}\t${attributes}`
    );

    accepted++;
  }

  const prepareTime = performance.now() - prepareStart;

  // ------------------------------------------
  // No valid logs
  // ------------------------------------------

  if (accepted === 0) {
    return res.status(400).json({
      accepted: 0,
      rejected: rejectedLogs,
    });
  }

  // ------------------------------------------
  // Build COPY payload
  // ------------------------------------------

  const csvData = csvRows.join('\n');

  const csvSizeBytes = Buffer.byteLength(
    csvData,
    'utf8'
  );

  // ------------------------------------------
  // PostgreSQL connection
  // ------------------------------------------

  const connectionStart = performance.now();

  const client = await pool.connect();

  const connectionTime =
    performance.now() - connectionStart;

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
      stream.once('finish', resolve);
      stream.once('error', reject);

      sourceStream.once('error', reject);

      sourceStream.pipe(stream);
    });

    const copyTime =
      performance.now() - copyStart;

    const totalTime =
      performance.now() - requestStart;

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
    console.error(
      'Error with COPY bulk insert logs:',
      err
    );

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
            ${decoded.timestamp}::timestamp,
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
// 3. GET /logs/aggregate (Direct Raw Logs Path)
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
      return res.status(400).json({ error: 'since is required.' });
    }

    if (typeof until !== 'string') {
      return res.status(400).json({ error: 'until is required.' });
    }

    if (typeof bucket !== 'string') {
      return res.status(400).json({ error: 'bucket is required.' });
    }

    // ----------------------------------------
    // Parse + validate timestamps
    // ----------------------------------------

    const sinceDate = new Date(since);
    const untilDate = new Date(until);

    if (Number.isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid since timestamp.',
      });
    }

    if (Number.isNaN(untilDate.getTime())) {
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

    const bucketExpressions = {
      '1m': sql`date_trunc('minute', ${logs.timestamp})`,
      '5m': sql`to_timestamp(
        floor(extract(epoch from ${logs.timestamp}) / 300) * 300
      )`,
      '1h': sql`date_trunc('hour', ${logs.timestamp})`,
      '1d': sql`date_trunc('day', ${logs.timestamp})`,
    } as const;

    if (!(bucket in bucketExpressions)) {
      return res.status(400).json({
        error: 'Invalid bucket. Must be 1m, 5m, 1h, or 1d.',
      });
    }

    const timeBucket =
      bucketExpressions[bucket as keyof typeof bucketExpressions];

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

    const validLevels = new Set([
      'debug',
      'info',
      'warn',
      'error',
    ]);

    if (
      level !== undefined &&
      (
        typeof level !== 'string' ||
        !validLevels.has(level)
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
    // Validate q
    // ----------------------------------------

    if (
      q !== undefined &&
      typeof q !== 'string'
    ) {
      return res.status(400).json({
        error: 'Invalid q parameter.',
      });
    }

    // ----------------------------------------
    // Build WHERE conditions
    // ----------------------------------------

    const conditions = [
      gte(logs.timestamp, sinceDate),
      sql`${logs.timestamp} < ${untilDate}`,
    ];

    if (service !== undefined) {
      conditions.push(
        eq(logs.service, service)
      );
    }

    if (level !== undefined) {
      conditions.push(
        eq(logs.level, level)
      );
    }

    if (q !== undefined && q.length > 0) {
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

      const attributeKey = key.slice(5);

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
    // SELECT group expression
    // ----------------------------------------

    const groupExpression =
      group_by === 'service'
        ? logs.service
        : group_by === 'level'
          ? logs.level
          : sql<string | null>`NULL`;

    // ----------------------------------------
    // Single PostgreSQL aggregation query
    // ----------------------------------------

    const results = await db
      .select({
        start: timeBucket,
        group: groupExpression,
        count: sql<number>`count(*)`,
      })
      .from(logs)
      .where(and(...conditions))
      .groupBy(
        timeBucket,
        groupExpression
      )
      .orderBy(
        asc(timeBucket)
      );

    // ----------------------------------------
    // Response
    // ----------------------------------------

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