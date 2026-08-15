import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { connectDB, db } from './db/database';
import logsRouter from './routes/logs';
import { sql } from 'drizzle-orm';
import { refreshRollups } from './services/rollup.service';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', async (req: Request, res: Response) => {
  try {
    await db.execute(sql`SELECT 1`);

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

// Logs
app.use('/logs', logsRouter);
async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  // Build rollups immediately after the server starts
  await refreshRollups();

  // Refresh rollups every 20 seconds
  setInterval(() => {
    void refreshRollups();
  }, 20000);

  // Retention cleanup
  setInterval(async () => {
    try {
      await db.execute(sql`
        DELETE FROM logs
        WHERE id IN (
          SELECT id
          FROM logs
          WHERE timestamp < NOW() - INTERVAL '30 days'
          LIMIT 10000
        )
      `);

      console.log('Retention cleanup completed.');
    } catch (err) {
      console.error('Retention cleanup failed:', err);
    }
  }, 60 * 60 * 1000);
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});