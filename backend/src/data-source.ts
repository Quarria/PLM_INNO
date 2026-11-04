import { StandardRetailPrice1742000000000 } from './migrations/1742000000000-StandardRetailPrice';
import { ProductSellingPoints1743000000000 } from './migrations/1743000000000-ProductSellingPoints';
import { ProductMaterialCode1743500000000 } from './migrations/1743500000000-ProductMaterialCode';
import { InventoryOperations1744000000000 } from './migrations/1744000000000-InventoryOperations';
import { CommerceOperations1745000000000 } from './migrations/1745000000000-CommerceOperations';
import { Opportunities1746000000000 } from './migrations/1746000000000-Opportunities';
import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as entities from './entities';
import { databaseConnectionConfig } from './database-config';
import { InitialSchema1741000000000 } from './migrations/1741000000000-InitialSchema';

export default new DataSource({
  ...databaseConnectionConfig(),
  entities: Object.values(entities),
  migrations: [InitialSchema1741000000000, StandardRetailPrice1742000000000, ProductSellingPoints1743000000000, ProductMaterialCode1743500000000, InventoryOperations1744000000000, CommerceOperations1745000000000, Opportunities1746000000000],
  migrationsTableName: 'migrations',
  synchronize: false,
});
