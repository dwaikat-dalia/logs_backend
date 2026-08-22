import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://postgres:password@localhost:5432/logs_db';
export const pool = new Pool({
  connectionString,
  max: 10,
 min:5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export const db = drizzle(pool);

export async function connectDB() {
  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
    console.log('Database connected successfully');
  } finally {
    client.release();
  }
}