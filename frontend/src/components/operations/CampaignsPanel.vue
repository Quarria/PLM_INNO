<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ProductPicker from './ProductPicker.vue'
import { apiError, can, dateTime, jsonBody, localDateTimeInput, money, opsRequest, pageParams, type Row } from './shared'

const props = defineProps<{ token: string; permissions: string[]; initialProductId?: string }>()
const writable = computed(() => can(props.permissions, 'campaign:write'))
const rows = ref<Row[]>([]), total = ref(0), page = ref(1), size = ref(10), q = ref(''), loading = ref(false)
const stores = ref<Row[]>([]), activeTab = ref('list'), error = ref('')
const showEditor = ref(false), editingId = ref(''), detail = ref<Row | null>(null), stats = ref<Row | null>(null)
const showStore = ref(false), showPreview = ref(false), previewResult = ref<Row | null>(null), previewTarget = ref<Row | null>(null)
const storeForm = reactive({ platform: '', name: '' })
const form = reactive<any>({ name: '', store_id: '', starts_at: '', ends_at: '', notes: '', items: [] as Row[] })
const preview = reactive({ product_id: '', quantity: 1, rule_indexes: [] as number[] })
const statsFilter = reactive({ from: '', to: '', store_id: '' })
let timer: ReturnType<typeof setTimeout> | undefined
const campaignStatus: Record<string, string> = { draft: '草稿', published: '已发布', archived: '已归档', ended: '已结束' }

async function load() {
  loading.value = true; error.value = ''
  try {
    const result = await opsRequest<{ items: Row[]; total: number }>(props.token, `/campaigns?${pageParams(page.value, size.value, q.value)}`)
    rows.value = result.items; total.value = result.total
  } catch (e) { error.value = apiError(e) } finally { loading.value = false }
}
async function loadStores() {
  try { stores.value = await opsRequest<Row[]>(props.token, '/stores') } catch (e) { error.value = apiError(e) }
}
watch(q, () => { clearTimeout(timer); page.value = 1; timer = setTimeout(() => { void load() }, 300) })
watch(page, () => { void load() })
watch(size, () => { page.value = 1; void load() })
onMounted(async () => { await Promise.all([load(), loadStores()]); if (props.initialProductId) openCreate(props.initialProductId) })

