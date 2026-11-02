import { StandardRetailPrice1742000000000 } from './migrations/1742000000000-StandardRetailPrice';
import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { databaseConnectionConfig } from './database-config';
import { InitialSchema1741000000000 } from './migrations/1741000000000-InitialSchema';

export default new DataSource({
  ...databaseConnectionConfig(),
  entities: Object.values(entities),
  migrations: [InitialSchema1741000000000, StandardRetailPrice1742000000000],
  migrationsTableName: 'migrations',
  synchronize: false,
});
