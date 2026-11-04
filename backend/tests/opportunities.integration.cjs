/* Isolated acceptance: all writes target a new random schema and OS temporary files. */
require('reflect-metadata');
const assert = require('node:assert/strict');
const { join, resolve, relative, isAbsolute, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { mkdtemp, rm } = require('node:fs/promises');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { hash } = require('bcryptjs');
require('dotenv').config({ path: join(__dirname, '../.env'), quiet: true });
const { databaseConnectionConfig } = require('../dist/database-config');
const config = databaseConnectionConfig();
const client = new Client({ host: config.host, port: config.port, database: config.database, user: config.username, password: config.password, ssl: config.ssl, connectionTimeoutMillis: 10000 });
const schema = `plm_opportunity_test_${randomBytes(6).toString('hex')}`;
const port = Number(process.env.OPPORTUNITY_TEST_PORT || 3108);
const preview = process.argv.includes('--preview');
const username = 'opportunity-preview';
const password = preview ? 'Opportunity-Preview-2026!' : randomBytes(18).toString('hex');
const base = `http://127.0.0.1:${port}`;
let server, filesRoot, connected = false, schemaCreated = false, checks = 0, logs = '', token = '';
const t = name => `"${schema}"."${name}"`;

async function req(path, body, expected = 200, method, auth = token) {
  const response = await fetch(`${base}/api${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const value = await response.json();
  if (expected === 200) assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}`);
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(value)}`);
  checks++;
  return value;
}
const actionBody = (op, reason, extra = {}) => ({ expected_version: op.version, request_id: randomUUID(), reason, ...extra });
const docBody = (op, extra = {}) => ({ name: '节点业务记录', type: '业务记录', business_date: '2026-11-04', stage_run_id: op.current_stage_run_id, ...extra });
async function create(customerId, name = '华东客户便携风扇合作', extra = {}, auth = token) { return req('/opportunities', { name, customer_id: customerId, ...extra }, 200, 'POST', auth); }
async function advance(op, reason = '本节点工作已完成') { return req(`/opportunities/${op.id}/advance`, actionBody(op, reason)); }

async function main() {
  await client.connect(); connected = true;
  await client.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  filesRoot = await mkdtemp(join(tmpdir(), 'plm-opportunity-test-'));
  const env = { ...process.env, DB_SCHEMA: schema, PORT: String(port), HOST: '127.0.0.1', JWT_SECRET: randomBytes(32).toString('hex'), MEDIA_DIR: join(filesRoot, 'media'), OPPORTUNITY_FILES_DIR: join(filesRoot, 'private') };
  const cli = require.resolve('typeorm/cli.js');
  execFileSync(process.execPath, [cli, 'migration:run', '-d', join(__dirname, '../dist/data-source.js')], { cwd: join(__dirname, '..'), env, stdio: 'pipe', windowsHide: true });
  const createUser = async (name, displayName, role) => {
    const [{ id }] = (await client.query(`INSERT INTO ${t('users')}(username,"displayName","passwordHash") VALUES($1,$2,$3) RETURNING id`, [name, displayName, await hash(password, 4)])).rows;
    await client.query(`INSERT INTO ${t('user_roles')}(user_id,role_id) SELECT $1,id FROM ${t('roles')} WHERE name=$2`, [id, role]);
    return id;
  };
  await client.query(`INSERT INTO ${t('roles')}(name,label,permissions) VALUES ('op-viewer','商机查看','["opportunity:view"]'),('op-manager','商机经理','["opportunity:view","opportunity:manage"]'),('op-none','无商机权限','[]')`);
  const adminId = await createUser(username, '商机验收管理员', 'admin');
  const businessId = await createUser('op-business', '业务负责人', 'business');
  const otherId = await createUser('op-other', '另一位业务员', 'business');
  await createUser('op-viewer', '只读人员', 'op-viewer');
  await createUser('op-manager', '商机经理', 'op-manager');
  await createUser('op-none', '无权限人员', 'op-none');
  server = spawn(process.execPath, [join(__dirname, '../dist/main.js')], { cwd: join(__dirname, '..'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', x => { logs = (logs + x).slice(-24000); });
  server.stderr.on('data', x => { logs = (logs + x).slice(-24000); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Isolated test server exited before ready');
    try { if ((await fetch(`${base}/api/health`)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  assert.ok(ready, 'Isolated test server did not start');
  const login = async name => (await req('/auth/login', { username: name, password }, 200, 'POST', '')).accessToken;
  token = await login(username);
  const businessToken = await login('op-business'), otherToken = await login('op-other'), viewerToken = await login('op-viewer'), managerToken = await login('op-manager'), noneToken = await login('op-none');
  const customer = await req('/customers', { name: '华东客户', contact: '陈经理', phone: '', notes: '' });
  const otherCustomer = await req('/customers', { name: '华南客户' });
  const product = await req('/products', { sku: 'OP-FAN-01', name: '便携风扇', kind: 'product', variants: [{ specification: '白色 / 5000mAh', unit: '台' }] });
  const brand = await req('/brands', { name: '毅诺', kind: 'own' });
  const [{ id: quoteId }] = (await client.query(`INSERT INTO ${t('quotes')}(quote_number,"quoteType",customer_id,brand_id,status,quote_date,expires_at,customer_snapshot,brand_snapshot,created_by) VALUES('OP-Q-01','own',$1,$2,'draft','2026-11-04','2026-12-04',$3,$4,$5) RETURNING id`, [customer.id, brand.id, JSON.stringify({ name: customer.name }), JSON.stringify({ name: brand.name }), adminId])).rows;
  const [{ id: otherQuoteId }] = (await client.query(`INSERT INTO ${t('quotes')}(quote_number,"quoteType",customer_id,brand_id,status,quote_date,expires_at,customer_snapshot,brand_snapshot,created_by) VALUES('OP-Q-02','own',$1,$2,'draft','2026-11-04','2026-12-04',$3,$4,$5) RETURNING id`, [otherCustomer.id, brand.id, JSON.stringify({ name: otherCustomer.name }), JSON.stringify({ name: brand.name }), adminId])).rows;

  await req('/opportunities', undefined, 401, 'GET', '');
  await req('/opportunities', undefined, 403, 'GET', noneToken);
  await req('/opportunities', { name: '非法新建', customer_id: customer.id }, 403, 'POST', viewerToken);
  await req('/opportunities', { name: '指定他人', customer_id: customer.id, owner_id: otherId }, 403, 'POST', businessToken);
  await req('/opportunities', { name: '', customer_id: customer.id }, 400);
  await req('/opportunities', { name: '日期错误', customer_id: customer.id, expected_completion_date: '2026-02-30' }, 400);
  await req('/opportunities', { name: '报价错客户', customer_id: customer.id, quote_ids: [otherQuoteId] }, 400);
  let op = await create(customer.id, '华东客户便携风扇贴牌合作', { product_variant_ids: [product.variants[0].id], quote_ids: [quoteId], expected_amount: '128000.00' });
  assert.equal(op.current_stage, 'sampling'); assert.equal(op.status, 'in_progress'); assert.ok(op.permissions.can_edit);
  assert.equal(op.products.length, 1); assert.deepEqual(op.quote_ids, [quoteId]); assert.equal(op.customer_name, customer.name);
  let reread = await req(`/opportunities/${op.id}`);
  assert.equal(reread.current_stage_run_id, op.current_stage_run_id); assert.equal(reread.stage_runs.length, 1);
  assert.equal((await req('/opportunities?q=贴牌&stage=sampling&status=in_progress&page=1&size=20')).total, 1);
  assert.equal((await req('/opportunities?q=不存在&page=1&size=20')).total, 0);
  const opts = await req(`/opportunities/options?customer_id=${customer.id}`, undefined, 200, 'GET', managerToken);
  assert.ok(opts.users.some(u => u.id === businessId)); assert.ok(opts.quotes.some(q => q.id === quoteId)); assert.ok(!opts.quotes.some(q => q.id === otherQuoteId));
  const asViewer = await req(`/opportunities/${op.id}`, undefined, 200, 'GET', viewerToken);
  assert.equal(asViewer.permissions.can_edit, false);
  await req(`/opportunities/${op.id}/documents`, docBody(op), 403, 'POST', viewerToken);
  await req(`/opportunities/${op.id}/documents`, docBody(op), 403, 'POST', otherToken);
  await req(`/opportunities/${op.id}/advance`, actionBody(op, ''), 400);
  await req(`/opportunities/${op.id}`, { version: op.version, name: op.name, customer_id: customer.id, status: 'completed' }, 400, 'PATCH');

  // Chinese filename, authenticated download, cross-opportunity ID and temporary file binding.
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
  const uploadForm = new FormData(); uploadForm.append('file', new Blob([pdf], { type: 'application/pdf' }), '打样检测报告.pdf');
  const att = await req(`/opportunities/${op.id}/attachments`, uploadForm);
  assert.equal(att.file_name, '打样检测报告.pdf', 'Chinese filenames must survive multipart upload');
  for (const name of ['大.pdf', 'café.pdf']) {
    const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), name);
    const file = await req(`/opportunities/${op.id}/attachments`, form);
    assert.equal(file.file_name, name, 'UTF-8 names without C1 bytes must also survive upload');
    await client.query(`UPDATE ${t('opportunity_attachments')} SET created_at=now()-interval '8 days' WHERE id=$1`, [file.id]);
  }
  const expired = await client.query(`SELECT count(*)::int n FROM ${t('opportunity_attachments')} WHERE document_id IS NULL AND created_at<now()-interval '7 days'`);
  assert.equal(expired.rows[0].n, 1, 'Expired temporary uploads are cleaned on the next upload');
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '第一轮打样记录', type: '检测报告', attachment_ids: [att.id] }));
  const firstRun = op.current_stage_run_id, firstDoc = op.stage_runs.find(r => r.id === firstRun).documents[0];
  assert.equal(firstDoc.attachments[0].id, att.id); assert.equal(op.current_stage, 'sampling');
  const download = await fetch(`${base}/api/opportunities/${op.id}/attachments/${att.id}`, { headers: { Authorization: `Bearer ${viewerToken}` } });
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf); checks++;
  const anonymousDownload = await fetch(`${base}/api/opportunities/${op.id}/attachments/${att.id}`); assert.equal(anonymousDownload.status, 401); checks++;
  const privateDownload = await fetch(`${base}/api/opportunities/${op.id}/attachments/${att.id}`, { headers: { Authorization: `Bearer ${noneToken}` } }); assert.equal(privateDownload.status, 403); checks++;
  const otherOp = await create(customer.id, '附件隔离商机');
  const crossDownload = await fetch(`${base}/api/opportunities/${otherOp.id}/attachments/${att.id}`, { headers: { Authorization: `Bearer ${token}` } }); assert.equal(crossDownload.status, 404); checks++;
  await req(`/opportunities/${otherOp.id}/documents`, docBody(otherOp, { attachment_ids: [att.id] }), 400);
  const badFile = new FormData(); badFile.append('file', new Blob(['executable content']), 'fake.pdf');
  await req(`/opportunities/${op.id}/attachments`, badFile, 400);
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('打样明细').addRow(['产品', '便携风扇']);
  const xlsx = await workbook.xlsx.writeBuffer();
  const officeFile = new FormData(); officeFile.append('file', new Blob([xlsx]), '打样明细.xlsx');
  const officeAtt = await req(`/opportunities/${op.id}/attachments`, officeFile);
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '打样数量明细', type: '打样记录', attachment_ids: [officeAtt.id] }));
  const renamedOffice = new FormData(); renamedOffice.append('file', new Blob([xlsx]), '伪装合同.docx');
  await req(`/opportunities/${op.id}/attachments`, renamedOffice, 400);

  // Exactly one winner for different concurrent requests; identical request is idempotent.
  const a = actionBody(op, '样品确认可送样'), b = actionBody(op, '另一位人员同时推进');
  const rawAdvance = body => fetch(`${base}/api/opportunities/${op.id}/advance`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const concurrent = await Promise.all([rawAdvance(a), rawAdvance(b)]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]); checks += 2;
  const winner = concurrent[0].status === 201 ? a : b;
  op = await req(`/opportunities/${op.id}/advance`, winner);
  assert.equal(op.current_stage, 'delivery');
  assert.equal(op.events.filter(e => e.action === 'advanced').length, 1);
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '顺丰送样单', type: '送样单', extra_data: { carrier: '顺丰', tracking_number: 'SF-OP-01' } }));
  op = await advance(op);
  assert.equal(op.current_stage, 'feedback');
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '客户要求调整风量', type: '客户反馈', extra_data: { feedback_result: 'needs_revision' } }));
  await req(`/opportunities/${op.id}/advance`, actionBody(op, ''), 400);
  const feedbackRun = op.current_stage_run_id;
  op = await req(`/opportunities/${op.id}/return`, actionBody(op, '客户要求调整后重新打样', { target_stage: 'sampling' }));
  assert.equal(op.current_stage, 'sampling'); assert.notEqual(op.current_stage_run_id, firstRun);
  assert.equal(op.stage_runs.find(r => r.id === firstRun).documents[0].name, '第一轮打样记录');
  assert.equal(op.stage_runs.find(r => r.id === feedbackRun).result, 'returned');
  await req(`/opportunities/${op.id}/documents`, docBody(op, { stage_run_id: feedbackRun }), 409);
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '第二轮打样单据' }));
  op = await advance(op);
  const delivery = op.current_stage_run_id;
  assert.equal(op.stage_runs.filter(r => r.stage === 'delivery').length, 2);
  // Supplement a previous reached stage while the current stage remains delivery.
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { stage_run_id: firstRun, name: '补录第一轮检测结果' }));
  assert.equal(op.current_stage_run_id, delivery);
  op = await advance(op);
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '客户测试通过', type: '反馈记录', extra_data: { feedback_result: 'passed' } }));
  op = await advance(op);
  assert.equal(op.current_stage, 'contract');
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '正式签约合同', type: '已签合同', extra_data: { contract_number: 'HT2026-001', contract_amount: '128000.00' } }));
  await req(`/opportunities/${op.id}/advance`, actionBody(op, ''), 400);
  op = await advance(op, '合同已签订，商机成功结案');
  assert.equal(op.current_stage, 'completed'); assert.equal(op.status, 'completed'); assert.ok(op.completed_at);
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { name: '完成交接记录', type: '结案说明' }));
  assert.equal(op.status, 'completed');
  op = await req(`/opportunities/${op.id}/documents`, docBody(op, { stage_run_id: firstRun, name: '结案后补录打样档案' }));
  await req(`/opportunities/${op.id}/advance`, actionBody(op, '重复完成'), 409);
  await req(`/opportunities/${op.id}/documents/${firstDoc.id}/void`, { reason: '结案后禁止修改历史' }, 409);
  await req(`/opportunities/${op.id}`, { version: op.version, name: '结案后修改', customer_id: customer.id }, 409, 'PATCH');
  assert.equal((await req(`/opportunities/${op.id}`)).status, 'completed');
  assert.equal((await client.query(`SELECT status FROM ${t('quotes')} WHERE id=$1`, [quoteId])).rows[0].status, 'draft');
  assert.equal((await client.query(`SELECT count(*)::int n FROM ${t('ops_sales_orders')}`)).rows[0].n, 0);

  // Ownership, management without write, void, and termination are separate paths.
  let owned = await create(customer.id, '业务员负责商机', {}, businessToken);
  assert.equal(owned.owner_id, businessId);
  const mgrView = await req(`/opportunities/${owned.id}`, undefined, 200, 'GET', managerToken); assert.ok(mgrView.permissions.can_edit);
  owned = await req(`/opportunities/${owned.id}`, { version: owned.version, name: '经理修改资料', customer_id: customer.id }, 200, 'PATCH', managerToken);
  owned = await req(`/opportunities/${owned.id}/documents`, docBody(owned, { name: '需作废打样记录' }), 200, 'POST', managerToken);
  const voidDoc = owned.stage_runs.find(r => r.id === owned.current_stage_run_id).documents[0];
  owned = await req(`/opportunities/${owned.id}/documents/${voidDoc.id}/void`, { reason: '录入错误' }, 200, 'POST', managerToken);
  assert.ok(owned.stage_runs.find(r => r.id === owned.current_stage_run_id).documents[0].is_void);
  await req(`/opportunities/${owned.id}/advance`, actionBody(owned, ''), 400, 'POST', managerToken);
  owned = await req(`/opportunities/${owned.id}/transfer`, { owner_id: otherId, reason: '业务交接' }, 200, 'POST', managerToken);
  assert.equal(owned.owner_id, otherId);
  await req(`/opportunities/${owned.id}/documents`, docBody(owned), 403, 'POST', businessToken);
  owned = await req(`/opportunities/${owned.id}/terminate`, actionBody(owned, '客户取消项目'), 200, 'POST', otherToken);
  assert.equal(owned.status, 'terminated'); assert.equal(owned.current_stage, 'sampling'); assert.equal(owned.termination_reason, '客户取消项目');
  await req(`/opportunities/${owned.id}/return`, actionBody(owned, '不能重新开启', { target_stage: 'sampling' }), 409, 'POST', managerToken);
  await req(`/opportunities/${owned.id}/documents/${voidDoc.id}/void`, { reason: '已终止禁止作废' }, 409, 'POST', managerToken);
  owned = await req(`/opportunities/${owned.id}/documents`, docBody(owned, { name: '终止后说明补录' }), 200, 'POST', managerToken);
  assert.equal(owned.status, 'terminated');
  const noPermissionDownload = await fetch(`${base}/media/${att.id}`); assert.equal(noPermissionDownload.status, 404); checks++;
  const schemaCounts = (await client.query(`SELECT (SELECT count(*) FROM ${t('opportunities')})::int opportunities,(SELECT count(*) FROM ${t('opportunity_events')})::int events`)).rows[0];
  assert.ok(schemaCounts.opportunities >= 3); assert.ok(schemaCounts.events > 15);
  console.log(`PASS: ${checks} API checks; isolated migrations, five stages, documents, authenticated Chinese attachment download, concurrency, replay, return rounds, completion, termination, ownership and manager-only permissions.`);
  if (preview) {
    console.log(`Isolated UI preview ready: ${base}; account ${username}; use documented preview password. Send stop on stdin to clean up.`);
    await new Promise(resolve => {
      process.once('SIGINT', resolve); process.once('SIGTERM', resolve);
      process.stdin.resume(); process.stdin.on('data', data => { if (String(data).trim() === 'stop') resolve(); });
    });
    process.stdin.pause();
  }
}

main().catch(e => { console.error(e.stack || e.message); if (logs) console.error(logs.slice(-7000)); process.exitCode = 1; }).finally(async () => {
  if (server && server.exitCode === null) { server.kill(); await new Promise(r => server.once('exit', r)); }
  if (connected && schemaCreated && /^plm_opportunity_test_[a-f0-9]{12}$/.test(schema)) {
    try { await client.query(`DROP SCHEMA "${schema}" CASCADE`); } catch (e) { console.error('Isolated schema cleanup failed:', e.message); process.exitCode = 1; }
  }
  if (filesRoot) {
    const rel = relative(resolve(tmpdir()), resolve(filesRoot));
    if (rel && !rel.startsWith('..') && !isAbsolute(rel) && /^plm-opportunity-test-/.test(basename(filesRoot))) await rm(filesRoot, { recursive: true, force: true });
    else throw new Error('Refusing unsafe temporary directory cleanup');
  }
  await client.end();
});
