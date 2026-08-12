import { Router, Request, Response } from 'express';
import { db } from '../db/database';
import { logs } from '../db/schema';
import { validateLogEntry } from '../utils/validator';
import { and, eq, gte, lte, ilike, sql, desc, asc } from 'drizzle-orm';

const router = Router();

// ==========================================
// 1. مسار إرسال وتخزين اللوجات (POST /logs)
// ==========================================
router.post('/', async (req: Request, res: Response): Promise<any> => {
  const body = req.body;
  
  if (!body || !Array.isArray(body.logs)) {
    return res.status(400).json({ error: "Request body must contain a 'logs' array" });
  }

  const entries = body.logs;
  if (entries.length === 0) {
    return res.status(400).json({ error: 'Request body cannot be empty' });
  }

  const validLogsToInsert = [];
  const rejectedLogs = [];

  for (let i = 0; i < entries.length; i++) {
    const errorMsg = validateLogEntry(entries[i]);
    if (errorMsg) {
      rejectedLogs.push({ index: i, reason: errorMsg });
    } else {
      validLogsToInsert.push({
        timestamp: new Date(entries[i].timestamp),
        level: entries[i].level,
        service: entries[i].service,
        message: entries[i].message,
        attributes: entries[i].attributes || {},
      });
    }
  }

  if (validLogsToInsert.length === 0) {
    return res.status(400).json({ accepted: 0, rejected: rejectedLogs });
  }

  try {
    const CHUNK_SIZE = 1000;
    let totalInsertedCount = 0;

    for (let i = 0; i < validLogsToInsert.length; i += CHUNK_SIZE) {
      const chunk = validLogsToInsert.slice(i, i + CHUNK_SIZE);
      const inserted = await db.insert(logs).values(chunk).returning({ id: logs.id });
      totalInsertedCount += inserted.length;
    }

    return res.status(200).json({
      accepted: totalInsertedCount,
      rejected: rejectedLogs,
    });
  } catch (err) {
    console.error('Error inserting logs:', err);
    return res.status(500).json({ error: 'Internal server error while saving logs' });
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
      order = 'desc',
    } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 1000) {
      return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 1000.' });
    }

    if (order !== 'asc' && order !== 'desc') {
      return res.status(400).json({ error: "Invalid order parameter. Must be 'asc' or 'desc'." });
    }

    const conditions = [];

    if (service) conditions.push(eq(logs.service, service as string));
    if (level) conditions.push(eq(logs.level, level as string));

    if (since) {
      const sinceDate = new Date(since as string);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: "Invalid 'since' timestamp format." });
      }
      conditions.push(gte(logs.timestamp, sinceDate));
    }

    if (until) {
      const untilDate = new Date(until as string);
      if (isNaN(untilDate.getTime())) {
        return res.status(400).json({ error: "Invalid 'until' timestamp format." });
      }
      conditions.push(lte(logs.timestamp, untilDate));
    }

    // التحقق من أن since أقدم من أو تساوي until
    if (since && until) {
      const sinceDate = new Date(since as string);
      const untilDate = new Date(until as string);
      if (sinceDate > untilDate) {
        return res.status(400).json({ error: "Invalid time range: 'since' must be earlier than or equal to 'until'." });
      }
    }

    if (q) {
      conditions.push(ilike(logs.message, `%${q}%`));
    }

    if (cursor) {
      const cursorId = parseInt(cursor as string, 10);
      if (isNaN(cursorId)) {
        return res.status(400).json({ error: 'Invalid cursor format. Must be a numeric ID.' });
      }
      if (order === 'desc') {
        conditions.push(sql`${logs.id} < ${cursorId}`);
      } else {
        conditions.push(sql`${logs.id} > ${cursorId}`);
      }
    }

    const sortDirection = order === 'asc' ? asc(logs.id) : desc(logs.id);

    const results = await db
      .select()
      .from(logs)
      .where(and(...conditions))
      .orderBy(sortDirection)
      .limit(parsedLimit + 1);

    let nextCursor = null;

    if (results.length > parsedLimit) {
      results.pop();
      nextCursor = results[results.length - 1].id.toString();
    }

    return res.status(200).json({
      logs: results,
      next_cursor: nextCursor,
    });

  } catch (err) {
    console.error('Error fetching logs:', err);
    return res.status(500).json({ error: 'Internal server error while fetching logs' });
  }
});
// ==========================================
// 3. مسار التجميع الإحصائي (GET /logs/aggregate)
// ==========================================
router.get('/aggregate', async (req: Request, res: Response): Promise<any> => {
  try {
    const { bucket, group_by, since, until } = req.query;

    // 1. التحقق من صحة الـ bucket
    const validBuckets = ['1m', '5m', '1h', '1d'];
    if (!bucket || !validBuckets.includes(bucket as string)) {
      return res.status(400).json({ 
        error: "Invalid or missing 'bucket' parameter. Must be one of: 1m, 5m, 1h, 1d." 
      });
    }

    // 2. التحقق من صحة الـ group_by إن وجد
    if (group_by && group_by !== 'service' && group_by !== 'level') {
      return res.status(400).json({ 
        error: "Invalid 'group_by' parameter. Must be either 'service' or 'level'." 
      });
    }

    // بناء شروط النطاق الزمني
    const conditions = [];

    if (since) {
      const sinceDate = new Date(since as string);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: "Invalid 'since' timestamp format." });
      }
      conditions.push(gte(logs.timestamp, sinceDate));
    }

    if (until) {
      const untilDate = new Date(until as string);
      if (isNaN(untilDate.getTime())) {
        return res.status(400).json({ error: "Invalid 'until' timestamp format." });
      }
      conditions.push(lte(logs.timestamp, untilDate));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let results;

    // 3. اختيار تعبير الـ Time Bucket وتنفيذ الاستعلام مباشرة حسب الـ group_by
    if (group_by === 'service') {
      let timeBucketSql;
      switch (bucket) {
        case '1m': timeBucketSql = sql`date_trunc('minute', ${logs.timestamp})`; break;
        case '5m': timeBucketSql = sql`to_timestamp(floor(extract(epoch from ${logs.timestamp}) / 300) * 300)`; break;
        case '1h': timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`; break;
        case '1d': timeBucketSql = sql`date_trunc('day', ${logs.timestamp})`; break;
        default: timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`;
      }

      results = await db
        .select({
          timestamp: timeBucketSql,
          service: logs.service,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(whereClause)
        .groupBy(timeBucketSql, logs.service)
        .orderBy(asc(timeBucketSql));

    } else if (group_by === 'level') {
      let timeBucketSql;
      switch (bucket) {
        case '1m': timeBucketSql = sql`date_trunc('minute', ${logs.timestamp})`; break;
        case '5m': timeBucketSql = sql`to_timestamp(floor(extract(epoch from ${logs.timestamp}) / 300) * 300)`; break;
        case '1h': timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`; break;
        case '1d': timeBucketSql = sql`date_trunc('day', ${logs.timestamp})`; break;
        default: timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`;
      }

      results = await db
        .select({
          timestamp: timeBucketSql,
          level: logs.level,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(whereClause)
        .groupBy(timeBucketSql, logs.level)
        .orderBy(asc(timeBucketSql));

    } else {
      let timeBucketSql;
      switch (bucket) {
        case '1m': timeBucketSql = sql`date_trunc('minute', ${logs.timestamp})`; break;
        case '5m': timeBucketSql = sql`to_timestamp(floor(extract(epoch from ${logs.timestamp}) / 300) * 300)`; break;
        case '1h': timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`; break;
        case '1d': timeBucketSql = sql`date_trunc('day', ${logs.timestamp})`; break;
        default: timeBucketSql = sql`date_trunc('hour', ${logs.timestamp})`;
      }

      results = await db
        .select({
          timestamp: timeBucketSql,
          count: sql<number>`count(*)`,
        })
        .from(logs)
        .where(whereClause)
        .groupBy(timeBucketSql)
        .orderBy(asc(timeBucketSql));
    }

    return res.status(200).json({
      data: results,
    });

  } catch (err) {
    console.error('Error aggregating logs:', err);
    return res.status(500).json({ error: 'Internal server error while aggregating logs' });
  }
});
export default router;