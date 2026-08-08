import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { connectDB } from './db/database';
import { db } from './db/database'; 
import { logs } from './db/schema';  
import { validateLogEntry } from './utils/validator';

dotenv.config();

const PORT = process.env.PORT || 8080;
const app = express();

app.use(express.json());

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
  const isArray = Array.isArray(body);
  const entries = isArray ? body : [body];

  if (entries.length === 0) {
    return res.status(400).json({ error: 'Request body cannot be empty' });
  }

  for (let i = 0; i < entries.length; i++) {
    const errorMsg = validateLogEntry(entries[i]);
    if (errorMsg) {
      return res.status(400).json({
        error: `Validation failed at index ${isArray ? i : 'root'}: ${errorMsg}`,
      });
    }
  }

  try {
    const formattedLogs = entries.map((entry) => ({
      timestamp: new Date(entry.timestamp),
      level: entry.level,
      service: entry.service,
      message: entry.message,
      attributes: entry.attributes || {},
    }));

    const insertedLogs = await db.insert(logs).values(formattedLogs).returning();

    return res.status(201).json({
      message: 'Logs inserted successfully',
      count: insertedLogs.length,
      logs: insertedLogs,
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