function emptyRule() { return { name: '', type: 'fixed', amount: '', threshold: '', cap: '', bearer: 'merchant', exclusive_group: '' } }
function openCreate(productId = '') {
  editingId.value = ''; detail.value = null
  Object.assign(form, { name: '', store_id: '', starts_at: '', ends_at: '', notes: '', items: productId ? [{ product_id: productId, product_label: '', list_price: '', rules: [emptyRule()] }] : [] })
  showEditor.value = true
}
function editCampaign(row: Row) {
  editingId.value = row.id; detail.value = row
  Object.assign(form, { name: row.name, store_id: row.store_id || '', starts_at: row.starts_at ? localDateTimeInput(new Date(row.starts_at)) : '', ends_at: row.ends_at ? localDateTimeInput(new Date(row.ends_at)) : '', notes: row.notes || '', items: (row.items || []).map((item: Row) => ({ ...item, product_label: item.sku ? `${item.sku} · ${item.name}` : '', rules: (item.rules || []).map((rule: Row) => ({ ...rule })) })) })
  showEditor.value = true
}
function addItem(product?: Row | null) {
  const item = { product_id: product?.id || '', product_label: product ? `${product.sku} · ${product.name}` : '', list_price: '', rules: [emptyRule()] }
  form.items.push(item)
}
function addRule(item: Row) { item.rules.push(emptyRule()) }
function removeItem(index: number | string) { form.items.splice(Number(index), 1) }
function removeRule(item: Row, index: number | string) { item.rules.splice(Number(index), 1) }
async function save() {
  if (!form.name.trim() || !form.store_id || !form.items.length || form.items.some((i: Row) => !i.product_id || !i.list_price)) { error.value = '请填写活动名称、店铺、商品和活动标价'; return }
  const payload = { name: form.name.trim(), store_id: form.store_id, starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString(), notes: form.notes, items: form.items.map((item: Row) => ({ product_id: item.product_id, list_price: String(item.list_price), rules: item.rules.map((rule: Row) => ({ name: rule.name, type: rule.type, amount: String(rule.amount), ...(rule.threshold !== '' ? { threshold: String(rule.threshold) } : {}), ...(rule.cap !== '' ? { cap: String(rule.cap) } : {}), bearer: rule.bearer, ...(rule.exclusive_group ? { exclusive_group: rule.exclusive_group } : {}) })) })) }
  loading.value = true; error.value = ''
  try { await opsRequest(props.token, editingId.value ? `/campaigns/${editingId.value}` : '/campaigns', { method: editingId.value ? 'PATCH' : 'POST', body: jsonBody(payload) }); showEditor.value = false; await load(); ElMessage.success('活动已保存') }
  catch (e) { error.value = apiError(e) } finally { loading.value = false }
}
async function createStore() {
  if (!storeForm.platform.trim() || !storeForm.name.trim()) { error.value = '请填写平台和店铺名称'; return }
  loading.value=true
  try { const store = await opsRequest<Row>(props.token, '/stores', { method: 'POST', body: jsonBody(storeForm) }); stores.value.push(store); form.store_id = store.id; showStore.value = false; Object.assign(storeForm, { platform: '', name: '' }); ElMessage.success('店铺已创建') }
  catch (e) { error.value = apiError(e) } finally { loading.value=false }
}
async function changeStatus(row: Row, action: 'publish' | 'archive') {
  error.value = ''; loading.value=true
  try { await opsRequest(props.token, `/campaigns/${row.id}/${action}`, { method: 'POST' }); ElMessage.success(action === 'publish' ? '活动已发布' : '活动已归档'); await load() }
  catch (e) { error.value = apiError(e) } finally { loading.value=false }
}
async function openStats(row: Row) {
  activeTab.value = 'stats'; detail.value = row; Object.assign(statsFilter,{from:'',to:'',store_id:row.store_id||''}); await loadStats()
}
async function loadStats() {
  if(!detail.value)return
  loading.value = true
  const params=new URLSearchParams({campaign_id:detail.value.id});if(statsFilter.from)params.set('from',statsFilter.from);if(statsFilter.to)params.set('to',statsFilter.to);if(statsFilter.store_id)params.set('store_id',statsFilter.store_id)
  try { stats.value = await opsRequest<Row>(props.token, `/campaign-stats?${params}`) }
  catch (e) { error.value = apiError(e) } finally { loading.value = false }
}
function openPreview(item: Row) { previewTarget.value = item; preview.product_id = item.product_id; preview.quantity = 1; preview.rule_indexes = []; previewResult.value = null; showPreview.value = true }
async function calculatePreview() {
  if (!detail.value?.id || !preview.product_id) { error.value = '请先选择活动商品'; return }
  loading.value=true
  try { previewResult.value = await opsRequest<Row>(props.token, `/campaigns/${detail.value.id}/preview`, { method: 'POST', body: jsonBody(preview) }) }
  catch (e) { error.value = apiError(e) } finally { loading.value=false }
}
const statItems = computed(() => stats.value?.items || [])
</script>

