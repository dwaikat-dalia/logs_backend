import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { pool } from '../db/database'; // تأكد من تصدير الـ pool من ملف قاعدة البيانات
import { logs } from '../db/schema';
import { validateLogEntry } from '../utils/validator';
import { and, eq, gte, lte, ilike, sql, desc, asc } from 'drizzle-orm';
import { from as copyFrom } from 'pg-copy-streams';
import { Readable } from 'stream';
import { performance } from 'perf_hooks';

import {
  encodeCursor,
  decodeCursor,
} from '../utils/cursor';
const router = Router();

// ==========================================
// 1. مسار إرسال وتخزين اللوجات (POST /logs) - باستخدام COPY
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

  // --------------------------------------------------
  // Validation + CSV preparation in ONE loop
  // --------------------------------------------------

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

    // PostgreSQL COPY text format escaping
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

  // --------------------------------------------------
  // Remove empty positions caused by rejected entries
  // --------------------------------------------------

  const csvData = csvRows
    .filter((row): row is string => row !== undefined)
    .join('\n');

  const csvSizeBytes = Buffer.byteLength(csvData, 'utf8');

  // --------------------------------------------------
  // Acquire DB connection ONLY after CPU work is done
  // --------------------------------------------------

  const connectionStart = performance.now();

  const client = await pool.connect();

  const connectionTime = performance.now() - connectionStart;

  try {
    // --------------------------------------------------
    // PostgreSQL COPY
    // --------------------------------------------------

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
// 2. مسار الاستعلام والبحث والفلترة (GET /logs)
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

    // -----------------------------
    // Validate limit
    // -----------------------------

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

    // -----------------------------
    // Validate level
    // -----------------------------

    const validLevels = ['debug', 'info', 'warn', 'error'];

    if (
      level !== undefined &&
      (typeof level !== 'string' || !validLevels.includes(level))
    ) {
      return res.status(400).json({
        error: 'Invalid level parameter.',
      });
    }

    // -----------------------------
    // Validate dates
    // -----------------------------

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

    // -----------------------------
    // Build conditions
    // -----------------------------

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
      conditions.push(eq(logs.level, level as string));
    }

    if (sinceDate) {
      conditions.push(gte(logs.timestamp, sinceDate));
    }

    // IMPORTANT:
    // until is EXCLUSIVE
    if (untilDate) {
      conditions.push(sql`${logs.timestamp} < ${untilDate}`);
    }

    // -----------------------------
    // Message search
    // -----------------------------

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

    // -----------------------------
    // Attribute filters
    // attr.user_id=42
    // attr.region=eu-west
    // -----------------------------

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

    // -----------------------------
    // Cursor
    // -----------------------------

    if (cursor) {
      try {
        const decoded = decodeCursor(cursor as string);

        conditions.push(
          sql`(${logs.timestamp}, ${logs.id}) < (${decoded.timestamp}, ${decoded.id})`
        );
      } catch {
        return res.status(400).json({
          error: 'Invalid or malformed cursor.',
        });
      }
    }

    // -----------------------------
    // Query
    // -----------------------------

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

    // -----------------------------
    // Cursor
    // -----------------------------

    let nextCursor: string | null = null;

    if (results.length > parsedLimit) {
      const lastReturned = results[parsedLimit - 1];

      results.pop();

      nextCursor = encodeCursor({
        timestamp: lastReturned.timestamp.toISOString(),
        id: lastReturned.id,
      });
    }

    return res.status(200).json({
      logs: results,
      next_cursor: nextCursor,
    });

  } catch (err) {
    console.error('Error fetching logs:', err);

    return res.status(500).json({
      error: 'Internal server error while fetching logs',
    });
  }
});

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

    // -----------------------------
    // Required parameters
    // -----------------------------

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

    // -----------------------------
    // Bucket validation
    // -----------------------------

    const validBuckets = ['1m', '5m', '1h', '1d'];

    if (!validBuckets.includes(bucket)) {
      return res.status(400).json({
        error: 'Invalid bucket. Must be 1m, 5m, 1h, or 1d.',
      });
    }

    // -----------------------------
    // group_by validation
    // -----------------------------

    if (
      group_by !== undefined &&
      group_by !== 'service' &&
      group_by !== 'level'
    ) {
      return res.status(400).json({
        error: 'Invalid group_by. Must be service or level.',
      });
    }

    // -----------------------------
    // Level validation
    // -----------------------------

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

    // -----------------------------
    // Time bucket
    // -----------------------------

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
    // -----------------------------
    // Filters
    // -----------------------------

    const conditions = [
      gte(logs.timestamp, sinceDate),
      sql`${logs.timestamp} < ${untilDate}`,
    ];

    if (service) {
      conditions.push(eq(logs.service, service as string));
    }

    if (level) {
      conditions.push(eq(logs.level, level as string));
    }

    if (q) {
      conditions.push(
        ilike(logs.message, `%${q}%`)
      );
    }

    // attributes
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

      conditions.push(
        sql`${logs.attributes}->>${attributeKey} = ${value}`
      );
    }

    // -----------------------------
    // Query
    // -----------------------------

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
        .groupBy(timeBucket, logs.service)
        .orderBy(asc(timeBucket));

    } else if (group_by === 'level') {
      results = await db
        .select({
          start: timeBucket,
          group: logs.level,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(and(...conditions))
        .groupBy(timeBucket, logs.level)
        .orderBy(asc(timeBucket));

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
        .orderBy(asc(timeBucket));
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