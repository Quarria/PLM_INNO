import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { OpsDatabase } from './ops-database';
import { allocateCents, calculateCampaign, cents, fromCents, money } from './commerce-calculation';
import { InventoryService } from './inventory.service';

type Row = Record<string, any>;
type CampaignRule = { name: string; type: 'fixed' | 'percent' | 'threshold'; amount: Decimal; threshold?: Decimal; cap?: Decimal; bearer: 'merchant' | 'platform'; exclusive_group?: string | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown, field = 'id'): string => { if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException(`${field} 必须是有效 UUID`); return value; };
const validDate = (value: unknown, field: string): string => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new BadRequestException(`${field} 必须是合法时间`); return new Date(value).toISOString(); };
const nonempty = (value: unknown, field: string, max = 250): string => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${field} 不能为空且不超过 ${max} 个字符`); return value.trim(); };
const text = (value: unknown, max = 2000): string => { if (value == null) return ''; if (typeof value !== 'string' || value.length > max) throw new BadRequestException(`文本不能超过 ${max} 个字符`); return value.trim(); };
const safeMoney = (value: unknown, field: string, allowZero = true): Decimal => { try { return money(value, field, allowZero); } catch (error: any) { throw new BadRequestException(error?.message || `${field} 金额无效`); } };
const pageArgs = (query: any) => {
  const page = query.page === undefined ? 1 : Number(query.page);
  const size = query.size === undefined ? 20 : Number(query.size);
  if (!Number.isInteger(page) || page < 1 || page > 1000000) throw new BadRequestException('page 必须是正整数');
  if (![10, 20, 50].includes(size)) throw new BadRequestException('size 只能是 10、20 或 50');
  return { page, size, offset: (page - 1) * size };
};
const escapedLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class CommerceService {
  private readonly stores: string;
  private readonly campaigns: string;
  private readonly items: string;
  private readonly rules: string;
  private readonly versions: string;
  private readonly orders: string;
  private readonly orderItems: string;
  private readonly discounts: string;
  private readonly refunds: string;
  private readonly discountRevisions: string;
  private readonly products: string;
  constructor(private readonly ops: OpsDatabase, private readonly inventory: InventoryService) {
    this.stores = ops.table('ops_stores'); this.campaigns = ops.table('ops_campaigns'); this.items = ops.table('ops_campaign_items');
    this.rules = ops.table('ops_campaign_rules'); this.versions = ops.table('ops_campaign_versions');
    this.orders = ops.table('ops_sales_orders'); this.orderItems = ops.table('ops_sales_order_items');
    this.discounts = ops.table('ops_sales_order_discounts'); this.refunds = ops.table('ops_sales_order_refunds');
    this.discountRevisions = ops.table('ops_sales_order_discount_revisions'); this.products = ops.table('products');
  }

  async listStores() {
    return this.ops.db.query(`SELECT id, platform, name FROM ${this.stores} ORDER BY platform, name`);
  }
  async createStore(body: any) {
    const platform = nonempty(body?.platform, 'platform'); const name = nonempty(body?.name, 'name');
    try { const [row] = await this.ops.db.query(`INSERT INTO ${this.stores}(platform,name) VALUES($1,$2) RETURNING id,platform,name`, [platform, name]); return row; }
    catch (error: any) { if (error?.code === '23505') throw new ConflictException('该平台店铺已存在'); throw error; }
  }

  async listCampaigns(query: any) {
    const { page, size, offset } = pageArgs(query); const q = text(query.q, 200); const pattern = `%${escapedLike(q)}%`;
    const base = `FROM ${this.campaigns} c LEFT JOIN ${this.stores} s ON s.id=c.store_id WHERE ($1='' OR c.name ILIKE $2 ESCAPE E'\\\\' OR COALESCE(s.name,'') ILIKE $2 ESCAPE E'\\\\')`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int AS total ${base}`, [q, pattern]);
    const rows: Row[] = await this.ops.db.query(`SELECT c.*,s.name AS store_name ${base} ORDER BY c.updated_at DESC LIMIT $3 OFFSET $4`, [q, pattern, size, offset]);
    const items = await Promise.all(rows.map((row) => this.campaignView(row)));
    return { items, total: count.total };
  }

  private async campaignView(row: Row) {
    const productRows: Row[] = await this.ops.db.query(`SELECT ci.id,ci.product_id,ci.list_price,ci.product_snapshot,p.sku,p.name,p.material_code,p.kind FROM ${this.items} ci JOIN ${this.products} p ON p.id=ci.product_id WHERE ci.campaign_id=$1 ORDER BY p.sku`, [row.id]);
    const items = await Promise.all(productRows.map(async (p) => ({
      product_id: p.product_id, list_price: String(p.list_price), sku: p.sku, name: p.name,
      material_code: p.material_code, kind: p.kind, rules: await this.rulesForItem(p.id),
    })));
    return { id: row.id, name: row.name, store_id: row.store_id, store_name: row.store_name ?? null, starts_at: row.starts_at, ends_at: row.ends_at, status: row.status, notes: row.notes, version: row.version, items };
  }

  private async rulesForItem(itemId: string): Promise<Row[]> {
    const rows: Row[] = await this.ops.db.query(`SELECT name,type,amount,threshold,cap,bearer,exclusive_group FROM ${this.rules} WHERE campaign_item_id=$1 ORDER BY rule_index`, [itemId]);
    return rows.map((r) => ({ name: r.name, type: r.type, amount: String(r.amount), threshold: r.threshold == null ? null : String(r.threshold), cap: r.cap == null ? null : String(r.cap), bearer: r.bearer, exclusive_group: r.exclusive_group }));
  }

  async createCampaign(body: any) { return this.saveCampaign(body); }
  async editCampaign(campaignId: string, body: any) { return this.saveCampaign(body, id(campaignId)); }
  private async saveCampaign(body: any, campaignId?: string) {
    if (!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > 500) throw new BadRequestException('活动必须包含 1 至 500 个商品');
    const name = nonempty(body.name, 'name'); const storeId = body.store_id == null ? null : id(body.store_id, 'store_id');
    const startsAt = validDate(body.starts_at, 'starts_at'); const endsAt = validDate(body.ends_at, 'ends_at');
    if (Date.parse(endsAt) < Date.parse(startsAt)) throw new BadRequestException('活动结束时间不能早于开始时间');
    const notes = text(body.notes);
    const seen = new Set<string>();
    const cleanItems = body.items.map((item: any) => {
      const productId = id(item?.product_id, 'product_id'); if (seen.has(productId)) throw new BadRequestException('活动商品不能重复'); seen.add(productId);
      const listPrice = safeMoney(item.list_price, 'list_price');
      if (!Array.isArray(item.rules) || item.rules.length > 50) throw new BadRequestException('每个商品规则数不能超过 50');
      const cleanRules = item.rules.map((rule: any, index: number) => {
        const type = rule?.type; if (!['fixed', 'percent', 'threshold'].includes(type)) throw new BadRequestException('优惠类型无效');
        const amount = safeMoney(rule.amount, 'rule.amount'); const threshold = rule.threshold == null ? null : safeMoney(rule.threshold, 'rule.threshold'); const cap = rule.cap == null ? null : safeMoney(rule.cap, 'rule.cap');
        if (type === 'threshold' && threshold == null) throw new BadRequestException('满额优惠必须设置 threshold');
        if (type === 'percent' && amount.gt(100)) throw new BadRequestException('percent amount 必须在 0 到 100 之间');
        if (!['merchant', 'platform'].includes(rule.bearer)) throw new BadRequestException('优惠承担方无效');
        return { rule_index: index, name: nonempty(rule.name, 'rule.name'), type, amount: amount.toFixed(2), threshold: threshold?.toFixed(2) ?? null, cap: cap?.toFixed(2) ?? null, bearer: rule.bearer, exclusive_group: rule.exclusive_group == null ? null : nonempty(rule.exclusive_group, 'exclusive_group', 100) };
      });
      return { product_id: productId, list_price: listPrice.toFixed(2), rules: cleanRules };
    });
    const productRows: Row[] = await this.ops.db.query(`SELECT id,sku,name,material_code,kind FROM ${this.products} WHERE id = ANY($1::uuid[]) AND active=true`, [[...seen]]);
    if (productRows.length !== seen.size) throw new BadRequestException('活动中存在无效或停用商品');
    if (storeId) { const s = await this.ops.db.query(`SELECT id FROM ${this.stores} WHERE id=$1`, [storeId]); if (!s.length) throw new BadRequestException('店铺不存在'); }
    return this.ops.db.transaction(async (manager) => {
      let campaign: Row; let version: number; let status = 'draft';
      if (campaignId) {
        const rows: Row[] = await manager.query(`SELECT * FROM ${this.campaigns} WHERE id=$1 FOR UPDATE`, [campaignId]);
        if (!rows.length) throw new NotFoundException('活动不存在'); campaign = rows[0];
        if (campaign.status === 'archived') throw new ConflictException('已归档活动不能修改');
        version = Number(campaign.version) + 1;
        await manager.query(`UPDATE ${this.campaigns} SET name=$2,store_id=$3,starts_at=$4,ends_at=$5,notes=$6,status='draft',version=$7,updated_at=now() WHERE id=$1`, [campaignId, name, storeId, startsAt, endsAt, notes, version]);
        await manager.query(`DELETE FROM ${this.items} WHERE campaign_id=$1`, [campaignId]);
      } else {
        const [row] = await manager.query(`INSERT INTO ${this.campaigns}(name,store_id,starts_at,ends_at,notes) VALUES($1,$2,$3,$4,$5) RETURNING *`, [name, storeId, startsAt, endsAt, notes]);
        campaign = row; version = 1;
      }
      for (const item of cleanItems) {
        const [inserted] = await manager.query(`INSERT INTO ${this.items}(campaign_id,product_id,list_price,product_snapshot) VALUES($1,$2,$3,$4::jsonb) RETURNING id`, [campaign.id, item.product_id, item.list_price, JSON.stringify(productRows.find((p) => p.id === item.product_id))]);
        for (const rule of item.rules) await manager.query(`INSERT INTO ${this.rules}(campaign_item_id,rule_index,name,type,amount,threshold,cap,bearer,exclusive_group) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [inserted.id, rule.rule_index, rule.name, rule.type, rule.amount, rule.threshold, rule.cap, rule.bearer, rule.exclusive_group]);
      }
      const snapshot = { name, store_id: storeId, starts_at: startsAt, ends_at: endsAt, notes, items: cleanItems.map((item) => ({ ...item, product: productRows.find((p) => p.id === item.product_id) })) };
      await manager.query(`INSERT INTO ${this.versions}(campaign_id,version,snapshot,status) VALUES($1,$2,$3::jsonb,$4)`, [campaign.id, version, JSON.stringify(snapshot), status]);
      return { id: campaign.id, name, store_id: storeId, starts_at: startsAt, ends_at: endsAt, status, notes, version, items: cleanItems };
    });
  }

  async setCampaignState(campaignId: string, state: 'published' | 'archived') {
    const campaignUuid = id(campaignId);
    return this.ops.db.transaction(async (manager) => {
      const rows: Row[] = await manager.query(`SELECT * FROM ${this.campaigns} WHERE id=$1 FOR UPDATE`, [campaignUuid]);
      if (!rows.length) throw new NotFoundException('活动不存在'); const row = rows[0];
      if (state === 'published' && row.status === 'archived') throw new ConflictException('已归档活动不能发布');
      await manager.query(`UPDATE ${this.campaigns} SET status=$2,updated_at=now() WHERE id=$1`, [campaignUuid, state]);
      await manager.query(`UPDATE ${this.versions} SET status=$3 WHERE campaign_id=$1 AND version=$2`, [campaignUuid, row.version, state]);
      return { id: campaignUuid, status: state, version: row.version };
    });
  }

  async previewCampaign(campaignId: string, body: any) {
    const campaignUuid = id(campaignId); const productId = id(body?.product_id, 'product_id');
    const quantity = Number(body?.quantity); if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new BadRequestException('quantity 必须是正整数');
    if (!Array.isArray(body?.rule_indexes) || body.rule_indexes.length > 50) throw new BadRequestException('rule_indexes 必须是数组');
    const rows: Row[] = await this.ops.db.query(`SELECT ci.list_price,cr.name,cr.type,cr.amount,cr.threshold,cr.cap,cr.bearer,cr.exclusive_group,cr.rule_index FROM ${this.items} ci LEFT JOIN ${this.rules} cr ON cr.campaign_item_id=ci.id WHERE ci.campaign_id=$1 AND ci.product_id=$2 ORDER BY cr.rule_index NULLS LAST`, [campaignUuid, productId]);
    if (!rows.length) throw new NotFoundException('活动中没有该商品');
    const [campaign] = await this.ops.db.query(`SELECT status,starts_at,ends_at FROM ${this.campaigns} WHERE id=$1`, [campaignUuid]);
    if (!campaign) throw new NotFoundException('活动不存在');
    if (campaign.status === 'archived') throw new ConflictException('已归档活动不能测算');
    const now = Date.now();
    const rules: CampaignRule[] = rows.filter((r) => r.name != null).map((r) => ({ name: r.name, type: r.type, amount: new Decimal(r.amount), threshold: r.threshold == null ? undefined : new Decimal(r.threshold), cap: r.cap == null ? undefined : new Decimal(r.cap), bearer: r.bearer, exclusive_group: r.exclusive_group }));
    try {
      const result = calculateCampaign(new Decimal(rows[0].list_price), quantity, rules, body.rule_indexes);
      return { ...result, campaign_status: campaign.status, activity_state: now < Date.parse(campaign.starts_at) ? 'scheduled' : now > Date.parse(campaign.ends_at) ? 'ended' : 'active' };
    }
    catch (error: any) { throw new BadRequestException(error?.message || '优惠规则测算失败'); }
  }

  async listOrders(query: any) {
    const { size, offset } = pageArgs(query); const q = text(query.q, 200); const pattern = `%${escapedLike(q)}%`;
    const base = `FROM ${this.orders} o LEFT JOIN ${this.stores} s ON s.id=o.store_id WHERE ($1='' OR o.number ILIKE $2 ESCAPE E'\\\\' OR COALESCE(o.external_number,'') ILIKE $2 ESCAPE E'\\\\' OR o.customer_name ILIKE $2 ESCAPE E'\\\\')`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int AS total ${base}`, [q, pattern]);
    const rows: Row[] = await this.ops.db.query(`SELECT o.*,s.name AS store_name ${base} ORDER BY o.ordered_at DESC LIMIT $3 OFFSET $4`, [q, pattern, size, offset]);
    return { items: await Promise.all(rows.map((row) => this.orderView(row))), total: count.total };
  }

  async getOrder(orderId: string) {
    const uuid = id(orderId); const rows: Row[] = await this.ops.db.query(`SELECT o.*,s.name AS store_name FROM ${this.orders} o LEFT JOIN ${this.stores} s ON s.id=o.store_id WHERE o.id=$1`, [uuid]);
    if (!rows.length) throw new NotFoundException('订单不存在'); return this.orderView(rows[0]);
  }

  private async orderView(row: Row) {
    const items: Row[] = await this.ops.db.query(`SELECT oi.*,p.sku,p.name,p.material_code,p.kind,oi.campaign_snapshot->'campaign'->>'name' AS campaign_name FROM ${this.orderItems} oi JOIN ${this.products} p ON p.id=oi.product_id WHERE oi.order_id=$1 ORDER BY oi.id`, [row.id]);
    const discounts: Row[] = await this.ops.db.query(`SELECT d.id,d.name,d.amount,d.bearer,d.product_id,d.allocations,p.sku FROM ${this.discounts} d LEFT JOIN ${this.products} p ON p.id=d.product_id WHERE d.order_id=$1 ORDER BY d.created_at,d.id`, [row.id]);
    const movements: Row[] = await this.ops.db.query(`SELECT id,number,type,reason,occurred_at,recipient,carrier,tracking_number,shipping_cost FROM ${this.ops.table('ops_movements')} WHERE sales_order_id=$1 AND type='sale' ORDER BY occurred_at,id`, [row.id]);
    const movementItems = movements.length ? await this.ops.db.query(`SELECT mi.movement_id,mi.product_id,mi.unit_id,mi.batch_number,mi.from_status,mi.to_status,u.serial_number FROM ${this.ops.table('ops_movement_items')} mi JOIN ${this.ops.table('ops_units')} u ON u.id=mi.unit_id WHERE mi.movement_id = ANY($1::uuid[]) ORDER BY mi.movement_id,mi.id`, [movements.map((m) => m.id)]) : [];
    const shipmentUnits = movementItems.map((mi: Row) => ({ ...mi }));
    const shipments = movements.map((m) => {
      const items = shipmentUnits.filter((unit: Row) => unit.movement_id === m.id);
      return { ...m, items, units: items };
    });
    return {
      id: row.id, number: row.number, external_number: row.external_number, channel: row.channel, store_id: row.store_id, store_name: row.store_name ?? null,
      customer_name: row.customer_name, recipient_phone: row.recipient_phone, shipping_address: row.shipping_address, ordered_at: row.ordered_at, status: row.status, original_amount: String(row.original_amount), discount_amount: String(row.discount_amount),
      paid_amount: String(row.paid_amount), shipping_amount: String(row.shipping_amount), refunded_amount: String(row.refunded_amount), discounts_complete: row.discounts_complete, undisclosed_discount_amount: String(row.undisclosed_discount_amount),
      notes: row.notes, items: items.map((it) => ({ id: it.id, product_id: it.product_id, sku: it.sku, name: it.name, material_code: it.material_code, kind: it.kind, quantity: it.quantity, unit_price: String(it.unit_price), original_amount: String(it.original_amount), discount_amount: String(it.discount_amount), undisclosed_discount_amount: String(it.undisclosed_discount_amount), paid_amount: String(it.paid_amount), campaign_id: it.campaign_id, campaign_name: it.campaign_name, campaign_version: it.campaign_version, campaign_snapshot: it.campaign_snapshot })),
      discounts: discounts.map((d) => ({ id: d.id, name: d.name, amount: String(d.amount), bearer: d.bearer, product_id: d.product_id, sku: d.sku, allocations: d.allocations })), shipments,
    };
  }

  async createOrder(body: any, actorId?: string) {
    if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 500) throw new BadRequestException('订单必须包含 1 至 500 个商品行');
    if (!Array.isArray(body?.discounts) || body.discounts.length > 200) throw new BadRequestException('discounts 必须是数组且不超过 200 项');
    const channel = nonempty(body.channel, 'channel'); const storeId = body.store_id == null ? null : id(body.store_id, 'store_id');
    const orderedAt = validDate(body.ordered_at, 'ordered_at'); const customerName = text(body.customer_name, 250);
    const recipientPhone = text(body.recipient_phone, 100); const shippingAddress = text(body.shipping_address, 1000);
    const externalNumber = body.external_number == null || body.external_number === '' ? null : nonempty(body.external_number, 'external_number', 250);
    const shipping = safeMoney(body.shipping_amount ?? '0', 'shipping_amount'); const notes = text(body.notes);
    const cleanItems = body.items.map((item: any) => {
      const productId = id(item?.product_id, 'product_id'); const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw new BadRequestException('商品 quantity 必须是正整数');
      const unitPrice = safeMoney(item.unit_price, 'unit_price'); const campaignId = item.campaign_id == null ? null : id(item.campaign_id, 'campaign_id');
      const originalAmount = unitPrice.mul(quantity);
      if (originalAmount.gt('999999999999.99')) throw new BadRequestException('订单商品行金额超出数据库金额范围');
      return { product_id: productId, quantity, unit_price: unitPrice.toFixed(2), original_cents: cents(originalAmount), campaign_id: campaignId };
    });
    const totalOriginalDecimal = cleanItems.reduce((sum, it) => sum.add(it.original_cents), new Decimal(0));
    if (totalOriginalDecimal.gt('99999999999999')) throw new BadRequestException('订单原金额超出数据库金额范围');
    const totalOriginal = totalOriginalDecimal.toNumber();
    const cleanDiscounts = body.discounts.map((d: any) => {
      const amount = safeMoney(d.amount, 'discount.amount'); if (!['merchant', 'platform'].includes(d.bearer)) throw new BadRequestException('优惠承担方无效');
      const productId = d.product_id == null ? null : id(d.product_id, 'discount.product_id');
      if (productId && !cleanItems.some((item) => item.product_id === productId)) throw new BadRequestException('指定商品优惠必须属于本订单');
      return { name: nonempty(d.name, 'discount.name'), amount_cents: cents(amount), bearer: d.bearer, product_id: productId };
    });
    const discountTotalDecimal = cleanDiscounts.reduce((sum, d) => sum.add(d.amount_cents), new Decimal(0));
    if (discountTotalDecimal.gt(totalOriginal)) throw new BadRequestException('优惠总额不能超过商品原金额');
    const discountTotal = discountTotalDecimal.toNumber();
    const paid = safeMoney(body.paid_amount, 'paid_amount'); const payableComplete = totalOriginal - discountTotal + cents(shipping);
    if (new Decimal(totalOriginal).add(cents(shipping)).gt('99999999999999')) throw new BadRequestException('订单总金额超出数据库金额范围');
    if (paid.gt(fromCents(totalOriginal + cents(shipping)))) throw new BadRequestException('paid_amount 不能超过商品原金额加运费');
    const discountsComplete = body.discounts_complete !== false;
    if (discountsComplete && cents(paid) !== payableComplete) throw new BadRequestException('优惠明细完整时，商品优惠、运费与 paid_amount 必须一致');
    if (!discountsComplete && (cents(paid) > payableComplete || cents(paid) < cents(shipping))) throw new BadRequestException('优惠明细待补时，实付金额须介于运费和已知优惠后的金额之间');
    const undisclosedDiscountCents = payableComplete - cents(paid);
    if (cents(paid) > totalOriginal + cents(shipping)) throw new BadRequestException('paid_amount 金额不合理');
    const productIds = [...new Set(cleanItems.map((item) => item.product_id))];
    const productRows: Row[] = await this.ops.db.query(`SELECT id,sku,name,material_code,kind FROM ${this.products} WHERE id = ANY($1::uuid[]) AND active=true`, [productIds]);
    if (productRows.length !== productIds.length) throw new BadRequestException('订单中存在无效或停用商品');
    if (storeId) { const stores = await this.ops.db.query(`SELECT id FROM ${this.stores} WHERE id=$1`, [storeId]); if (!stores.length) throw new BadRequestException('店铺不存在'); }
    const createdId: string = await this.ops.db.transaction(async (manager) => {
      const campaignSnapshots = new Map<string, any>();
      const campaignIds = [...new Set(cleanItems.map((item) => item.campaign_id).filter(Boolean) as string[])].sort();
      for (const campaignId of campaignIds) {
        const campaigns: Row[] = await manager.query(`SELECT * FROM ${this.campaigns} WHERE id=$1 FOR SHARE`, [campaignId]);
        if (!campaigns.length) throw new BadRequestException('订单引用的活动不存在');
        const campaign = campaigns[0];
        if (campaign.status !== 'published') throw new BadRequestException('订单商品只能关联已发布活动');
        if (Date.parse(orderedAt) < Date.parse(campaign.starts_at) || Date.parse(orderedAt) > Date.parse(campaign.ends_at)) throw new BadRequestException('订单时间不在所选活动有效期内');
        if (campaign.store_id && campaign.store_id !== storeId) throw new BadRequestException('订单店铺与活动店铺不一致');
        const campaignItems: Row[] = await manager.query(`SELECT ci.*,p.sku,p.name,p.material_code,p.kind FROM ${this.items} ci JOIN ${this.products} p ON p.id=ci.product_id WHERE ci.campaign_id=$1 AND ci.product_id = ANY($2::uuid[])`, [campaignId, productIds]);
        const snapshotItems: Row[] = [];
        for (const item of campaignItems) {
          const rules: Row[] = await manager.query(`SELECT name,type,amount,threshold,cap,bearer,exclusive_group FROM ${this.rules} WHERE campaign_item_id=$1 ORDER BY rule_index`, [item.id]);
          snapshotItems.push({ product_id: item.product_id, list_price: String(item.list_price), product: { sku: item.sku, name: item.name, material_code: item.material_code, kind: item.kind }, rules: rules.map((rule) => ({ name: rule.name, type: rule.type, amount: String(rule.amount), threshold: rule.threshold == null ? null : String(rule.threshold), cap: rule.cap == null ? null : String(rule.cap), bearer: rule.bearer, exclusive_group: rule.exclusive_group })) });
        }
        campaignSnapshots.set(campaignId, { campaign: { id: campaign.id, name: campaign.name, version: campaign.version, store_id: campaign.store_id, starts_at: campaign.starts_at, ends_at: campaign.ends_at, status: campaign.status }, items: snapshotItems });
      }
      const orderNumber = `SO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      let order: Row;
      try {
        [order] = await manager.query(`INSERT INTO ${this.orders}(number,external_number,channel,store_id,customer_name,recipient_phone,shipping_address,ordered_at,original_amount,discount_amount,paid_amount,shipping_amount,discounts_complete,undisclosed_discount_amount,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [orderNumber, externalNumber, channel, storeId, customerName, recipientPhone, shippingAddress, orderedAt, fromCents(totalOriginal), fromCents(discountTotal), paid.toFixed(2), shipping.toFixed(2), discountsComplete, fromCents(undisclosedDiscountCents), notes, actorId ?? null]);
      } catch (error: any) { if (error?.code === '23505') throw new ConflictException('外部订单号在该店铺下已存在'); throw error; }
      const lineIds: string[] = [];
      for (const item of cleanItems) {
        const prod = productRows.find((p) => p.id === item.product_id)!;
        const snap = item.campaign_id ? campaignSnapshots.get(item.campaign_id) : null;
        const productCampaign = snap?.items.find((x: Row) => x.product_id === item.product_id) ?? null;
        if (item.campaign_id && !productCampaign) throw new BadRequestException('订单商品不属于关联活动');
        const lineSnapshot = productCampaign ? { campaign: snap.campaign, item: productCampaign } : null;
        const [line] = await manager.query(`INSERT INTO ${this.orderItems}(order_id,product_id,quantity,unit_price,original_amount,discount_amount,paid_amount,campaign_id,campaign_version,campaign_snapshot,product_snapshot) VALUES($1,$2,$3,$4,$5,0,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING id`, [order.id, item.product_id, item.quantity, item.unit_price, fromCents(item.original_cents), item.campaign_id, snap?.campaign.version ?? null, lineSnapshot ? JSON.stringify(lineSnapshot) : null, JSON.stringify(prod)]);
        lineIds.push(line.id);
      }
      const allocationsByDiscount: Array<Map<string, number>> = [];
      for (const discount of cleanDiscounts) {
        const eligible = cleanItems.map((item, index) => ({ item, index })).filter(({ item }) => !discount.product_id || item.product_id === discount.product_id);
        if (!eligible.length && discount.amount_cents > 0) throw new BadRequestException('优惠没有可分摊商品');
        let allocation: Map<string, number>;
        try { allocation = allocateCents(discount.amount_cents, eligible.map(({ item, index }) => ({ id: lineIds[index], weight: new Decimal(item.original_cents) }))); }
        catch (error: any) { throw new BadRequestException(error?.message || '优惠不能分摊到所选商品'); }
        allocationsByDiscount.push(allocation);
        const allocationsObj = Object.fromEntries([...allocation.entries()].map(([lineId, amount]) => [lineId, fromCents(amount)]));
        await manager.query(`INSERT INTO ${this.discounts}(order_id,name,amount,bearer,product_id,allocations) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [order.id, discount.name, fromCents(discount.amount_cents), discount.bearer, discount.product_id, JSON.stringify(allocationsObj)]);
      }
      const knownDiscountByLine = new Map<string, number>();
      for (let index = 0; index < cleanItems.length; index++) {
        const allocated = allocationsByDiscount.reduce((sum, map) => sum + (map.get(lineIds[index]) || 0), 0);
        if (allocated > cleanItems[index].original_cents) throw new BadRequestException('优惠分摊超过商品原金额');
        knownDiscountByLine.set(lineIds[index], allocated);
      }
      let undisclosedByLine = new Map<string, number>();
      if (undisclosedDiscountCents > 0) {
        const netTargets = cleanItems.map((item, index) => ({ id: lineIds[index], weight: new Decimal(item.original_cents - (knownDiscountByLine.get(lineIds[index]) || 0)) }));
        try { undisclosedByLine = allocateCents(undisclosedDiscountCents, netTargets); }
        catch (error: any) { throw new BadRequestException(error?.message || '未拆分优惠无法分配到订单商品'); }
      }
      for (let index = 0; index < cleanItems.length; index++) {
        const known = knownDiscountByLine.get(lineIds[index]) || 0; const undisclosed = undisclosedByLine.get(lineIds[index]) || 0;
        await manager.query(`UPDATE ${this.orderItems} SET discount_amount=$2,undisclosed_discount_amount=$3,paid_amount=$4 WHERE id=$1`, [lineIds[index], fromCents(known), fromCents(undisclosed), fromCents(cleanItems[index].original_cents - known - undisclosed)]);
      }
      return order.id;
    });
    return this.getOrder(createdId);
  }

  async supplementOrderDiscounts(orderId: string, body: any, actorId?: string) {
    const uuid = id(orderId);
    if (body?.discounts_complete !== true) throw new BadRequestException('补录优惠必须确认 discounts_complete=true');
    if (!Array.isArray(body?.discounts) || body.discounts.length > 200) throw new BadRequestException('discounts 必须是数组且不超过 200 项');
    await this.ops.db.transaction(async (manager) => {
      const orders: Row[] = await manager.query(`SELECT * FROM ${this.orders} WHERE id=$1 FOR UPDATE`, [uuid]);
      if (!orders.length) throw new NotFoundException('订单不存在');
      const order = orders[0];
      if (order.status === 'cancelled') throw new ConflictException('已取消订单不能补录优惠');
      if (order.discounts_complete) throw new ConflictException('该订单优惠明细已完整，无需补录');
      const lines: Row[] = await manager.query(`SELECT * FROM ${this.orderItems} WHERE order_id=$1 ORDER BY id FOR UPDATE`, [uuid]);
      const cleanDiscounts = body.discounts.map((discount: any) => {
        const amount = safeMoney(discount.amount, 'discount.amount');
        if (!['merchant', 'platform'].includes(discount.bearer)) throw new BadRequestException('优惠承担方无效');
        const productId = discount.product_id == null ? null : id(discount.product_id, 'discount.product_id');
        if (productId && !lines.some((line) => line.product_id === productId)) throw new BadRequestException('指定商品优惠必须属于该订单');
        return { name: nonempty(discount.name, 'discount.name'), amount_cents: cents(amount), bearer: discount.bearer, product_id: productId };
      });
      const totalCents = cents(new Decimal(order.original_amount));
      const discountCentsDecimal = cleanDiscounts.reduce((sum, discount) => sum.add(discount.amount_cents), new Decimal(0));
      if (discountCentsDecimal.gt(totalCents)) throw new BadRequestException('优惠总额不能超过商品原金额');
      const discountCents = discountCentsDecimal.toNumber();
      const knownPayable = totalCents - discountCents + cents(new Decimal(order.shipping_amount));
      if (knownPayable !== cents(new Decimal(order.paid_amount))) throw new BadRequestException('补录优惠金额与订单实付金额不一致，不能标记为完整');
      const lineIds = lines.map((line) => line.id);
      const lineOriginal = lines.map((line) => cents(new Decimal(line.original_amount)));
      const knownByLine = new Map<string, number>();
      const allocations: Array<Map<string, number>> = [];
      for (const discount of cleanDiscounts) {
        const eligible = lines.map((line, index) => ({ line, index })).filter(({ line }) => !discount.product_id || line.product_id === discount.product_id);
        let allocation: Map<string, number>;
        try { allocation = allocateCents(discount.amount_cents, eligible.map(({ line, index }) => ({ id: line.id, weight: new Decimal(line.original_amount) }))); }
        catch (error: any) { throw new BadRequestException(error?.message || '优惠不能分摊到订单商品'); }
        allocations.push(allocation);
        for (const [lineId, amount] of allocation) knownByLine.set(lineId, (knownByLine.get(lineId) || 0) + amount);
      }
      for (let index = 0; index < lines.length; index++) if ((knownByLine.get(lineIds[index]) || 0) > lineOriginal[index]) throw new BadRequestException('优惠分摊超过商品原金额');
      const previousRows: Row[] = await manager.query(`SELECT name,amount,bearer,product_id,allocations FROM ${this.discounts} WHERE order_id=$1 ORDER BY created_at,id`, [uuid]);
      const replacement = cleanDiscounts.map((discount, i) => ({ ...discount, amount: fromCents(discount.amount_cents), allocations: Object.fromEntries([...allocations[i].entries()].map(([lineId, amount]) => [lineId, fromCents(amount)])) }));
      await manager.query(`INSERT INTO ${this.discountRevisions}(order_id,previous_discounts,replacement_discounts,previous_discounts_complete,actor_id) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)`, [uuid, JSON.stringify(previousRows), JSON.stringify(replacement), order.discounts_complete, actorId ?? null]);
      await manager.query(`DELETE FROM ${this.discounts} WHERE order_id=$1`, [uuid]);
      for (let index = 0; index < cleanDiscounts.length; index++) {
        const discount = cleanDiscounts[index];
        await manager.query(`INSERT INTO ${this.discounts}(order_id,name,amount,bearer,product_id,allocations) VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [uuid, discount.name, fromCents(discount.amount_cents), discount.bearer, discount.product_id, JSON.stringify(replacement[index].allocations)]);
      }
      for (let index = 0; index < lines.length; index++) {
        const known = knownByLine.get(lineIds[index]) || 0;
        await manager.query(`UPDATE ${this.orderItems} SET discount_amount=$2,undisclosed_discount_amount=0,paid_amount=$3 WHERE id=$1`, [lineIds[index], fromCents(known), fromCents(lineOriginal[index] - known)]);
      }
      await manager.query(`UPDATE ${this.orders} SET discount_amount=$2,undisclosed_discount_amount=0,discounts_complete=true WHERE id=$1`, [uuid, fromCents(discountCents)]);
    });
    return this.getOrder(uuid);
  }

  async cancelOrder(orderId: string, actor: { id: string; username: string; displayName: string }) {
    const uuid = id(orderId);
    return this.ops.db.transaction(async (manager) => {
      const rows: Row[] = await manager.query(`SELECT * FROM ${this.orders} WHERE id=$1 FOR UPDATE`, [uuid]);
      if (!rows.length) throw new NotFoundException('订单不存在'); const order = rows[0];
      if (order.status !== 'open') throw new ConflictException('仅未发货订单可取消');
      await this.inventory.releaseOrderReservations(manager, uuid, actor);
      await manager.query(`UPDATE ${this.orders} SET status='cancelled' WHERE id=$1`, [uuid]); return { id: uuid, status: 'cancelled' };
    });
  }

  async refundOrder(orderId: string, body: any, actorId?: string) {
    const uuid = id(orderId); const amount = safeMoney(body?.amount, 'amount', false); const reason = nonempty(body?.reason, 'reason', 1000);
    return this.ops.db.transaction(async (manager) => {
      const rows: Row[] = await manager.query(`SELECT * FROM ${this.orders} WHERE id=$1 FOR UPDATE`, [uuid]);
      if (!rows.length) throw new NotFoundException('订单不存在'); const order = rows[0];
      if (order.status === 'cancelled') throw new ConflictException('已取消订单不能退款');
      const refunded = new Decimal(order.refunded_amount).add(amount);
      if (refunded.gt(order.paid_amount)) throw new BadRequestException('累计退款不能超过订单实付金额');
      await manager.query(`INSERT INTO ${this.refunds}(order_id,amount,reason,created_by) VALUES($1,$2,$3,$4)`, [uuid, amount.toFixed(2), reason, actorId ?? null]);
      await manager.query(`UPDATE ${this.orders} SET refunded_amount=$2 WHERE id=$1`, [uuid, refunded.toFixed(2)]);
      return { id: uuid, refunded_amount: refunded.toFixed(2) };
    });
  }

  async campaignStats(query: any) {
    const campaignId = id(query.campaign_id, 'campaign_id');
    const campaign = await this.ops.db.query(`SELECT id FROM ${this.campaigns} WHERE id=$1`, [campaignId]); if (!campaign.length) throw new NotFoundException('活动不存在');
    const from = query.from == null || query.from === '' ? null : validDate(query.from, 'from');
    const to = query.to == null || query.to === '' ? null : validDate(query.to, 'to');
    if (from && to && Date.parse(from) >= Date.parse(to)) throw new BadRequestException('to 必须晚于 from');
    const storeId = query.store_id == null || query.store_id === '' ? null : id(query.store_id, 'store_id');
    const filters = `AND ($2::timestamptz IS NULL OR o.ordered_at >= $2) AND ($3::timestamptz IS NULL OR o.ordered_at < $3) AND ($4::uuid IS NULL OR o.store_id=$4)`;
    const filterArgs = [campaignId, from, to, storeId];
    const rows: Row[] = await this.ops.db.query(`SELECT oi.product_id,p.sku,p.name,p.material_code,SUM(oi.quantity)::int AS ordered_quantity,SUM(oi.original_amount) AS original_amount,SUM(oi.discount_amount) AS discount_amount,SUM(oi.undisclosed_discount_amount) AS undisclosed_discount_amount,SUM(oi.paid_amount) AS paid_amount FROM ${this.orderItems} oi JOIN ${this.orders} o ON o.id=oi.order_id JOIN ${this.products} p ON p.id=oi.product_id WHERE oi.campaign_id=$1 AND o.status <> 'cancelled' ${filters} GROUP BY oi.product_id,p.sku,p.name,p.material_code ORDER BY p.sku`, filterArgs);
    const campaignLines: Row[] = await this.ops.db.query(`SELECT oi.id,oi.product_id,oi.order_id FROM ${this.orderItems} oi JOIN ${this.orders} o ON o.id=oi.order_id WHERE oi.campaign_id=$1 AND o.status <> 'cancelled' ${filters}`, filterArgs);
    const orderIds = [...new Set(campaignLines.map((line) => line.order_id))];
    const discountRows: Row[] = orderIds.length ? await this.ops.db.query(`SELECT d.id,d.order_id,d.name,d.amount,d.bearer,d.allocations FROM ${this.discounts} d WHERE d.order_id = ANY($1::uuid[]) ORDER BY d.created_at,d.id`, [orderIds]) : [];
    const allocatedByLine = new Map<string, { merchant: number; platform: number }>();
    const discountSummary = new Map<string, { name: string; bearer: string; count: number; amount: number; seen: Set<string> }>();
    for (const discount of discountRows) {
      const key = `${discount.name}\u0000${discount.bearer}`;
      const summary = discountSummary.get(key) ?? { name: discount.name, bearer: discount.bearer, count: 0, amount: 0, seen: new Set<string>() };
      const allocations = discount.allocations || {};
      let campaignAmount = 0;
      for (const line of campaignLines.filter((candidate) => candidate.order_id === discount.order_id)) {
        const centsAmount = cents(new Decimal(allocations[line.id] || 0));
        if (centsAmount > 0) {
          campaignAmount += centsAmount; summary.seen.add(discount.order_id);
          const current = allocatedByLine.get(line.id) ?? { merchant: 0, platform: 0 };
          current[discount.bearer as 'merchant' | 'platform'] += centsAmount;
          allocatedByLine.set(line.id, current);
        }
      }
      summary.amount += campaignAmount; discountSummary.set(key, summary);
    }
    for (const summary of discountSummary.values()) summary.count = summary.seen.size;
    const discounts = [...discountSummary.values()].map(({ seen, ...summary }) => ({ ...summary, amount: fromCents(summary.amount) }));
    const incomplete = await this.ops.db.query(`SELECT COUNT(DISTINCT o.id)::int AS count FROM ${this.orders} o JOIN ${this.orderItems} oi ON oi.order_id=o.id WHERE oi.campaign_id=$1 AND o.discounts_complete=false AND o.status <> 'cancelled' ${filters}`, filterArgs);
    const refundTotals = await this.ops.db.query(`SELECT COALESCE(SUM(o.refunded_amount),0) AS amount,COUNT(DISTINCT o.id)::int AS order_count FROM ${this.orders} o JOIN (SELECT DISTINCT oi.order_id FROM ${this.orderItems} oi JOIN ${this.orders} o ON o.id=oi.order_id WHERE oi.campaign_id=$1 AND o.status <> 'cancelled' ${filters}) ci ON ci.order_id=o.id`, filterArgs);
    const movementRows: Row[] = await this.ops.db.query(`WITH campaign_order_products AS (
      SELECT DISTINCT oi.order_id,oi.product_id FROM ${this.orderItems} oi JOIN ${this.orders} o ON o.id=oi.order_id WHERE oi.campaign_id=$1 AND o.status <> 'cancelled' ${filters}
    ), movement_activity AS (
      SELECT m.sales_order_id AS order_id,mi.product_id,'sale'::text AS type,COUNT(*)::int AS quantity
      FROM ${this.ops.table('ops_movement_items')} mi JOIN ${this.ops.table('ops_movements')} m ON m.id=mi.movement_id
      JOIN campaign_order_products cop ON cop.order_id=m.sales_order_id AND cop.product_id=mi.product_id
      WHERE m.type='sale' AND mi.to_status='shipped' GROUP BY m.sales_order_id,mi.product_id
      UNION ALL
      SELECT sm.sales_order_id AS order_id,ret.product_id,'return'::text AS type,COUNT(*)::int AS quantity
      FROM ${this.ops.table('ops_movement_items')} ret
      JOIN ${this.ops.table('ops_movements')} rm ON rm.id=ret.movement_id AND rm.type='return'
      JOIN ${this.ops.table('ops_movement_items')} src ON src.id=ret.source_movement_item_id
      JOIN ${this.ops.table('ops_movements')} sm ON sm.id=src.movement_id AND sm.type='sale'
      JOIN campaign_order_products cop ON cop.order_id=sm.sales_order_id AND cop.product_id=ret.product_id
      GROUP BY sm.sales_order_id,ret.product_id
    ) SELECT product_id,type,SUM(quantity)::int AS quantity FROM movement_activity GROUP BY product_id,type`, filterArgs);
    const shippedByProduct = new Map<string, number>(); const returnedByProduct = new Map<string, number>();
    for (const row of movementRows) (row.type === 'sale' ? shippedByProduct : returnedByProduct).set(row.product_id, row.quantity);
    const linesByProduct = new Map<string, Row[]>();
    for (const line of campaignLines) linesByProduct.set(line.product_id, [...(linesByProduct.get(line.product_id) ?? []), line]);
    const items = rows.map((row) => {
      const productLines = linesByProduct.get(row.product_id) ?? [];
      const merchantCents = productLines.reduce((sum, line) => sum + (allocatedByLine.get(line.id)?.merchant ?? 0), 0);
      const platformCents = productLines.reduce((sum, line) => sum + (allocatedByLine.get(line.id)?.platform ?? 0), 0);
      const shipped = shippedByProduct.get(row.product_id) ?? 0; const returned = returnedByProduct.get(row.product_id) ?? 0;
      return { product_id: row.product_id, sku: row.sku, name: row.name, ordered_quantity: row.ordered_quantity, shipped_quantity: shipped, returned_quantity: returned, net_shipped_quantity: shipped - returned, original_amount: String(row.original_amount), discount_amount: String(row.discount_amount), undisclosed_discount_amount: String(row.undisclosed_discount_amount), paid_amount: String(row.paid_amount), merchant_discount: fromCents(merchantCents), platform_discount: fromCents(platformCents) };
    });
    const total = rows.reduce((sum, row) => ({ ordered_quantity: sum.ordered_quantity + Number(row.ordered_quantity), original_amount: sum.original_amount.add(row.original_amount), discount_amount: sum.discount_amount.add(row.discount_amount), undisclosed_discount_amount: sum.undisclosed_discount_amount.add(row.undisclosed_discount_amount), paid_amount: sum.paid_amount.add(row.paid_amount) }), { ordered_quantity: 0, original_amount: new Decimal(0), discount_amount: new Decimal(0), undisclosed_discount_amount: new Decimal(0), paid_amount: new Decimal(0) });
    const shippedTotal = [...shippedByProduct.values()].reduce((a, b) => a + b, 0); const returnedTotal = [...returnedByProduct.values()].reduce((a, b) => a + b, 0);
    return { items, totals: { ...total, original_amount: total.original_amount.toFixed(2), discount_amount: total.discount_amount.toFixed(2), undisclosed_discount_amount: total.undisclosed_discount_amount.toFixed(2), paid_amount: total.paid_amount.toFixed(2), shipped_quantity: shippedTotal, returned_quantity: returnedTotal, net_shipped_quantity: shippedTotal - returnedTotal, merchant_discount: fromCents([...allocatedByLine.values()].reduce((sum, value) => sum + value.merchant, 0)), platform_discount: fromCents([...allocatedByLine.values()].reduce((sum, value) => sum + value.platform, 0)), order_level_refunded_amount: String(refundTotals[0]?.amount ?? '0.00'), order_level_refunded_orders: refundTotals[0]?.order_count ?? 0 }, discounts, incomplete_orders: incomplete[0]?.count ?? 0 };
  }
}
