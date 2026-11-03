/* Run against an automatically created isolated schema, never business tables. */
require('reflect-metadata');
const { join } = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { hash } = require('bcryptjs');
require('dotenv').config({ path: join(__dirname, '../.env') });
const schema = `plm_ops_test_${randomBytes(6).toString('hex')}`;
const { databaseConnectionConfig } = require('../dist/database-config');
const config = databaseConnectionConfig();
const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.username, password: config.password, ssl: config.ssl });
const port = 3107;
let server;
let token;
let checks = 0;
let serverLogs = '';
async function request(path, data, expected = 200, method) {
  const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: method || (data ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const value = await response.json();
  if (expected === 'reject') assert.ok(response.status >= 400 && response.status < 500, `${path}: expected rejection, got ${response.status} ${JSON.stringify(value)}`);
  else assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
  checks++;
  return value;
}
async function main() {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  const env = { ...process.env, DB_SCHEMA: schema, PORT: String(port), HOST: '127.0.0.1', JWT_SECRET: randomBytes(32).toString('hex') };
  const cli = require.resolve('typeorm/cli.js');
  execFileSync(process.execPath, [cli, 'migration:run', '-d', join(__dirname, '../dist/data-source.js')], { cwd: join(__dirname, '..'), env, stdio: 'pipe' });
  const previewMode = process.argv.includes('--preview');
  const password = previewMode ? 'Experience-Only-2026!' : randomBytes(12).toString('hex');
  const [{ id: userId }] = (await client.query(`INSERT INTO "${schema}".users(username,"displayName","passwordHash") VALUES ('integration','测试账号',$1) RETURNING id`, [await hash(password, 4)])).rows;
  await client.query(`INSERT INTO "${schema}".user_roles(user_id,role_id) SELECT $1,id FROM "${schema}".roles WHERE name='admin'`, [userId]);
  let logs = '';
  server = spawn(process.execPath, [join(__dirname, '../dist/main.js')], { cwd: join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', x => { logs = (logs + x).slice(-12000); serverLogs = logs; });
  server.stderr.on('data', x => { logs = (logs + x).slice(-12000); serverLogs = logs; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Test server failed: ${logs}`);
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, 'Test server did not start');
  token = (await request('/auth/login', { username: 'integration', password })).accessToken;
  const now = new Date().toISOString();
  const product = await request('/products', { sku: 'TEST-P', name: '测试主机', kind: 'product', sellingPoints: '测试卖点\n多行', variants: [{ specification: '测试规格', unit: '台' }] });
  const bundle = await request('/products', { sku: 'TEST-B', name: '测试套装', kind: 'bundle', variants: [{ specification: '测试套装规格', unit: '套' }] });
  assert.ok(product.materialCode && bundle.materialCode);
  await request(`/products/${product.id}`, { sellingPoints: '' }, 200, 'PATCH');
  const store = await request('/operations/stores', { platform: '测试平台', name: '测试店铺' });
  const editableStore = await request('/operations/stores', { platform: '测试平台', name: '临时店铺' });
  const renamedStore = await request(`/operations/stores/${editableStore.id}`, { platform: '测试平台', name: '已修改店铺' }, 200, 'PATCH');
  assert.equal(renamedStore.name, '已修改店铺');
  await request(`/operations/stores/${editableStore.id}`, undefined, 200, 'DELETE');
  const warehouses = await request('/operations/warehouses');
  await request('/operations/catalog?q=TEST&page=1');
  await request(`/operations/catalog?id=${product.id}`);
  const warehouse = warehouses[0].id;
  await request('/operations/receipts', { type: 'initial', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: product.id, batch_number: 'LOT-01', serial_numbers: ['0001', '0002', '0003', '0004'] }] });
  await request('/operations/receipts', { type: 'purchase', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: product.id, batch_number: 'LOT-01', serial_numbers: ['0001'] }] }, 'reject');
  await request(`/products/${product.id}`, { materialCode: 'CHANGED' }, 'reject', 'PATCH');
  const campaign = await request('/operations/campaigns', { name: '测试大促', store_id: store.id, starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(), items: [{ product_id: product.id, list_price: '100.00', rules: [{ name: '店铺券', type: 'fixed', amount: '10.00', bearer: 'merchant' }, { name: '平台券', type: 'percent', amount: '10', bearer: 'platform' }] }] });
  await request(`/operations/stores/${store.id}`, undefined, 'reject', 'DELETE');
  const emptyCampaignBody = { name: '空活动', store_id: store.id, starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(), items: [] };
  const emptyCampaign = await request('/operations/campaigns', emptyCampaignBody);
  await request(`/operations/campaigns/${emptyCampaign.id}/publish`, {}, 'reject');
  const withProduct = await request(`/operations/campaigns/${emptyCampaign.id}`, { ...emptyCampaignBody, version: emptyCampaign.version, items: [{ product_id: product.id, list_price: '99', rules: [] }] }, 200, 'PATCH');
  assert.equal(withProduct.items.length, 1);
  assert.equal((await request(`/operations/campaigns/${emptyCampaign.id}`)).items[0].sku, product.sku);
  await request(`/operations/campaigns/${emptyCampaign.id}`, { ...emptyCampaignBody, version: emptyCampaign.version }, 'reject', 'PATCH');
  await request(`/operations/campaigns/${campaign.id}/publish`, {});
  await request('/operations/campaigns?q=测试&page=1&size=10');
  const preview = await request(`/operations/campaigns/${campaign.id}/preview`, { product_id: product.id, quantity: 1, rule_indexes: [0, 1] });
  assert.equal(Number(preview.paid_amount), 81);
  const order = await request('/operations/orders', { external_number: 'EXT-1', channel: '电商', store_id: store.id, customer_name: '测试收货方', ordered_at: now, shipping_amount: '0', paid_amount: '162', discounts_complete: true, items: [{ product_id: product.id, quantity: 2, unit_price: '100', campaign_id: campaign.id }], discounts: [{ name: '店铺券', amount: '20', bearer: 'merchant' }, { name: '平台券', amount: '18', bearer: 'platform' }] });
  assert.equal(Number(order.paid_amount), 162);
  await request('/operations/orders?q=EXT&page=1&size=10');
  await request('/operations/orders', { channel: '电商', customer_name: '错误金额', ordered_at: now, shipping_amount: '0', paid_amount: '1', discounts_complete: true, items: [{ product_id: product.id, quantity: 1, unit_price: '100' }], discounts: [] }, 'reject');
  const units = (await request(`/operations/units?product_id=${product.id}&status=available&page=1&size=10`)).items;
  assert.equal(units.length, 4);
  const issue = { type: 'sale', warehouse_id: warehouse, occurred_at: now, recipient: '测试收货方', reason: '销售发货', sales_order_id: order.id, carrier: '测试物流', tracking_number: 'TRACK-1', shipping_cost: '8.50', unit_ids: [units[0].id] };
  const failures = [];
  const attemptIssue = () => request('/operations/issues', issue).then(() => true).catch(e => { failures.push(e.message); return false; });
  const parallel = await Promise.all([attemptIssue(), attemptIssue()]);
  if (!parallel.some(Boolean)) console.error('Concurrent issue errors:', failures.join('; '));
  assert.equal(parallel.filter(Boolean).length, 1, 'Concurrent same serial must be posted only once');
  await request('/operations/issues', { ...issue, unit_ids: [units[1].id] });
  await request('/operations/issues', { ...issue, unit_ids: [units[2].id] }, 'reject');
  await request(`/operations/orders/${order.id}/cancel`, {}, 'reject');
  await request(`/operations/orders/${order.id}/refunds`, { amount: '10.00', reason: '部分退款' });
  const afterRefund = await request(`/operations/units?product_id=${product.id}&status=shipped`);
  assert.equal(afterRefund.total, 2, 'Refund alone must not restock');
  await request('/operations/receipts', { type: 'return', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: product.id, batch_number: 'LOT-01', serial_numbers: [units[0].serial_number] }] });
  const stats = await request(`/operations/campaign-stats?campaign_id=${campaign.id}`);
  assert.ok(stats.items.length);
  assert.equal(stats.items[0].shipped_quantity, 2);
  assert.equal(stats.items[0].returned_quantity, 1);
  const pending = await request(`/operations/units?product_id=${product.id}&status=pending`);
  assert.equal(pending.total, 1);
  await request('/operations/inspections', { unit_id: pending.items[0].id, warehouse_id: warehouse, occurred_at: now, result: 'available', reason: '验收通过' });
  const unknownOrder = await request('/operations/orders', { channel: '线下', customer_name: '待补优惠', ordered_at: now, shipping_amount: '0', paid_amount: '8', discounts_complete: false, items: [{ product_id: product.id, quantity: 1, unit_price: '10' }], discounts: [] });
  assert.equal(Number(unknownOrder.items[0].paid_amount), 8);
  assert.equal(Number(unknownOrder.undisclosed_discount_amount), 2);
  const supplemented = await request(`/operations/orders/${unknownOrder.id}/discounts`, { discounts_complete: true, discounts: [{ name: '补录店铺券', amount: '2', bearer: 'merchant' }] });
  assert.equal(Number(supplemented.paid_amount), 8);
  await request(`/operations/orders/${unknownOrder.id}/discounts`, { discounts_complete: true, discounts: [] }, 'reject');
  const cancelOrder = await request('/operations/orders', { channel: '线下', customer_name: '预留测试', ordered_at: now, shipping_amount: '0', paid_amount: '100', discounts_complete: true, items: [{ product_id: product.id, quantity: 1, unit_price: '100' }], discounts: [] });
  await request('/operations/reservations', { sales_order_id: cancelOrder.id, unit_ids: [units[0].id], warehouse_id: warehouse, occurred_at: now, reason: '订单锁货' });
  const reserved = await request(`/operations/units?product_id=${product.id}&status=reserved`);
  assert.equal(reserved.total, 1);
  await request('/operations/issues', { ...issue, sales_order_id: unknownOrder.id, unit_ids: [units[0].id] }, 'reject');
  await request(`/operations/orders/${cancelOrder.id}/cancel`, {});
  assert.equal((await request(`/operations/units?product_id=${product.id}&status=reserved`)).total, 0);
  await request('/operations/issues', { ...issue, sales_order_id: cancelOrder.id, unit_ids: [units[0].id] }, 'reject');
  await request('/operations/reservations', { sales_order_id: unknownOrder.id, unit_ids: [units[0].id], warehouse_id: warehouse, occurred_at: now, reason: '为已补录订单备货' });
  assert.equal((await request(`/operations/units?status=reserved&reserved_order_id=${unknownOrder.id}`)).total, 1);
  assert.ok((await request(`/operations/units?status=dispatchable&dispatch_order_id=${unknownOrder.id}`)).items.some(u => u.id === units[0].id));
  await request('/operations/issues', { ...issue, sales_order_id: unknownOrder.id, tracking_number: 'TRACK-UNKNOWN', unit_ids: [units[0].id] });
  await request('/operations/receipts', { type: 'return', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: product.id, batch_number: 'LOT-01', serial_numbers: [units[0].serial_number] }] });
  await request('/operations/inspections', { unit_id: units[0].id, warehouse_id: warehouse, occurred_at: now, result: 'available', reason: '二次验收' });
  await request('/operations/assemblies', { product_id: bundle.id, serial_number: 'SET-0001', batch_number: 'LOT-SET', warehouse_id: warehouse, occurred_at: now, unit_ids: [units[2].id, units[3].id] });
  await request('/operations/issues', { type: 'sample', warehouse_id: warehouse, occurred_at: now, recipient: '测试接收人', reason: '寄样', unit_ids: [units[2].id] }, 'reject');
  const trace = await request('/operations/trace?q=SET-0001');
  assert.equal(trace.units[0].components.length, 2);
  await request('/operations/disassemblies', { unit_id: trace.units[0].id, warehouse_id: warehouse, occurred_at: now, reason: '测试拆套' });
  const componentTrace = await request(`/operations/trace?q=${units[2].serial_number}`);
  assert.ok(componentTrace.units[0].history.length >= 2);
  const borrowUnit = units[2].id;
  await request('/operations/issues', { type: 'borrow', warehouse_id: warehouse, occurred_at: now, recipient: '测试借用人', reason: '借样试用', expected_return_at: new Date(Date.now() + 86400000).toISOString(), unit_ids: [borrowUnit] });
  await request('/operations/receipts', { type: 'borrow_return', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: product.id, batch_number: 'LOT-01', serial_numbers: [units[2].serial_number] }] });
  await request('/operations/receipts', { type: 'purchase', warehouse_id: warehouse, occurred_at: now, items: [{ product_id: bundle.id, batch_number: 'FACTORY-LOT', serial_numbers: ['SET-FACTORY-01'] }] });
  const factoryTrace = await request('/operations/trace?q=SET-FACTORY-01');
  assert.equal(factoryTrace.units[0].traceability_pending, true);
  await request('/operations/bundle-components', { unit_id: factoryTrace.units[0].id, warehouse_id: warehouse, occurred_at: now, reason: '登记厂家套装组成', unit_ids: [units[0].id, units[3].id] });
  const factoryComplete = await request('/operations/trace?q=SET-FACTORY-01');
  assert.equal(factoryComplete.units[0].traceability_pending, false);
  assert.equal(factoryComplete.units[0].components.length, 2);
  assert.equal((await request('/operations/trace?q=TRACK-1')).units.length, 2);
  await request('/operations/stock?q=TEST&page=1&size=10');
  await request('/operations/movements?page=1&size=10');
  console.log(`PASS: ${checks} API checks, isolated migrations, coupon calculation, amount validation, concurrent serial safety, over-shipping prevention, refund, return, assembly, trace and borrowing.`);
  if (previewMode) {
    console.log(`Isolated UI preview ready on http://127.0.0.1:${port}; Ctrl+C cleans the test schema.`);
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
}
main().catch(e => { console.error(e.message); console.error(serverLogs.slice(-5000)); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); }
  if (/^plm_ops_test_[a-f0-9]{12}$/.test(schema)) {
    try { await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } catch (e) { console.error('Test schema cleanup failed:', e.message); process.exitCode = 1; }
  }
  await client.end();
});
