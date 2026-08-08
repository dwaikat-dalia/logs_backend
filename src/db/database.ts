import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import dotenv from 'dotenv';
import * as schema from './schema'; // تأكد أن مسار الـ schema صحيح بالنسبة لمكان هذا الملف

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/logs_db';

export const pool = new Pool({
  connectionString,
  max: 20, 
});

export const db = drizzle(pool, { schema });

// connection with db 
export async function connectDB() {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to PostgreSQL database');
    client.release();
  } catch (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
}