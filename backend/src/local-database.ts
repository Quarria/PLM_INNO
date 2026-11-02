import { StandardRetailPrice1742000000000 } from './migrations/1742000000000-StandardRetailPrice';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as entities from './entities';
import { Role, User } from './entities';
import { InitialSchema1741000000000 } from './migrations/1741000000000-InitialSchema';

export async function startLocalDatabase() {
  const schema = process.env.DB_SCHEMA || 'plm';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA must be a simple PostgreSQL schema name');
  const port = Number(process.env.PGLITE_PORT || 15432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PGLITE_PORT is invalid');
  const dataDir = resolve(process.env.PGLITE_DATA_DIR || './data/pglite');
  mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 1 });
  try {
    await db.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await server.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
    process.env.DB_SSL = 'false';
    const ds = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, schema, entities: Object.values(entities), migrations: [InitialSchema1741000000000, StandardRetailPrice1742000000000], migrationsTableName: 'migrations', synchronize: false, extra: { max: 1 } });
    await ds.initialize();
    try {
      await ds.runMigrations();
      const users = ds.getRepository(User);
      if (await users.count() === 0) {
        const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
        const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
        if (!username || !password || password.length < 12) throw new Error('Set BOOTSTRAP_ADMIN_USERNAME and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters in backend/.env');
        const role = await ds.getRepository(Role).findOneByOrFail({ name: 'admin' });
        await users.save(users.create({ username, displayName: process.env.BOOTSTRAP_ADMIN_NAME || '系统管理员', passwordHash: await hash(password, 12), roles: [role] }));
        console.log('Initial administrator created.');
      }
    } finally { await ds.destroy(); }
    for (let i = 0; i < 40 && server.getStats().activeConnections; i++) await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    return async () => { await server.stop(); await db.close(); };
  } catch (error) {
    await server.stop().catch(() => undefined);
    await db.close();
    throw error;
  }
}
