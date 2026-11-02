'use strict';
const { PGlite } = require('@electric-sql/pglite');
const { Client } = require('pg');
const { resolve, join } = require('node:path');
const { realpath } = require('node:fs/promises');
require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });
const { databaseConnectionConfig } = require('../../dist/database-config');

const tables = ['roles','users','user_roles','products','product_variants','product_base_prices','bom_components','customers','brands','price_rules','price_tiers','quotes','quote_items','quote_tiers','audit_logs'];
const sourceArg = process.argv.indexOf('--source');
const sourcePath = sourceArg >= 0 ? process.argv[sourceArg + 1] : undefined;
const apply = process.argv.includes('--apply');
const identifier = (s) => '"' + s.replaceAll('"', '""') + '"';
const tablePath = (schema, table) => `${identifier(schema)}.${identifier(table)}`;
async function columns(db, schema, table) {
  const result = await db.query('SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [schema, table]);
  if (!result.rows.length) throw new Error(`数据表不存在：${schema}.${table}`);
  return result.rows;
}
(async () => {
  if (!sourcePath || sourcePath.startsWith('--')) throw new Error('请用 --source 指定已停止服务后制作的 PGlite 数据目录副本');
  const sourceReal = await realpath(resolve(sourcePath));
  const originalPath = resolve(__dirname, '../../data/pglite');
  let originalReal; try { originalReal = await realpath(originalPath); } catch {}
  if (originalReal && sourceReal === originalReal) throw new Error('请先备份并使用数据目录副本，不能直接打开原始数据库');
  const config = databaseConnectionConfig();
  const sourceSchema = 'plm';
  const targetSchema = config.schema;
  const source = await PGlite.create(sourceReal);
  const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.username, password: config.password, ssl: config.ssl });
  let connected = false, begun = false;
  try {
    await client.connect(); connected = true;
    await client.query('BEGIN'); begun = true;
    await client.query(`LOCK TABLE ${tables.map(t => tablePath(targetSchema, t)).join(', ')} IN ACCESS EXCLUSIVE MODE`);
    const tableColumns = new Map();
    const counts = {};
    for (const table of tables) {
      const src = await columns(source, sourceSchema, table);
      const dst = await columns(client, targetSchema, table);
      if (JSON.stringify(src) !== JSON.stringify(dst)) throw new Error(`表结构不一致：${table}；请先核对源和目标数据库迁移版本`);
      tableColumns.set(table, src);
      const srcCount = Number((await source.query(`SELECT COUNT(*) AS n FROM ${tablePath(sourceSchema, table)}`)).rows[0].n);
      const dstCount = Number((await client.query(`SELECT COUNT(*) AS n FROM ${tablePath(targetSchema, table)}`)).rows[0].n);
      if (table !== 'roles' && dstCount !== 0) throw new Error(`目标表 ${table} 已有 ${dstCount} 条记录；为避免覆盖，已中止迁移`);
      counts[table] = srcCount;
    }
    const targetRoles = (await client.query(`SELECT name FROM ${tablePath(targetSchema, 'roles')} ORDER BY name`)).rows.map(r => r.name);
    if (JSON.stringify(targetRoles) !== JSON.stringify(['admin','approver','business'])) throw new Error('目标角色不是初始化默认状态，已中止迁移');
    const sourceRoles = (await source.query(`SELECT * FROM ${tablePath(sourceSchema, 'roles')}`)).rows;
    for (const name of targetRoles) if (!sourceRoles.some(r => r.name === name)) throw new Error(`源数据缺少默认角色 ${name}`);
    console.log('源数据记录数：' + JSON.stringify(counts));
    if (!apply) { await client.query('ROLLBACK'); begun = false; console.log('预检通过；未写入目标数据库。'); return; }
    const roleMap = new Map();
    for (const role of sourceRoles) {
      const result = await client.query(`INSERT INTO ${tablePath(targetSchema, 'roles')} (id, name, label, permissions) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (name) DO UPDATE SET label=EXCLUDED.label, permissions=EXCLUDED.permissions RETURNING id`, [role.id, role.name, role.label, JSON.stringify(role.permissions)]);
      roleMap.set(role.id, result.rows[0].id);
    }
    for (const table of tables.filter(t => t !== 'roles')) {
      const defs = tableColumns.get(table), names = defs.map(c => c.column_name);
      const selectOrder = table === 'user_roles' ? 'user_id, role_id' : 'id';
      let offset = 0;
      while (true) {
        const rows = (await source.query(`SELECT * FROM ${tablePath(sourceSchema, table)} ORDER BY ${selectOrder} LIMIT 200 OFFSET ${offset}`)).rows;
        if (!rows.length) break;
        for (const row of rows) {
          if (table === 'user_roles') { if (!roleMap.has(row.role_id)) throw new Error('源用户关联了不存在的角色'); row.role_id = roleMap.get(row.role_id); }
          const values = defs.map(c => ['json', 'jsonb'].includes(c.udt_name) && row[c.column_name] != null ? JSON.stringify(row[c.column_name]) : row[c.column_name]);
          const args = defs.map((c, i) => `$${i + 1}${['json','jsonb'].includes(c.udt_name) ? '::jsonb' : ''}`);
          await client.query(`INSERT INTO ${tablePath(targetSchema, table)} (${names.map(identifier).join(', ')}) VALUES (${args.join(', ')})`, values);
        }
        offset += rows.length;
      }
      const actual = Number((await client.query(`SELECT COUNT(*) AS n FROM ${tablePath(targetSchema, table)}`)).rows[0].n);
      if (actual !== counts[table]) throw new Error(`${table} 迁移条数不一致，已回滚`);
    }
    await client.query('COMMIT'); begun = false;
    console.log('数据库迁移成功；各业务表条数已核对。图片文件仍需单独保留或复制。');
  } finally {
    if (begun) await client.query('ROLLBACK').catch(() => {});
    if (connected) await client.end().catch(() => {});
    await source.close();
  }
})().catch(err => { console.error('迁移未完成：' + err.message); process.exitCode = 1; });
