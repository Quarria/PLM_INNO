import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { OpsDatabase } from './ops-database';

type Actor = { id: string; username: string; displayName: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const date = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim() || Number.isNaN(Date.parse(v))) throw new BadRequestException(`${label}必须是合法时间`); return new Date(v).toISOString(); };
const uuid = (v: unknown, label: string) => { if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`${label}必须是有效 UUID`); return v; };
const text = (v: unknown, label: string, required = false, max = 2000) => { if (v == null && !required) return ''; if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) throw new BadRequestException(`${label}格式无效`); return v.trim(); };
const pageParams = (query: any) => { const page = Math.max(1, Math.min(100000, Number.parseInt(query.page || '1', 10) || 1)); const requested = Number.parseInt(query.size || '20', 10); const size = [10, 20, 50].includes(requested) ? requested : 20; return { page, size, offset: (page - 1) * size }; };
const json = (value: any) => JSON.stringify(value);
const literalLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class InventoryService {
  constructor(private readonly ops: OpsDatabase) {}
  private t(name: string) { return this.ops.table(name); }

  async catalog(query: any) {
    if (query.id) { const id=uuid(query.id,'id'); const items=await this.ops.db.query(`SELECT p.id,p.sku,p.name,COALESCE(p.material_code,'') material_code,p.kind,EXISTS(SELECT 1 FROM ${this.t('product_variants')} pv JOIN ${this.t('bom_components')} bc ON bc.parent_variant_id=pv.id WHERE pv.product_id=p.id) bom_configured FROM ${this.t('products')} p WHERE p.id=$1`,[id]); return { items,hasMore:false }; }
    const q = literalLike(text(query.q, '搜索词')); const p = pageParams({ page: query.page, size: 20 });
    const rows = await this.ops.db.query(`SELECT p.id,p.sku,p.name,COALESCE(p.material_code,'') material_code,p.kind,EXISTS(SELECT 1 FROM ${this.t('product_variants')} pv JOIN ${this.t('bom_components')} bc ON bc.parent_variant_id=pv.id WHERE pv.product_id=p.id) bom_configured FROM ${this.t('products')} p WHERE p.active=true AND ($1='' OR p.sku ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%' OR COALESCE(p.material_code,'') ILIKE '%'||$1||'%') ORDER BY p.name,p.sku LIMIT 21 OFFSET $2`, [q, p.offset]);
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
  }
  async warehouses() { return this.ops.db.query(`SELECT id,name FROM ${this.t('ops_warehouses')} WHERE active=true ORDER BY name`); }

  async stock(query: any) {
    const q = literalLike(text(query.q, '搜索词')); const p = pageParams(query);
    const productFilter=`(p.active=true OR EXISTS (SELECT 1 FROM ${this.t('ops_units')} historical WHERE historical.product_id=p.id)) AND ($1='' OR p.sku ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%' OR COALESCE(p.material_code,'') ILIKE '%'||$1||'%')`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int total FROM ${this.t('products')} p WHERE ${productFilter}`, [q]);
    const items = await this.ops.db.query(`SELECT p.id product_id,p.sku,p.name,COALESCE(p.material_code,'') material_code,
      count(u.id) FILTER (WHERE u.status IN ('available','reserved','pending') AND u.parent_id IS NULL)::int in_stock,
      count(u.id) FILTER (WHERE u.status='available' AND u.parent_id IS NULL)::int available,
      count(u.id) FILTER (WHERE u.status='reserved' AND u.parent_id IS NULL)::int reserved,
      count(u.id) FILTER (WHERE u.status='pending' AND u.parent_id IS NULL)::int pending,
      count(u.id) FILTER (WHERE u.status='borrowed')::int borrowed
      FROM ${this.t('products')} p LEFT JOIN ${this.t('ops_units')} u ON u.product_id=p.id WHERE ${productFilter} GROUP BY p.id ORDER BY p.name,p.sku LIMIT $2 OFFSET $3`, [q, p.size, p.offset]);
    return { items, total: count.total };
  }
  async units(query: any) {
    const q = literalLike(text(query.q, '搜索词'));
    const pagination = pageParams(query);
    const product = query.product_id ? uuid(query.product_id, '商品') : null;
    const warehouse = query.warehouse_id ? uuid(query.warehouse_id, '仓库') : null;
    const reservedOrder = query.reserved_order_id ? uuid(query.reserved_order_id, '预留订单') : null;
    const dispatchOrder = query.dispatch_order_id ? uuid(query.dispatch_order_id, '出库订单') : null;
    const status = query.status ? text(query.status, '状态', false, 24) : null;
    if (status && !['available','reserved','pending','borrowed','shipped','assembled','disassembled','scrapped','dispatchable'].includes(status)) throw new BadRequestException('库存状态无效');
    if (status === 'dispatchable' && !dispatchOrder) throw new BadRequestException('查询待发实物必须选择销售订单');
    const args = [product, status, warehouse, q, reservedOrder, dispatchOrder];
    const from = ` FROM ${this.t('ops_units')} u JOIN ${this.t('products')} p ON p.id=u.product_id LEFT JOIN ${this.t('ops_warehouses')} w ON w.id=u.warehouse_id
      WHERE ($1::uuid IS NULL OR u.product_id=$1)
      AND ($2::text IS NULL OR u.status=$2 OR ($2='dispatchable' AND (u.status='available' OR (u.status='reserved' AND u.reserved_order_id=$6::uuid))))
      AND ($3::uuid IS NULL OR u.warehouse_id=$3)
      AND ($4='' OR u.serial_number ILIKE '%'||$4||'%' OR u.batch_number ILIKE '%'||$4||'%' OR p.sku ILIKE '%'||$4||'%' OR p.name ILIKE '%'||$4||'%' OR COALESCE(p.material_code,'') ILIKE '%'||$4||'%')
      AND ($5::uuid IS NULL OR u.reserved_order_id=$5)`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int total${from}`, args);
    const items = await this.ops.db.query(`SELECT u.id,u.product_id,p.sku,p.name,COALESCE(p.material_code,'') material_code,u.serial_number,u.batch_number,u.status,u.warehouse_id,w.name warehouse_name,u.parent_id,u.reserved_order_id,u.traceability_pending${from} ORDER BY u.updated_at DESC,u.id LIMIT $7 OFFSET $8`, [...args, pagination.size, pagination.offset]);
    return { items, total: count.total };
  }
  async movements(query: any) {
    const p = pageParams(query); const q = literalLike(text(query.q, '搜索词'));
    const filter = ` WHERE ($1='' OR m.number ILIKE '%'||$1||'%' OR m.recipient ILIKE '%'||$1||'%' OR m.reason ILIKE '%'||$1||'%' OR m.tracking_number ILIKE '%'||$1||'%')`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int total FROM ${this.t('ops_movements')} m${filter}`, [q]);
    const heads = await this.ops.db.query(`SELECT m.* FROM ${this.t('ops_movements')} m${filter} ORDER BY m.occurred_at DESC,m.created_at DESC LIMIT $2 OFFSET $3`, [q,p.size,p.offset]);
    if (!heads.length) return { items: [], total: count.total };
    const details = await this.ops.db.query(`SELECT i.movement_id,i.unit_id,i.product_id,p.sku,p.name,u.serial_number,i.batch_number,i.from_status,i.to_status,i.source_movement_item_id FROM ${this.t('ops_movement_items')} i JOIN ${this.t('products')} p ON p.id=i.product_id JOIN ${this.t('ops_units')} u ON u.id=i.unit_id WHERE i.movement_id=ANY($1::uuid[]) ORDER BY i.created_at,i.id`, [heads.map((x: any) => x.id)]);
    const groups = new Map<string,any[]>(); for (const d of details) { const a=groups.get(d.movement_id)||[]; a.push(d); groups.set(d.movement_id,a); }
    return { items: heads.map((h: any) => ({ ...h, items: groups.get(h.id)||[] })), total: count.total };
  }

  private async start(type: string, body: any, actor: Actor, work: (qr: QueryRunner, movement: any) => Promise<void>) {
    const warehouseId = uuid(body.warehouse_id, 'warehouse_id'); const occurred = date(body.occurred_at, 'occurred_at');
    const id = randomUUID(); const number = `INV-${id.slice(0,8).toUpperCase()}`;
    const qr = this.ops.db.createQueryRunner(); await qr.connect(); await qr.startTransaction('SERIALIZABLE');
    try {
      const [warehouse] = await qr.query(`SELECT id FROM ${this.t('ops_warehouses')} WHERE id=$1 AND active=true FOR SHARE`, [warehouseId]);
      if (!warehouse) throw new NotFoundException('仓库不存在或已停用');
      const movement = { id, number, type, warehouseId, occurred };
      await qr.query(`INSERT INTO ${this.t('ops_movements')}(id,number,type,reason,warehouse_id,occurred_at,recipient,sales_order_id,carrier,tracking_number,shipping_cost,expected_return_at,notes,actor_id,actor_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [id,number,type,text(body.reason,'reason'),warehouseId,occurred,text(body.recipient,'recipient',false,300),body.sales_order_id?uuid(body.sales_order_id,'sales_order_id'):null,text(body.carrier,'carrier',false,160),text(body.tracking_number,'tracking_number',false,180),body.shipping_cost == null || body.shipping_cost === '' ? null : this.money(body.shipping_cost),body.expected_return_at?date(body.expected_return_at,'expected_return_at'):null,text(body.notes,'notes'),actor.id,actor.displayName||actor.username]);
      await work(qr,movement); await qr.commitTransaction(); return { id,number,type,occurred_at:occurred };
    } catch (error: any) { await qr.rollbackTransaction(); if (error?.code === '40001' || error?.code === '40P01') throw new ConflictException('库存状态已被其他操作更新，请刷新后重试'); throw error; } finally { await qr.release(); }
  }
  private money(v: unknown) { if (!(typeof v==='string'||typeof v==='number') || !/^\d{1,10}(\.\d{1,2})?$/.test(String(v))) throw new BadRequestException('物流费用必须是非负金额，最多两位小数'); return String(v); }
  private async item(qr: { query(sql: string, parameters?: any[]): Promise<any> }, movement: any, unit: any, from: string|null, to: string, fromWarehouse: string|null, toWarehouse: string|null, sourceItemId: string|null = null) {
    await qr.query(`INSERT INTO ${this.t('ops_movement_items')}(movement_id,unit_id,product_id,batch_number,from_status,to_status,from_warehouse_id,to_warehouse_id,source_movement_item_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [movement.id,unit.id,unit.product_id,unit.batch_number,from,to,fromWarehouse,toWarehouse,sourceItemId]);
  }
  async receipt(body: any, actor: Actor) {
    const type = text(body.type,'type',true,24); if (!['purchase','initial','return','borrow_return'].includes(type)) throw new BadRequestException('入库类型无效');
    if (!Array.isArray(body.items)||!body.items.length) throw new BadRequestException('请至少添加一条入库明细');
    const inputs: any[]=[]; const seen=new Set<string>();
    for (const line of body.items) { const productId=uuid(line.product_id,'product_id'); if (!Array.isArray(line.serial_numbers)||!line.serial_numbers.length) throw new BadRequestException('每件库存都必须录入序列号'); const serials=line.serial_numbers.map((x:any)=>text(x,'serial_number',true,200)); for(const s of serials){const k=`${productId}\0${s}`;if(seen.has(k))throw new BadRequestException(`序列号重复：${s}`);seen.add(k);inputs.push({productId,serial:s,batch:text(line.batch_number,'batch_number',true,160)});}}
    return this.start(type,{...body,reason:type},actor,async(qr,m)=>{
      for(const entry of inputs){
        const [product]=await qr.query(`SELECT id,kind FROM ${this.t('products')} WHERE id=$1 AND active=true FOR SHARE`,[entry.productId]); if(!product)throw new NotFoundException('商品不存在或已停用');
        let unit:any; let from:string|null=null; let fromWarehouse:string|null=null; let sourceItemId:string|null=null;
        if(type==='return'||type==='borrow_return'){
          const expected=type==='return'?'shipped':'borrowed'; const rows=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE product_id=$1 AND serial_number=$2 FOR UPDATE`,[entry.productId,entry.serial]); unit=rows[0];
          if(!unit||unit.status!==expected)throw new BadRequestException(type==='return'?'退货只能接收历史出库的原实物':'借样归还只能接收当前借出的原实物');
          if(entry.batch!==unit.batch_number)throw new BadRequestException(`原实物 ${entry.serial} 的生产批号不能更改`);
          from=unit.status; fromWarehouse=unit.warehouse_id;
          if(type==='return'){ const [prior]=await qr.query(`SELECT i.id FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id WHERE i.unit_id=$1 AND i.to_status='shipped' AND m.type='sale' AND NOT EXISTS (SELECT 1 FROM ${this.t('ops_movement_items')} r WHERE r.source_movement_item_id=i.id) ORDER BY m.occurred_at DESC LIMIT 1 FOR UPDATE OF i`,[unit.id]); if(!prior)throw new BadRequestException('该实物没有可退的销售发货记录'); sourceItemId=prior.id; }
          await qr.query(`UPDATE ${this.t('ops_units')} SET status='pending',warehouse_id=$2,updated_at=now() WHERE id=$1`,[unit.id,m.warehouseId]);
        } else {
          const rows=await qr.query(`INSERT INTO ${this.t('ops_units')}(product_id,serial_number,batch_number,status,warehouse_id,traceability_pending) VALUES($1,$2,$3,'available',$4,$5) ON CONFLICT(product_id,serial_number) DO NOTHING RETURNING *`,[entry.productId,entry.serial,entry.batch,m.warehouseId,product.kind==='bundle']);
          if(!rows.length)throw new BadRequestException(`序列号已存在：${entry.serial}`); unit=rows[0];
        }
        await this.item(qr,m,unit,from,type==='return'||type==='borrow_return'?'pending':'available',fromWarehouse,m.warehouseId,type==='return'?sourceItemId:null);
      }
    });
  }
  async issue(body: any, actor: Actor) {
    const type=text(body.type,'type',true,24); if(!['sale','sample','borrow','internal','scrap'].includes(type))throw new BadRequestException('出库类型无效');
    if(!Array.isArray(body.unit_ids)||!body.unit_ids.length)throw new BadRequestException('请选择出库实物'); const ids=body.unit_ids.map((x:any)=>uuid(x,'unit_id')); if(new Set(ids).size!==ids.length)throw new BadRequestException('同一实物不能重复出库');
    const reason=text(body.reason,'reason',true); if(['sale','sample','borrow','internal'].includes(type)&&!text(body.recipient,'recipient',true,300))throw new BadRequestException('该出库类型必须填写接收方');
    if(type==='sale'&&!body.sales_order_id)throw new BadRequestException('销售出库必须关联销售订单'); if(type!=='sale'&&body.sales_order_id)throw new BadRequestException('只有销售发货可以关联销售订单');
    if(type==='borrow'&&!body.expected_return_at)throw new BadRequestException('借样出库必须填写预计归还时间'); if(body.expected_return_at){const due=date(body.expected_return_at,'expected_return_at');const occurred=date(body.occurred_at,'occurred_at');if(Date.parse(due)<=Date.parse(occurred))throw new BadRequestException('预计归还时间必须晚于出库时间');}
    return this.start(type,{...body,reason},actor,async(qr,m)=>{
      if(type==='sale') await this.checkSalesOrder(qr,uuid(body.sales_order_id,'sales_order_id'),ids);
      const locked=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]); if(locked.length!==ids.length)throw new NotFoundException('部分实物不存在');
      for(const u of locked){ const validSaleReservation=type==='sale'&&u.status==='reserved'&&u.reserved_order_id===body.sales_order_id; const validAvailable=u.status==='available'&&!u.reserved_order_id; if((!validAvailable&&!validSaleReservation)||u.parent_id)throw new BadRequestException(`实物 ${u.serial_number} 当前不可出库或预留给其他订单`); if(u.warehouse_id!==m.warehouseId)throw new BadRequestException(`实物 ${u.serial_number} 不在所选仓库`); }
      const dest=type==='borrow'?'borrowed':type==='scrap'?'scrapped':'shipped';
      for(const u of locked){await qr.query(`UPDATE ${this.t('ops_units')} SET status=$2,warehouse_id=NULL,reserved_order_id=NULL,updated_at=now() WHERE id=$1`,[u.id,dest]);await this.item(qr,m,u,u.status,dest,u.warehouse_id,null);}
      if(type==='sale'){
        const [totals]=await qr.query(`SELECT COALESCE(sum(quantity),0)::int ordered, (SELECT count(*)::int FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id WHERE m.sales_order_id=$1 AND m.type='sale' AND i.to_status='shipped') shipped FROM ${this.t('ops_sales_order_items')} WHERE order_id=$1`,[body.sales_order_id]);
        await qr.query(`UPDATE ${this.t('ops_sales_orders')} SET status=CASE WHEN $2::int >= $1::int THEN 'shipped' WHEN $2::int > 0 THEN 'partial' ELSE 'open' END WHERE id=$3 AND status IN ('open','partial')`,[Number(totals.ordered),Number(totals.shipped),body.sales_order_id]);
      }
    });
  }
  private async checkSalesOrder(qr: QueryRunner, orderId: string, ids: string[]) {
    const orders=await qr.query(`SELECT id,status FROM ${this.t('ops_sales_orders')} WHERE id=$1 FOR UPDATE`,[orderId]);if(!orders.length)throw new NotFoundException('销售订单不存在');if(!['open','partial'].includes(orders[0].status))throw new BadRequestException('已取消或已完全发货的订单不能继续销售出库');
    const lines=await qr.query(`SELECT id,product_id,quantity FROM ${this.t('ops_sales_order_items')} WHERE order_id=$1 ORDER BY id FOR UPDATE`,[orderId]); if(!lines.length)throw new NotFoundException('销售订单没有商品明细');
    const units=await qr.query(`SELECT id,product_id,status,reserved_order_id FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[])`,[ids]); const grouped=new Map<string,number>(); for(const u of units)grouped.set(u.product_id,(grouped.get(u.product_id)||0)+1);
    const quantities=new Map<string,number>();for(const line of lines)quantities.set(line.product_id,(quantities.get(line.product_id)||0)+Number(line.quantity));
    for(const [productId,requested] of grouped){const qty=quantities.get(productId);if(qty==null)throw new BadRequestException('所选实物不属于该销售订单商品');const [sent]=await qr.query(`SELECT count(*)::int n FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id WHERE m.sales_order_id=$1 AND i.product_id=$2 AND i.to_status='shipped'`,[orderId,productId]);const [reserved]=await qr.query(`SELECT count(*)::int n FROM ${this.t('ops_units')} WHERE reserved_order_id=$1 AND product_id=$2 AND status='reserved'`,[orderId,productId]);const used=units.filter((u:any)=>u.product_id===productId&&u.status==='reserved'&&u.reserved_order_id===orderId).length;if(Number(sent.n)+requested+Number(reserved.n)-used>qty)throw new BadRequestException('本次发货及已有预留数量超过订单未发货数量');}
  }
  async reserve(body: any, actor: Actor) {
    const orderId=uuid(body.sales_order_id,'sales_order_id');if(!Array.isArray(body.unit_ids))throw new BadRequestException('请选择预留实物');const ids=body.unit_ids.map((x:any)=>uuid(x,'unit_id'));if(!ids.length||new Set(ids).size!==ids.length)throw new BadRequestException('请选择不重复的预留实物');const reason=text(body.reason,'reason',true);
    return this.start('reservation',{...body,reason,sales_order_id:orderId},actor,async(qr,m)=>{
      const orders=await qr.query(`SELECT id,status FROM ${this.t('ops_sales_orders')} WHERE id=$1 FOR UPDATE`,[orderId]);if(!orders.length)throw new NotFoundException('销售订单不存在');if(!['open','partial'].includes(orders[0].status))throw new BadRequestException('已取消或已完全发货的订单不能预留库存');
      const lines=await qr.query(`SELECT product_id,quantity FROM ${this.t('ops_sales_order_items')} WHERE order_id=$1 FOR UPDATE`,[orderId]);if(!lines.length)throw new NotFoundException('销售订单没有商品明细');const demand=new Map<string,number>();for(const l of lines)demand.set(l.product_id,(demand.get(l.product_id)||0)+Number(l.quantity));
      const units=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]);if(units.length!==ids.length)throw new NotFoundException('部分实物不存在');const requested=new Map<string,number>();for(const u of units){if(u.status!=='available'||u.reserved_order_id||u.parent_id)throw new BadRequestException(`实物 ${u.serial_number} 当前不可预留`);if(u.warehouse_id!==m.warehouseId)throw new BadRequestException(`实物 ${u.serial_number} 不在所选仓库`);requested.set(u.product_id,(requested.get(u.product_id)||0)+1);}
      const shippedRows=await qr.query(`SELECT i.product_id,count(*)::int n FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id WHERE m.sales_order_id=$1 AND m.type='sale' AND i.to_status='shipped' GROUP BY i.product_id`,[orderId]);const shipped=new Map<string,number>(shippedRows.map((x:any)=>[x.product_id,Number(x.n)]));
      const reservedRows=await qr.query(`SELECT product_id,count(*)::int n FROM ${this.t('ops_units')} WHERE reserved_order_id=$1 AND status='reserved' GROUP BY product_id`,[orderId]);const reserved=new Map<string,number>(reservedRows.map((x:any)=>[x.product_id,Number(x.n)]));
      for(const [pid,n] of requested){const qty=demand.get(pid);if(qty==null)throw new BadRequestException('所选实物不属于该销售订单商品');if((shipped.get(pid)||0)+(reserved.get(pid)||0)+n>qty)throw new BadRequestException('预留数量超过订单未发货数量');}
      for(const u of units){await qr.query(`UPDATE ${this.t('ops_units')} SET status='reserved',reserved_order_id=$2,updated_at=now() WHERE id=$1`,[u.id,orderId]);await this.item(qr,m,u,'available','reserved',m.warehouseId,m.warehouseId);}
    });
  }
  async release(body: any, actor: Actor) {
    const orderId=uuid(body.sales_order_id,'sales_order_id');if(!Array.isArray(body.unit_ids))throw new BadRequestException('请选择要释放的预留实物');const ids=body.unit_ids.map((x:any)=>uuid(x,'unit_id'));if(!ids.length||new Set(ids).size!==ids.length)throw new BadRequestException('请选择不重复的预留实物');const reason=text(body.reason,'reason',true);
    return this.start('release',{...body,reason,sales_order_id:orderId},actor,async(qr,m)=>{
      const [order]=await qr.query(`SELECT id FROM ${this.t('ops_sales_orders')} WHERE id=$1 FOR UPDATE`,[orderId]);if(!order)throw new NotFoundException('销售订单不存在');
      const units=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]);if(units.length!==ids.length)throw new NotFoundException('部分实物不存在');for(const u of units)if(u.status!=='reserved'||u.reserved_order_id!==orderId||u.warehouse_id!==m.warehouseId)throw new BadRequestException(`实物 ${u.serial_number} 没有预留给该订单或仓库不匹配`);
      for(const u of units){await qr.query(`UPDATE ${this.t('ops_units')} SET status='available',reserved_order_id=NULL,updated_at=now() WHERE id=$1`,[u.id]);await this.item(qr,m,u,'reserved','available',m.warehouseId,m.warehouseId);}
    });
  }
  /** Release all order reservations from an existing TypeORM transaction manager. */
  async releaseOrderReservations(manager: { query(sql: string, parameters?: any[]): Promise<any> }, orderId: string, actor: Actor): Promise<void> {
    uuid(orderId,'sales_order_id');
    const units=await manager.query(`SELECT * FROM ${this.t('ops_units')} WHERE reserved_order_id=$1 AND status='reserved' ORDER BY id FOR UPDATE`,[orderId]);if(!units.length)return;
    const groups=new Map<string,any[]>();for(const u of units){const a=groups.get(u.warehouse_id)||[];a.push(u);groups.set(u.warehouse_id,a);}
    for(const [warehouseId,group] of groups){const id=randomUUID();const number=`INV-${id.slice(0,8).toUpperCase()}`;const occurred=new Date().toISOString();const name=actor.displayName||actor.username||'系统';
      await manager.query(`INSERT INTO ${this.t('ops_movements')}(id,number,type,reason,warehouse_id,occurred_at,sales_order_id,notes,actor_id,actor_name) VALUES($1,$2,'release','订单取消释放预留',$3,$4,$5,'',$6,$7)`,[id,number,warehouseId,occurred,orderId,actor.id,name]);
      const movement={id,number,type:'release',warehouseId,occurred};for(const u of group){await manager.query(`UPDATE ${this.t('ops_units')} SET status='available',reserved_order_id=NULL,updated_at=now() WHERE id=$1`,[u.id]);await this.item(manager,movement,u,'reserved','available',warehouseId,warehouseId);}
    }
  }
  private async validateBundleComponents(qr: QueryRunner, productId: string, components: any[]) {
    if(components.some((u:any)=>u.product_id===productId))throw new BadRequestException('套装不能包含自身型号');
    const [nested]=await qr.query(`SELECT count(*)::int n FROM ${this.t('products')} WHERE id=ANY($1::uuid[]) AND kind='bundle'`,[components.map((u:any)=>u.product_id)]);if(Number(nested.n))throw new BadRequestException('第一期不支持嵌套套装');
    const templates=await qr.query(`SELECT pv.id parent_variant_id,cv.product_id component_product_id,bc.quantity FROM ${this.t('product_variants')} pv JOIN ${this.t('bom_components')} bc ON bc.parent_variant_id=pv.id JOIN ${this.t('product_variants')} cv ON cv.id=bc.component_variant_id WHERE pv.product_id=$1 ORDER BY pv.id,cv.product_id`,[productId]);
    if(!templates.length)return false;
    const candidates=new Map<string,Map<string,number>>();for(const r of templates){const n=Number(r.quantity);if(!Number.isInteger(n)||n<1)throw new BadRequestException('该套装 BOM 数量不是可追踪的整件数量');const m0=candidates.get(r.parent_variant_id)||new Map<string,number>();m0.set(r.component_product_id,(m0.get(r.component_product_id)||0)+n);candidates.set(r.parent_variant_id,m0);}
    const actual=new Map<string,number>();for(const u of components)actual.set(u.product_id,(actual.get(u.product_id)||0)+1);
    const matched=[...candidates.values()].some((expected)=>expected.size===actual.size&&[...expected].every(([pid,n])=>actual.get(pid)===n));if(!matched)throw new BadRequestException('所选实物组成与该套装已配置的 BOM 不匹配');return true;
  }
  async assemble(body: any, actor: Actor) {
    const productId=uuid(body.product_id,'product_id');const serial=text(body.serial_number,'serial_number',true,200);const batch=text(body.batch_number,'batch_number',true,160);if(!Array.isArray(body.unit_ids)||!body.unit_ids.length)throw new BadRequestException('请选择组装组件');const ids=body.unit_ids.map((x:any)=>uuid(x,'unit_id'));if(new Set(ids).size!==ids.length)throw new BadRequestException('组件不能重复');
    return this.start('assembly',{...body,reason:'assembly'},actor,async(qr,m)=>{
      const [p]=await qr.query(`SELECT id,kind FROM ${this.t('products')} WHERE id=$1 AND active=true FOR SHARE`,[productId]);if(!p)throw new NotFoundException('套装商品不存在');if(p.kind!=='bundle')throw new BadRequestException('组装目标商品必须是实体套装型号');
      const c=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]);if(c.length!==ids.length)throw new NotFoundException('部分组件不存在');for(const u of c)if(u.status!=='available'||u.parent_id||u.warehouse_id!==m.warehouseId)throw new BadRequestException(`组件 ${u.serial_number} 不可组装`);
      await this.validateBundleComponents(qr,productId,c);
      const [parent]=await qr.query(`INSERT INTO ${this.t('ops_units')}(product_id,serial_number,batch_number,status,warehouse_id) VALUES($1,$2,$3,'available',$4) ON CONFLICT(product_id,serial_number) DO NOTHING RETURNING *`,[productId,serial,batch,m.warehouseId]);if(!parent)throw new BadRequestException(`套装序列号已存在：${serial}`);
      await this.item(qr,m,parent,null,'available',null,m.warehouseId);
      for(const u of c){await qr.query(`UPDATE ${this.t('ops_units')} SET status='assembled',warehouse_id=NULL,parent_id=$2,updated_at=now() WHERE id=$1`,[u.id,parent.id]);await qr.query(`INSERT INTO ${this.t('ops_assembly_links')}(parent_unit_id,child_unit_id,assembly_movement_id,valid_from) VALUES($1,$2,$3,$4)`,[parent.id,u.id,m.id,m.occurred]);await this.item(qr,m,u,'available','assembled',m.warehouseId,null);}
    });
  }
  async recordBundleComponents(body: any, actor: Actor) {
    const parentId=uuid(body.unit_id,'unit_id');if(!Array.isArray(body.unit_ids)||!body.unit_ids.length)throw new BadRequestException('请选择组件实物');const ids=body.unit_ids.map((x:any)=>uuid(x,'unit_id'));if(new Set(ids).size!==ids.length)throw new BadRequestException('组件不能重复');const reason=text(body.reason,'reason',true);
    return this.start('bundle_components',{...body,reason},actor,async(qr,m)=>{
      const [parent]=await qr.query(`SELECT u.*,p.kind FROM ${this.t('ops_units')} u JOIN ${this.t('products')} p ON p.id=u.product_id WHERE u.id=$1 FOR UPDATE OF u`,[parentId]);if(!parent||parent.kind!=='bundle'||parent.status!=='available'||!parent.traceability_pending||parent.warehouse_id!==m.warehouseId)throw new BadRequestException('只可为所选仓库中组成信息待补的在库套装补录实物组件');
      const [existing]=await qr.query(`SELECT count(*)::int n FROM ${this.t('ops_assembly_links')} WHERE parent_unit_id=$1 AND valid_to IS NULL`,[parentId]);if(Number(existing.n))throw new ConflictException('该套装已有组成件记录');
      const children=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,[ids]);if(children.length!==ids.length)throw new NotFoundException('部分组件实物不存在');for(const child of children)if(child.status!=='available'||child.parent_id||child.reserved_order_id||child.warehouse_id!==m.warehouseId)throw new BadRequestException(`组件 ${child.serial_number} 当前不可关联`);
      await this.validateBundleComponents(qr,parent.product_id,children);
      for(const child of children){await qr.query(`UPDATE ${this.t('ops_units')} SET status='assembled',warehouse_id=NULL,parent_id=$2,updated_at=now() WHERE id=$1`,[child.id,parentId]);await qr.query(`INSERT INTO ${this.t('ops_assembly_links')}(parent_unit_id,child_unit_id,assembly_movement_id,valid_from) VALUES($1,$2,$3,$4)`,[parentId,child.id,m.id,m.occurred]);await this.item(qr,m,child,'available','assembled',m.warehouseId,null);}
      await qr.query(`UPDATE ${this.t('ops_units')} SET traceability_pending=false,updated_at=now() WHERE id=$1`,[parentId]);await this.item(qr,m,parent,'available','available',m.warehouseId,m.warehouseId);
    });
  }
  async disassemble(body: any, actor: Actor) {
    const unitId=uuid(body.unit_id,'unit_id');const occurred=date(body.occurred_at,'occurred_at');const reason=text(body.reason,'reason',true);
    return this.start('disassembly',{warehouse_id:body.warehouse_id,occurred_at:occurred,reason},actor,async(qr,m)=>{
      const rows=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=$1 FOR UPDATE`,[unitId]);const parent=rows[0];if(!parent||parent.status!=='available'||parent.parent_id||parent.warehouse_id!==m.warehouseId)throw new BadRequestException('只有所选仓库中可用的套装才能拆解');
      const links=await qr.query(`SELECT l.id link_id,l.valid_from,u.* FROM ${this.t('ops_assembly_links')} l JOIN ${this.t('ops_units')} u ON u.id=l.child_unit_id WHERE l.parent_unit_id=$1 AND l.valid_to IS NULL ORDER BY u.id FOR UPDATE OF u`,[unitId]);if(!links.length)throw new BadRequestException('该套装没有当前有效的组成件');
      await qr.query(`UPDATE ${this.t('ops_units')} SET status='disassembled',warehouse_id=NULL,updated_at=now() WHERE id=$1`,[unitId]);await this.item(qr,m,parent,'available','disassembled',parent.warehouse_id,null);
      for(const u of links){await qr.query(`UPDATE ${this.t('ops_units')} SET status='available',warehouse_id=$2,parent_id=NULL,updated_at=now() WHERE id=$1`,[u.id,m.warehouseId]);await qr.query(`UPDATE ${this.t('ops_assembly_links')} SET valid_to=$2,disassembly_movement_id=$3 WHERE id=$1`,[u.link_id,m.occurred,m.id]);await this.item(qr,m,u,'assembled','available',null,m.warehouseId);}
    });
  }
  async inspect(body: any, actor: Actor) {
    const unitId=uuid(body.unit_id,'unit_id');const occurred=date(body.occurred_at,'occurred_at');const result=text(body.result,'result',true,24);if(!['available','scrapped'].includes(result))throw new BadRequestException('检验结果只能是 available 或 scrapped');const reason=text(body.reason,'reason',true);
    return this.start('inspection',{warehouse_id:body.warehouse_id,occurred_at:occurred,reason},actor,async(qr,m)=>{
      const rows=await qr.query(`SELECT * FROM ${this.t('ops_units')} WHERE id=$1 FOR UPDATE`,[unitId]);const u=rows[0];if(!u||u.status!=='pending'||u.parent_id||u.warehouse_id!==m.warehouseId)throw new BadRequestException('只有所选仓库中待检的独立实物可以检验');
      const warehouse=result==='scrapped'?null:m.warehouseId;await qr.query(`UPDATE ${this.t('ops_units')} SET status=$2,warehouse_id=$3,updated_at=now() WHERE id=$1`,[u.id,result,warehouse]);await this.item(qr,m,u,'pending',result,m.warehouseId,warehouse);
    });
  }
  async trace(query: any) {
    const q=literalLike(text(query.q,'搜索词',true,200));
    const rows=await this.ops.db.query(`SELECT u.id,u.product_id,p.sku,p.name,COALESCE(p.material_code,'') material_code,u.serial_number,u.batch_number,u.status,u.warehouse_id,w.name warehouse_name,u.parent_id,u.reserved_order_id,u.traceability_pending
      FROM ${this.t('ops_units')} u JOIN ${this.t('products')} p ON p.id=u.product_id LEFT JOIN ${this.t('ops_warehouses')} w ON w.id=u.warehouse_id
      WHERE u.serial_number ILIKE '%'||$1||'%' OR u.batch_number ILIKE '%'||$1||'%' OR p.sku ILIKE '%'||$1||'%' OR p.name ILIKE '%'||$1||'%' OR COALESCE(p.material_code,'') ILIKE '%'||$1||'%'
      OR EXISTS (SELECT 1 FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id LEFT JOIN ${this.t('ops_sales_orders')} o ON o.id=m.sales_order_id WHERE (i.unit_id=u.id OR i.unit_id IN (SELECT l.parent_unit_id FROM ${this.t('ops_assembly_links')} l WHERE l.child_unit_id=u.id AND m.occurred_at>=l.valid_from AND (l.valid_to IS NULL OR m.occurred_at<=l.valid_to))) AND (m.number ILIKE '%'||$1||'%' OR m.tracking_number ILIKE '%'||$1||'%' OR COALESCE(o.number,'') ILIKE '%'||$1||'%' OR COALESCE(o.external_number,'') ILIKE '%'||$1||'%'))
      ORDER BY p.sku,u.serial_number LIMIT 100`,[q]);
    const ids=rows.map((r:any)=>r.id);if(!ids.length)return {units:[]};
    const [components,parentLinks]=await Promise.all([
      this.ops.db.query(`SELECT l.parent_unit_id,l.valid_from,l.valid_to,u.id,u.product_id,p.sku,p.name,COALESCE(p.material_code,'') material_code,u.serial_number,u.batch_number,u.status,u.warehouse_id,u.parent_id,u.traceability_pending FROM ${this.t('ops_assembly_links')} l JOIN ${this.t('ops_units')} u ON u.id=l.child_unit_id JOIN ${this.t('products')} p ON p.id=u.product_id WHERE l.parent_unit_id=ANY($1::uuid[]) ORDER BY l.valid_from,u.serial_number`,[ids]),
      this.ops.db.query(`SELECT child_unit_id,parent_unit_id,valid_from,valid_to FROM ${this.t('ops_assembly_links')} WHERE child_unit_id=ANY($1::uuid[]) ORDER BY valid_from`,[ids])
    ]);
    const contextIds=[...new Set([...ids,...components.map((c:any)=>c.id),...parentLinks.map((x:any)=>x.parent_unit_id)])];
    const history=await this.ops.db.query(`SELECT i.unit_id,m.id movement_id,m.number,m.type,m.occurred_at,m.created_at,m.recipient,m.reason,m.notes,m.carrier,m.tracking_number,m.expected_return_at,m.sales_order_id,o.number sales_order_number,o.external_number,i.from_status,i.to_status,COALESCE(wto.name,wfrom.name) warehouse_name,m.actor_id,m.actor_name
      FROM ${this.t('ops_movement_items')} i JOIN ${this.t('ops_movements')} m ON m.id=i.movement_id LEFT JOIN ${this.t('ops_sales_orders')} o ON o.id=m.sales_order_id LEFT JOIN ${this.t('ops_warehouses')} wto ON wto.id=i.to_warehouse_id LEFT JOIN ${this.t('ops_warehouses')} wfrom ON wfrom.id=i.from_warehouse_id WHERE i.unit_id=ANY($1::uuid[]) ORDER BY m.occurred_at,m.created_at`,[contextIds]);
    const hm=new Map<string,any[]>(),cm=new Map<string,any[]>(),pl=new Map<string,any[]>();for(const x of history){const a=hm.get(x.unit_id)||[];a.push(x);hm.set(x.unit_id,a);}for(const x of components){const a=cm.get(x.parent_unit_id)||[];a.push({...x,history:hm.get(x.id)||[],parent_history:(hm.get(x.parent_unit_id)||[]).filter((h:any)=>new Date(h.occurred_at)>=new Date(x.valid_from)&&(!x.valid_to||new Date(h.occurred_at)<=new Date(x.valid_to)))});cm.set(x.parent_unit_id,a);}for(const x of parentLinks){const a=pl.get(x.child_unit_id)||[];a.push(x);pl.set(x.child_unit_id,a);}
    return {units:rows.map((u:any)=>({...u,history:hm.get(u.id)||[],parent_history:(pl.get(u.id)||[]).flatMap((link:any)=>(hm.get(link.parent_unit_id)||[]).filter((h:any)=>new Date(h.occurred_at)>=new Date(link.valid_from)&&(!link.valid_to||new Date(h.occurred_at)<=new Date(link.valid_to)))),components:cm.get(u.id)||[]}))};
  }
}
