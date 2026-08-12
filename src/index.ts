import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { connectDB, db } from './db/database';
import logsRouter from './routes/logs'; // 
import { sql } from 'drizzle-orm';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));

//test
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

// logs 
app.use('/logs', logsRouter);

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    setInterval(async () => {
      try {
        await db.execute(sql`DELETE FROM logs WHERE timestamp < NOW() - INTERVAL '30 days'`);
        console.log("Background retention cleanup: Old logs deleted successfully.");
      } catch (err) {
        console.error("Failed to clean old logs in background:", err);
      }
    }, 24 * 60 * 60 * 1000);
  });
}

startServer();