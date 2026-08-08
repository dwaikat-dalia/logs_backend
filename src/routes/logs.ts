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
    return res.status(400).json({ 
      error: "Request body must be an object containing a 'logs' array" 
    });
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
      rejectedLogs.push({
        index: i,
        reason: errorMsg,
      });
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
    return res.status(400).json({
      accepted: 0,
      rejected: rejectedLogs,
    });
  }

  try {
    const insertedLogs = await db.insert(logs).values(validLogsToInsert).returning();

    return res.status(200).json({
      accepted: insertedLogs.length,
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
      limit = '50',
      order = 'desc',
    } = req.query;

    const parsedLimit = parseInt(limit as string, 10);
    if (isNaN(parsedLimit) || parsedLimit <= 0 || parsedLimit > 100) {
      return res.status(400).json({ error: 'Invalid limit parameter. Must be between 1 and 100.' });
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
    let hasMore = false;

    if (results.length > parsedLimit) {
      hasMore = true;
      results.pop();
      nextCursor = results[results.length - 1].id;
    }

    return res.status(200).json({
      data: results,
      pagination: {
        limit: parsedLimit,
        nextCursor,
        hasMore,
      },
    });

  } catch (err) {
    console.error('Error fetching logs:', err);
    return res.status(500).json({ error: 'Internal server error while fetching logs' });
  }
});

export default router;