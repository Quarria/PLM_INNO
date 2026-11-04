import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { OpsDatabase } from './ops-database';

type Actor = { sub: string; permissions?: string[] };
type Row = Record<string, any>;
const STAGES = ['sampling', 'delivery', 'feedback', 'contract', 'completed'] as const;
const stageLabels: Record<string, string> = { sampling: '打样', delivery: '送样', feedback: '客户反馈', contract: '合同', completed: '完成' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (v: unknown, field = 'id') => { if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`${field} 必须是有效 UUID`); return v; };
const text = (v: unknown, field: string, max: number, required = false) => { if (v == null && !required) return ''; if (typeof v !== 'string') throw new BadRequestException(`${field} 格式无效`); const s = v.trim(); if ((required && !s) || s.length > max) throw new BadRequestException(`${field}${required ? '不能为空且' : ''}不能超过 ${max} 个字符`); return s; };
const date = (v: unknown, field: string) => { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${field} 必须是有效的 YYYY-MM-DD 日期`); const d=new Date(`${v}T00:00:00Z`); if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==v)throw new BadRequestException(`${field} 必须是有效的 YYYY-MM-DD 日期`);return v; };
const amount = (v: unknown) => { if (v == null || v === '') return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 999999999999.99 || !/^\d{1,12}(\.\d{1,2})?$/.test(String(v))) throw new BadRequestException('预计金额无效'); return n.toFixed(2); };
const cleanUuidArray = (v: unknown, field: string): string[] => { if (v == null) return []; if (!Array.isArray(v) || v.length > 200) throw new BadRequestException(`${field} 必须是数组且最多 200 项`); const values = v.map((x) => id(x, field)); if (new Set(values).size !== values.length) throw new BadRequestException(`${field} 不能重复`); return values; };
function validOfficeZip(buffer: Buffer, kind: 'docx'|'xlsx'): boolean {
  try {
    if(buffer.length<22||buffer.readUInt32LE(0)!==0x04034b50)return false;
    const min=Math.max(0,buffer.length-65557);let eocd=-1;for(let i=buffer.length-22;i>=min;i--)if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break;}if(eocd<0)return false;
    const disk=buffer.readUInt16LE(eocd+4),cdDisk=buffer.readUInt16LE(eocd+6),count=buffer.readUInt16LE(eocd+10),cdSize=buffer.readUInt32LE(eocd+12),cdOffset=buffer.readUInt32LE(eocd+16);if(disk||cdDisk||count===0||count>1000||cdOffset+cdSize>eocd)return false;
    const entries=new Map<string,{method:number;compressed:number;size:number;offset:number}>();let p=cdOffset,total=0;
    for(let i=0;i<count;i++){
      if(buffer.readUInt32LE(p)!==0x02014b50)return false;const flags=buffer.readUInt16LE(p+8),method=buffer.readUInt16LE(p+10),compressed=buffer.readUInt32LE(p+20),size=buffer.readUInt32LE(p+24),nameLen=buffer.readUInt16LE(p+28),extraLen=buffer.readUInt16LE(p+30),commentLen=buffer.readUInt16LE(p+32),external=buffer.readUInt32LE(p+38),offset=buffer.readUInt32LE(p+42);const name=buffer.subarray(p+46,p+46+nameLen).toString('utf8');
      if(flags&1||![0,8].includes(method)||!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(part=>part==='..')||name.includes('\0')||entries.has(name))return false;
      const mode=external>>>16;if((mode&0xf000)===0xa000)return false;total+=size;if(total>30*1024*1024)return false;entries.set(name,{method,compressed,size,offset});p+=46+nameLen+extraLen+commentLen;if(p>cdOffset+cdSize)return false;
    }
    if(p!==cdOffset+cdSize||!entries.has('[Content_Types].xml'))return false;
    const content=(name:string)=>{const e=entries.get(name);if(!e)return null;const o=e.offset;if(buffer.readUInt32LE(o)!==0x04034b50)return null;const n=buffer.readUInt16LE(o+26),x=buffer.readUInt16LE(o+28),start=o+30+n+x,end=start+e.compressed;if(end>buffer.length)return null;const raw=buffer.subarray(start,end);const out=e.method===0?raw:inflateRawSync(raw,{maxOutputLength:30*1024*1024});if(out.length!==e.size)return null;return out.toString('utf8');};
    const types=content('[Content_Types].xml');if(!types||!types.includes('<Types')||/vbaProject/i.test(types))return false;
    if(kind==='docx'){const doc=content('word/document.xml');return !!doc&&/<w:document(?:\s|>)/.test(doc)&&/word\/document\.xml/.test(types)&&![...entries.keys()].some(n=>/vbaProject\.bin$/i.test(n));}
    const book=content('xl/workbook.xml');return !!book&&/<(?:\w+:)?workbook(?:\s|>)/.test(book)&&/xl\/workbook\.xml/.test(types)&&![...entries.keys()].some(n=>/vbaProject\.bin$/i.test(n));
  } catch { return false; }
}

@Injectable()
export class OpportunityService {
  private readonly t: Record<string, string>;
  constructor(private readonly ops: OpsDatabase) {
    this.t = Object.fromEntries(['opportunities','opportunity_stage_runs','opportunity_items','opportunity_documents','opportunity_attachments','opportunity_quote_links','opportunity_events','customers','users','product_variants','products','quotes'].map((n) => [n, ops.table(n)]));
  }
  private has(actor: Actor, permission: string) { return actor.permissions?.includes('*') || actor.permissions?.includes(permission); }
  private manage(actor: Actor) { return this.has(actor, 'opportunity:manage'); }
  private canView(actor: Actor) { return this.has(actor,'opportunity:view')||this.manage(actor); }
  private assertView(actor: Actor) { if(!this.canView(actor)) throw new ForbiddenException('当前账号没有商机查看权限'); }
  private async editable(op: Row, actor: Actor) { if (!(this.manage(actor) || (op.owner_id === actor.sub && this.has(actor, 'opportunity:write')))) throw new ForbiddenException('仅商机负责人或商机管理员可编辑'); }
  private async findOp(manager: EntityManager, opportunityId: string, lock = false) {
    const rows: Row[] = await manager.query(`SELECT o.*,r.stage AS current_stage,r.entered_at AS stage_entered_at FROM ${this.t.opportunities} o LEFT JOIN ${this.t.opportunity_stage_runs} r ON r.id=o.current_stage_run_id WHERE o.id=$1${lock ? ' FOR UPDATE OF o' : ''}`, [id(opportunityId, '商机 ID')]);
    if (!rows.length) throw new NotFoundException('商机不存在'); return rows[0];
  }
  async list(query: any, actor: Actor) {
    this.assertView(actor);
    const page = Number(query.page || 1), size = Number(query.size || 20); if (!Number.isInteger(page) || page < 1 || ![10,20,50].includes(size)) throw new BadRequestException('分页参数无效');
    const q = text(query.q, '关键词', 200), owner = query.owner_id ? id(query.owner_id, 'owner_id') : null;
    const stage = query.stage || null; if (stage && !STAGES.includes(stage)) throw new BadRequestException('节点无效');
    const status = query.status || null; if (status && !['in_progress','completed','terminated','all'].includes(status)) throw new BadRequestException('状态无效');
    const params = [q, `%${q.replace(/[\\%_]/g, '\\$&')}%`, owner, stage, status === 'all' ? null : status, size, (page - 1) * size];
    const where = `WHERE ($1='' OR o.number ILIKE $2 ESCAPE E'\\\\' OR o.name ILIKE $2 ESCAPE E'\\\\' OR c.name ILIKE $2 ESCAPE E'\\\\') AND ($3::uuid IS NULL OR o.owner_id=$3) AND ($4::text IS NULL OR r.stage=$4) AND ($5::text IS NULL OR o.status=$5)`;
    const [count] = await this.ops.db.query(`SELECT count(*)::int AS total FROM ${this.t.opportunities} o JOIN ${this.t.customers} c ON c.id=o.customer_id LEFT JOIN ${this.t.opportunity_stage_runs} r ON r.id=o.current_stage_run_id ${where}`, params.slice(0,5));
    const rows: Row[] = await this.ops.db.query(`SELECT o.id,o.number,o.name,o.customer_id,c.name AS customer_name,o.owner_id,u."displayName" AS owner_name,r.stage AS current_stage,r.entered_at AS stage_entered_at,o.status,o.version,o.expected_amount,o.expected_completion_date,o.updated_at FROM ${this.t.opportunities} o JOIN ${this.t.customers} c ON c.id=o.customer_id JOIN ${this.t.users} u ON u.id=o.owner_id LEFT JOIN ${this.t.opportunity_stage_runs} r ON r.id=o.current_stage_run_id ${where} ORDER BY o.updated_at DESC LIMIT $6 OFFSET $7`, params);
    return { items: rows, total: count.total };
  }
  async options(query: any = {}, actor?: Actor) {
    if(actor)this.assertView(actor);
    const customerId=query.customer_id?id(query.customer_id,'customer_id'):null;
    const [customers,users,quotes]=await Promise.all([
      this.ops.db.query(`SELECT id,name,contact,phone FROM ${this.t.customers} WHERE active=true ORDER BY name`),
      this.ops.db.query(`SELECT id,username,"displayName" AS display_name FROM ${this.t.users} WHERE active=true ORDER BY "displayName",username`),
      customerId ? this.ops.db.query(`SELECT id,quote_number,customer_id,status,quote_date,expires_at FROM ${this.t.quotes} WHERE customer_id=$1 ORDER BY "createdAt" DESC`,[customerId]) : Promise.resolve([]),
    ]);
    return {customers,users,quotes};
  }
  async owners(actor?: Actor) { if(actor)this.assertView(actor);return {items:await this.ops.db.query(`SELECT id,username,"displayName" AS display_name FROM ${this.t.users} WHERE active=true ORDER BY "displayName",username`)}; }
  async detail(opportunityId: string, actor?: Actor, manager: EntityManager = this.ops.db.manager) {
    if(actor)this.assertView(actor);
    const op = await this.findOp(manager, opportunityId);
    const runs = await manager.query(`SELECT r.*,docs.docs AS documents FROM ${this.t.opportunity_stage_runs} r LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'stage_run_id',d.stage_run_id,'name',d.name,'type',d.type,'business_date',d.business_date,'description',d.description,'extra_data',d.extra_data,'created_by',d.created_by,'created_by_name',u."displayName",'created_at',d.created_at,'is_void',d.is_void,'void_reason',d.void_reason,'is_backfill',(r.exited_at IS NOT NULL AND d.created_at>r.exited_at OR o.status='completed' AND d.created_at>o.completed_at OR o.status='terminated' AND d.created_at>(SELECT max(e.created_at) FROM ${this.t.opportunity_events} e WHERE e.opportunity_id=o.id AND e.action='terminated')),'attachments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'file_name',a.file_name,'mime_type',a.mime_type,'size',a.size)) FROM ${this.t.opportunity_attachments} a WHERE a.document_id=d.id),'[]'::jsonb)) ORDER BY d.created_at),'[]'::jsonb) AS docs FROM ${this.t.opportunity_documents} d JOIN ${this.t.users} u ON u.id=d.created_by JOIN ${this.t.opportunities} o ON o.id=d.opportunity_id WHERE d.stage_run_id=r.id) docs ON true WHERE r.opportunity_id=$1 ORDER BY r.entered_at,r.round`, [op.id]);
    const events = await manager.query(`SELECT e.action,e.from_run_id,e.to_run_id,e.reason,e.detail,e.created_at,u."displayName" AS actor_name,fr.stage AS from_stage,tr.stage AS to_stage FROM ${this.t.opportunity_events} e JOIN ${this.t.users} u ON u.id=e.actor_id LEFT JOIN ${this.t.opportunity_stage_runs} fr ON fr.id=e.from_run_id LEFT JOIN ${this.t.opportunity_stage_runs} tr ON tr.id=e.to_run_id WHERE e.opportunity_id=$1 ORDER BY e.created_at,e.id`, [op.id]);
    const products = await manager.query(`SELECT i.variant_id,i.snapshot,p.sku,p.name,p.material_code,pv.specification,pv.unit FROM ${this.t.opportunity_items} i JOIN ${this.t.product_variants} pv ON pv.id=i.variant_id JOIN ${this.t.products} p ON p.id=pv.product_id WHERE i.opportunity_id=$1 ORDER BY p.sku,pv.specification`, [op.id]);
    const quotes = await manager.query(`SELECT q.id,q.quote_number,q.status,q.quote_date,q.expires_at FROM ${this.t.opportunity_quote_links} l JOIN ${this.t.quotes} q ON q.id=l.quote_id WHERE l.opportunity_id=$1 ORDER BY q."createdAt" DESC`, [op.id]);
    const owner = await manager.query(`SELECT "displayName" FROM ${this.t.users} WHERE id=$1`, [op.owner_id]);
    const customer=await manager.query(`SELECT name FROM ${this.t.customers} WHERE id=$1`,[op.customer_id]);
    return { ...op, customer_name:customer[0]?.name, owner_name: owner[0]?.displayName, stage_runs: runs.map((r: Row) => ({ ...r, documents: r.documents || [] })), events, products, quotes, quote_ids: quotes.map((q: Row) => q.id), permissions: { can_edit: !!actor && (this.manage(actor) || (op.owner_id === actor.sub && this.has(actor, 'opportunity:write'))), can_manage: !!actor && this.manage(actor) } };
  }

  async create(body: any, actor: Actor) {
    const name = text(body?.name,'商机名称',200,true), customerId = id(body?.customer_id,'customer_id');
    const ownerId = body?.owner_id ? id(body.owner_id,'owner_id') : actor.sub; if (ownerId !== actor.sub && !this.manage(actor)) throw new ForbiddenException('仅商机管理员可指定其他负责人');
    const desc = text(body?.description,'需求描述',10000), expected = amount(body?.expected_amount), completion = body?.expected_completion_date ? date(body.expected_completion_date,'expected_completion_date') : null;
    const variants = cleanUuidArray(body?.product_variant_ids,'product_variant_ids'), quotes = cleanUuidArray(body?.quote_ids,'quote_ids');
    return this.ops.db.transaction(async (m) => {
      if (!(await m.query(`SELECT id FROM ${this.t.customers} WHERE id=$1 AND active=true`,[customerId])).length) throw new BadRequestException('客户不存在或已停用');
      if (!(await m.query(`SELECT id FROM ${this.t.users} WHERE id=$1 AND active=true`,[ownerId])).length) throw new BadRequestException('负责人不存在或已停用');
      await this.validateVariants(m, variants); await this.validateQuotes(m, quotes, customerId);
      const [seq] = await m.query(`SELECT nextval('"${process.env.DB_SCHEMA || 'plm'}"."opportunity_number_seq"')::text AS n`);
      const d = new Date(), number = `SJ${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(seq.n).padStart(4,'0')}`;
      const [op] = await m.query(`INSERT INTO ${this.t.opportunities}(number,name,customer_id,owner_id,created_by,description,expected_amount,expected_completion_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[number,name,customerId,ownerId,actor.sub,desc,expected,completion]);
      const [run] = await m.query(`INSERT INTO ${this.t.opportunity_stage_runs}(opportunity_id,stage,round) VALUES($1,'sampling',1) RETURNING id`,[op.id]);
      await m.query(`UPDATE ${this.t.opportunities} SET current_stage_run_id=$2 WHERE id=$1`,[op.id,run.id]);
      await this.replaceLinks(m, op.id, variants, quotes);
      await this.event(m,op.id,'created',actor.sub,'',null,run.id,null,{});
      return this.detail(op.id, actor, m);
    });
  }
  private async validateVariants(m: EntityManager, ids: string[]) { if (!ids.length) return; const r = await m.query(`SELECT pv.id FROM ${this.t.product_variants} pv JOIN ${this.t.products} p ON p.id=pv.product_id WHERE pv.id=ANY($1::uuid[]) AND pv.active=true AND p.active=true`,[ids]); if (r.length!==ids.length) throw new BadRequestException('包含无效或停用的商品规格'); }
  private async validateQuotes(m: EntityManager, ids: string[], customer: string) { if (!ids.length) return; const r = await m.query(`SELECT id FROM ${this.t.quotes} WHERE id=ANY($1::uuid[]) AND customer_id=$2`,[ids,customer]); if (r.length!==ids.length) throw new BadRequestException('关联报价必须属于当前客户'); }
  private async replaceLinks(m: EntityManager, opId: string, variants: string[], quotes: string[]) {
    await m.query(`DELETE FROM ${this.t.opportunity_items} WHERE opportunity_id=$1`,[opId]);
    for (const v of variants) { const [snap] = await m.query(`SELECT jsonb_build_object('sku',p.sku,'name',p.name,'specification',pv.specification,'unit',pv.unit) AS snapshot FROM ${this.t.product_variants} pv JOIN ${this.t.products} p ON p.id=pv.product_id WHERE pv.id=$1`,[v]); await m.query(`INSERT INTO ${this.t.opportunity_items}(opportunity_id,variant_id,snapshot) VALUES($1,$2,$3)`,[opId,v,snap.snapshot]); }
    await m.query(`DELETE FROM ${this.t.opportunity_quote_links} WHERE opportunity_id=$1`,[opId]); for (const q of quotes) await m.query(`INSERT INTO ${this.t.opportunity_quote_links}(opportunity_id,quote_id) VALUES($1,$2)`,[opId,q]);
  }
  async edit(opportunityId: string, body: any, actor: Actor) {
    return this.ops.db.transaction(async (m) => {
      const op = await this.findOp(m,opportunityId,true); await this.editable(op,actor);
      const allowed = new Set(['version','name','customer_id','description','expected_amount','expected_completion_date','product_variant_ids','quote_ids']);
      if (Object.keys(body || {}).some((key) => !allowed.has(key))) throw new BadRequestException('基本信息接口不允许修改状态、节点或负责人');
      if (Number(body?.version)!==Number(op.version)) throw new ConflictException('商机已被其他人修改，请刷新后重试');
      if (op.status !== 'in_progress') throw new ConflictException('已结案商机仅允许授权人员补录单据');
      const name = text(body?.name,'商机名称',200,true), customerId=id(body?.customer_id,'customer_id'), ownerId=body?.owner_id ? id(body.owner_id,'owner_id') : op.owner_id;
      if (ownerId!==op.owner_id && !this.manage(actor)) throw new ForbiddenException('负责人变更请使用转交操作');
      const desc=text(body?.description,'需求描述',10000), expected=amount(body?.expected_amount), completion=body?.expected_completion_date ? date(body.expected_completion_date,'expected_completion_date') : null;
      const variants=cleanUuidArray(body?.product_variant_ids,'product_variant_ids'), quotes=cleanUuidArray(body?.quote_ids,'quote_ids');
      if (!(await m.query(`SELECT id FROM ${this.t.customers} WHERE id=$1 AND active=true`,[customerId])).length) throw new BadRequestException('客户不存在或已停用');
      await this.validateVariants(m,variants); await this.validateQuotes(m,quotes,customerId);
      await m.query(`UPDATE ${this.t.opportunities} SET name=$2,customer_id=$3,description=$4,expected_amount=$5,expected_completion_date=$6,version=version+1,updated_at=now() WHERE id=$1`,[op.id,name,customerId,desc,expected,completion]);
      await this.replaceLinks(m,op.id,variants,quotes); await this.event(m,op.id,'updated',actor.sub,'',op.current_stage_run_id,op.current_stage_run_id,null,{}); return this.detail(op.id, actor, m);
    });
  }

  private async event(m: EntityManager,opId:string,action:string,actorId:string,reason:string,from:string|null,to:string|null,requestId:string|null,detail:Row) { await m.query(`INSERT INTO ${this.t.opportunity_events}(opportunity_id,action,actor_id,reason,from_run_id,to_run_id,request_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[opId,action,actorId,reason,from,to,requestId,detail]); }
  private async replay(m: EntityManager,opId:string,requestId:string) { const rows=await m.query(`SELECT id FROM ${this.t.opportunity_events} WHERE opportunity_id=$1 AND request_id=$2`,[opId,requestId]); return rows.length>0; }
  private async action(opportunityId:string,body:any,actor:Actor,action:'advance'|'return'|'terminate') {
    const requestId=id(body?.request_id,'request_id'), expected=Number(body?.expected_version); if(!Number.isInteger(expected)||expected<1) throw new BadRequestException('expected_version 必须是正整数');
    const reason=text(body?.reason,'原因',2000,action!=='advance');
    return this.ops.db.transaction(async (m) => {
      const op=await this.findOp(m,opportunityId,true); await this.editable(op,actor);
      if(await this.replay(m,op.id,requestId)) return this.detail(op.id, actor, m);
      if(Number(op.version)!==expected) throw new ConflictException('商机版本已变化，请刷新后重试');
      if(op.status!=='in_progress') throw new ConflictException('已完成或终止的商机不能执行此操作');
      const current=op.current_stage, index=STAGES.indexOf(current); if(index<0) throw new ConflictException('当前节点数据无效');
      if(action==='terminate') {
        await m.query(`UPDATE ${this.t.opportunities} SET status='terminated',termination_reason=$2,version=version+1,updated_at=now() WHERE id=$1`,[op.id,reason]);
        await this.event(m,op.id,'terminated',actor.sub,reason,op.current_stage_run_id,op.current_stage_run_id,requestId,{});
      } else if(action==='advance') {
        if(index>=STAGES.length-1) throw new ConflictException('商机已到最后节点');
        if(current==='contract'&&!reason) throw new BadRequestException('完成商机必须填写结案说明');
        const [valid] = await m.query(`SELECT count(*)::int AS n FROM ${this.t.opportunity_documents} WHERE stage_run_id=$1 AND is_void=false`,[op.current_stage_run_id]);
        if(!valid.n&&!reason) throw new BadRequestException('当前节点没有有效单据，请填写无单据推进原因');
        if(current==='feedback') {
          const [negative] = await m.query(`SELECT EXISTS(SELECT 1 FROM ${this.t.opportunity_documents} WHERE stage_run_id=$1 AND is_void=false AND extra_data->>'feedback_result' IN ('needs_revision','rejected','需修改','不通过')) AS yes`,[op.current_stage_run_id]);
          if(negative.yes&&!reason) throw new BadRequestException('客户反馈为需修改或不通过，请填写继续推进原因');
        }
        const next=STAGES[index+1], [newRun]=await m.query(`SELECT COALESCE(max(round),0)+1 AS round FROM ${this.t.opportunity_stage_runs} WHERE opportunity_id=$1 AND stage=$2`,[op.id,next]);
        await m.query(`UPDATE ${this.t.opportunity_stage_runs} SET exited_at=now(),result='completed' WHERE id=$1`,[op.current_stage_run_id]);
        const [run]=await m.query(`INSERT INTO ${this.t.opportunity_stage_runs}(opportunity_id,stage,round,previous_run_id) VALUES($1,$2,$3,$4) RETURNING id`,[op.id,next,newRun.round,op.current_stage_run_id]);
        const completed=next==='completed'; await m.query(`UPDATE ${this.t.opportunities} SET current_stage_run_id=$2,status=$3,completed_at=CASE WHEN $4 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1`,[op.id,run.id,completed?'completed':'in_progress',completed]);
        await this.event(m,op.id,completed?'completed':'advanced',actor.sub,reason,op.current_stage_run_id,run.id,requestId,{from_stage:current,to_stage:next});
      } else {
        const target=body.target_stage; const ti=STAGES.indexOf(target); if(ti<0||ti>=index) throw new BadRequestException('只能退回至已到达的前序节点');
        const oldRuns=await m.query(`SELECT id FROM ${this.t.opportunity_stage_runs} WHERE opportunity_id=$1 AND stage=$2 LIMIT 1`,[op.id,target]); if(!oldRuns.length) throw new BadRequestException('只能退回至已到达的前序节点');
        await m.query(`UPDATE ${this.t.opportunity_stage_runs} SET exited_at=now(),result='returned' WHERE id=$1`,[op.current_stage_run_id]);
        const [newRun]=await m.query(`SELECT COALESCE(max(round),0)+1 AS round FROM ${this.t.opportunity_stage_runs} WHERE opportunity_id=$1 AND stage=$2`,[op.id,target]);
        const [run]=await m.query(`INSERT INTO ${this.t.opportunity_stage_runs}(opportunity_id,stage,round,previous_run_id) VALUES($1,$2,$3,$4) RETURNING id`,[op.id,target,newRun.round,op.current_stage_run_id]);
        await m.query(`UPDATE ${this.t.opportunities} SET current_stage_run_id=$2,version=version+1,updated_at=now() WHERE id=$1`,[op.id,run.id]); await this.event(m,op.id,'returned',actor.sub,reason,op.current_stage_run_id,run.id,requestId,{target_stage:target});
      }
      return this.detail(op.id, actor, m);
    });
  }
  advance(id:string,b:any,a:Actor){return this.action(id,b,a,'advance');} returnStage(id:string,b:any,a:Actor){return this.action(id,b,a,'return');} terminate(id:string,b:any,a:Actor){return this.action(id,b,a,'terminate');}
  async transfer(opportunityId:string,body:any,actor:Actor) { const owner=id(body?.owner_id,'owner_id'),reason=text(body?.reason,'原因',2000); return this.ops.db.transaction(async(m)=>{const op=await this.findOp(m,opportunityId,true);await this.editable(op,actor);if(!this.manage(actor))throw new ForbiddenException('仅商机管理员可转交');if(op.status!=='in_progress')throw new ConflictException('已结案商机不能转交');if(!(await m.query(`SELECT id FROM ${this.t.users} WHERE id=$1 AND active=true`,[owner])).length)throw new BadRequestException('新负责人不存在或已停用');await m.query(`UPDATE ${this.t.opportunities} SET owner_id=$2,version=version+1,updated_at=now() WHERE id=$1`,[op.id,owner]);await this.event(m,op.id,'transferred',actor.sub,reason,op.current_stage_run_id,op.current_stage_run_id,null,{from_owner:op.owner_id,to_owner:owner});return this.detail(op.id,actor,m);}); }
  async createDocument(opportunityId:string,body:any,actor:Actor) {
    const name=text(body?.name,'单据名称',200,true),type=text(body?.type,'单据类型',100,true),businessDate=date(body?.business_date,'business_date'),description=text(body?.description,'说明',5000),extra=body?.extra_data??{};
    if(typeof extra!=='object'||Array.isArray(extra))throw new BadRequestException('extra_data 必须为对象'); const attachmentIds=cleanUuidArray(body?.attachment_ids,'attachment_ids'); if(attachmentIds.length>10)throw new BadRequestException('每条单据最多关联 10 个附件');
    return this.ops.db.transaction(async(m)=>{const op=await this.findOp(m,opportunityId,true);await this.editable(op,actor);const runId=body?.stage_run_id?id(body.stage_run_id,'stage_run_id'):op.current_stage_run_id;const runs=await m.query(`SELECT * FROM ${this.t.opportunity_stage_runs} WHERE id=$1 AND opportunity_id=$2`,[runId,op.id]);if(!runs.length)throw new BadRequestException('节点执行记录不属于该商机');const stageIndex=STAGES.indexOf(runs[0].stage), currentIndex=STAGES.indexOf(op.current_stage);if(stageIndex>currentIndex)throw new ConflictException('不能向未来节点录入单据');if(op.status==='terminated'&&!this.manage(actor))throw new ConflictException('已终止商机仅允许管理员补录');if(op.status==='completed'&&stageIndex>currentIndex)throw new ConflictException('不能向未来节点录入单据');if(attachmentIds.length){const a=await m.query(`SELECT id FROM ${this.t.opportunity_attachments} WHERE id=ANY($1::uuid[]) AND opportunity_id=$2 AND document_id IS NULL AND uploaded_by=$3`,[attachmentIds,op.id,actor.sub]);if(a.length!==attachmentIds.length)throw new BadRequestException('附件必须由当前账号为该商机上传且尚未使用');}
      const [doc]=await m.query(`INSERT INTO ${this.t.opportunity_documents}(opportunity_id,stage_run_id,name,type,business_date,description,extra_data,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[op.id,runId,name,type,businessDate,description,JSON.stringify(extra),actor.sub]);if(attachmentIds.length)await m.query(`UPDATE ${this.t.opportunity_attachments} SET document_id=$2 WHERE id=ANY($1::uuid[])`,[attachmentIds,doc.id]);await this.event(m,op.id,'document_added',actor.sub,'',runId,runId,null,{document_id:doc.id,post_close:op.status!=='in_progress'});await m.query(`UPDATE ${this.t.opportunities} SET version=version+1,updated_at=now() WHERE id=$1`,[op.id]);return this.detail(op.id,actor,m);});
  }
  async voidDocument(opportunityId:string,documentId:string,body:any,actor:Actor){const reason=text(body?.reason,'作废原因',2000,true);return this.ops.db.transaction(async(m)=>{const op=await this.findOp(m,opportunityId,true);await this.editable(op,actor);if(op.status!=='in_progress')throw new ConflictException('已完成或终止商机不能作废历史单据');const [d]=await m.query(`SELECT * FROM ${this.t.opportunity_documents} WHERE id=$1 AND opportunity_id=$2 FOR UPDATE`,[id(documentId,'document_id'),op.id]);if(!d)throw new NotFoundException('单据不存在');if(d.is_void)throw new ConflictException('单据已作废');await m.query(`UPDATE ${this.t.opportunity_documents} SET is_void=true,void_reason=$2 WHERE id=$1`,[d.id,reason]);await this.event(m,op.id,'document_voided',actor.sub,reason,d.stage_run_id,d.stage_run_id,null,{document_id:d.id});await m.query(`UPDATE ${this.t.opportunities} SET version=version+1,updated_at=now() WHERE id=$1`,[op.id]);return this.detail(op.id,actor,m);});}

  private privateDir(){const p=resolve(process.env.OPPORTUNITY_FILES_DIR||join(process.cwd(),'data','opportunities-private'));const publicDir=resolve(process.env.MEDIA_DIR||join(process.cwd(),'data','media'));const rel=relative(publicDir,p);if(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw new Error('商机附件目录不能位于公开媒体目录内');return p;}
  private async cleanupExpiredUploads(){const expired:Row[]=await this.ops.db.query(`WITH deleted AS (DELETE FROM ${this.t.opportunity_attachments} WHERE document_id IS NULL AND created_at<now()-interval '7 days' RETURNING storage_key) SELECT storage_key FROM deleted`);const root=this.privateDir();await Promise.all(expired.map((row)=>{const path=resolve(root,row.storage_key),rel=relative(root,path);if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))return Promise.resolve();return unlink(path).catch(()=>{});}));}
  async saveAttachment(opportunityId:string,file:any,actor:Actor){if(!file?.buffer?.length)throw new BadRequestException('请上传文件');if(file.size>20*1024*1024)throw new BadRequestException('单文件不能超过 20 MB');const op=await this.findOp(this.ops.db.manager,opportunityId);await this.editable(op,actor);if(op.status==='terminated'&&!this.manage(actor))throw new ConflictException('已终止商机仅允许管理员补录附件');
    await this.cleanupExpiredUploads();
    const filename=basename(String(file.originalname||'upload').replace(/[\\/\0]/g,''));const ext=extname(filename).toLowerCase();const allowed:Record<string,{mime:string;valid:(b:Buffer)=>boolean}>={'.pdf':{mime:'application/pdf',valid:b=>b.subarray(0,5).toString()==='%PDF-'},'.png':{mime:'image/png',valid:b=>b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},'.jpg':{mime:'image/jpeg',valid:b=>b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217},'.jpeg':{mime:'image/jpeg',valid:b=>b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217},'.docx':{mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',valid:b=>validOfficeZip(b,'docx')},'.xlsx':{mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',valid:b=>validOfficeZip(b,'xlsx')}};
    if(!allowed[ext]||!allowed[ext].valid(file.buffer))throw new BadRequestException('仅支持内容有效的 PDF、PNG、JPEG、DOCX、XLSX 附件');const mime=allowed[ext].mime;
    const storageKey=randomUUID(),dir=this.privateDir(),target=join(dir,storageKey);await mkdir(dir,{recursive:true});await writeFile(target,file.buffer,{flag:'wx'});const sha256=createHash('sha256').update(file.buffer).digest('hex');
    try{const [att]=await this.ops.db.query(`INSERT INTO ${this.t.opportunity_attachments}(opportunity_id,storage_key,file_name,mime_type,size,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,file_name,mime_type,size,sha256`,[op.id,storageKey,filename,mime,file.size,sha256,actor.sub]);return att;}catch(e){await unlink(target).catch(()=>{});throw e;}
  }
  async attachment(opportunityId:string,attachmentId:string,actor:Actor){this.assertView(actor);const op=await this.findOp(this.ops.db.manager,opportunityId);const rows=await this.ops.db.query(`SELECT * FROM ${this.t.opportunity_attachments} WHERE id=$1 AND opportunity_id=$2`,[id(attachmentId,'attachment_id'),op.id]);if(!rows.length)throw new NotFoundException('附件不存在');const a=rows[0];if(!a.document_id&&a.uploaded_by!==actor.sub&&!this.manage(actor))throw new NotFoundException('附件不存在');const root=this.privateDir(),path=resolve(root,a.storage_key),rel=relative(root,path);if(rel===''||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new NotFoundException('附件不存在');return {path,attachment:a};}
}
