import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import { connectDB, db } from './db/database';
import logsRouter from './routes/logs'; // استدعاء الراوتر الجديد

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
  });
}

startServer();