<template>
  <section>
    <header class="ops-toolbar">
      <div><div class="eyebrow">COMMERCE / CAMPAIGNS</div><h1>电商活动</h1><p class="section-lead">维护店铺活动和优惠规则，查看活动成交统计与预计到手价。</p></div>
      <div class="ops-actions"><el-input v-model="q" class="ops-search" clearable placeholder="搜索活动名称或店铺" /><el-button v-if="writable" type="primary" @click="openCreate()">新建活动</el-button><el-button v-if="writable" @click="showStore = true">新增店铺</el-button></div>
    </header>
    <p v-if="error" class="ops-error">{{ error }}</p>
    <div class="ops-tabs"><button :class="{active:activeTab==='list'}" @click="activeTab='list'; detail=null">活动列表</button><button v-if="activeTab==='stats'" class="active">活动统计</button></div>
    <div v-if="activeTab==='list'" class="panel ops-panel">
      <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th style="width:22%">活动名称</th><th style="width:16%">店铺</th><th style="width:23%">活动时间</th><th style="width:12%">状态</th><th style="width:8%">商品</th><th style="width:19%">操作</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.id"><td class="ops-row-title" :title="row.name">{{ row.name }}</td><td :title="row.store_name">{{ row.store_name || '—' }}</td><td :title="`${dateTime(row.starts_at)} 至 ${dateTime(row.ends_at)}`">{{ dateTime(row.starts_at) }} 至 {{ dateTime(row.ends_at) }}</td><td><span class="ops-chip">{{ campaignStatus[row.status] || row.status }}</span></td><td>{{ row.items?.length || 0 }}</td><td><div class="ops-row-actions"><el-button link @click="detail=row; activeTab='detail'">查看</el-button><el-button v-if="writable && row.status==='draft'" link @click="editCampaign(row)">编辑</el-button><el-button v-if="writable && row.status==='draft'" link type="primary" @click="changeStatus(row,'publish')">发布</el-button><el-button v-if="writable && row.status==='published'" link @click="changeStatus(row,'archive')">归档</el-button><el-button link @click="openStats(row)">统计</el-button></div></td></tr></tbody>
      </table><div v-if="!rows.length && !loading" class="ops-empty">暂无活动记录</div></div>
      <div class="ops-pagination"><span>共 {{ total }} 条</span><el-select v-model="size" style="width:95px"><el-option :value="10" label="10 条/页"/><el-option :value="20" label="20 条/页"/><el-option :value="50" label="50 条/页"/></el-select><el-button :disabled="page<=1" @click="page--">上一页</el-button><span>第 {{ page }} 页</span><el-button :disabled="page*size>=total" @click="page++">下一页</el-button></div>
    </div>
    <div v-else-if="activeTab==='detail' && detail" class="panel ops-panel">
      <div class="panel-heading"><div><div class="eyebrow">活动详情</div><h3>{{ detail.name }}</h3></div><el-button @click="activeTab='list';detail=null">返回列表</el-button></div>
      <div class="ops-detail"><div><label>店铺</label><strong>{{ detail.store_name || '—' }}</strong></div><div><label>状态</label><strong>{{ campaignStatus[detail.status] || detail.status }}</strong></div><div><label>开始时间</label><strong>{{ dateTime(detail.starts_at) }}</strong></div><div><label>结束时间</label><strong>{{ dateTime(detail.ends_at) }}</strong></div><div class="span-two"><label>备注</label><strong :title="detail.notes">{{ detail.notes || '—' }}</strong></div></div>
      <h3>活动商品与优惠</h3><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>商品</th><th>物料编码</th><th>活动标价</th><th>优惠方案</th><th>操作</th></tr></thead><tbody><tr v-for="item in detail.items || []" :key="item.product_id"><td :title="`${item.sku||''} ${item.name||''}`">{{ item.sku }} · {{ item.name }}</td><td>{{ item.material_code || '—' }}</td><td>{{ money(item.list_price) }}</td><td :title="(item.rules||[]).map((r:Row)=>r.name).join('、')">{{ (item.rules||[]).map((r:Row)=>r.name).join('、') || '未配置优惠' }}</td><td><el-button @click="openPreview(item)">测算到手价</el-button></td></tr></tbody></table></div>
    </div>
    <div v-else-if="activeTab==='stats' && stats" class="panel ops-panel">
      <div class="panel-heading"><div><div class="eyebrow">CAMPAIGN PERFORMANCE</div><h3>{{ detail?.name }} · 活动统计</h3></div><el-button @click="activeTab='list';detail=null;stats=null">返回列表</el-button></div>
      <div class="ops-inline" style="margin-bottom:16px;flex-wrap:wrap"><label class="ops-muted">统计开始</label><el-date-picker v-model="statsFilter.from" type="date" value-format="YYYY-MM-DD" placeholder="不限"/><label class="ops-muted">结束时间（不含）</label><el-date-picker v-model="statsFilter.to" type="date" value-format="YYYY-MM-DD" placeholder="不限"/><el-select v-model="statsFilter.store_id" clearable placeholder="全部店铺" style="width:190px"><el-option v-for="store in stores" :key="store.id" :label="`${store.platform} · ${store.name}`" :value="store.id"/></el-select><el-button type="primary" :loading="loading" @click="loadStats">应用筛选</el-button></div>
      <div class="ops-detail"><div><label>商品原金额</label><strong>{{ money(stats.totals?.original_amount) }}</strong></div><div><label>已录入优惠</label><strong>{{ money(stats.totals?.discount_amount) }}</strong></div><div><label>买家实付</label><strong>{{ money(stats.totals?.paid_amount) }}</strong></div><div><label>优惠明细待补订单</label><strong>{{ stats.incomplete_orders || 0 }}</strong></div><div><label>关联订单退款合计（整单金额，未分摊到商品）</label><strong>{{ money(stats.totals?.order_level_refunded_amount) }}</strong></div><div><label>净发货数量</label><strong>{{ stats.totals?.net_shipped_quantity ?? 0 }}</strong></div><div><label>待补优惠金额</label><strong>{{ money(stats.totals?.undisclosed_discount_amount) }}</strong></div></div>
      <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>商品</th><th>下单数量</th><th>发货数量</th><th>退货数量</th><th>原金额</th><th>实际优惠</th><th>买家实付</th><th>商家承担</th><th>平台承担</th></tr></thead><tbody><tr v-for="item in statItems" :key="item.product_id"><td :title="`${item.sku} ${item.name}`">{{ item.sku }} · {{ item.name }}</td><td>{{ item.ordered_quantity }}</td><td>{{ item.shipped_quantity }}</td><td>{{ item.returned_quantity }}</td><td>{{ money(item.original_amount) }}</td><td>{{ money(item.discount_amount) }}</td><td>{{ money(item.paid_amount) }}</td><td>{{ money(item.merchant_discount) }}</td><td>{{ money(item.platform_discount) }}</td></tr></tbody></table></div>
      <p class="ops-muted">优惠明细：{{ (stats.discounts||[]).map((d:Row)=>`${d.name}（${d.count} 次，${money(d.amount)}）`).join('；') || '暂无实际优惠记录' }}</p>
    </div>

    <el-dialog v-model="showEditor" :title="editingId ? '编辑活动' : '新建活动'" width="900px" destroy-on-close>
      <div class="ops-form-grid"><el-form-item label="活动名称"><el-input v-model="form.name" placeholder="例如：年中促销" /></el-form-item><el-form-item label="店铺"><div class="ops-inline" style="width:100%"><el-select v-model="form.store_id" placeholder="选择店铺" style="flex:1"><el-option v-for="store in stores" :key="store.id" :label="`${store.platform} · ${store.name}`" :value="store.id"/></el-select><el-button @click="showStore=true">新增</el-button></div></el-form-item><el-form-item label="开始时间"><el-date-picker v-model="form.starts_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择开始时间" style="width:100%" /></el-form-item><el-form-item label="结束时间"><el-date-picker v-model="form.ends_at" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="选择结束时间" style="width:100%" /></el-form-item><el-form-item label="备注" class="span-two"><el-input v-model="form.notes" type="textarea" :rows="2" /></el-form-item></div>
      <div class="panel-heading"><h3>活动商品与优惠</h3><span class="ops-muted">预计价格仅用于测算，实际优惠以订单记录为准</span></div>
      <article v-for="(item,index) in form.items" :key="index" style="padding:12px 0;border-top:1px solid var(--line)"><div class="ops-inline"><ProductPicker v-model="item.product_id" :token="token" @select="(product)=>item.product_label=product?`${product.sku} · ${product.name}`:''"/><el-input v-model="item.list_price" placeholder="活动标价" style="max-width:150px"/><el-button link type="danger" @click="removeItem(Number(index))">移除商品</el-button></div><div v-for="(rule,ri) in item.rules" :key="ri" class="ops-rule-row"><el-input v-model="rule.name" placeholder="优惠名称"/><el-select v-model="rule.type"><el-option label="直接立减" value="fixed"/><el-option label="满额减" value="threshold"/><el-option label="折扣" value="percent"/></el-select><el-input v-model="rule.amount" :placeholder="rule.type==='percent'?'减免百分比':'减免金额'"/><el-input v-if="rule.type==='threshold'" v-model="rule.threshold" placeholder="满额门槛"/><el-input v-else v-model="rule.cap" placeholder="优惠封顶（可选）"/><div class="ops-inline"><el-select v-model="rule.bearer" style="width:115px"><el-option label="商家承担" value="merchant"/><el-option label="平台承担" value="platform"/></el-select><el-input v-model="rule.exclusive_group" placeholder="互斥组（可选）"/><el-button link type="danger" @click="removeRule(item,Number(ri))">删除</el-button></div></div><el-button link @click="addRule(item)">＋ 添加优惠行</el-button></article>
      <el-button @click="addItem()">＋ 添加商品</el-button><p v-if="error" class="ops-error">{{ error }}</p>
      <template #footer><el-button @click="showEditor=false">取消</el-button><el-button type="primary" :loading="loading" @click="save">保存活动</el-button></template>
    </el-dialog>
    <el-dialog v-model="showStore" title="新增店铺" width="480px"><el-form-item label="平台名称"><el-input v-model="storeForm.platform" placeholder="如：天猫"/></el-form-item><el-form-item label="店铺名称"><el-input v-model="storeForm.name"/></el-form-item><p v-if="error" class="ops-error">{{ error }}</p><template #footer><el-button @click="showStore=false">取消</el-button><el-button type="primary" @click="createStore">创建店铺</el-button></template></el-dialog>
    <el-dialog v-model="showPreview" title="活动价格测算" width="560px"><div class="ops-detail"><div><label>商品</label><strong>{{ previewTarget?.sku }} · {{ previewTarget?.name }}</strong></div><div><label>活动标价</label><strong>{{ money(previewTarget?.list_price) }}</strong></div></div><el-form-item label="购买数量"><el-input-number v-model="preview.quantity" :min="1" :step="1" /></el-form-item><div class="ops-muted">选择本次叠加的优惠方案</div><el-checkbox-group v-model="preview.rule_indexes"><el-checkbox v-for="(rule,index) in previewTarget?.rules || []" :key="index" :label="index">{{ rule.name }} · {{ rule.type==='percent' ? `减免 ${rule.amount}%` : money(rule.amount) }}{{ rule.exclusive_group ? `（互斥组 ${rule.exclusive_group}）` : '' }}</el-checkbox></el-checkbox-group><el-button type="primary" @click="calculatePreview">计算预计价格</el-button><div v-if="previewResult" class="ops-detail" style="margin-top:16px"><div><label>原金额</label><strong>{{ money(previewResult.original_amount) }}</strong></div><div><label>优惠金额</label><strong>{{ money(previewResult.discount_amount) }}</strong></div><div><label>预计到手价</label><strong>{{ money(previewResult.paid_amount) }}</strong></div><div class="span-two"><label>优惠承担</label><strong>{{ (previewResult.discounts||[]).map((d:Row)=>`${d.name} ${money(d.amount)}（${d.bearer==='merchant'?'商家':'平台'}）`).join('；') || '无优惠' }}</strong></div></div></el-dialog>
  </section>
</template>
