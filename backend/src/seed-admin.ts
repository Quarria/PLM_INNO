import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { hash } from 'bcryptjs';
import { Role, User } from './entities';
import { databaseConnectionConfig } from './database-config';

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) throw new Error('Set BOOTSTRAP_ADMIN_USERNAME and a BOOTSTRAP_ADMIN_PASSWORD of at least 12 characters');
  const ds = new DataSource({ ...databaseConnectionConfig(), entities: [Role, User], synchronize: false });
  await ds.initialize();
  const repo = ds.getRepository(User);
  const existing = await repo.findOneBy({ username });
  if (existing) throw new Error('That username already exists; bootstrap does not overwrite accounts');
  const role = await ds.getRepository(Role).findOneByOrFail({ name: 'admin' });
  await repo.save(repo.create({ username, displayName: process.env.BOOTSTRAP_ADMIN_NAME || '系统管理员', passwordHash: await hash(password, 12), roles: [role] }));
  await ds.destroy();
  console.log(`Created administrator: ${username}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
