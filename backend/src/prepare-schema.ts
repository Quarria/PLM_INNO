import 'dotenv/config';
import { DataSource } from 'typeorm';

async function main() {
  const url = process.env.DATABASE_URL;
  const schema = process.env.DB_SCHEMA || 'plm';
  if (!url) throw new Error('DATABASE_URL is required');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA must be a simple PostgreSQL schema name');
  const db = new DataSource({ type: 'postgres', url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false });
  await db.initialize();
  await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await db.destroy();
  console.log(`Schema "${schema}" is ready. No existing tables were changed.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
