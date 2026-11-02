import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { compare, hash } from 'bcryptjs';
import Decimal from 'decimal.js';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { AuditLog, Brand, BomComponent, Customer, PriceRule, PriceTier, Product, ProductBasePrice, ProductVariant, Quote, QuoteItem, QuoteTier, Role, User } from './entities';
import { calculateQuantity, TierInput, validateTiers } from './pricing';

type Actor = { id: string; username: string; displayName: string; roles: string[]; permissions: string[] };
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v);
const isDateOnly = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

@Injectable()
export class ApiService {
  constructor(private db: DataSource, private jwt: JwtService) {}
  private repo<T extends object>(entity: new (...args: any[]) => T) { return this.db.getRepository(entity); }
  private async audit(actor: Actor | null, action: string, entityType: string, entityId: string | null, detail: Record<string, unknown> = {}) {
    await this.repo(AuditLog).save(this.repo(AuditLog).create({ userId: actor?.id || null, action, entityType, entityId, detail }));
  }
  async health() { await this.db.query('SELECT 1'); return { status: 'ok', database: 'connected', app: 'plm-inno' }; }
  async login(username: string, password: string) {
    const user = await this.repo(User).findOne({ where: { username, active: true }, relations: { roles: true } });
    if (!user || !(await compare(password, user.passwordHash))) throw new UnauthorizedException('用户名或密码错误');
    const roles = user.roles.map((r) => r.name);
    const permissions = [...new Set(user.roles.flatMap((r) => r.permissions || []))];
    const payload = { sub: user.id, username: user.username, displayName: user.displayName, roles, permissions };
    return { accessToken: await this.jwt.signAsync(payload), user: { id: user.id, username: user.username, displayName: user.displayName, roles, permissions } };
  }
  async listProducts() {
    const products = await this.repo(Product).find({ order: { name: 'ASC' } });
    const variants = await this.repo(ProductVariant).find({ order: { specification: 'ASC' } });
    const bom = await this.repo(BomComponent).find();
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantView = variants.map((v) => ({ ...v, product: productById.get(v.productId) }));
    return products.map((p) => ({ ...p, variants: variantView.filter((v) => v.productId === p.id), components: bom.filter((b) => variantView.find((v) => v.id === b.parentVariantId)?.productId === p.id) }));
  }
  async listProductsPage(query: Record<string, string>) {
    const page = Number(query.page || 1), size = Number(query.size || 10);
    if (!Number.isSafeInteger(page) || page < 1 || ![10, 20, 50].includes(size)) throw new BadRequestException('分页参数无效');
    const search = String(query.q || '').trim().slice(0, 100);
    const qb = this.repo(Product).createQueryBuilder('p');
    if (search) {
      const escaped = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      const kind = ({ '标品': 'product', '配件': 'accessory', '组合商品': 'bundle' } as Record<string, string>)[search] || '';
      const variantSearch = qb.subQuery().select('1').from(ProductVariant, 'v').where('v.product_id = p.id').andWhere("(v.specification ILIKE :search ESCAPE '\\' OR v.unit ILIKE :search ESCAPE '\\')").getQuery();
      qb.where(`(p.sku ILIKE :search ESCAPE '\\' OR p.name ILIKE :search ESCAPE '\\' OR p.description ILIKE :search ESCAPE '\\' OR p.kind = :kind OR EXISTS ${variantSearch})`, { search: escaped, kind });
    }
    const [items, total] = await qb.orderBy('p.name', 'ASC').addOrderBy('p.id', 'ASC').skip((page - 1) * size).take(size).getManyAndCount();
    const activeCount = await this.repo(Product).countBy({ active: true });
    if (!items.length) return { items: [], total, activeCount };
    const variants = await this.repo(ProductVariant).find({ where: { productId: In(items.map((p) => p.id)) }, order: { specification: 'ASC' } });
    const variantIds = variants.map((v) => v.id);
    const components = variantIds.length ? await this.repo(BomComponent).findBy({ parentVariantId: In(variantIds) }) : [];
    const childIds = [...new Set(components.map((c) => c.componentVariantId))];
    const children = childIds.length ? await this.repo(ProductVariant).findBy({ id: In(childIds) }) : [];
    const childProducts = children.length ? await this.repo(Product).findBy({ id: In(children.map((v) => v.productId)) }) : [];
    return { items: items.map((p) => ({ ...p, variants: variants.filter((v) => v.productId === p.id), components: components.filter((c) => variants.some((v) => v.productId === p.id && v.id === c.parentVariantId)).map((c) => { const child = children.find((v) => v.id === c.componentVariantId); const product = childProducts.find((x) => x.id === child?.productId); return { ...c, componentSku: product?.sku, componentName: product?.name }; }) })), total, activeCount };
  }
  async searchProductOptions(query: Record<string, string>) {
    const limit = 20;
    const page = Number(query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BadRequestException('页码无效');
    if (query.id && !isUuid(query.id)) throw new BadRequestException('商品编号无效');
    if (query.excludeId && !isUuid(query.excludeId)) throw new BadRequestException('排除商品编号无效');
    const search = String(query.q || '').trim().slice(0, 100);
    const qb = this.repo(ProductVariant).createQueryBuilder('v')
      .innerJoin(Product, 'p', 'p.id = v.product_id')
      .select('v.id', 'id').addSelect('p.sku', 'sku').addSelect('p.name', 'name').addSelect('p.kind', 'kind')
      .orderBy('p.sku', 'ASC').addOrderBy('v.id', 'ASC');
    if (query.id) qb.where('v.id = :id', { id: query.id });
    else {
      qb.where('v.active = :active AND p.active = :active', { active: true });
      if (search) qb.andWhere("(p.sku ILIKE :search ESCAPE '\\' OR p.name ILIKE :search ESCAPE '\\')", { search: `%${search.replace(/[\\%_]/g, '\\$&')}%` });
      if (query.excludeBundles === 'true') qb.andWhere('p.kind <> :kind', { kind: 'bundle' });
      if (query.excludeId) qb.andWhere('v.id <> :excludeId', { excludeId: query.excludeId });
    }
    const rows = await qb.offset(query.id ? 0 : (page - 1) * limit).limit(limit + 1).getRawMany();
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  async createProduct(body: any, actor: Actor) {
    if (typeof body.sku !== 'string' || !body.sku.trim() || typeof body.name !== 'string' || !body.name.trim() || !['product', 'accessory', 'bundle'].includes(body.kind)) throw new BadRequestException('货号、品名和商品类型必填');
    if (!Array.isArray(body.variants) || body.variants.length !== 1) throw new BadRequestException('商品须填写一个规格');
    return this.db.transaction(async (m) => {
      const product = await m.getRepository(Product).save(m.getRepository(Product).create({ sku: body.sku.trim(), name: body.name.trim(), kind: body.kind, description: body.description || '' }));
      const variants = await m.getRepository(ProductVariant).save(body.variants.map((v: any) => {
        if (!v.specification?.trim() || !v.unit?.trim()) throw new BadRequestException('规格描述和单位必填');
        return m.getRepository(ProductVariant).create({ productId: product.id, specification: v.specification.trim(), unit: v.unit.trim() });
      }));
      if (body.imagePath) { product.imagePath = body.imagePath; await m.getRepository(Product).save(product); }
      for (const variant of variants) await m.getRepository(ProductBasePrice).save(m.getRepository(ProductBasePrice).create({ variantId: variant.id, purchasePrice: null, financeCost: null }));
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'create', entityType: 'product', entityId: product.id, detail: { sku: product.sku } }));
      return { ...product, variants };
    });
  }
  async updateProduct(id: string, body: any, actor: Actor) {
    return this.db.transaction(async (m) => {
      const productRepo = m.getRepository(Product);
      const variantRepo = m.getRepository(ProductVariant);
      const product = await productRepo.findOneBy({ id });
      if (!product) throw new NotFoundException('未找到商品');
      if (body.sku !== undefined) {
        if (typeof body.sku !== 'string' || !body.sku.trim()) throw new BadRequestException('货号必填');
        product.sku = body.sku.trim();
      }
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('品名必填');
        product.name = body.name.trim();
      }
      if (body.description !== undefined) product.description = body.description;
      if (body.imagePath !== undefined) product.imagePath = body.imagePath;
      if (body.active !== undefined) product.active = Boolean(body.active);
      if (body.variants !== undefined) {
        if (!Array.isArray(body.variants) || body.variants.length !== 1) throw new BadRequestException('商品须填写一个规格');
        const existing = await variantRepo.findBy({ productId: product.id });
        const suppliedIds = body.variants.filter((v: any) => v.id).map((v: any) => v.id);
        if (suppliedIds.some((variantId: string) => !existing.some((v) => v.id === variantId))) throw new BadRequestException('规格中含有不属于该商品的记录');
        for (const v of body.variants.filter((v: any) => v.id)) {
          if (!String(v.specification || '').trim() || !String(v.unit || '').trim()) throw new BadRequestException('规格和单位必填');
          const existingVariant = existing.find((x) => x.id === v.id)!;
          existingVariant.specification = String(v.specification).trim(); existingVariant.unit = String(v.unit).trim();
          await variantRepo.save(existingVariant);
        }
        const additions = body.variants.filter((v: any) => !v.id);
        if (additions.length && existing.length) throw new BadRequestException('商品只能有一个规格');
        const specs = [...existing.map((v) => v.specification), ...additions.map((v: any) => String(v.specification || '').trim())];
        if (additions.some((v: any) => !String(v.specification || '').trim() || !String(v.unit || '').trim()) || new Set(specs).size !== specs.length) throw new BadRequestException('新增规格的描述和单位必填，且不能与已有规格重复');
        const newVariants = await variantRepo.save(additions.map((v: any) => variantRepo.create({ productId: product.id, specification: String(v.specification).trim(), unit: String(v.unit).trim() })));
        if (newVariants.length) await m.getRepository(ProductBasePrice).save(newVariants.map((v) => m.getRepository(ProductBasePrice).create({ variantId: v.id, purchasePrice: null, financeCost: null })));
      }
      await productRepo.save(product);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'update', entityType: 'product', entityId: product.id, detail: body }));
      return product;
    });
  }
  async deleteProduct(id: string, actor: Actor) {
    return this.db.transaction(async (m) => {
      const products = m.getRepository(Product);
      const product = await products.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!product) throw new NotFoundException('未找到商品');
      const variants = await m.getRepository(ProductVariant).findBy({ productId: id });
      const ids = variants.map((v) => v.id);
      if (ids.length) {
        const rules = await m.getRepository(PriceRule).countBy({ variantId: In(ids) });
        const quotes = await m.getRepository(QuoteItem).countBy({ variantId: In(ids) });
        const parents = await m.getRepository(BomComponent).countBy({ parentVariantId: In(ids) });
        const components = await m.getRepository(BomComponent).countBy({ componentVariantId: In(ids) });
        if (rules || quotes || parents || components) throw new ConflictException('商品已关联报价、价格规则或组合关系，不能删除；可将其设为失效');
        await m.getRepository(ProductBasePrice).delete({ variantId: In(ids) });
        await m.getRepository(ProductVariant).delete({ id: In(ids) });
      }
      await products.delete(id);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'delete-product', entityType: 'product', entityId: id, detail: { sku: product.sku, name: product.name } }));
      return { success: true };
    });
  }
  async listCustomers() { return this.repo(Customer).find({ order: { name: 'ASC' } }); }
  async createCustomer(body: any, actor: Actor) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('客户名称必填');
    if (await this.repo(Customer).findOneBy({ name: body.name.trim() })) throw new ConflictException('客户名称已存在');
    const customer = await this.repo(Customer).save(this.repo(Customer).create({ name: body.name.trim(), contact: body.contact || '', phone: body.phone || '', notes: body.notes || '' }));
    await this.audit(actor, 'create', 'customer', customer.id, { name: customer.name });
    return customer;
  }
  async updateCustomer(id: string, body: any, actor: Actor) {
    const customer = await this.repo(Customer).findOneBy({ id });
    if (!customer) throw new NotFoundException('客户不存在');
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('客户名称必填');
      const duplicate = await this.repo(Customer).findOneBy({ name: body.name.trim() });
      if (duplicate && duplicate.id !== id) throw new ConflictException('客户名称已存在');
      customer.name = body.name.trim();
    }
    if (body.contact !== undefined) customer.contact = String(body.contact);
    if (body.phone !== undefined) customer.phone = String(body.phone);
    if (body.notes !== undefined) customer.notes = String(body.notes);
    if (body.active !== undefined) customer.active = Boolean(body.active);
    await this.repo(Customer).save(customer);
    await this.audit(actor, 'update', 'customer', id, body);
    return customer;
  }
  async listBrands() { return this.repo(Brand).find({ order: { kind: 'ASC', name: 'ASC' } }); }
  async createBrand(body: any, actor: Actor) {
    if (typeof body.name !== 'string' || !body.name.trim() || !['own', 'customer'].includes(body.kind)) throw new BadRequestException('品牌名称和类型必填');
    if (body.kind === 'customer' && !body.customerId) throw new BadRequestException('客户品牌必须关联客户');
    const duplicate = await this.repo(Brand).findOne({ where: { name: body.name.trim(), kind: body.kind, customerId: body.kind === 'customer' ? body.customerId : IsNull() } });
    if (duplicate) throw new ConflictException('该品牌已存在');
    const brand = await this.repo(Brand).save(this.repo(Brand).create({ name: body.name.trim(), kind: body.kind, customerId: body.kind === 'customer' ? body.customerId : null }));
    await this.audit(actor, 'create', 'brand', brand.id, { name: brand.name, kind: brand.kind });
    return brand;
  }
  async updateBrand(id: string, body: any, actor: Actor) {
    const brand = await this.repo(Brand).findOneBy({ id });
    if (!brand) throw new NotFoundException('品牌不存在');
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) throw new BadRequestException('品牌名称必填');
      const duplicate = await this.repo(Brand).findOne({ where: { name: body.name.trim(), kind: brand.kind, customerId: brand.customerId || IsNull() } });
      if (duplicate && duplicate.id !== id) throw new ConflictException('该品牌已存在');
      brand.name = body.name.trim();
    }
    if (body.active !== undefined) brand.active = Boolean(body.active);
    await this.repo(Brand).save(brand);
    await this.audit(actor, 'update', 'brand', id, body);
    return brand;
  }
  async updateBasePrice(variantId: string, body: any, actor: Actor) {
    const variant = await this.repo(ProductVariant).findOneBy({ id: variantId });
    if (!variant) throw new NotFoundException('未找到商品规格');
    const validMoney = (v: any) => v === null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0);
    if (body.purchasePrice !== undefined && !validMoney(body.purchasePrice)) throw new BadRequestException('采购基准价须为大于或等于零的金额');
    if (actor.permissions.includes('*') || actor.permissions.includes('cost:view')) {
      if (body.financeCost !== undefined && !validMoney(body.financeCost)) throw new BadRequestException('财务成本须为大于或等于零的金额');
    }
    if (body.standardRetailPrice !== undefined && !validMoney(body.standardRetailPrice)) throw new BadRequestException('标准市场零售价须为大于或等于零的金额');
    const repository = this.repo(ProductBasePrice);
    const row = await repository.findOneBy({ variantId }) || repository.create({ variantId });
    const oldPrice = row.purchasePrice;
    if (body.purchasePrice !== undefined) row.purchasePrice = body.purchasePrice === '' ? null : body.purchasePrice;
    if ((actor.permissions.includes('*') || actor.permissions.includes('cost:view')) && body.financeCost !== undefined) row.financeCost = body.financeCost === '' ? null : body.financeCost;
    if (body.standardRetailPrice !== undefined) row.standardRetailPrice = body.standardRetailPrice === '' ? null : body.standardRetailPrice;
    row.updatedBy = actor.id;
    await repository.save(row);
    await this.audit(actor, 'update-base-price', 'product-variant', variantId, { oldPrice, purchasePrice: row.purchasePrice, financeCost: row.financeCost });
    return row;
  }
  async listRules() {
    const [rules, tiers] = await Promise.all([this.repo(PriceRule).find({ where: { active: true }, order: { updatedAt: 'DESC' } }), this.repo(PriceTier).find({ order: { minQuantity: 'ASC' } })]);
    const ids = [...new Set(rules.map((r) => r.variantId))];
    const variants = ids.length ? await this.repo(ProductVariant).findBy({ id: In(ids) }) : [];
    const products = variants.length ? await this.repo(Product).findBy({ id: In([...new Set(variants.map((v) => v.productId))]) }) : [];
    return rules.map((rule) => { const variant = variants.find((v) => v.id === rule.variantId); const product = products.find((p) => p.id === variant?.productId); return { ...rule, product: product ? { sku: product.sku, name: product.name } : null, variant: variant ? { specification: variant.specification, unit: variant.unit } : null, tiers: tiers.filter((t) => t.ruleId === rule.id) }; });
  }
  async saveRule(body: any, actor: Actor, id?: string) {
    if (!['own', 'private'].includes(body.quoteType) || !body.variantId || !body.brandId || !['whole', 'segmented'].includes(body.quantityMode)) throw new BadRequestException('价格类型、商品规格、品牌及计价方式必填');
    if (body.quoteType === 'private' && !body.customerId) throw new BadRequestException('贴牌价格必须关联客户');
    const tiers = validateTiers(body.tiers || []);
    const variant = await this.repo(ProductVariant).findOneBy({ id: body.variantId });
    const brand = await this.repo(Brand).findOneBy({ id: body.brandId });
    if (!variant || !brand) throw new NotFoundException('商品规格或品牌不存在');
    if (!variant.active || !(await this.repo(Product).findOneBy({ id: variant.productId, active: true }))) throw new BadRequestException('失效商品不能维护价格规则');
    if ((body.quoteType === 'own' && brand.kind !== 'own') || (body.quoteType === 'private' && (brand.kind !== 'customer' || brand.customerId !== body.customerId))) throw new BadRequestException('报价类型、客户与品牌不匹配');
    return this.db.transaction(async (m) => {
      const repository = m.getRepository(PriceRule);
      let rule: PriceRule;
      if (id) {
        const existing = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!existing || !existing.active) throw new NotFoundException('未找到有效价格规则');
        rule = existing;
        rule.quoteType = body.quoteType; rule.variantId = body.variantId; rule.brandId = body.brandId; rule.customerId = body.customerId || null; rule.quantityMode = body.quantityMode; rule.version += 1;
      } else {
        const existing = await repository.findOne({ where: { quoteType: body.quoteType, variantId: body.variantId, brandId: body.brandId, customerId: body.customerId ? body.customerId : IsNull(), active: true } });
        if (existing) throw new ConflictException('该商品、客户和品牌已有有效价格规则，请编辑现有规则');
        rule = repository.create({ quoteType: body.quoteType, variantId: body.variantId, brandId: body.brandId, customerId: body.customerId || null, quantityMode: body.quantityMode, active: true, version: 1, createdBy: actor.id });
      }
      const collision = await repository.findOne({ where: { quoteType: body.quoteType, variantId: body.variantId, brandId: body.brandId, customerId: body.customerId ? body.customerId : IsNull(), active: true } });
      if (collision && collision.id !== rule.id) throw new ConflictException('该商品、客户和品牌已有有效价格规则');
      rule = await repository.save(rule);
      await m.getRepository(PriceTier).delete({ ruleId: rule.id });
      await m.getRepository(PriceTier).save(tiers.map((t) => m.getRepository(PriceTier).create({ ruleId: rule!.id, minQuantity: t.minQuantity, maxQuantityExclusive: t.maxQuantityExclusive, method: t.method, value: String(t.value) })));
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: id ? 'update-rule' : 'create-rule', entityType: 'price-rule', entityId: rule.id, detail: { version: rule.version } }));
      return { ...rule, tiers };
    });
  }
  async deleteRule(id: string, actor: Actor) {
    await this.db.transaction(async (m) => {
      const repository = m.getRepository(PriceRule);
      const rule = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!rule || !rule.active) throw new NotFoundException('未找到有效价格规则');
      rule.active = false;
      await repository.save(rule);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'delete-price-rule', entityType: 'price-rule', entityId: id, detail: { variantId: rule.variantId, brandId: rule.brandId, customerId: rule.customerId, version: rule.version } }));
    });
    return { success: true };
  }
  private async findRule(m: EntityManager, quoteType: 'own' | 'private', variantId: string, brandId: string, customerId: string) {
    return m.getRepository(PriceRule).findOne({ where: { quoteType, variantId, brandId, customerId: quoteType === 'private' ? customerId : IsNull(), active: true } });
  }
  private async tiersFor(m: EntityManager, ruleId: string): Promise<TierInput[]> { return (await m.getRepository(PriceTier).find({ where: { ruleId }, order: { minQuantity: 'ASC' } })).map((t) => ({ minQuantity: t.minQuantity, maxQuantityExclusive: t.maxQuantityExclusive, method: t.method, value: t.value })); }
  private async bundlePrice(m: EntityManager, variantId: string, qty: number, quoteType: 'own' | 'private', brandId: string, customerId: string, visited = new Set<string>()) {
    if (visited.has(variantId)) throw new BadRequestException('组合商品存在循环组成关系');
    visited.add(variantId);
    const components = await m.getRepository(BomComponent).findBy({ parentVariantId: variantId });
    if (!components.length) throw new BadRequestException('组合商品没有组成明细，也没有可用独立价格规则');
    let total = new Decimal(0);
    const details: any[] = [];
    for (const component of components) {
      const componentQty = new Decimal(qty).mul(component.quantity);
      if (!componentQty.isInteger() || componentQty.lte(0)) throw new BadRequestException('组合数量乘配件用量后必须为正整数');
      const n = componentQty.toNumber();
      const v = await m.getRepository(ProductVariant).findOneBy({ id: component.componentVariantId, active: true });
      if (!v) throw new BadRequestException('组合商品包含已停用或无效的组成规格');
      const product = await m.getRepository(Product).findOneBy({ id: v.productId, active: true });
      if (!product) throw new BadRequestException('组合商品包含已停用或无效的组成商品');
      if (product.kind === 'bundle') throw new BadRequestException('首期不支持组合商品嵌套');
      const rule = await this.findRule(m, quoteType, v.id, brandId, customerId);
      if (!rule) throw new BadRequestException(`组成商品 ${product.sku} 缺少对应报价规则`);
      const base = await m.getRepository(ProductBasePrice).findOneBy({ variantId: v.id });
      const line = calculateQuantity(n, await this.tiersFor(m, rule.id), rule.quantityMode, base?.purchasePrice);
      total = total.plus(line.totalAmount);
      details.push({ sku: product.sku, specification: v.specification, variantId: v.id, quantity: n, totalAmount: line.totalAmount, ruleId: rule.id, ruleVersion: rule.version, baseUpdatedAt: base?.updatedAt?.toISOString() || null, baseDependent: (await this.tiersFor(m, rule.id)).some((t) => t.method !== 'fixed'), calculation: line });
    }
    visited.delete(variantId);
    const amount = total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const unit = amount.div(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return { quantity: qty, unitPrice: unit.toFixed(2), totalAmount: amount.toFixed(2), calculation: { source: 'components', components: details } };
  }
  async listBasePrices(actor: Actor) {
    const canViewBase = actor.permissions.includes('*') || actor.permissions.includes('cost:view') || actor.permissions.includes('price:manage');
    if (!canViewBase) throw new ForbiddenException('当前账号没有查看价格的权限');
    const rows = await this.repo(ProductBasePrice).find();
    return rows.map((row) => ({ variantId: row.variantId, purchasePrice: row.purchasePrice, standardRetailPrice: row.standardRetailPrice, ...(actor.permissions.includes('*') || actor.permissions.includes('cost:view') ? { financeCost: row.financeCost } : {}) }));
  }
  async createQuote(body: any, actor: Actor) {
    if (!['own', 'private'].includes(body.quoteType) || !body.customerId || !body.brandId || !Array.isArray(body.items) || !body.items.length) throw new BadRequestException('报价类型、客户、品牌及至少一个商品必填');
    if (!body.expiresAt) throw new BadRequestException('请填写报价有效期');
    const customer = await this.repo(Customer).findOneBy({ id: body.customerId, active: true });
    const brand = await this.repo(Brand).findOneBy({ id: body.brandId, active: true });
    if (!customer || !brand) throw new NotFoundException('客户或品牌不存在/已停用');
    if (body.quoteType === 'own' && brand.kind !== 'own') throw new BadRequestException('自有品牌报价请选择自有品牌');
    if (body.quoteType === 'private' && (brand.kind !== 'customer' || brand.customerId !== customer.id)) throw new BadRequestException('贴牌品牌必须属于所选客户');
    const today = new Date().toISOString().slice(0, 10);
    const quoteDate = body.quoteDate || today;
    if (!isDateOnly(quoteDate) || !isDateOnly(body.expiresAt)) throw new BadRequestException('报价日期和有效期必须是有效日期');
    if (body.expiresAt < quoteDate) throw new BadRequestException('报价有效期不能早于报价日期');
    if (new Set(body.items.map((item: any) => item.variantId)).size !== body.items.length) throw new BadRequestException('同一报价单中请合并同一商品规格的数量档');
    const quoteId = await this.db.transaction(async (m) => {
      const quoteRepo = m.getRepository(Quote);
      const quote = await quoteRepo.save(quoteRepo.create({ quoteNumber: `Q${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`, quoteType: body.quoteType, customerId: customer.id, brandId: brand.id, quoteDate, expiresAt: body.expiresAt, terms: body.terms || '', customerSnapshot: { name: customer.name, contact: customer.contact, phone: customer.phone }, brandSnapshot: { name: brand.name, kind: brand.kind }, createdBy: actor.id, status: 'draft', version: 1 }));
      const itemRepo = m.getRepository(QuoteItem);
      const tierRepo = m.getRepository(QuoteTier);
      for (const requested of body.items) {
        const variant = await m.getRepository(ProductVariant).findOneBy({ id: requested.variantId, active: true });
        if (!variant) throw new NotFoundException('所选商品规格不存在或已停用');
        const product = await m.getRepository(Product).findOneBy({ id: variant.productId, active: true });
        if (!product) throw new NotFoundException('所选商品不存在或已停用');
        const quantities: number[] = (requested.quantities || []).map(Number);
        if (!quantities.length || quantities.some((n, index) => !Number.isInteger(n) || n < 1 || (index > 0 && n <= quantities[index - 1]))) throw new BadRequestException(`${product.name} 的报价数量必须是按从小到大排列且不重复的正整数`);
        if (requested.suggestedFirstQuantity !== undefined && requested.suggestedFirstQuantity !== null && requested.suggestedFirstQuantity !== '' && (!Number.isInteger(Number(requested.suggestedFirstQuantity)) || Number(requested.suggestedFirstQuantity) < 1)) throw new BadRequestException(`${product.name} 的建议首批量必须是正整数`);
        const manual = requested.manualPrices || [];
        if (!Array.isArray(manual)) throw new BadRequestException(`${product.name} 的人工报价格式不正确`);
        if (manual.length && (manual.length !== quantities.length || new Set(manual.map((x: any) => Number(x.quantity))).size !== quantities.length || quantities.some((q) => !manual.some((x: any) => Number(x.quantity) === q)))) throw new BadRequestException(`${product.name} 的人工报价必须覆盖所有数量档，且每档只能填写一次`);
        if (manual.some((x: any) => x.unitPrice === undefined || x.unitPrice === null || String(x.unitPrice).trim() === '')) throw new BadRequestException(`${product.name} 的人工报价不能为空`);
        if (manual.length && requested.ruleDraft) throw new BadRequestException(`${product.name} 不能同时保存常用价格规则和使用本次人工报价`);
        let rule = await m.getRepository(PriceRule).findOne({ where: { quoteType: body.quoteType, variantId: variant.id, brandId: brand.id, customerId: body.quoteType === 'private' ? customer.id : IsNull(), active: true } });
        if (!rule && requested.ruleDraft) {
          if (!actor.permissions.includes('*') && !actor.permissions.includes('price:manage')) throw new ForbiddenException('没有维护常用价格规则的权限，可选择仅用于本次的固定价格');
          const draft = requested.ruleDraft;
          if (!['whole', 'segmented'].includes(draft.quantityMode)) throw new BadRequestException('请选择整批或分段计价');
          const draftTiers = validateTiers(draft.tiers || []);
          const duplicate = await m.getRepository(PriceRule).findOne({ where: { quoteType: body.quoteType, variantId: variant.id, brandId: brand.id, customerId: body.quoteType === 'private' ? customer.id : IsNull(), active: true } });
          if (duplicate) throw new ConflictException('此商品的常用价格已被其他人建立，请刷新后重新报价');
          const createdRule = m.getRepository(PriceRule).create({ quoteType: body.quoteType, variantId: variant.id, brandId: brand.id, customerId: body.quoteType === 'private' ? customer.id : null, quantityMode: draft.quantityMode, active: true, version: 1, createdBy: actor.id });
          rule = await m.getRepository(PriceRule).save(createdRule);
          await m.getRepository(PriceTier).save(draftTiers.map((t) => m.getRepository(PriceTier).create({ ruleId: rule!.id, minQuantity: t.minQuantity, maxQuantityExclusive: t.maxQuantityExclusive, method: t.method, value: String(t.value) })));
        }
        const base = await m.getRepository(ProductBasePrice).findOneBy({ variantId: variant.id });
        let marketRetailPrice: string | null = null;
        if (requested.retailPriceMode === 'manual') {
          if (requested.manualRetailPrice === undefined || requested.manualRetailPrice === null || String(requested.manualRetailPrice).trim() === '') throw new BadRequestException(`${product.name} 请填写建议零售价`);
          let manualRetail: Decimal;
          try { manualRetail = new Decimal(String(requested.manualRetailPrice)); } catch { throw new BadRequestException(`${product.name} 的建议零售价必须是有效金额`); }
          if (!manualRetail.isFinite() || manualRetail.isNegative()) throw new BadRequestException(`${product.name} 的建议零售价必须是非负金额`);
          marketRetailPrice = manualRetail.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
        } else if (['50', '80', '100', '180'].includes(String(requested.retailPriceMode))) {
          if (base?.purchasePrice == null) throw new BadRequestException(`${product.name} 缺少采购基准价，请手工填写建议零售价`);
          marketRetailPrice = new Decimal(base.purchasePrice).mul(new Decimal(1).plus(new Decimal(String(requested.retailPriceMode)).div(100))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
        }
        const pricingRule = manual.length ? null : rule;
        const tierInputs = pricingRule ? await m.getRepository(PriceTier).find({ where: { ruleId: pricingRule.id }, order: { minQuantity: 'ASC' } }) : [];
        if (pricingRule && !tierInputs.length) throw new BadRequestException(`${product.name} 的价格规则没有数量档`);
        const offers: any[] = [];
        for (const quantity of quantities) {
          const manualPrice = manual.find((x: any) => Number(x.quantity) === quantity)?.unitPrice;
          let calculated: any;
          if (manualPrice !== undefined && manualPrice !== null && manualPrice !== '') {
            let price: Decimal;
            try { price = new Decimal(String(manualPrice)); } catch { throw new BadRequestException(`${product.name} 的人工报价必须是有效金额`); }
            if (!price.isFinite() || price.isNegative()) throw new BadRequestException('手工报价必须是大于或等于零的金额');
            const unit = price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
            calculated = { quantity, unitPrice: unit.toFixed(2), totalAmount: unit.mul(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), segments: [{ quantity, unitPrice: unit.toFixed(2), amount: unit.mul(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2), source: 'manual' }] };
          } else if (pricingRule) {
            calculated = calculateQuantity(quantity, tierInputs, pricingRule.quantityMode, base?.purchasePrice);
          } else if (product.kind === 'bundle') {
            calculated = await this.bundlePrice(m, variant.id, quantity, body.quoteType, brand.id, customer.id);
          } else {
            throw new BadRequestException(`${product.name} 缺少价格规则，请先设置规则或为该数量填写本次固定报价`);
          }
          offers.push({ ...calculated, calculation: calculated.calculation || { source: manualPrice !== undefined ? 'manual' : 'rule', mode: pricingRule?.quantityMode || 'manual', segments: calculated.segments } });
        }
        const bundleRefs = offers.flatMap((offer: any) => offer.calculation?.components || []);
        const bomSnapshot = product.kind === 'bundle' && bundleRefs.length ? (await m.getRepository(BomComponent).findBy({ parentVariantId: variant.id })).map((c) => ({ componentVariantId: c.componentVariantId, quantity: c.quantity })).sort((a, b) => a.componentVariantId.localeCompare(b.componentVariantId)) : null;
        const baseDependent = tierInputs.some((t) => t.method !== 'fixed') || ['50', '80', '100', '180'].includes(String(requested.retailPriceMode));
        const item = await itemRepo.save(itemRepo.create({ quoteId: quote.id, variantId: variant.id, kind: product.kind, productSnapshot: { sku: product.sku, name: product.name, specification: variant.specification, unit: variant.unit, description: product.description }, ruleId: pricingRule?.id || null, ruleVersion: pricingRule?.version || null, basePriceSnapshot: baseDependent ? base?.purchasePrice || null : null, marketRetailPrice, suggestedFirstQuantity: requested.suggestedFirstQuantity === '' || requested.suggestedFirstQuantity == null ? null : Number(requested.suggestedFirstQuantity), calculationSnapshot: { manualOverride: manual.length > 0, basePriceMissing: !base?.purchasePrice, ruleMissing: !pricingRule, baseDependent, retailPriceMode: requested.retailPriceMode || null, componentRefs: bundleRefs.map((c: any) => ({ variantId: c.variantId, ruleId: c.ruleId, ruleVersion: c.ruleVersion, baseUpdatedAt: c.baseUpdatedAt, baseDependent: c.baseDependent })), bomSnapshot }, confirmedAt: null, confirmedBy: null }));
        await tierRepo.save(offers.map((o: any) => tierRepo.create({ quoteItemId: item.id, quantity: o.quantity, unitPrice: o.unitPrice, totalAmount: o.totalAmount, calculation: o.calculation })));
      }
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'create-quote', entityType: 'quote', entityId: quote.id, detail: { quoteNumber: quote.quoteNumber } }));
      return quote.id;
    });
    return this.getQuote(quoteId);
  }
  async getQuote(id: string) {
    const quote = await this.repo(Quote).findOneBy({ id });
    if (!quote) throw new NotFoundException('未找到报价单');
    const items = await this.repo(QuoteItem).find({ where: { quoteId: id } });
    const tiers = items.length ? await this.repo(QuoteTier).find({ where: { quoteItemId: In(items.map((x) => x.id)) } }) : [];
    return this.presentQuote(quote, items, tiers);
  }
  private presentQuote(quote: Quote, items: QuoteItem[], tiers: QuoteTier[]) {
    return { ...quote, items: items.map((item) => {
      const { basePriceSnapshot: _internalCost, ruleId: _ruleId, ruleVersion: _ruleVersion, ...publicItem } = item;
      const { componentRefs: _internalRefs, bomSnapshot: _internalBom, basePriceMissing: _missingBase, ruleMissing: _missingRule, baseDependent: _baseDependent, retailPriceMode: _retailMode, manualOverride: _manualOverride, ...publicCalculation } = item.calculationSnapshot || {};
      publicItem.calculationSnapshot = publicCalculation;
      return { ...publicItem, tiers: tiers.filter((t) => t.quoteItemId === item.id).map((tier) => {
        const calculation = { ...(tier.calculation || {}) } as any;
        if (Array.isArray(calculation.components)) calculation.components = calculation.components.map((component: any) => { const { ruleId: _rule, ruleVersion: _version, baseUpdatedAt: _updated, baseDependent: _dependent, variantId: _variant, ...safe } = component; return safe; });
        return { ...tier, calculation };
      }) };
    }) };
  }
  async listQuotes() {
    const all = await this.repo(Quote).find({ order: { createdAt: 'DESC' }, take: 200 });
    if (!all.length) return [];
    const items = await this.repo(QuoteItem).find({ where: { quoteId: In(all.map((q) => q.id)) } });
    const tiers = items.length ? await this.repo(QuoteTier).find({ where: { quoteItemId: In(items.map((x) => x.id)) } }) : [];
    return all.map((quote) => this.presentQuote(quote, items.filter((item) => item.quoteId === quote.id), tiers));
  }
  async submitQuote(id: string, actor: Actor) {
    const quote = await this.repo(Quote).findOneBy({ id });
    if (!quote) throw new NotFoundException('未找到报价单');
    if (!['draft', 'pending'].includes(quote.status)) throw new ConflictException('只有草稿报价可以提交确认');
    quote.status = 'pending'; await this.repo(Quote).save(quote); await this.audit(actor, 'submit-quote', 'quote', id);
    return this.getQuote(id);
  }
  async confirmItem(quoteId: string, itemId: string, actor: Actor) {
    const resultId = await this.db.transaction(async (m) => {
      const quote = await m.getRepository(Quote).findOne({ where: { id: quoteId }, lock: { mode: 'pessimistic_write' } });
      const item = await m.getRepository(QuoteItem).findOneBy({ id: itemId, quoteId });
      if (!quote || !item) throw new NotFoundException('报价或商品行不存在');
      if (quote.status !== 'pending') throw new ConflictException('报价单尚未提交确认或已完成');
      if (!(await m.getRepository(QuoteTier).countBy({ quoteItemId: item.id }))) throw new BadRequestException('该产品没有可确认的数量档');
      const currentBase = item.variantId ? await m.getRepository(ProductBasePrice).findOneBy({ variantId: item.variantId }) : null;
      if (item.ruleId) {
        const currentRule = await m.getRepository(PriceRule).findOneBy({ id: item.ruleId, active: true });
        const currentTiers = currentRule ? await m.getRepository(PriceTier).findBy({ ruleId: currentRule.id }) : [];
        const baseDependent = item.calculationSnapshot.baseDependent ?? currentTiers.some((tier) => tier.method !== 'fixed');
        if (!currentRule || currentRule.version !== item.ruleVersion || (baseDependent && (currentBase?.purchasePrice || null) !== item.basePriceSnapshot)) throw new ConflictException('价格规则或基准价已变化，请重新生成此报价后再确认');
      } else if (item.calculationSnapshot.baseDependent && (currentBase?.purchasePrice || null) !== item.basePriceSnapshot) {
        throw new ConflictException('建议零售价使用的基准价已变化，请重新生成报价后再确认');
      }
      const componentRefs = (item.calculationSnapshot.componentRefs as any[]) || [];
      for (const ref of componentRefs) {
        const currentRule = await m.getRepository(PriceRule).findOneBy({ id: ref.ruleId, active: true });
        const currentVariant = ref.variantId ? await m.getRepository(ProductVariant).findOneBy({ id: ref.variantId }) : null;
        const currentBase = currentVariant ? await m.getRepository(ProductBasePrice).findOneBy({ variantId: currentVariant.id }) : null;
        if (!currentRule || currentRule.version !== ref.ruleVersion || (ref.baseDependent && (currentBase?.updatedAt?.toISOString() || null) !== ref.baseUpdatedAt)) throw new ConflictException('组合商品组成项的价格规则或基准价已变化，请重新生成报价');
      }
      if (item.calculationSnapshot.bomSnapshot && item.variantId) {
        const currentBom = (await m.getRepository(BomComponent).findBy({ parentVariantId: item.variantId })).map((c) => ({ componentVariantId: c.componentVariantId, quantity: c.quantity })).sort((a, b) => a.componentVariantId.localeCompare(b.componentVariantId));
        if (JSON.stringify(currentBom) !== JSON.stringify(item.calculationSnapshot.bomSnapshot)) throw new ConflictException('组合商品组成已变化，请重新生成报价');
      }
      item.confirmedAt = new Date(); item.confirmedBy = actor.id; await m.getRepository(QuoteItem).save(item);
      const remaining = await m.getRepository(QuoteItem).count({ where: { quoteId, confirmedAt: IsNull() } });
      if (remaining === 0) quote.status = 'confirmed';
      await m.getRepository(Quote).save(quote);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'confirm-quote-item', entityType: 'quote-item', entityId: item.id, detail: { quoteId } }));
      return quoteId;
    });
    return this.getQuote(resultId);
  }
  async changeQuotePrices(quoteId: string, itemId: string, body: any, actor: Actor) {
    await this.db.transaction(async (m) => {
      const quote = await m.getRepository(Quote).findOne({ where: { id: quoteId }, lock: { mode: 'pessimistic_write' } });
      const item = await m.getRepository(QuoteItem).findOneBy({ id: itemId, quoteId });
      if (!quote || !item) throw new NotFoundException('报价或商品行不存在');
      if (quote.status !== 'pending' || item.confirmedAt) throw new ConflictException('只能修改待确认商品的价格');
      const tiers = await m.getRepository(QuoteTier).findBy({ quoteItemId: itemId });
      if (!Array.isArray(body.prices) || body.prices.length !== tiers.length || new Set(body.prices.map((p: any) => p.id)).size !== tiers.length) throw new BadRequestException('请填写全部数量档价格');
      const changes: any[] = [];
      for (const tier of tiers) {
        const input = body.prices.find((p: any) => p.id === tier.id);
        if (!input || input.unitPrice === '' || input.unitPrice === null || !Number.isFinite(Number(input.unitPrice)) || Number(input.unitPrice) < 0) throw new BadRequestException('价格须为大于或等于零的金额');
        const price = new Decimal(input.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        changes.push({ quantity: tier.quantity, oldPrice: tier.unitPrice, newPrice: price.toFixed(2) });
        tier.unitPrice = price.toFixed(2); tier.totalAmount = price.mul(tier.quantity).toDecimalPlaces(2).toFixed(2); tier.calculation = { source: 'manual', mode: 'whole' };
        await m.getRepository(QuoteTier).save(tier);
      }
      item.ruleId = null; item.ruleVersion = null; item.basePriceSnapshot = null;
      item.calculationSnapshot = { ...item.calculationSnapshot, manualOverride: true, baseDependent: false, componentRefs: [], bomSnapshot: null };
      await m.getRepository(QuoteItem).save(item);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'change-quote-prices', entityType: 'quote-item', entityId: itemId, detail: { quoteId, changes } }));
    });
    return this.getQuote(quoteId);
  }
  async removeQuote(id: string, actor: Actor, mode: 'delete' | 'void') {
    await this.db.transaction(async (m) => {
      const repo = m.getRepository(Quote);
      const quote = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!quote) throw new NotFoundException('未找到报价单');
      if (mode === 'delete' && !['draft', 'void'].includes(quote.status)) throw new ConflictException('只能删除草稿或已失效的报价，请先将报价设为失效');
      if (mode === 'void' && quote.status === 'void') throw new ConflictException('报价单已失效');
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: mode === 'delete' ? 'delete-quote' : 'void-quote', entityType: 'quote', entityId: id, detail: { quoteNumber: quote.quoteNumber, previousStatus: quote.status } }));
      if (mode === 'delete') await repo.delete(id); else { quote.status = 'void'; await repo.save(quote); }
    });
    return { success: true };
  }
  async updateTerms(id: string, body: any, actor: Actor) {
    const quote = await this.repo(Quote).findOneBy({ id });
    if (!quote || quote.status === 'confirmed' || quote.status === 'void') throw new ConflictException('报价单已完成，需复制新版本后修改');
    if (!isDateOnly(body.expiresAt) || body.expiresAt < quote.quoteDate) throw new BadRequestException('报价有效期必须是有效日期，且不能早于报价日期');
    quote.terms = String(body.terms || ''); quote.expiresAt = body.expiresAt;
    quote.status = quote.status === 'pending' ? 'draft' : quote.status;
    const items = await this.repo(QuoteItem).findBy({ quoteId: id });
    for (const item of items) { item.confirmedAt = null; item.confirmedBy = null; await this.repo(QuoteItem).save(item); }
    await this.repo(Quote).save(quote); await this.audit(actor, 'update-quote-terms', 'quote', id);
    return this.getQuote(id);
  }
  async recalculateQuote(id: string, actor: Actor) {
    const quoteId = await this.db.transaction(async (m) => {
      const quote = await m.getRepository(Quote).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!quote) throw new NotFoundException('未找到报价单');
      if (!['draft', 'pending'].includes(quote.status)) throw new ConflictException('只有未确认报价可以重新生成价格');
      const items = await m.getRepository(QuoteItem).findBy({ quoteId: id });
      const quoteTiers = await m.getRepository(QuoteTier).find({ where: items.map((item) => ({ quoteItemId: item.id })) });
      for (const item of items) {
        if (item.calculationSnapshot.manualOverride) continue;
        const variant = item.variantId ? await m.getRepository(ProductVariant).findOneBy({ id: item.variantId, active: true }) : null;
        if (!variant) throw new ConflictException('报价商品已停用，无法重新生成');
        const product = await m.getRepository(Product).findOneBy({ id: variant.productId, active: true });
        if (!product) throw new ConflictException('报价商品已失效，无法重新生成');
        const rule = await m.getRepository(PriceRule).findOne({ where: { quoteType: quote.quoteType, variantId: variant.id, brandId: quote.brandId, customerId: quote.quoteType === 'private' ? quote.customerId : IsNull(), active: true } });
        const offers = quoteTiers.filter((tier) => tier.quoteItemId === item.id);
        if (!offers.length) throw new ConflictException('报价商品没有数量档');
        const base = await m.getRepository(ProductBasePrice).findOneBy({ variantId: variant.id });
        const tiers = rule ? await m.getRepository(PriceTier).find({ where: { ruleId: rule.id }, order: { minQuantity: 'ASC' } }) : [];
        const refreshed: any[] = [];
        if (rule) {
          if (!tiers.length) throw new ConflictException('价格规则没有有效阶梯');
          for (const offer of offers) {
            const calc = calculateQuantity(offer.quantity, tiers, rule.quantityMode, base?.purchasePrice);
            refreshed.push({ offer, calc, calculation: { source: 'rule', mode: rule.quantityMode, segments: calc.segments } });
          }
        } else if (product.kind === 'bundle') {
          for (const offer of offers) {
            const calc = await this.bundlePrice(m, variant.id, offer.quantity, quote.quoteType, quote.brandId, quote.customerId);
            refreshed.push({ offer, calc, calculation: calc.calculation });
          }
        } else if (item.ruleId) {
          throw new ConflictException(`${product.name} 的规则已移除，无法重新生成，请先维护新规则`);
        } else {
          continue; // 本次人工固定价格，不受常用规则重算影响。
        }
        const retailMode = item.calculationSnapshot.retailPriceMode;
        if (['50', '80', '100', '180'].includes(String(retailMode))) {
          if (base?.purchasePrice == null) throw new ConflictException(`${product.name} 缺少采购基准价，请改为手工建议零售价`);
          item.marketRetailPrice = new Decimal(base.purchasePrice).mul(new Decimal(1).plus(new Decimal(String(retailMode)).div(100))).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
        }
        item.ruleId = rule?.id || null; item.ruleVersion = rule?.version || null;
        item.basePriceSnapshot = base?.purchasePrice || null; item.confirmedAt = null; item.confirmedBy = null;
        const componentRefs = refreshed.flatMap((entry) => entry.calculation?.components || []).map((component: any) => ({ variantId: component.variantId, ruleId: component.ruleId, ruleVersion: component.ruleVersion, baseUpdatedAt: component.baseUpdatedAt, baseDependent: component.baseDependent }));
        const bomSnapshot = product.kind === 'bundle' && !rule ? (await m.getRepository(BomComponent).findBy({ parentVariantId: variant.id })).map((c) => ({ componentVariantId: c.componentVariantId, quantity: c.quantity })).sort((a, b) => a.componentVariantId.localeCompare(b.componentVariantId)) : null;
        item.calculationSnapshot = { ...item.calculationSnapshot, basePriceMissing: !base?.purchasePrice, ruleMissing: !rule, baseDependent: tiers.some((t) => t.method !== 'fixed') || ['50', '80', '100', '180'].includes(String(retailMode)), componentRefs, bomSnapshot };
        await m.getRepository(QuoteItem).save(item);
        await m.getRepository(QuoteTier).delete({ quoteItemId: item.id });
        await m.getRepository(QuoteTier).save(refreshed.map(({ offer, calc, calculation }) => m.getRepository(QuoteTier).create({ quoteItemId: item.id, quantity: offer.quantity, unitPrice: calc.unitPrice, totalAmount: calc.totalAmount, calculation })));
      }
      quote.status = 'draft'; await m.getRepository(Quote).save(quote);
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({ userId: actor.id, action: 'recalculate-quote', entityType: 'quote', entityId: id, detail: { itemCount: items.length } }));
      return quote.id;
    });
    return this.getQuote(quoteId);
  }
  async duplicateQuote(id: string, actor: Actor) {
    const source = await this.getQuote(id);
    const internalItems = await this.repo(QuoteItem).findBy({ quoteId: id });
    const newId = await this.db.transaction(async (m) => {
      const qRepo = m.getRepository(Quote);
      const quote = await qRepo.save(qRepo.create({ quoteNumber: `Q${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 6).toUpperCase()}`, quoteType: source.quoteType, customerId: source.customerId, brandId: source.brandId, status: 'draft', quoteDate: new Date().toISOString().slice(0, 10), expiresAt: source.expiresAt, terms: source.terms, customerSnapshot: source.customerSnapshot, brandSnapshot: source.brandSnapshot, createdBy: actor.id, version: source.version + 1 }));
      for (const old of source.items) {
        const internal = internalItems.find((x) => x.id === old.id)!;
        const item = await m.getRepository(QuoteItem).save(m.getRepository(QuoteItem).create({ quoteId: quote.id, variantId: old.variantId, kind: old.kind, productSnapshot: old.productSnapshot, ruleId: internal.ruleId, ruleVersion: internal.ruleVersion, basePriceSnapshot: internal.basePriceSnapshot, marketRetailPrice: old.marketRetailPrice, suggestedFirstQuantity: internal.suggestedFirstQuantity, calculationSnapshot: internal.calculationSnapshot }));
        await m.getRepository(QuoteTier).save(old.tiers.map((t: QuoteTier) => m.getRepository(QuoteTier).create({ quoteItemId: item.id, quantity: t.quantity, unitPrice: t.unitPrice, totalAmount: t.totalAmount, calculation: t.calculation })));
      }
      return quote.id;
    });
    return this.getQuote(newId);
  }
  async exportQuotes(ids: string[]) {
    if (!ids?.length) throw new BadRequestException('请选择要导出的报价单');
    if (ids.length !== 1) throw new BadRequestException('请一次导出一份报价单');
    const quotes = await Promise.all(ids.map((id) => this.getQuote(id)));
    if (quotes.some((q) => q.status !== 'confirmed')) throw new BadRequestException('只能导出已确认的报价单');
    const wb = new ExcelJS.Workbook();
    wb.creator = process.env.COMPANY_NAME || '产品与报价管理'; wb.created = new Date();
    const quote = quotes[0];
    const hasSegmented = quote.items.some((item: any) => item.tiers.some((tier: any) => tier.calculation?.mode === 'segmented' || (tier.calculation?.segments?.length || 0) > 1 || tier.calculation?.components?.some((component: any) => (component.calculation?.segments?.length || 0) > 1)));
    const company = process.env.COMPANY_NAME || '宁波毅诺智慧健康科技有限公司';
    const fill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF243B53' } };
    const dark = { argb: 'FFFFFFFF' };
    for (const [sheetName, kind] of [['自有品牌报价', 'own'], ['客户贴牌报价', 'private']] as const) {
      const sheet = wb.addWorksheet(sheetName);
      const items = quote.items.filter((item: any) => item && item.tiers && quote.quoteType === kind);
      if (!items.length) continue;
      const quantities = [...new Set<number>(items.flatMap((item: any) => item.tiers.map((tier: any) => Number(tier.quantity))))].sort((a, b) => a - b);
      const headers = kind === 'own'
        ? ['序号', '货号', '产品名称', '规格 / 计价单位', ...quantities.map((q) => `线下供货价（订购${q}，元）`), '建议零售价/市场指导价（元）', '建议首批量', '交付说明']
        : ['序号', '货号', '产品名称', '规格 / 计价单位', ...quantities.flatMap((q) => [`订购${q}单价（元）`, `订购${q}货款（元）`]), '定制说明'];
      const lastColumn = headers.length;
      const lastLetter = (column: number) => { let result = ''; while (column > 0) { const remainder = (column - 1) % 26; result = String.fromCharCode(65 + remainder) + result; column = Math.floor((column - 1) / 26); } return result; };
      const lastCol = lastLetter(lastColumn);
      sheet.mergeCells(`A1:${lastCol}1`);
      sheet.getCell('A1').value = `${(quote.brandSnapshot as any).name} ${kind === 'own' ? '产品合作参考报价' : '品牌定制合作参考报价'}`;
      sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF243B53' } };
      sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 34;
      sheet.mergeCells(`A2:${lastCol}2`);
      sheet.getCell('A2').value = company;
      sheet.getCell('A2').font = { size: 12, color: { argb: 'FF52606D' } };
      sheet.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.mergeCells(`A3:D3`);
      sheet.getCell('A3').value = `客户：${(quote.customerSnapshot as any).name}　报价编号：${quote.quoteNumber}`;
      sheet.mergeCells(`E3:${lastCol}3`);
      sheet.getCell('E3').value = `报价日期：${quote.quoteDate}　有效期至：${quote.expiresAt}　·　人民币含税报价 / 不含运输费用`;
      sheet.getRow(3).font = { bold: true, color: { argb: 'FF334E68' } };
      sheet.mergeCells(`A4:${lastCol}4`);
      sheet.getCell('A4').value = kind === 'own'
        ? `采用${(quote.brandSnapshot as any).name}品牌标准产品，适用于门店、电商及合作渠道选品。首批采购量可结合库存与交付安排协商。${hasSegmented ? '分段计价数量档展示的单价为折算平均单价。' : ''}`
        : `以下为客户品牌定制合作参考报价，各型号及规格分别核价；定制范围按双方确认的商务条款执行。${hasSegmented ? '分段计价档单价为平均单价，货款按各数量段金额合计。' : ''}`;
      sheet.getCell('A4').alignment = { wrapText: true, vertical: 'middle' };
      sheet.getRow(4).height = 32;
      sheet.columns = headers.map((header, index) => ({ key: `c${index + 1}`, width: index < 4 ? [8, 18, 24, 24][index] : Math.max(17, header.length * 1.5) }));
      const header = sheet.getRow(5);
      headers.forEach((value, index) => { header.getCell(index + 1).value = value; });
      header.height = 36;
      header.font = { bold: true, color: dark };
      header.fill = fill;
      header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      sheet.views = [{ state: 'frozen', ySplit: 5 }];
      items.forEach((item: any, index: number) => {
        const tiers = new Map<number, any>(item.tiers.map((tier: any) => [Number(tier.quantity), tier]));
        const product = item.productSnapshot as any;
        const rowValues: any[] = [index + 1, product.sku, product.name, `${product.specification} / ${product.unit}`];
        for (const quantity of quantities) {
          const tier = tiers.get(quantity);
          if (kind === 'own') rowValues.push(tier ? Number(tier.unitPrice) : null);
          else rowValues.push(tier ? Number(tier.unitPrice) : null, tier ? Number(tier.totalAmount) : null);
        }
        if (kind === 'own') rowValues.push(item.marketRetailPrice == null ? null : Number(item.marketRetailPrice), item.suggestedFirstQuantity ?? null, '配置及交期按订单确认');
        else rowValues.push('普通彩盒与基础说明书');
        const row = sheet.addRow(rowValues);
        row.alignment = { vertical: 'middle', wrapText: true };
        row.height = 26;
        for (let column = 5; column <= lastColumn; column++) if (column <= 4 + quantities.length * (kind === 'own' ? 1 : 2) || (kind === 'own' && column === 5 + quantities.length)) row.getCell(column).numFmt = '#,##0.00';
      });
      sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: Math.max(sheet.rowCount, 5), column: lastColumn } };
      const termsTitle = sheet.addRow(['商务条款']);
      sheet.mergeCells(`A${termsTitle.number}:${lastCol}${termsTitle.number}`);
      termsTitle.getCell(1).font = { bold: true, color: { argb: 'FF243B53' } };
      const terms = sheet.addRow([quote.terms || '付款、交期、质量与售后安排以双方书面订单约定为准。']);
      sheet.mergeCells(`A${terms.number}:${lastCol}${terms.number}`);
      terms.getCell(1).alignment = { wrapText: true, vertical: 'top' };
      terms.height = Math.max(42, Math.min(180, (quote.terms || '').split('\n').length * 18));
      const companyContact = process.env.COMPANY_CONTACT?.trim();
      if (companyContact) {
        const contact = sheet.addRow([`业务联系：${companyContact}`]);
        sheet.mergeCells(`A${contact.number}:${lastCol}${contact.number}`);
        contact.getCell(1).font = { color: { argb: 'FF52606D' } };
      }
      sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
      sheet.eachRow((row) => row.eachCell((cell) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD9E2EC' } } }; }));
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  async listRoles() { return this.repo(Role).find({ order: { name: 'ASC' } }); }
  async updateRole(id: string, body: any, actor: Actor) {
    const role = await this.repo(Role).findOneBy({ id });
    if (!role) throw new NotFoundException('角色不存在');
    if (!Array.isArray(body.permissions) || body.permissions.some((x: any) => typeof x !== 'string')) throw new BadRequestException('权限列表格式不正确');
    role.permissions = role.name === 'admin' ? ['*'] : [...new Set<string>(body.permissions as string[])]; await this.repo(Role).save(role); await this.audit(actor, 'update-role', 'role', id, { permissions: role.permissions }); return role;
  }
  async listUsers() { return (await this.repo(User).find({ relations: { roles: true }, order: { username: 'ASC' } })).map(({ passwordHash, ...u }) => u); }
  async createUser(body: any, actor: Actor) {
    if (!body.username?.trim() || !body.displayName?.trim() || !body.password || body.password.length < 12 || !Array.isArray(body.roleIds)) throw new BadRequestException('用户名、姓名、至少 12 位密码和角色必填');
    const roles = await this.repo(Role).findByIds(body.roleIds);
    if (!roles.length) throw new BadRequestException('请选择有效角色');
    const user = this.repo(User).create({ username: body.username.trim(), displayName: body.displayName.trim(), passwordHash: await hash(body.password, 12), roles, active: true });
    const saved = await this.repo(User).save(user); await this.audit(actor, 'create-user', 'user', saved.id, { username: saved.username });
    return { id: saved.id, username: saved.username, displayName: saved.displayName, roles: saved.roles.map((r) => r.name) };
  }
  async setBom(parentVariantId: string, components: any[], actor: Actor) {
    const parent = await this.repo(ProductVariant).findOneBy({ id: parentVariantId });
    if (!parent) throw new NotFoundException('父商品规格不存在');
    const product = await this.repo(Product).findOneByOrFail({ id: parent.productId });
    if (product.kind !== 'bundle') throw new BadRequestException('只有产品或组合商品可以配置组成');
    if (!Array.isArray(components) || components.some((c) => !c.variantId || c.variantId === parentVariantId || !Number.isFinite(Number(c.quantity)) || Number(c.quantity) <= 0)) throw new BadRequestException('组成项规格、正数量必填，且不能引用自身');
    const ids = components.map((c) => c.variantId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('同一商品规格不能重复添加为组成项');
    const variants = await this.repo(ProductVariant).findByIds(ids);
    if (variants.length !== new Set(ids).size) throw new BadRequestException('组成项中存在无效商品规格');
    const childProducts = await this.repo(Product).findByIds(variants.map((v) => v.productId));
    if (variants.some((v) => !v.active) || childProducts.some((p) => !p.active)) throw new BadRequestException('失效商品不能添加到组合中');
    if (childProducts.some((p) => p.kind === 'bundle')) throw new BadRequestException('首期不支持组合商品嵌套');
    const existingBom = await this.repo(BomComponent).find();
    const graph = new Map<string, string[]>();
    for (const edge of existingBom) if (edge.parentVariantId !== parentVariantId) graph.set(edge.parentVariantId, [...(graph.get(edge.parentVariantId) || []), edge.componentVariantId]);
    graph.set(parentVariantId, ids);
    const reachesParent = (current: string, seen = new Set<string>()): boolean => {
      if (current === parentVariantId) return true;
      if (seen.has(current)) return false;
      seen.add(current);
      return (graph.get(current) || []).some((next) => reachesParent(next, seen));
    };
    if (ids.some((componentId) => reachesParent(componentId))) throw new BadRequestException('组成关系会形成循环引用');
    await this.db.transaction(async (m) => {
      await m.getRepository(BomComponent).delete({ parentVariantId });
      await m.getRepository(BomComponent).save(components.map((c) => m.getRepository(BomComponent).create({ parentVariantId, componentVariantId: c.variantId, quantity: String(c.quantity) })));
    });
    await this.audit(actor, 'set-bom', 'product-variant', parentVariantId, { components: components.length });
    return { parentVariantId, components };
  }
}

