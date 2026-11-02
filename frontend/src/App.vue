<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ProductSelect from './ProductSelect.vue'

type AnyRow = Record<string, any>
const token = ref(localStorage.getItem('plm-token') || '')
const me = ref<AnyRow | null>(null)
const section = ref('overview')
const loading = ref(false)
const products = ref<AnyRow[]>([])
const customers = ref<AnyRow[]>([])
const brands = ref<AnyRow[]>([])
const rules = ref<AnyRow[]>([])
const customerRuleCounts = ref<AnyRow[]>([])
const ruleSearch = ref('')
const rulePage = ref(1)
const rulePageSize = ref(10)
const ruleTotal = ref(0)
const rulesLoading = ref(false)
const tierDetailRule = ref<AnyRow | null>(null)
let ruleRequest = 0
let ruleSearchTimer: ReturnType<typeof setTimeout> | undefined
const quotes = ref<AnyRow[]>([])
const quoteSearch = ref('')
const quotePage = ref(1)
const quotePageSize = ref(10)
const quoteTotal = ref(0)
const quotePendingTotal = ref(0)
const quoteOverallTotal = ref(0)
const recentQuotes = ref<AnyRow[]>([])
const customerQuoteCounts = ref<AnyRow[]>([])
const quotesLoading = ref(false)
let quoteRequest = 0
let quoteSearchTimer: ReturnType<typeof setTimeout> | undefined
const basePrices = ref<AnyRow[]>([])
const roles = ref<AnyRow[]>([])
const users = ref<AnyRow[]>([])
const loginForm = reactive({ username: '', password: '' })
const showProduct = ref(false)
const productSearch = ref('')
const productPage = ref(1)
const productPageSize = ref(10)
const productTotal = ref(0)
const activeProductCount = ref(0)
let productRequest = 0
let productSearchTimer: ReturnType<typeof setTimeout> | undefined
const detailProduct = ref<AnyRow | null>(null)
const specProduct = ref<AnyRow | null>(null)
const editingProductId = ref('')
const showCustomer = ref(false)
const editingCustomerId = ref('')
const showBrand = ref(false)
const editingBrandId = ref('')
const showRule = ref(false)
const editingRuleId = ref('')
const showQuote = ref(false)
const showBase = ref(false)
const showBom = ref(false)
const showReview = ref(false)
const selectedQuote = ref<AnyRow | null>(null)
const imageFile = ref<File | null>(null)

const productForm = reactive({ sku: '', name: '', kind: 'product', description: '', imagePath: '', active: true, variants: [{ id: '', specification: '', unit: '套' }] as AnyRow[] })
const customerForm = reactive({ name: '', contact: '', phone: '', notes: '', active: true })
const brandForm = reactive({ name: '', kind: 'own', customerId: '', active: true })
const baseForm = reactive({ variantId: '', purchasePrice: '', standardRetailPrice: '' })
const ruleForm = reactive<any>({ quoteType: 'own', customerId: '', brandId: '', variantId: '', quantityMode: 'whole', tiers: [{ minQuantity: 1, maxQuantityExclusive: null, method: 'fixed', value: '' }] })
const quoteForm = reactive<any>({ quoteType: 'own', customerId: '', brandId: '', quoteDate: new Date().toISOString().slice(0, 10), expiresAt: '', terms: '', items: [] as any[] })
const bomForm = reactive<any>({ parentVariantId: '', components: [{ variantId: '', quantity: 1 }] })
const userForm = reactive({ username: '', displayName: '', password: '', roleIds: [] as string[] })

const permissions = [
  { key: 'catalog:write', label: '维护产品、客户和品牌' },
  { key: 'price:manage', label: '维护阶梯规则和采购基准价' },
  { key: 'cost:view', label: '查看采购价和财务成本' },
  { key: 'quote:create', label: '创建和提交报价' },
  { key: 'quote:confirm', label: '确认报价' },
]
const has = (permission: string) => !!me.value?.permissions?.includes('*') || !!me.value?.permissions?.includes(permission)
const canManage = computed(() => has('price:manage'))
const canConfirm = computed(() => has('quote:confirm'))
const canAdmin = computed(() => me.value?.roles?.includes('admin'))
watch(productSearch, () => { productPage.value = 1; clearTimeout(productSearchTimer); productSearchTimer = setTimeout(() => { void loadProducts() }, 300) })
watch(productPageSize, () => { productPage.value = 1; void loadProducts() })
watch(productPage, () => { void loadProducts() })
watch(quoteSearch, () => { quotePage.value = 1; clearTimeout(quoteSearchTimer); quoteSearchTimer = setTimeout(() => { void loadQuotes() }, 300) })
watch(quotePageSize, () => { quotePage.value = 1; void loadQuotes() })
watch(quotePage, () => { void loadQuotes() })
watch(ruleSearch, () => { rulePage.value = 1; clearTimeout(ruleSearchTimer); ruleSearchTimer = setTimeout(() => { void loadRules() }, 300) })
watch(rulePageSize, () => { rulePage.value = 1; void loadRules() })
watch(rulePage, () => { void loadRules() })
watch([() => quoteForm.quoteType, () => quoteForm.brandId, () => quoteForm.customerId], () => {
  if (showQuote.value) for (const line of quoteForm.items) void refreshQuoteRule(line)
})
const activeCustomers = computed(() => customers.value.filter((c) => c.active))
const ownBrandDirectory = computed(() => brands.value.filter((b) => b.kind === 'own'))
const ownBrands = computed(() => brands.value.filter((b) => b.kind === 'own' && b.active))
const privateBrands = computed(() => brands.value.filter((b) => b.kind === 'customer' && b.customerId === quoteForm.customerId && b.active))
const ruleBrands = computed(() => ruleForm.quoteType === 'own' ? ownBrands.value : brands.value.filter((b) => b.kind === 'customer' && b.customerId === ruleForm.customerId && b.active))
const navIcons: Record<string, string> = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  products: 'm12 3 9 5-9 5-9-5 9-5z M3 8v9l9 5 9-5V8 M12 13v9',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-4',
  pricing: 'M4 4h7l10 10-7 7L4 11V4z M8 8h.01',
  quotes: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.6 2.8-.2-.1a1.7 1.7 0 0 0-1.9.3l-.1.1h-3.2l-.1-.2a1.7 1.7 0 0 0-1.6-1l-.2.1-2.8-1.6.1-.2a1.7 1.7 0 0 0-.3-1.9l-.1-.1v-3.2l.2-.1a1.7 1.7 0 0 0 1-1.6l-.1-.2 1.6-2.8.2.1a1.7 1.7 0 0 0 1.9-.3l.1-.1h3.2l.1.2a1.7 1.7 0 0 0 1.6 1l.2-.1 2.8 1.6-.1.2a1.7 1.7 0 0 0 .3 1.9l.1.1v3.2z',
}
const navigation = computed(() => [
  { id: 'overview', label: '工作台', icon: navIcons.overview },
  { id: 'quotes', label: '客户报价', icon: navIcons.quotes },
  { id: 'products', label: '产品资料', icon: navIcons.products },
  { id: 'customers', label: '客户与品牌', icon: navIcons.customers },
  { id: 'pricing', label: '价格规则', icon: navIcons.pricing, show: canManage.value || has('quote:create') },
].filter((entry) => entry.show !== false))
const tiles = computed(() => [
  { label: '在售商品', value: activeProductCount.value, note: '按商品资料统计' },
  { label: '客户', value: customers.value.filter((c) => c.active).length, note: '已维护客户档案' },
  { label: '待确认报价', value: quotePendingTotal.value, note: '需要确认角色处理' },
  { label: '累计报价', value: quoteOverallTotal.value, note: '历史报价保留快照' },
])

async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (token.value) headers.set('Authorization', `Bearer ${token.value}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, { ...options, headers })
  if (!response.ok) {
    let message = `请求失败 (${response.status})`
    try { const body = await response.json(); message = Array.isArray(body.message) ? body.message.join('；') : body.message || message } catch {}
    throw new Error(message)
  }
  return response.status === 204 ? undefined as T : response.json()
}
const body = (value: unknown) => JSON.stringify(value)
function notifyError(error: unknown) { ElMessage.error(error instanceof Error ? error.message : '操作失败') }
async function login() {
  try {
    const result = await api<any>('/auth/login', { method: 'POST', body: body(loginForm) })
    token.value = result.accessToken; localStorage.setItem('plm-token', token.value); me.value = result.user
    await loadAll(); ElMessage.success('登录成功')
  } catch (e) { notifyError(e) }
}
function logout() { token.value = ''; me.value = null; localStorage.removeItem('plm-token') }
async function loadProducts() {
  if (!token.value) return
  const request = ++productRequest
  try {
    const params = new URLSearchParams({ page: String(productPage.value), size: String(productPageSize.value), q: productSearch.value.trim() })
    const result = await api<{ items: AnyRow[]; total: number; activeCount: number }>(`/products-page?${params}`)
    if (request !== productRequest) return
    const maxPage = Math.max(1, Math.ceil(result.total / productPageSize.value))
    if (productPage.value > maxPage) { productPage.value = maxPage; return }
    products.value = result.items; productTotal.value = result.total; activeProductCount.value = result.activeCount
  } catch (e) { if (request === productRequest) notifyError(e) }
}
async function loadRules() {
  if (!token.value || !(has('quote:create') || canManage.value || canAdmin.value)) return
  const request = ++ruleRequest
  rulesLoading.value = true
  try {
    const params = new URLSearchParams({ page: String(rulePage.value), size: String(rulePageSize.value), q: ruleSearch.value.trim() })
    const result = await api<{ items: AnyRow[]; total: number }>(`/rules-page?${params}`)
    if (request !== ruleRequest) return
    const maxPage = Math.max(1, Math.ceil(result.total / rulePageSize.value))
    if (rulePage.value > maxPage) { rulePage.value = maxPage; return }
    rules.value = result.items; ruleTotal.value = result.total
  } catch (e) { if (request === ruleRequest) notifyError(e) }
  finally { if (request === ruleRequest) rulesLoading.value = false }
}
async function loadQuotes() {
  if (!token.value) return
  const request = ++quoteRequest
  quotesLoading.value = true
  try {
    const params = new URLSearchParams({ page: String(quotePage.value), size: String(quotePageSize.value), q: quoteSearch.value.trim() })
    const result = await api<{ items: AnyRow[]; total: number }>(`/quotes-page?${params}`)
    if (request !== quoteRequest) return
    const maxPage = Math.max(1, Math.ceil(result.total / quotePageSize.value))
    if (quotePage.value > maxPage) { quotePage.value = maxPage; return }
    quotes.value = result.items; quoteTotal.value = result.total
  } catch (e) { if (request === quoteRequest) notifyError(e) }
  finally { if (request === quoteRequest) quotesLoading.value = false }
}
async function loadQuoteSummary() {
  const summary = await api<{ total: number; pending: number; recent: AnyRow[]; customerCounts: AnyRow[] }>('/quotes-summary')
  quoteOverallTotal.value = summary.total; quotePendingTotal.value = summary.pending; recentQuotes.value = summary.recent; customerQuoteCounts.value = summary.customerCounts
}
async function openQuoteDetails(quote: AnyRow) {
  try { selectedQuote.value = await api(`/quotes/${quote.id}`); showReview.value = true } catch (e) { notifyError(e) }
}
async function loadAll() {
  if (!token.value) return
  loading.value = true
  try {
    const results = await Promise.allSettled([
      api<AnyRow[]>('/customers'), api<AnyRow[]>('/brands'),
      has('quote:create') || has('price:manage') || canAdmin.value ? api<AnyRow[]>('/rule-customer-counts') : Promise.resolve([]),
      has('cost:view') || has('price:manage') || canAdmin.value ? api<AnyRow[]>('/base-prices') : Promise.resolve([]),
    ])
    const values = results.map((r) => r.status === 'fulfilled' ? r.value : []) as AnyRow[][]
    ;[customers.value, brands.value, customerRuleCounts.value, basePrices.value] = values
    await Promise.all([loadProducts(), loadRules(), loadQuotes(), loadQuoteSummary()])
    if (canAdmin.value) { const [r, u] = await Promise.all([api<AnyRow[]>('/admin/roles'), api<AnyRow[]>('/admin/users')]); roles.value = r; users.value = u }
  } catch (e) { notifyError(e) } finally { loading.value = false }
}
onMounted(async () => {
  if (token.value) {
    try { me.value = await api('/auth/me'); await loadAll() }
    catch (e) { logout(); notifyError(e) }
  }
})

function openProduct() { editingProductId.value = ''; Object.assign(productForm, { sku: '', name: '', kind: 'product', description: '', imagePath: '', active: true, variants: [{ id: '', specification: '', unit: '套' }] }); imageFile.value = null; showProduct.value = true }
function editProduct(product: AnyRow) { editingProductId.value = product.id; Object.assign(productForm, { sku: product.sku, name: product.name, kind: product.kind, description: product.description || '', imagePath: product.imagePath || '', active: product.active, variants: (product.variants || []).slice(0, 1).map((v: AnyRow) => ({ id: v.id, specification: v.specification, unit: v.unit })) }); imageFile.value = null; showProduct.value = true }
async function uploadSelectedImage() {
  if (!imageFile.value) return productForm.imagePath
  const fd = new FormData(); fd.append('file', imageFile.value)
  const result = await api<{ path: string }>('/products/image', { method: 'POST', body: fd })
  return result.path
}
async function saveProduct() {
  try {
    const imagePath = await uploadSelectedImage()
    const payload = { ...productForm, imagePath, variants: productForm.variants }
    await api(editingProductId.value ? `/products/${editingProductId.value}` : '/products', { method: editingProductId.value ? 'PATCH' : 'POST', body: body(payload) })
    showProduct.value = false; await loadAll(); ElMessage.success('产品资料已保存')
  } catch (e) { notifyError(e) }
}
async function setProductActive(product: AnyRow) {
  try {
    const action = product.active ? '失效' : '启用'
    await ElMessageBox.confirm(product.active ? `确定将“${product.name}”设为失效？失效后不能用于新报价或新价格规则，作为组合项时也无法按组成计算新价格。` : `确定重新启用“${product.name}”？`, `${action}商品`, { type: 'warning' })
    await api(`/products/${product.id}`, { method: 'PATCH', body: body({ active: !product.active }) })
    await loadAll(); ElMessage.success(`商品已${action}`)
  } catch (e) { if (e !== 'cancel' && e !== 'close') notifyError(e) }
}
async function deleteProduct(product: AnyRow) {
  try {
    await ElMessageBox.confirm(`确定删除“${product.name}”？删除后无法恢复。已关联业务记录的商品只能设为失效。`, '删除商品', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await api(`/products/${product.id}`, { method: 'DELETE' })
    await loadAll(); ElMessage.success('商品已删除')
  } catch (e) { if (e !== 'cancel' && e !== 'close') notifyError(e) }
}
function openCustomer() { editingCustomerId.value = ''; Object.assign(customerForm, { name: '', contact: '', phone: '', notes: '', active: true }); showCustomer.value = true }
function editCustomer(customer: AnyRow) { editingCustomerId.value = customer.id; Object.assign(customerForm, { name: customer.name, contact: customer.contact || '', phone: customer.phone || '', notes: customer.notes || '', active: customer.active }); showCustomer.value = true }
async function saveCustomer() {
  try { await api(editingCustomerId.value ? `/customers/${editingCustomerId.value}` : '/customers', { method: editingCustomerId.value ? 'PATCH' : 'POST', body: body(customerForm) }); showCustomer.value = false; Object.assign(customerForm, { name: '', contact: '', phone: '', notes: '', active: true }); await loadAll(); ElMessage.success('客户资料已保存') } catch (e) { notifyError(e) }
}
function openBrand() { editingBrandId.value = ''; Object.assign(brandForm, { name: '', kind: 'own', customerId: '', active: true }); showBrand.value = true }
function editBrand(brand: AnyRow) { editingBrandId.value = brand.id; Object.assign(brandForm, { name: brand.name, kind: brand.kind, customerId: brand.customerId || '', active: brand.active }); showBrand.value = true }
async function saveBrand() {
  try { await api(editingBrandId.value ? `/brands/${editingBrandId.value}` : '/brands', { method: editingBrandId.value ? 'PATCH' : 'POST', body: body(brandForm) }); showBrand.value = false; Object.assign(brandForm, { name: '', kind: 'own', customerId: '', active: true }); await loadAll(); ElMessage.success('品牌资料已保存') } catch (e) { notifyError(e) }
}
function openBase(variant: AnyRow) {
  const current = basePrices.value.find((p) => p.variantId === variant.id)
  Object.assign(baseForm, { variantId: variant.id, purchasePrice: current?.purchasePrice ?? '', standardRetailPrice: current?.standardRetailPrice ?? '' }); showBase.value = true
}
async function saveBase() {
  try { await api(`/variants/${baseForm.variantId}/base-price`, { method: 'PUT', body: body(baseForm) }); showBase.value = false; await loadAll(); ElMessage.success('价格已保存') } catch (e) { notifyError(e) }
}
function openRule() { editingRuleId.value = ''; Object.assign(ruleForm, { quoteType: 'own', customerId: '', brandId: '', variantId: '', quantityMode: 'whole', tiers: [{ minQuantity: 1, maxQuantityExclusive: null, method: 'fixed', value: '' }] }); showRule.value = true }
function editRule(rule: AnyRow) {
  editingRuleId.value = rule.id
  Object.assign(ruleForm, { quoteType: rule.quoteType, customerId: rule.customerId || '', brandId: rule.brandId, variantId: rule.variantId, quantityMode: rule.quantityMode, tiers: rule.tiers.map((t: AnyRow) => ({ minQuantity: t.minQuantity, maxQuantityExclusive: t.maxQuantityExclusive, method: t.method, value: t.value })) })
  showRule.value = true
}
function addTier(target: any) {
  const list = target.tiers
  const last = list[list.length - 1]
  if (last.maxQuantityExclusive == null || !Number.isInteger(Number(last.maxQuantityExclusive))) return ElMessage.warning('先为当前档填写下一档的起始数量')
  list.push({ minQuantity: Number(last.maxQuantityExclusive), maxQuantityExclusive: null, method: 'fixed', value: '' })
}
async function saveRule() {
  try {
    const payload = { ...ruleForm, customerId: ruleForm.quoteType === 'private' ? ruleForm.customerId : null, tiers: ruleForm.tiers.map((t: AnyRow) => ({ ...t, maxQuantityExclusive: t.maxQuantityExclusive == null || t.maxQuantityExclusive === '' ? null : Number(t.maxQuantityExclusive) })) }
    await api(editingRuleId.value ? `/rules/${editingRuleId.value}` : '/rules', { method: editingRuleId.value ? 'PUT' : 'POST', body: body(payload) }); showRule.value = false; await loadAll(); ElMessage.success('阶梯规则已保存')
  } catch (e) { notifyError(e) }
}
async function deleteRule(rule: AnyRow) {
  try {
    await ElMessageBox.confirm('确定删除该价格规则？删除后新报价将不再使用此规则，使用旧规则的待确认报价需重新计算。', '删除价格规则', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await api(`/rules/${rule.id}`, { method: 'DELETE' })
    await loadAll(); ElMessage.success('价格规则已删除')
  } catch (e) { if (e !== 'cancel' && e !== 'close') notifyError(e) }
}
function openQuote() {
  Object.assign(quoteForm, { quoteType: 'own', customerId: '', brandId: ownBrands.value.length === 1 ? ownBrands.value[0].id : '', quoteDate: new Date().toISOString().slice(0, 10), expiresAt: '', terms: defaultTerms('own'), items: [] })
  addQuoteLine(); showQuote.value = true
}
function addQuoteLine() { quoteForm.items.push({ variantId: '', quantities: '', manualPrices: '', suggestedFirstQuantity: '', priceSource: 'rule', saveAsCommon: canManage.value, quantityMode: 'whole', retailPriceMode: '', manualRetailPrice: '', tiers: [{ minQuantity: 1, maxQuantityExclusive: null, method: 'fixed', value: '' }] }) }
function selectQuoteVariant(line: AnyRow, option: AnyRow | null) {
  line.variantId = option?.id || ''
  line.productKind = option?.kind || ''
  line.manualPrices = ''
  line.priceSource = 'rule'
  line.saveAsCommon = false
  void refreshQuoteRule(line)
}
function defaultTerms(type: string) {
  return type === 'own'
    ? '采用所选品牌标准产品，适用于门店、电商及合作渠道选品。首批采购量可结合库存与交付安排协商。\n建议零售价供销售规划参考。实际零售价由合作方依法自主确定。本单为合作参考报价，确认型号、数量和配置后提供正式订单报价。\n合作支持\n产品资料：基础产品介绍、参数、使用指引及渠道适用的资质资料。\n销售支持：首次合作 1 次线上产品培训，提供基础图文及陈列建议。\n专项服务：专版素材、现场培训、代发及联合活动，按范围另行约定。\n交易与交付\n价格与运输：含税产品价，运费另计。按数量与配置确认正式订单价。\n付款与交期：付款及交期书面约定，定制订单签样后安排交付。\n质量与售后：按确认样品及资料验收。保修、退换货和责任边界按合同执行。\n下一步：请反馈型号、数量、销售渠道及品牌要求，以便确认订单报价。'
    : '以下为客户品牌定制合作参考报价，各型号及规格分别核价。\n定制范围：普通彩盒与基础说明书；按双方确认的品牌标识和稿件制作。\n产品资料：提供基础参数及使用资料，首次合作可安排 1 次线上培训。\n专项开发：独家配色、特殊结构、模具、认证及研发需求另行报价。\n交易与交付\n价格与运输：含税产品价，运费另计。按数量与配置确认正式订单价。\n付款与交期：付款及交期书面约定，定制订单签样后安排交付。\n质量与售后：按确认样品及资料验收。保修、退换货和责任边界按合同执行。\n医疗器械的品牌标识、包装及说明书按适用法规审核。定制报价不改变注册产品信息，专项设计、打样及超出基础配置的制作另行约定。'
}function changeQuoteType() { quoteForm.brandId = quoteForm.quoteType === 'own' && ownBrands.value.length === 1 ? ownBrands.value[0].id : ''; quoteForm.terms = defaultTerms(quoteForm.quoteType) }
function ruleForLine(line: AnyRow) { return line.matchedRule || null }
async function refreshQuoteRule(line: AnyRow) {
  const sequence = (line.matchSequence || 0) + 1
  line.matchSequence = sequence; line.matchedRule = null; line.matchError = ''; line.matchLoading = false
  if (!line.variantId || !quoteForm.brandId || (quoteForm.quoteType === 'private' && !quoteForm.customerId)) return
  line.matchLoading = true
  const params = new URLSearchParams({ quoteType: quoteForm.quoteType, variantId: line.variantId, brandId: quoteForm.brandId })
  if (quoteForm.quoteType === 'private') params.set('customerId', quoteForm.customerId)
  try {
    const result = await api<{ rule: AnyRow | null }>(`/rule-match?${params}`)
    if (line.matchSequence !== sequence) return
    line.matchedRule = result.rule
    line.saveAsCommon = canManage.value && line.productKind !== 'bundle' && !result.rule
  } catch (e) { if (line.matchSequence === sequence) line.matchError = e instanceof Error ? e.message : '价格规则匹配失败' }
  finally { if (line.matchSequence === sequence) line.matchLoading = false }
}
function parsePositiveIntegers(value: string) {
  const pieces = value.split(',').map((v) => v.trim())
  if (!pieces.length || pieces.some((v) => !/^\d+$/.test(v) || Number(v) < 1)) throw new Error('数量档只能填写正整数，使用逗号分隔')
  const parsed = pieces.map(Number)
  if (parsed.some((quantity, index) => index > 0 && quantity <= parsed[index - 1])) throw new Error('数量档请按从小到大填写，且不能重复')
  return parsed
}
async function createQuote() {
  try {
    const lines = quoteForm.items.map((line: AnyRow) => {
      if (line.matchLoading) throw new Error('正在匹配价格规则，请稍后再生成报价')
      if (line.matchError) throw new Error(`价格规则匹配失败：${line.matchError}`)
      const quantities = parsePositiveIntegers(line.quantities)
      if (!quantities.length) throw new Error('每个商品至少输入一个正整数数量档')
      const hasRule = ruleForLine(line)
      const manualValues = line.manualPrices ? line.manualPrices.split(',').map((x: string) => x.trim()) : []
      const manualMode = hasRule ? line.priceSource === 'manual' : !line.saveAsCommon
      if (manualMode && manualValues.length !== quantities.length) throw new Error('本次人工报价必须为每个数量档填写一个价格')
      const manualPrices = manualMode ? quantities.map((quantity: number, index: number) => ({ quantity, unitPrice: manualValues[index] })) : []
      const ruleDraft = !hasRule && line.saveAsCommon ? { quantityMode: line.quantityMode, tiers: line.tiers.map((t: AnyRow) => ({ ...t, maxQuantityExclusive: t.maxQuantityExclusive == null || t.maxQuantityExclusive === '' ? null : Number(t.maxQuantityExclusive) })) } : undefined
      return { variantId: line.variantId, quantities, manualPrices, ruleDraft, retailPriceMode: line.retailPriceMode, manualRetailPrice: line.manualRetailPrice, suggestedFirstQuantity: line.suggestedFirstQuantity }
    })
    await api('/quotes', { method: 'POST', body: body({ ...quoteForm, items: lines }) })
    showQuote.value = false; await loadAll(); ElMessage.success('报价草稿已生成')
  } catch (e) { notifyError(e) }
}
async function submitQuote(quote: AnyRow) {
  try { await api(`/quotes/${quote.id}/submit`, { method: 'POST' }); await loadAll(); ElMessage.success('已提交确认') } catch (e) { notifyError(e) }
}
async function recalculateQuote(quote: AnyRow) {
  try { await api(`/quotes/${quote.id}/recalculate`, { method: 'POST' }); await loadAll(); ElMessage.success('已按当前价格规则重新生成，请重新提交确认') } catch (e) { notifyError(e) }
}
async function confirmItem(quote: AnyRow, item: AnyRow) {
  try { selectedQuote.value = await api(`/quotes/${quote.id}/items/${item.id}/confirm`, { method: 'POST' }); showReview.value = true; await loadAll(); ElMessage.success('产品价格已确认') } catch (e) { notifyError(e) }
}
async function changePrices(quote: AnyRow, item: AnyRow) {
  try {
    const result = await ElMessageBox.prompt(`按数量档顺序输入单价，使用逗号分隔：${item.tiers.map((t: AnyRow) => t.quantity).join('、')}`, '修改报价价格', { inputValue: item.tiers.map((t: AnyRow) => t.unitPrice).join(','), confirmButtonText: '保存', cancelButtonText: '取消' })
    const values = result.value.split(',').map((v: string) => v.trim())
    if (values.length !== item.tiers.length || values.some((v: string) => v === '' || !Number.isFinite(Number(v)) || Number(v) < 0)) throw new Error('请为每个数量档填写非负价格')
    selectedQuote.value = await api(`/quotes/${quote.id}/items/${item.id}/prices`, { method: 'PUT', body: body({ prices: item.tiers.map((t: AnyRow, i: number) => ({ id: t.id, unitPrice: values[i] })) }) })
    await loadAll(); ElMessage.success('报价价格已更新')
  } catch (e) { if (e !== 'cancel' && e !== 'close') notifyError(e) }
}
async function removeQuote(quote: AnyRow, mode: 'delete' | 'void') {
  try {
    await ElMessageBox.confirm(mode === 'delete' ? '确定删除该报价单？删除后无法恢复。' : '确定将该报价单设为失效？', mode === 'delete' ? '删除报价' : '失效报价', { type: 'warning' })
    await api(`/quotes/${quote.id}${mode === 'void' ? '/void' : ''}`, { method: mode === 'void' ? 'POST' : 'DELETE' })
    await loadAll(); ElMessage.success(mode === 'delete' ? '报价已删除' : '报价已失效')
  } catch (e) { if (e !== 'cancel' && e !== 'close') notifyError(e) }
}
async function exportQuote(quote: AnyRow) {
  try {
    const response = await fetch('/api/quotes/export', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` }, body: body({ ids: [quote.id] }) })
    if (!response.ok) { const e = await response.json(); throw new Error(e.message || '导出失败') }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${quote.quoteNumber}.xlsx`; a.click(); URL.revokeObjectURL(url)
  } catch (e) { notifyError(e) }
}
async function updateRole(role: AnyRow) {
  try { const updated = await api<AnyRow>(`/admin/roles/${role.id}`, { method: 'PATCH', body: body({ permissions: role.permissions }) }); Object.assign(role, updated); ElMessage.success('角色权限已保存') } catch (e) { notifyError(e) }
}
async function createUser() {
  try { await api('/admin/users', { method: 'POST', body: body(userForm) }); Object.assign(userForm, { username: '', displayName: '', password: '', roleIds: [] }); await loadAll(); ElMessage.success('用户已创建') } catch (e) { notifyError(e) }
}
function kindLabel(kind: string) { return ({ product: '标品', accessory: '配件', bundle: '组合商品' } as AnyRow)[kind] || kind }
function statusLabel(status: string) { return ({ draft: '草稿', pending: '待确认', confirmed: '已确认', void: '已失效' } as AnyRow)[status] || status }
function money(value: string | number) { return `¥${Number(value || 0).toFixed(2)}` }
const tierNumberFormatter = new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })
function formatTierValue(value: string | number) { const number = Number(value); return Number.isFinite(number) ? tierNumberFormatter.format(number) : '—' }
function priceLabel(value: string | number | null | undefined) { return value == null || value === '' ? '未维护' : money(value) }
function openBom(variant: AnyRow) {
  const product = products.value.find((p) => p.variants?.some((v: AnyRow) => v.id === variant.id))
  const existing = (product?.components || []).filter((component: AnyRow) => component.parentVariantId === variant.id).map((component: AnyRow) => ({ variantId: component.componentVariantId, quantity: Number(component.quantity) }))
  Object.assign(bomForm, { parentVariantId: variant.id, components: existing.length ? existing : [{ variantId: '', quantity: 1 }] })
  showBom.value = true
}
async function saveBom() {
  try { await api(`/variants/${bomForm.parentVariantId}/components`, { method: 'PUT', body: body({ components: bomForm.components }) }); showBom.value = false; await loadAll(); ElMessage.success('组成关系已保存') } catch (e) { notifyError(e) }
}
</script>

<template>
  <main v-if="!token || !me" class="login-shell">
    <section class="login-card">
      <div class="brand-mark">Y</div>
      <div class="eyebrow">PRODUCT · PRICE · QUOTE</div>
      <h1>产品与报价管理</h1>
      <p class="muted">统一产品资料，按规则生成报价，并由负责人逐项确认。</p>
      <el-form label-position="top" @submit.prevent="login">
        <el-form-item label="账号"><el-input v-model="loginForm.username" autocomplete="username" placeholder="输入账号" @keyup.enter="login" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="loginForm.password" type="password" show-password autocomplete="current-password" placeholder="输入密码" @keyup.enter="login" /></el-form-item>
        <el-button type="primary" class="full" size="large" @click="login">登录系统</el-button>
      </el-form>
      <div class="login-foot">内网业务系统 · 人工确认后对外报价</div>
    </section>
  </main>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="side-brand"><div class="brand-mark small">Y</div><div><strong>毅诺 PLM</strong><span>产品与报价管理</span></div></div>
      <div class="nav-caption">工作台</div>
      <button v-for="entry in navigation" :key="entry.id" class="nav-item" :class="{active:section===entry.id}" :aria-current="section===entry.id ? 'page' : undefined" @click="section=entry.id">
        <svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="entry.icon" /></svg><span class="nav-label">{{ entry.label }}</span><span v-if="entry.id==='quotes' && quotePendingTotal > 0" class="nav-count">{{ quotePendingTotal }}</span>
      </button>
      <div v-if="canAdmin" class="nav-caption settings-caption">管理</div>
      <button v-if="canAdmin" class="nav-item" :class="{active:section==='settings'}" :aria-current="section==='settings' ? 'page' : undefined" @click="section='settings'"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="navIcons.settings" /></svg><span class="nav-label">用户与权限</span></button>
      <div class="side-bottom"><div class="online-dot"></div><span>连接内网工作区</span></div>
    </aside>

    <section class="main-column">
      <header class="topbar">
        <div><div class="crumb">PLM <span>/</span> {{ ({overview:'总览',products:'产品资料',customers:'客户与品牌',pricing:'价格规则',quotes:'客户报价',settings:'用户与权限'} as AnyRow)[section] }}</div><h2>{{ ({overview:'业务概览',products:'产品资料',customers:'客户与品牌',pricing:'阶梯价格规则',quotes:'报价单管理',settings:'用户与权限'} as AnyRow)[section] }}</h2></div>
        <div class="user-menu"><div class="avatar">{{ me.displayName?.slice(0,1) || 'U' }}</div><div><strong>{{ me.displayName }}</strong><span>{{ me.roles?.join(' · ') }}</span></div><el-button text @click="loadAll">刷新</el-button><el-button text @click="logout">退出</el-button></div>
      </header>

      <div class="page-content" v-loading="loading">
        <template v-if="section==='overview'">
          <div class="welcome-row"><div><h1>把每一份报价，做到心中有数。</h1><p>从待办开始，查看客户报价与业务资料。</p></div><el-button v-if="has('quote:create')" type="primary" size="large" @click="openQuote">＋ 新建报价</el-button></div>
          <div class="stat-grid"><article v-for="tile in tiles" :key="tile.label" class="stat-card" :class="{attention:tile.label==='待确认报价'}"><span>{{ tile.label }}<i v-if="tile.label==='待确认报价' && tile.value" class="attention-dot" /></span><strong>{{ tile.value }}</strong><small>{{ tile.note }}</small><button v-if="tile.label==='待确认报价' && tile.value" class="stat-action" @click="section='quotes'">去处理 →</button></article></div>
          <div class="overview-grid">
            <section class="panel task-panel"><div class="panel-heading"><h3>今天先处理这些</h3></div>
              <div class="task-highlight"><span class="task-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h5" /></svg></span><div><strong>{{ quotePendingTotal }}{{ quotePendingTotal ? ' 份报价等待确认' : '当前没有待确认报价' }}</strong><p>{{ quotePendingTotal ? '逐个产品核对所有数量档，再导出对外报价。' : '待确认报价会在提交后显示于此。' }}</p></div><el-button plain :disabled="!quotePendingTotal" @click="section='quotes'">查看待确认 <span aria-hidden="true">→</span></el-button></div>
              <div class="task-bottom">报价按产品逐项确认，确认后可导出 Excel。</div>
            </section>
            <section class="panel shortcuts"><div class="panel-heading"><h3>常用入口</h3></div><div class="shortcut-grid"><button @click="section='products'"><strong>产品资料</strong><small>查商品、规格与组成</small><span aria-hidden="true">→</span></button><button v-if="navigation.some(entry=>entry.id==='pricing')" @click="section='pricing'"><strong>价格规则</strong><small>维护品牌阶梯价格</small><span aria-hidden="true">→</span></button><button @click="section='customers'"><strong>客户与品牌</strong><small>管理客户及品牌归属</small><span aria-hidden="true">→</span></button></div></section>
          </div>
          <section class="panel recent-panel"><div class="panel-heading"><h3>最近报价</h3><el-button text @click="section='quotes'">查看全部 →</el-button></div><el-table v-if="recentQuotes.length" :data="recentQuotes" class="recent-quotes-table" style="width:100%">
            <el-table-column label="报价单号 / 日期" min-width="195"><template #default="{row}"><strong class="quote-number">{{ row.quoteNumber }}</strong><small class="table-sub">{{ row.quoteDate }}</small></template></el-table-column>
            <el-table-column label="客户 / 品牌" min-width="200"><template #default="{row}"><strong>{{ row.customerSnapshot?.name }}</strong><small class="table-sub">{{ row.brandSnapshot?.name }}</small></template></el-table-column>
            <el-table-column label="报价类型" width="130"><template #default="{row}">{{ row.quoteType==='own'?'自有品牌':'客户贴牌' }}</template></el-table-column>
            <el-table-column label="产品数" width="90" align="right"><template #default="{row}">{{ row.itemCount || 0 }} 款</template></el-table-column>
            <el-table-column label="状态" width="105"><template #default="{row}"><el-tag :type="row.status==='confirmed'?'success':row.status==='pending'?'warning':'info'" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="125" align="right"><template #default="{row}"><el-button link type="primary" @click="openQuoteDetails(row)">{{ row.status==='pending' && canConfirm ? '核对报价' : '查看详情' }} →</el-button></template></el-table-column>
          </el-table><el-empty v-else description="还没有报价记录" :image-size="72" /></section>
        </template>

        <template v-else-if="section==='products'">
          <div class="toolbar"><div><p class="section-lead">产品、配件和组合商品共用商品资料，并按规格分别报价。</p></div><div class="product-toolbar-actions"><el-input v-model="productSearch" clearable placeholder="搜索型号、名称、规格或备注" aria-label="搜索商品" /><el-button v-if="has('catalog:write')" type="primary" @click="openProduct">＋ 新增商品</el-button></div></div>
          <section class="panel table-panel"><el-table :data="products" stripe class="product-table" style="width:100%" :row-class-name="({row}: AnyRow) => row.kind === 'bundle' ? '' : 'no-expand'">
            <el-table-column label="图片" width="78"><template #default="{row}"><el-image v-if="row.imagePath" :src="row.imagePath" :preview-src-list="[row.imagePath]" preview-teleported fit="contain" class="product-thumb" :alt="row.name" /><div v-else class="product-thumb placeholder">{{ row.name?.slice(0,1) }}</div></template></el-table-column>
            <el-table-column label="商品" min-width="180"><template #default="{row}"><div class="product-cell"><div><strong class="product-name" :title="row.name">{{ row.name }}</strong><small>{{ row.sku }}</small></div></div></template></el-table-column>
            <el-table-column label="类型" width="125"><template #default="{row}"><el-tag effect="plain">{{ kindLabel(row.kind) }}</el-tag></template></el-table-column>
            <el-table-column type="expand" width="48"><template #default="{row}"><div v-if="row.kind==='bundle'" class="dialog-hint"><div v-for="c in row.components" :key="c.id">{{ c.componentSku || '—' }} · {{ c.componentName || '未知商品' }} × {{ c.quantity }}</div><span v-if="!row.components.length">尚未维护组成</span></div></template></el-table-column>
            <el-table-column label="规格" min-width="180"><template #default="{row}"><el-tooltip v-if="row.variants?.length" placement="top" effect="dark" :show-after="300"><template #content><div class="product-spec-tooltip">{{ row.variants.map((v: AnyRow) => v.specification).join('\n') }}</div></template><button type="button" class="product-spec-ellipsis" :aria-label="`查看${row.name}的完整规格`" @click="specProduct=row">{{ row.variants.map((v: AnyRow) => v.specification).join('；') }}</button></el-tooltip><span v-else>—</span></template></el-table-column>
            <el-table-column label="单位" width="90"><template #default="{row}"><div v-for="v in row.variants" :key="v.id">{{ v.unit }}</div></template></el-table-column>
            <el-table-column label="采购基准价（含税） / 标准市场零售价" min-width="230"><template #default="{row}"><div v-for="v in row.variants" :key="v.id" class="price-line"><template v-if="has('cost:view') || has('price:manage')">{{ priceLabel(basePrices.find(x=>x.variantId===v.id)?.purchasePrice) }} · {{ priceLabel(basePrices.find(x=>x.variantId===v.id)?.standardRetailPrice) }}</template><span v-else class="muted">按权限查看</span><el-button v-if="has('price:manage')" link type="primary" @click="openBase(v)">维护</el-button></div></template></el-table-column>
            <el-table-column label="状态" width="95"><template #default="{row}"><span class="status-dot" :class="{off:!row.active}"></span>{{ row.active?'启用':'失效' }}</template></el-table-column>
          <el-table-column label="操作" width="270" fixed="right"><template #default="{row}"><el-button link type="primary" @click="detailProduct=row">详情</el-button><template v-if="has('catalog:write')"><el-button v-if="row.kind==='bundle' && row.variants.length" link type="primary" @click="openBom(row.variants[0])">组成</el-button><el-button link type="primary" @click="editProduct(row)">编辑</el-button><el-button link :type="row.active ? 'warning' : 'success'" @click="setProductActive(row)">{{ row.active ? '失效' : '启用' }}</el-button><el-button link type="danger" @click="deleteProduct(row)">删除</el-button></template></template></el-table-column></el-table><el-pagination v-if="productTotal" v-model:current-page="productPage" v-model:page-size="productPageSize" :page-sizes="[10, 20, 50]" :total="productTotal" layout="total, sizes, prev, pager, next" class="product-pagination" /></section>
        </template>

        <template v-else-if="section==='customers'">
          <div class="toolbar"><p class="section-lead">客户有实际报价需求时再维护对应商品的贴牌规则。</p><div><el-button v-if="has('catalog:write')" @click="openBrand">＋ 新增品牌</el-button><el-button v-if="has('catalog:write')" type="primary" @click="openCustomer">＋ 新增客户</el-button></div></div>
          <div class="customer-grid"><article v-for="c in customers" :key="c.id" class="customer-card"><div class="customer-top"><div class="customer-avatar">{{ c.name.slice(0,1) }}</div><el-tag :type="c.active?'success':'info'" effect="plain">{{ c.active?'合作中':'已停用' }}</el-tag></div><h3>{{ c.name }}</h3><p>{{ c.contact || '未填写联系人' }}<span v-if="c.phone"> · {{ c.phone }}</span></p><div class="brand-chips"><span v-for="b in brands.filter(x=>x.customerId===c.id)" :key="b.id">{{ b.name }}<el-button v-if="has('catalog:write')" link @click="editBrand(b)">编辑</el-button></span><small v-if="!brands.some(x=>x.customerId===c.id)">尚未添加客户品牌</small></div><footer><span>{{ customerQuoteCounts.find(q=>q.customerId===c.id)?.count || 0 }} 份报价记录</span><span>{{ customerRuleCounts.find(r=>r.customerId===c.id)?.count || 0 }} 条贴牌规则</span></footer><el-button v-if="has('catalog:write')" link @click="editCustomer(c)">编辑客户</el-button></article><el-empty v-if="!customers.length" description="录入客户后，可按实际报价逐步维护专属价格" /></div>
          <section class="panel brand-panel"><div class="panel-heading"><div><div class="eyebrow">BRAND DIRECTORY</div><h3>自有品牌</h3></div></div><div class="brand-list"><div v-for="b in ownBrandDirectory" :key="b.id" class="brand-chip"><span class="brand-glyph">Y</span><strong>{{ b.name }}</strong><small>{{ b.active ? '自有品牌' : '已停用' }}</small><el-button v-if="has('catalog:write')" link @click="editBrand(b)">编辑</el-button></div><el-empty v-if="!ownBrandDirectory.length" description="添加公司自有品牌" :image-size="56" /></div></section>
        </template>

        <template v-else-if="section==='pricing'">
          <div class="toolbar"><div><p class="section-lead">每档可以固定设价、加固定金额、加百分比或打折；支持整批和分段计价。</p></div><div class="product-toolbar-actions"><el-input v-model="ruleSearch" clearable placeholder="搜索型号、名称、规格、品牌或客户" aria-label="搜索价格规则" /><el-button v-if="canManage" type="primary" @click="openRule">＋ 新增价格规则</el-button></div></div>
          <div class="callout"><strong>按需建价</strong><span>首次报价可设置价格阶梯并保存为常用规则。</span></div>
          <section class="panel table-panel"><el-table :data="rules" stripe style="width:100%" class="rule-table" v-loading="rulesLoading" :empty-text="ruleSearch ? '没有匹配的价格规则' : '尚未建立价格规则'">
            <el-table-column label="报价范围" min-width="160"><template #default="{row}"><div class="rule-scope"><strong>{{ row.quoteType==='own'?'自有品牌':'客户贴牌' }}</strong><small class="table-sub" :title="brands.find(x=>x.id===row.brandId)?.name">{{ brands.find(x=>x.id===row.brandId)?.name }}</small><small v-if="row.customerId" class="table-sub" :title="customers.find(x=>x.id===row.customerId)?.name">{{ customers.find(x=>x.id===row.customerId)?.name }}</small></div></template></el-table-column>
            <el-table-column label="商品规格" min-width="210"><template #default="{row}"><div v-if="row.product" class="rule-product"><strong :title="`${row.product.sku} · ${row.product.name}`">{{ row.product.sku }} · {{ row.product.name }}</strong><el-tooltip v-if="row.variant" placement="top" effect="dark" :show-after="300"><template #content><div class="product-spec-tooltip">{{ row.variant.specification }} / {{ row.variant.unit }}</div></template><button type="button" class="product-spec-ellipsis rule-spec" :aria-label="`查看${row.product.name}的完整规格`" @click="specProduct={...row.product,variants:[row.variant]}">{{ row.variant.specification }} / {{ row.variant.unit }}</button></el-tooltip></div><span v-else>—</span></template></el-table-column>
            <el-table-column label="计价方式" width="110"><template #default="{row}">{{ row.quantityMode==='whole'?'整批':'分段' }}</template></el-table-column>
            <el-table-column label="价格阶梯" min-width="300"><template #default="{row}"><button v-if="row.tiers.length" type="button" class="rule-tier-preview" :aria-label="`查看${row.product?.name || '商品'}的全部${row.tiers.length}档价格`" @click="tierDetailRule=row"><span class="rule-tier-first"><span class="rule-tier-label">首档</span><span class="rule-tier-range">数量 {{ row.tiers[0].minQuantity }}{{ row.tiers[0].maxQuantityExclusive ? '–' + (row.tiers[0].maxQuantityExclusive-1) : ' 起' }}</span><span class="rule-tier-divider">·</span><span class="rule-tier-method">{{ ({fixed:'固定单价',add:'基准价 + 金额',markup:'基准价加价',discount:'基准价折扣'} as AnyRow)[row.tiers[0].method] }}</span><strong class="rule-tier-value">{{ formatTierValue(row.tiers[0].value) }}{{ row.tiers[0].method==='markup'||row.tiers[0].method==='discount'?'%':' 元' }}</strong></span><span class="rule-tier-action">共 {{ row.tiers.length }} 档 · 查看完整价格阶梯 <span aria-hidden="true">→</span></span></button><span v-else>—</span></template></el-table-column>
            <el-table-column v-if="canManage" label="操作" width="140" fixed="right"><template #default="{row}"><el-button link type="primary" @click="editRule(row)">编辑</el-button><el-button link type="danger" @click="deleteRule(row)">删除</el-button></template></el-table-column>
          </el-table><el-pagination v-if="ruleTotal" v-model:current-page="rulePage" v-model:page-size="rulePageSize" :page-sizes="[10, 20, 50]" :total="ruleTotal" layout="total, sizes, prev, pager, next" class="product-pagination" /></section>
        </template>

        <template v-else-if="section==='quotes'">
          <div class="toolbar"><p class="section-lead">查看报价单及其产品、价格与确认状态。</p><div class="product-toolbar-actions"><el-input v-model="quoteSearch" clearable placeholder="搜索单号、客户、品牌、型号或商品" aria-label="搜索客户报价" /><el-button v-if="has('quote:create')" type="primary" @click="openQuote">＋ 新建报价</el-button></div></div>
          <section class="panel table-panel"><el-table :data="quotes" stripe class="quote-table" style="width:100%" v-loading="quotesLoading" :empty-text="quoteSearch ? '没有匹配的报价单' : '尚未创建报价单'">
            <el-table-column label="报价单号 / 日期" min-width="190"><template #default="{row}"><div class="quote-table-text"><strong class="quote-number" :title="row.quoteNumber">{{ row.quoteNumber }}</strong><small class="table-sub">{{ row.quoteDate }}</small></div></template></el-table-column>
            <el-table-column label="客户 / 品牌" min-width="170"><template #default="{row}"><div class="quote-table-text"><strong :title="row.customerSnapshot?.name">{{ row.customerSnapshot?.name }}</strong><small class="table-sub" :title="row.brandSnapshot?.name">{{ row.brandSnapshot?.name }}</small></div></template></el-table-column>
            <el-table-column label="报价类型" width="105"><template #default="{row}">{{ row.quoteType==='own'?'自有品牌':'客户贴牌' }}</template></el-table-column>
            <el-table-column label="商品" min-width="190"><template #default="{row}"><div class="quote-table-text"><strong :title="row.items.map((item: AnyRow) => `${item.productSnapshot?.sku} · ${item.productSnapshot?.name}`).join('；')">{{ row.items.map((item: AnyRow) => item.productSnapshot?.name).join('、') || '—' }}</strong><small class="table-sub">{{ row.items.length }} 款商品</small></div></template></el-table-column>
            <el-table-column label="有效期至" width="110"><template #default="{row}">{{ row.expiresAt }}</template></el-table-column>
            <el-table-column label="状态" width="105"><template #default="{row}"><el-tag :type="row.status==='confirmed'?'success':row.status==='pending'?'warning':'info'" effect="plain">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="355" fixed="right"><template #default="{row}"><div class="quote-table-actions"><el-button link type="primary" @click="openQuoteDetails(row)">详情</el-button><el-button v-if="has('quote:create') && (row.status==='draft' || row.status==='pending')" link type="primary" @click="recalculateQuote(row)">规则重算</el-button><el-button v-if="has('quote:create') && row.status==='confirmed'" link type="primary" @click="exportQuote(row)">导出</el-button><el-button v-else-if="row.status==='draft' && has('quote:create')" link type="primary" @click="submitQuote(row)">提交确认</el-button><el-button v-else-if="row.status==='pending' && canConfirm" link type="primary" @click="openQuoteDetails(row)">查看并确认</el-button><el-button v-if="has('quote:create') && (row.status==='draft' || row.status==='void')" link type="danger" @click="removeQuote(row,'delete')">删除</el-button><el-button v-if="has('quote:create') && row.status!=='void'" link type="danger" @click="removeQuote(row,'void')">失效</el-button><el-button v-if="has('quote:create') && row.status==='confirmed'" link type="primary" @click="api(`/quotes/${row.id}/duplicate`,{method:'POST'}).then(loadAll).catch(notifyError)">复制新版本</el-button></div></template></el-table-column>
          </el-table><el-pagination v-if="quoteTotal" v-model:current-page="quotePage" v-model:page-size="quotePageSize" :page-sizes="[10,20,50]" :total="quoteTotal" layout="total, sizes, prev, pager, next" class="product-pagination" /></section>
        </template>

        <template v-else-if="section==='settings' && canAdmin">
          <div class="settings-grid"><section class="panel"><div class="panel-heading"><div><div class="eyebrow">ACCESS CONTROL</div><h3>角色权限</h3></div></div><article v-for="role in roles" :key="role.id" class="role-row"><div class="role-head"><strong>{{ role.label }}</strong><span>{{ role.name }}</span></div><el-checkbox-group v-model="role.permissions"><el-checkbox v-for="perm in permissions" :key="perm.key" :label="perm.key">{{ perm.label }}</el-checkbox><el-checkbox label="*">全部权限</el-checkbox></el-checkbox-group><el-button size="small" type="primary" @click="updateRole(role)">保存 {{ role.label }} 权限</el-button></article></section>
            <section class="panel"><div class="panel-heading"><div><div class="eyebrow">TEAM</div><h3>新增用户</h3></div></div><el-form label-position="top"><el-form-item label="登录账号"><el-input v-model="userForm.username" /></el-form-item><el-form-item label="姓名"><el-input v-model="userForm.displayName" /></el-form-item><el-form-item label="初始密码（至少 12 位）"><el-input v-model="userForm.password" type="password" show-password /></el-form-item><el-form-item label="分配角色"><el-select v-model="userForm.roleIds" multiple class="full"><el-option v-for="r in roles" :key="r.id" :label="r.label" :value="r.id" /></el-select></el-form-item><el-button type="primary" @click="createUser">创建用户</el-button></el-form><div class="user-list"><div v-for="u in users" :key="u.id"><strong>{{ u.displayName }}</strong><span>{{ u.username }} · {{ u.roles?.map((r:any)=>r.label).join('、') }}</span></div></div></section></div>
        </template>
      </div>
    </section>

    <el-dialog v-model="showProduct" :title="editingProductId ? '编辑商品资料' : '新增商品资料'" width="720px">
      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item label="货号 / 型号"><el-input v-model="productForm.sku" /></el-form-item>
          <el-form-item label="品名"><el-input v-model="productForm.name" /></el-form-item>
          <el-form-item v-if="!editingProductId" label="商品类型"><el-select v-model="productForm.kind" class="full"><el-option label="标品" value="product"/><el-option label="配件" value="accessory"/><el-option label="组合商品" value="bundle"/></el-select></el-form-item>
          <el-form-item v-if="editingProductId" label="商品状态"><el-checkbox v-model="productForm.active">启用（停用后不可用于新报价）</el-checkbox></el-form-item>
          <el-form-item label="规格" class="span-two"><el-input v-model="productForm.variants[0].specification" /></el-form-item>
          <el-form-item label="单位" class="span-two"><el-input v-model="productForm.variants[0].unit" placeholder="套、台、只" /></el-form-item>
          <el-form-item label="图片（JPEG / PNG / WebP，最大 5 MB）" class="span-two"><input type="file" accept="image/jpeg,image/png,image/webp" @change="imageFile=($event.target as HTMLInputElement).files?.[0] || null" /></el-form-item>
          <el-form-item label="备注" class="span-two"><el-input v-model="productForm.description" type="textarea" :rows="2" /></el-form-item>
        </div>
      </el-form>
      <template #footer><el-button @click="showProduct=false">取消</el-button><el-button type="primary" @click="saveProduct">{{ editingProductId ? '保存修改' : '保存商品' }}</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!specProduct" title="商品规格" width="min(620px, 94%)" @close="specProduct=null">
      <template v-if="specProduct"><strong>{{ specProduct.sku }} · {{ specProduct.name }}</strong><p v-for="v in specProduct.variants" :key="v.id" class="product-detail-text">{{ v.specification || '未填写' }}</p></template>
      <template #footer><el-button @click="specProduct=null">关闭</el-button></template>
    </el-dialog>
    <el-dialog :model-value="!!tierDetailRule" title="价格阶梯" width="min(620px, 94%)" @close="tierDetailRule=null">
      <template v-if="tierDetailRule"><strong>{{ tierDetailRule.product?.sku }} · {{ tierDetailRule.product?.name }}</strong><p class="muted">{{ tierDetailRule.quoteType === 'own' ? '自有品牌' : '客户贴牌' }} · {{ tierDetailRule.quantityMode === 'whole' ? '整批计价' : '分段计价' }}</p><div v-for="t in tierDetailRule.tiers" :key="t.id" class="tier-summary rule-tier-detail"><span>{{ t.minQuantity }}–{{ t.maxQuantityExclusive ? t.maxQuantityExclusive-1 : '以上' }}</span><b>{{ ({fixed:'固定单价',add:'基准价 + 金额',markup:'基准价加价',discount:'基准价折扣'} as AnyRow)[t.method] }}</b><strong>{{ formatTierValue(t.value) }}{{ t.method==='markup'||t.method==='discount'?'%':' 元' }}</strong></div></template>
      <template #footer><el-button @click="tierDetailRule=null">关闭</el-button></template>
    </el-dialog>
    <el-drawer :model-value="!!detailProduct" title="商品详情" size="min(620px, 95%)" @close="detailProduct=null">
      <template v-if="detailProduct">
        <div class="product-detail-header"><el-image v-if="detailProduct.imagePath" :src="detailProduct.imagePath" :preview-src-list="[detailProduct.imagePath]" preview-teleported fit="contain" class="product-detail-image" :alt="detailProduct.name" /><div v-else class="product-detail-image placeholder">暂无图片</div><div><h3>{{ detailProduct.name }}</h3><p>{{ detailProduct.sku }}</p><el-tag effect="plain">{{ kindLabel(detailProduct.kind) }}</el-tag> <el-tag :type="detailProduct.active ? 'success' : 'info'" effect="plain">{{ detailProduct.active ? '启用' : '失效' }}</el-tag></div></div>
        <section v-for="v in detailProduct.variants" :key="v.id" class="product-detail-section"><h4>规格与单位</h4><p class="product-detail-text">{{ v.specification || '未填写' }}</p><p>单位：{{ v.unit || '未填写' }}</p><template v-if="has('cost:view') || has('price:manage')"><p>采购基准价（含税）：{{ priceLabel(basePrices.find(x=>x.variantId===v.id)?.purchasePrice) }}</p><p>标准市场零售价：{{ priceLabel(basePrices.find(x=>x.variantId===v.id)?.standardRetailPrice) }}</p></template></section>
        <section class="product-detail-section"><h4>备注</h4><p class="product-detail-text">{{ detailProduct.description || '未填写' }}</p></section>
        <section v-if="detailProduct.kind==='bundle'" class="product-detail-section"><h4>组成</h4><p v-for="c in detailProduct.components" :key="c.id">{{ c.componentSku || '—' }} · {{ c.componentName || '未知商品' }} × {{ c.quantity }}</p><p v-if="!detailProduct.components?.length">尚未维护组成</p></section>
      </template>
    </el-drawer>
    <el-dialog v-model="showCustomer" :title="editingCustomerId ? '编辑客户' : '新增客户'" width="520px">
      <el-form label-position="top">
        <el-form-item label="客户名称"><el-input v-model="customerForm.name" /></el-form-item>
        <div class="form-grid"><el-form-item label="联系人"><el-input v-model="customerForm.contact" /></el-form-item><el-form-item label="联系电话"><el-input v-model="customerForm.phone" /></el-form-item></div>
        <el-form-item label="备注"><el-input v-model="customerForm.notes" type="textarea" /></el-form-item>
        <el-form-item v-if="editingCustomerId" label="客户状态"><el-checkbox v-model="customerForm.active">合作中（取消后不可创建新报价）</el-checkbox></el-form-item>
      </el-form>
      <template #footer><el-button @click="showCustomer=false">取消</el-button><el-button type="primary" @click="saveCustomer">保存客户</el-button></template>
    </el-dialog>
    <el-dialog v-model="showBrand" :title="editingBrandId ? '编辑品牌' : '新增品牌'" width="460px">
      <el-form label-position="top">
        <el-form-item v-if="!editingBrandId" label="品牌类型"><el-radio-group v-model="brandForm.kind"><el-radio-button value="own">自有品牌</el-radio-button><el-radio-button value="customer">客户贴牌</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="品牌名称"><el-input v-model="brandForm.name" /></el-form-item>
        <el-form-item v-if="!editingBrandId && brandForm.kind==='customer'" label="所属客户"><el-select v-model="brandForm.customerId" class="full"><el-option v-for="c in activeCustomers" :key="c.id" :label="c.name" :value="c.id" /></el-select></el-form-item>
        <el-form-item v-if="editingBrandId" label="品牌状态"><el-checkbox v-model="brandForm.active">启用（停用后不可用于新报价）</el-checkbox></el-form-item>
      </el-form>
      <template #footer><el-button @click="showBrand=false">取消</el-button><el-button type="primary" @click="saveBrand">保存品牌</el-button></template>
    </el-dialog>
    <el-dialog v-model="showBase" title="维护基础价格" width="480px"><p class="dialog-hint">空值代表尚未维护。</p><el-form label-position="top"><el-form-item label="采购基准价（含税）（元）"><el-input v-model="baseForm.purchasePrice" placeholder="可留空" /></el-form-item><el-form-item label="标准市场零售价（元）"><el-input v-model="baseForm.standardRetailPrice" placeholder="可留空" /></el-form-item></el-form><template #footer><el-button @click="showBase=false">取消</el-button><el-button type="primary" @click="saveBase">保存价格</el-button></template></el-dialog>
    <el-dialog v-model="showBom" title="维护商品组成" width="620px"><div class="dialog-hint">组合商品可包含产品和配件；首期不支持组合商品嵌套。每套使用量为正数。</div><div v-for="(component,index) in bomForm.components" :key="index" class="bom-row"><ProductSelect v-model="component.variantId" :token="token" :exclude-bundles="true" :exclude-id="bomForm.parentVariantId" placeholder="搜索型号或名称" /><el-input-number v-model="component.quantity" :min="0.0001" :precision="4"/><el-button text type="danger" @click="bomForm.components.splice(index,1)">移除</el-button></div><el-button text type="primary" @click="bomForm.components.push({variantId:'',quantity:1})">＋ 添加组成项</el-button><template #footer><el-button @click="showBom=false">取消</el-button><el-button type="primary" @click="saveBom">保存组成</el-button></template></el-dialog>
    <el-dialog v-model="showRule" :title="editingRuleId ? '编辑阶梯价格规则' : '新增阶梯价格规则'" width="760px" top="5vh"><el-form label-position="top"><div class="form-grid"><el-form-item label="报价类型"><el-select v-model="ruleForm.quoteType" class="full"><el-option label="自有品牌（线下供货）" value="own"/><el-option label="客户贴牌" value="private"/></el-select></el-form-item><el-form-item v-if="ruleForm.quoteType==='private'" label="客户"><el-select v-model="ruleForm.customerId" class="full"><el-option v-for="c in activeCustomers" :key="c.id" :label="c.name" :value="c.id"/></el-select></el-form-item><el-form-item label="品牌"><el-select v-model="ruleForm.brandId" class="full"><el-option v-for="b in ruleBrands" :key="b.id" :label="b.name" :value="b.id"/></el-select></el-form-item><el-form-item label="商品"><ProductSelect v-model="ruleForm.variantId" :token="token" /></el-form-item><el-form-item label="阶梯计价"><el-radio-group v-model="ruleForm.quantityMode"><el-radio-button value="whole">整批</el-radio-button><el-radio-button value="segmented">分段</el-radio-button></el-radio-group></el-form-item></div><div class="tier-editor"><div class="tier-editor-head"><strong>数量阶梯</strong><span>整数数量；区间下限包含，上限不包含。最后一档不限量。</span></div><div v-for="(tier,index) in ruleForm.tiers" :key="index" class="tier-edit-row"><el-input-number v-model="tier.minQuantity" class="tier-min" aria-label="数量档起始数量" :min="1" :disabled="index===0" controls-position="right"/><span class="tier-separator">至</span><el-input v-model="tier.maxQuantityExclusive" class="tier-max" aria-label="下一档起始数量" :placeholder="index===ruleForm.tiers.length-1?'以上':'下一档起始数'"/><el-select v-model="tier.method" class="tier-method" aria-label="计价方式"><el-option label="固定单价" value="fixed"/><el-option label="基准价 + 固定金额" value="add"/><el-option label="基准价加价 %" value="markup"/><el-option label="基准价折扣 %" value="discount"/></el-select><el-input v-model="tier.value" class="tier-value" aria-label="金额或百分比" placeholder="金额 / 百分比"/><el-button v-if="ruleForm.tiers.length>1" class="tier-remove" text type="danger" @click="ruleForm.tiers.splice(index,1)">删除</el-button></div><el-button text type="primary" @click="addTier(ruleForm)">＋ 添加下一数量档</el-button></div></el-form><template #footer><el-button @click="showRule=false">取消</el-button><el-button type="primary" @click="saveRule">保存阶梯规则</el-button></template></el-dialog>

    <el-dialog v-model="showQuote" title="新建客户报价" width="850px" top="4vh"><el-form label-position="top"><div class="form-grid"><el-form-item label="报价类型"><el-select v-model="quoteForm.quoteType" class="full" @change="changeQuoteType"><el-option label="自有品牌" value="own"/><el-option label="客户贴牌" value="private"/></el-select></el-form-item><el-form-item label="客户"><el-select v-model="quoteForm.customerId" class="full"><el-option v-for="c in activeCustomers" :key="c.id" :label="c.name" :value="c.id"/></el-select></el-form-item><el-form-item label="品牌"><el-select v-model="quoteForm.brandId" class="full"><el-option v-for="b in (quoteForm.quoteType==='own'?ownBrands:privateBrands)" :key="b.id" :label="b.name" :value="b.id"/></el-select></el-form-item><el-form-item label="报价日期"><el-date-picker v-model="quoteForm.quoteDate" value-format="YYYY-MM-DD" class="full"/></el-form-item><el-form-item label="报价有效期至"><el-date-picker v-model="quoteForm.expiresAt" value-format="YYYY-MM-DD" class="full"/></el-form-item></div><div class="quote-builder-head"><strong>报价产品与数量档</strong><el-button text type="primary" @click="addQuoteLine">＋ 添加产品</el-button></div><article v-for="(line,index) in quoteForm.items" :key="index" class="builder-line"><div class="builder-line-top"><strong>产品 {{ Number(index)+1 }}</strong><el-button text type="danger" @click="quoteForm.items.splice(index,1)">移除</el-button></div><div class="builder-fields"><ProductSelect v-model="line.variantId" :token="token" @change="selectQuoteVariant(line,$event)" /><el-input v-model="line.quantities" placeholder="数量档：如 500,1000"/><span v-if="line.matchLoading" class="rule-found">正在匹配价格规则…</span><span v-else-if="line.matchError" class="rule-missing">规则匹配失败，请重新选择商品</span><span v-else-if="ruleForLine(line)" class="rule-found">已匹配常用规则 · {{ ruleForLine(line)?.quantityMode==='whole'?'整批':'分段' }}</span><span v-else-if="line.productKind==='bundle'" class="rule-found">组合价按组成项计算参考值</span><span v-else class="rule-missing">尚无规则，设置首次价格</span><el-radio-group v-if="ruleForLine(line)" v-model="line.priceSource" @change="line.saveAsCommon=false"><el-radio-button value="rule">按常用规则</el-radio-button><el-radio-button value="manual">本次人工定价</el-radio-button></el-radio-group><el-input v-model="line.suggestedFirstQuantity" placeholder="建议首批量（正整数，可选）" /></div><div v-if="line.variantId && !line.matchLoading && !line.matchError && (!ruleForLine(line) || line.priceSource==='manual')" class="first-price"><el-checkbox v-if="canManage && !ruleForLine(line) && line.productKind!=='bundle'" v-model="line.saveAsCommon">保存为常用阶梯价格</el-checkbox><el-checkbox v-else-if="canManage && !ruleForLine(line)" v-model="line.saveAsCommon">为组合商品单独设置阶梯价格</el-checkbox><template v-if="line.saveAsCommon"><el-radio-group v-model="line.quantityMode"><el-radio-button value="whole">整批</el-radio-button><el-radio-button value="segmented">分段</el-radio-button></el-radio-group><div v-for="(tier,tIndex) in line.tiers" :key="tIndex" class="tier-edit-row"><el-input-number v-model="tier.minQuantity" class="tier-min" aria-label="数量档起始数量" :min="1" :disabled="tIndex===0" controls-position="right"/><span class="tier-separator">至</span><el-input v-model="tier.maxQuantityExclusive" class="tier-max" aria-label="下一档起始数量" :placeholder="tIndex===line.tiers.length-1?'以上':'下一档起始数'"/><el-select v-model="tier.method" class="tier-method" aria-label="计价方式"><el-option label="固定单价" value="fixed"/><el-option label="基准价 + 固定金额" value="add"/><el-option label="基准价加价 %" value="markup"/><el-option label="基准价折扣 %" value="discount"/></el-select><el-input v-model="tier.value" class="tier-value" aria-label="金额或百分比" placeholder="金额 / 百分比"/><el-button v-if="line.tiers.length>1" class="tier-remove" text type="danger" @click="line.tiers.splice(tIndex,1)">删除</el-button></div><el-button text type="primary" @click="addTier(line)">＋ 添加数量档</el-button></template><el-form-item v-else label="本次固定单价（与上面的数量档顺序对应，逗号分隔）"><el-input v-model="line.manualPrices" placeholder="例如 125,118" /></el-form-item><div class="retail-price-row"><el-select v-model="line.retailPriceMode" clearable placeholder="建议零售价（可选）"><el-option label="出厂价加价 50%" value="50"/><el-option label="出厂价加价 80%" value="80"/><el-option label="出厂价加价 100%" value="100"/><el-option label="出厂价加价 180%" value="180"/><el-option label="单独手工维护" value="manual"/></el-select><el-input v-if="line.retailPriceMode==='manual'" v-model="line.manualRetailPrice" placeholder="手工建议零售价" /></div></div></article><el-form-item label="商务条款"><el-input v-model="quoteForm.terms" type="textarea" :rows="3"/></el-form-item></el-form><template #footer><el-button @click="showQuote=false">取消</el-button><el-button type="primary" @click="createQuote">生成报价草稿</el-button></template></el-dialog>

    

    <el-drawer v-model="showReview" :title="selectedQuote?.status==='pending' && canConfirm ? '报价详情与确认' : '报价详情'" size="min(760px, 100%)"><template v-if="selectedQuote"><div class="quote-detail-heading"><strong>{{ selectedQuote.quoteNumber }}</strong><span>{{ selectedQuote.quoteType==='own' ? '自有品牌' : '客户贴牌' }} · {{ statusLabel(selectedQuote.status) }} · 报价日期 {{ selectedQuote.quoteDate }}</span></div><div class="drawer-summary"><div><span>客户与品牌</span><strong>{{ selectedQuote.customerSnapshot?.name }} · {{ selectedQuote.brandSnapshot?.name }}</strong></div><div><span>报价有效期</span><strong>{{ selectedQuote.expiresAt }}</strong></div></div><section v-for="item in selectedQuote.items" :key="item.id" class="review-item"><div class="review-item-heading"><div><strong>{{ item.productSnapshot?.sku }} · {{ item.productSnapshot?.name }}</strong><small>{{ item.productSnapshot?.specification }} / {{ item.productSnapshot?.unit }}<template v-if="selectedQuote.quoteType==='own' && item.marketRetailPrice"> · 建议零售价 {{ money(item.marketRetailPrice) }}</template></small></div><el-tag :type="item.confirmedAt?'success':'warning'" effect="plain">{{ item.confirmedAt?'已确认':selectedQuote.status==='pending'?'待确认':statusLabel(selectedQuote.status) }}</el-tag></div><div class="review-tiers"><div v-for="tier in item.tiers" :key="tier.id"><span>订购 {{ tier.quantity }} 件</span><strong>{{ money(tier.unitPrice) }} / 件</strong><b>{{ money(tier.totalAmount) }}</b><small v-if="tier.calculation?.segments?.length>1">{{ tier.calculation.segments.map((s:any)=>`${s.quantity}×${s.unitPrice}=${s.amount}`).join(' + ') }}</small></div></div><el-button v-if="selectedQuote.status==='pending' && !item.confirmedAt && canConfirm" @click="changePrices(selectedQuote,item)">修改价格</el-button><el-button v-if="selectedQuote.status==='pending' && !item.confirmedAt && canConfirm" type="primary" @click="confirmItem(selectedQuote,item)">确认此产品的全部档位</el-button></section><div class="terms-preview"><strong>商务条款</strong><p>{{ selectedQuote.terms }}</p></div></template></el-drawer>
  </div>
</template>









