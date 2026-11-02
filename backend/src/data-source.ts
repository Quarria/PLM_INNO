import { StandardRetailPrice1742000000000 } from './migrations/1742000000000-StandardRetailPrice';
import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { InitialSchema1741000000000 } from './migrations/1741000000000-InitialSchema';

const schema = process.env.DB_SCHEMA || 'plm';
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  schema,
  entities: Object.values(entities),
  migrations: [InitialSchema1741000000000, StandardRetailPrice1742000000000],
  migrationsTableName: 'migrations',
  synchronize: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});
