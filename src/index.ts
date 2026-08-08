import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { connectDB } from './db/database';
import { db } from './db/database'; 
import { logs } from './db/schema';  
import { validateLogEntry } from './utils/validator';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;


app.use(express.json({ limit: '10mb' }));

app.get('/health', async (req: Request, res: Response) => {
  try {
    await db.execute('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

app.post('/logs', async (req: Request, res: Response): Promise<any> => {
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

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer();