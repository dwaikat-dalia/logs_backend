import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:password@localhost:5432/logs_db';

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: false,
});

export const db = drizzle(pool);

export async function connectDB() {
  await pool.query('SELECT 1');
  console.log('Database connected successfully');
}