// src/config/database.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:password@localhost:5432/logs_db';

export const pool = new Pool({
  connectionString,
});

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
