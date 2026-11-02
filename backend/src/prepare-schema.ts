import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseConnectionConfig } from './database-config';

async function main() {
  const config = databaseConnectionConfig();
  const schema = config.schema;
  const db = new DataSource(config);
  await db.initialize();
  await db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await db.destroy();
  console.log(`Schema "${schema}" is ready. No existing tables were changed.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
