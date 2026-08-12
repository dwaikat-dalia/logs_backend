import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import dotenv from 'dotenv';

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:password@localhost:5432/logs_db';

export const pool = new Pool({
  connectionString,

  max: 10,

  min: 2,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 5000,

  allowExitOnIdle: false,
});

export const db = drizzle(pool);

export async function connectDB() {
  await pool.query('SELECT 1');
  console.log('Database connected successfully');
}