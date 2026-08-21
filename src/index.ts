import express, { Request, Response } from 'express';
import cors from "cors";
import { connectDB, db } from './db/database';
import logsRouter from './routes/logs';
import { sql } from 'drizzle-orm';

const app = express();
const PORT = process.env.PORT || 8080;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
  ],
}));

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

// Statistics
app.get('/stats', async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total_logs,
        COUNT(*) FILTER (WHERE level = 'error')::int AS errors,
        COUNT(DISTINCT service)::int AS services
      FROM logs
    `);

    const stats = result.rows[0];

    res.status(200).json({
      total_logs: stats.total_logs,
      errors: stats.errors,
      services: stats.services,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load stats',
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

  // Retention cleanup (تنظيف السجلات القديمة حسب سياسة الاحتفاظ)
  setInterval(async () => {
    try {
      await db.execute(sql`
        DELETE FROM logs
        WHERE id IN (
          SELECT id
          FROM logs
          WHERE timestamp < NOW() - (${RETENTION_DAYS} * INTERVAL '1 day')
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