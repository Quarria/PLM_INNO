<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import ProductSelect from '../../ProductSelect.vue'
import { opportunityBody, opportunityDate, opportunityDateTime, opportunityRequest, opportunityStageLabel, opportunityStages, opportunityStatusLabel, type OpportunityRow } from './shared'

const props = withDefaults(defineProps<{ token: string; permissions: string[]; userId?: string; userName?: string }>(), { userId: '', userName: '' })
const has = (permission: string) => props.permissions.includes('*') || props.permissions.includes(permission)
const mayCreate = computed(() => has('opportunity:create'))
const mayManage = computed(() => has('opportunity:manage'))
const rows = ref<OpportunityRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const ownerFilter = ref('')
const stageFilter = ref('')
const statusFilter = ref('in_progress')
const loadingList = ref(false)
const listError = ref('')
const detail = ref<OpportunityRow | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const selectedStage = ref('sampling')
const showOldRounds = ref(false)
const selectedRoundId = ref('')
const detailId = ref('')
const customers = ref<OpportunityRow[]>([])
const quotes = ref<OpportunityRow[]>([])
const users = ref<OpportunityRow[]>([])
const catalogError = ref('')
const catalogsLoaded = ref(false)
const formOpen = ref(false)
const formLoading = ref(false)
const editing = ref(false)
const formError = ref('')
const form = reactive({ name: '', customer_id: '', owner_id: '', description: '', expected_amount: '', expected_completion_date: '', product_variant_ids: [''] as string[], quote_ids: [] as string[] })
const documentOpen = ref(false)
const documentSaving = ref(false)
const documentError = ref('')
const documentForm = reactive({ name: '', type: '', business_date: new Date().toISOString().slice(0, 10), description: '' })
const extraFields = reactive<Record<string, string>>({ sample_quantity: '', expected_completion_date: '', recipient: '', courier_company: '', tracking_number: '', sent_date: '', feedback_result: '', contract_number: '', contract_amount: '', signed_date: '', completion_date: '', result_summary: '', related_quote_id: '' })
const stageExtraFields: Record<string, string[]> = {
  sampling: ['sample_quantity', 'expected_completion_date'],
  delivery: ['recipient', 'sent_date', 'courier_company', 'tracking_number'],
  feedback: ['feedback_result'],
  contract: ['contract_number', 'contract_amount', 'signed_date', 'related_quote_id'],
  completed: ['completion_date', 'result_summary'],
}
const stageFieldLabels: Record<string, string> = { sample_quantity: '打样数量', expected_completion_date: '预计完成日期', recipient: '收件人', sent_date: '寄出日期', courier_company: '快递公司', tracking_number: '运单号', feedback_result: '反馈结论', contract_number: '合同编号', contract_amount: '合同金额', signed_date: '签订日期', related_quote_id: '关联报价', completion_date: '完成日期', result_summary: '结果说明' }
let optionsRequest = 0
const selectedFiles = ref<File[]>([])
const uploadedByKey = ref<Record<string, OpportunityRow>>({})
const actionOpen = ref(false)
const actionType = ref<'advance' | 'return' | 'terminate' | 'transfer' | ''>('')
const actionLoading = ref(false)
const actionError = ref('')
const actionReason = ref('')
const actionTarget = ref('sampling')
const actionOwner = ref('')
const voidOpen = ref(false)
const voidTarget = ref<OpportunityRow | null>(null)
const voidReason = ref('')
const voidLoading = ref(false)
let listRequest = 0
let detailRequest = 0

const stageIndex = (code: string) => opportunityStages.findIndex((stage) => stage.code === code)
const currentStage = computed(() => detail.value?.current_stage || 'sampling')
const currentRun = computed(() => {
  const runs = detail.value?.stage_runs || []
  return runs.find((run: OpportunityRow) => run.id === detail.value?.current_stage_run_id) || [...runs].filter((run: OpportunityRow) => run.stage === currentStage.value).sort((a: OpportunityRow, b: OpportunityRow) => Number(b.round) - Number(a.round))[0] || null
})
const visibleRuns = computed(() => (detail.value?.stage_runs || []).filter((run: OpportunityRow) => run.stage === selectedStage.value).sort((a: OpportunityRow, b: OpportunityRow) => Number(b.round) - Number(a.round)))
const latestRun = computed(() => visibleRuns.value[0] || null)
const displayedRuns = computed(() => showOldRounds.value ? visibleRuns.value : visibleRuns.value.slice(0, 1))
const selectedRun = computed(() => visibleRuns.value.find((run: OpportunityRow) => run.id === selectedRoundId.value) || visibleRuns.value.find((run: OpportunityRow) => run.id === currentRun.value?.id) || latestRun.value)
const selectedDocuments = computed(() => selectedRun.value?.documents || [])
const quoteChoices = computed(() => quotes.value.filter((quote) => !form.customer_id || (quote.customer_id || quote.customerId) === form.customer_id))
const canEditDetail = computed(() => !!detail.value?.permissions?.can_edit)
const canManageDetail = computed(() => !!detail.value?.permissions?.can_manage)
const statusText = computed(() => opportunityStatusLabel(detail.value?.status || ''))
const stageSummary = computed(() => detail.value?.status === 'terminated' ? `已终止 · 停留在${opportunityStageLabel(currentStage.value)}` : `${opportunityStageLabel(currentStage.value)}${detail.value?.status === 'completed' ? ' · 已完成' : ' · 进行中'}`)
const activeDocumentCount = computed(() => (currentRun.value?.documents || []).filter((doc: OpportunityRow) => !doc.is_void).length)
const negativeFeedback = computed(() => (currentRun.value?.documents || []).filter((doc: OpportunityRow) => !doc.is_void).some((doc: OpportunityRow) => {
  const result = String(doc.extra_data?.feedback_result || doc.extra_data?.result || '').toLowerCase()
  return /需修改|不通过|未通过|reject|fail|revision/.test(result)
}))
const advanceNeedsReason = computed(() => activeDocumentCount.value === 0 || currentStage.value === 'contract' || (currentStage.value === 'feedback' && negativeFeedback.value))
const canAddDocument = computed(() => {
  if (!detail.value) return false
  if (detail.value.status === 'terminated') return canManageDetail.value && selectedStage.value === currentStage.value
  const reachedStage = (detail.value.stage_runs || []).some((run: OpportunityRow) => run.stage === selectedStage.value)
  if (!reachedStage) return false
  return canEditDetail.value || canManageDetail.value
})
const canFlow = computed(() => detail.value?.status === 'in_progress' && (canEditDetail.value || canManageDetail.value))
const currency = (value: unknown) => value == null || value === '' ? '—' : `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const quoteStatusLabel = (status: string) => ({ draft: '草稿', pending: '待确认', confirmed: '已确认', void: '已失效' } as Record<string, string>)[status] || status || '—'
const fileKey = (file: File) => `${file.name}|${file.size}|${file.lastModified}`

async function request<T = any>(path: string, options: RequestInit = {}) { return opportunityRequest<T>(props.token, path, options) }
function changeHash(id: string) {
  const next = id ? `#opportunity=${encodeURIComponent(id)}` : ''
  if (window.location.hash !== next) history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
}
function hashOpportunityId() {
  const match = window.location.hash.match(/^#opportunity=(.+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}
async function loadList() {
  const requestId = ++listRequest
  loadingList.value = true; listError.value = ''
  const params = new URLSearchParams({ page: String(page.value), size: String(pageSize.value), q: keyword.value.trim() })
  if (ownerFilter.value) params.set('owner_id', ownerFilter.value)
  if (stageFilter.value) params.set('stage', stageFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  try {
    const result = await request<{ items: OpportunityRow[]; total: number }>(`/opportunities?${params}`)
    if (requestId !== listRequest) return
    rows.value = result.items || []; total.value = Number(result.total || 0)
    const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value))
    if (page.value > maxPage) { page.value = maxPage; return }
  } catch (error) { if (requestId === listRequest) listError.value = error instanceof Error ? error.message : '商机列表读取失败' }
  finally { if (requestId === listRequest) loadingList.value = false }
}
async function loadDetail(id: string, updateHash = false) {
  const requestId = ++detailRequest
  detailId.value = id
  if (updateHash) changeHash(id)
  detailLoading.value = true; detailError.value = ''; detail.value = null; showOldRounds.value = false
  selectedRoundId.value = ''
  try {
    const result = await request<OpportunityRow>(`/opportunities/${encodeURIComponent(id)}`)
    if (requestId !== detailRequest) return
    detail.value = result
    selectedStage.value = result.current_stage || 'sampling'
  } catch (error) { if (requestId === detailRequest) detailError.value = error instanceof Error ? error.message : '商机详情读取失败' }
  finally { if (requestId === detailRequest) detailLoading.value = false }
}
function openList() { detailRequest++; detail.value = null; detailId.value = ''; detailError.value = ''; changeHash(''); void loadList() }
async function syncHash() {
  const id = hashOpportunityId()
  if (id && id !== detailId.value) await loadDetail(id)
  else if (!id && detailId.value) { detailRequest++; detail.value = null; detailId.value = ''; detailError.value = ''; void loadList() }
}
async function loadCatalogs() {
  if (catalogsLoaded.value) return
  catalogError.value = ''
  try {
    const options = await request<OpportunityRow>('/opportunities/options')
    if (options.customers) customers.value = options.customers
    if (options.users) users.value = options.users
    quotes.value = options.quotes || []
    catalogsLoaded.value = true
  } catch {
    catalogError.value = '客户、负责人和报价资料加载失败；可重试加载，已填写内容会保留。'
  }
}
async function retryCatalogs() { catalogsLoaded.value = false; await loadCatalogs() }
async function loadQuotesForCustomer(customerId: string) {
  const requestId = ++optionsRequest
  try {
    const params = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : ''
    const options = await request<OpportunityRow>(`/opportunities/options${params}`)
    if (requestId === optionsRequest) quotes.value = options.quotes || []
  } catch (error) { if (requestId === optionsRequest) catalogError.value = error instanceof Error ? error.message : '报价资料加载失败' }
}
function resetForm() { Object.assign(form, { name: '', customer_id: '', owner_id: props.userId, description: '', expected_amount: '', expected_completion_date: '', product_variant_ids: [''], quote_ids: [] }); formError.value = '' }
function removeProduct(index: number) {
  if (form.product_variant_ids.length === 1) form.product_variant_ids[0] = ''
  else form.product_variant_ids.splice(index, 1)
}
async function openCreate() {
  editing.value = false; resetForm(); formOpen.value = true
  await loadCatalogs()
}
async function openEdit() {
  if (!detail.value) return
  editing.value = true; resetForm(); formOpen.value = true; await loadCatalogs()
  const row = detail.value
  const variantIds = (row.products || []).map((item: OpportunityRow) => item.variant_id || item.id).filter(Boolean)
  Object.assign(form, { name: row.name || '', customer_id: row.customer_id || '', owner_id: row.owner_id || props.userId, description: row.description || '', expected_amount: row.expected_amount ?? '', expected_completion_date: row.expected_completion_date || '', product_variant_ids: variantIds.length ? variantIds : [''], quote_ids: [...(row.quote_ids || [])] })
}
async function saveOpportunity() {
  if (!form.name.trim() || !form.customer_id) { formError.value = '请填写商机名称并选择客户。'; return }
  const variantIds = form.product_variant_ids.filter(Boolean)
  if (new Set(variantIds).size !== variantIds.length) { formError.value = '同一商品不能重复关联，请移除重复项。'; return }
  formLoading.value = true; formError.value = ''
  const payload: OpportunityRow = { name: form.name.trim(), customer_id: form.customer_id, description: form.description.trim(), expected_amount: form.expected_amount === '' ? null : Number(form.expected_amount), expected_completion_date: form.expected_completion_date || null, product_variant_ids: variantIds, quote_ids: form.quote_ids }
  if (!editing.value) payload.owner_id = mayManage.value ? form.owner_id || props.userId : props.userId
  if (editing.value) payload.version = detail.value?.version
  try {
    if (editing.value && detail.value) {
      await request(`/opportunities/${encodeURIComponent(detail.value.id)}`, { method: 'PATCH', body: opportunityBody(payload) })
      formOpen.value = false; ElMessage.success('商机资料已保存'); await loadDetail(detailId.value); await loadList()
    } else {
      const created = await request<OpportunityRow>('/opportunities', { method: 'POST', body: opportunityBody(payload) })
      formOpen.value = false; ElMessage.success('商机已创建'); await loadList(); await loadDetail(created.id, true)
    }
  } catch (error) { formError.value = error instanceof Error ? error.message : '保存失败，请重试' }
  finally { formLoading.value = false }
}
function selectStage(code: string) { selectedStage.value = code; showOldRounds.value = false; selectedRoundId.value = '' }
function openDocument() {
  if (!canAddDocument.value) return
  Object.assign(documentForm, { name: '', type: '', business_date: new Date().toISOString().slice(0, 10), description: '' })
  Object.assign(extraFields, { sample_quantity: '', expected_completion_date: '', recipient: '', courier_company: '', tracking_number: '', sent_date: '', feedback_result: '', contract_number: '', contract_amount: '', signed_date: '', completion_date: '', result_summary: '', related_quote_id: '' })
  selectedFiles.value = []; uploadedByKey.value = {}; documentError.value = ''; documentOpen.value = true
}
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const incoming = Array.from(input.files || [])
  if (selectedFiles.value.length + incoming.length > 10) documentError.value = '每张单据最多添加 10 个附件。'
  for (const file of incoming) {
    if (!selectedFiles.value.some((existing) => fileKey(existing) === fileKey(file)) && selectedFiles.value.length >= 10) continue
    if (file.size > 20 * 1024 * 1024) { documentError.value = `“${file.name}”超过单文件 20 MB 限制。`; continue }
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx'].includes(extension)) { documentError.value = `“${file.name}”格式不支持。`; continue }
    if (!selectedFiles.value.some((existing) => fileKey(existing) === fileKey(file))) selectedFiles.value.push(file)
  }
  input.value = ''
}
function removeFile(index: number) {
  const [file] = selectedFiles.value.splice(index, 1)
  if (file) delete uploadedByKey.value[fileKey(file)]
}
async function saveDocument() {
  if (!documentForm.name.trim() || !documentForm.type.trim() || !documentForm.business_date) { documentError.value = '单据名称、类型和业务日期为必填项。'; return }
  documentSaving.value = true; documentError.value = ''
  try {
    const attachmentIds: string[] = []
    for (const file of selectedFiles.value) {
      const key = fileKey(file)
      let uploaded = uploadedByKey.value[key]
      if (!uploaded) {
        const data = new FormData(); data.append('file', file)
        uploaded = await request<OpportunityRow>(`/opportunities/${encodeURIComponent(detailId.value)}/attachments`, { method: 'POST', body: data })
        uploadedByKey.value[key] = uploaded
      }
      attachmentIds.push(uploaded.id)
    }
    const extraData: OpportunityRow = {}
    const fieldNames = stageExtraFields[selectedStage.value] || []
    for (const name of fieldNames) if (extraFields[name] !== '') extraData[name] = name.endsWith('_amount') || name.endsWith('_quantity') ? Number(extraFields[name]) : extraFields[name]
    const run = selectedRun.value
    await request(`/opportunities/${encodeURIComponent(detailId.value)}/documents`, { method: 'POST', body: opportunityBody({ stage_run_id: run?.id, name: documentForm.name.trim(), type: documentForm.type.trim(), business_date: documentForm.business_date, description: documentForm.description.trim() || undefined, extra_data: extraData, attachment_ids: attachmentIds }) })
    documentOpen.value = false; ElMessage.success('单据已保存'); await loadDetail(detailId.value)
  } catch (error) { documentError.value = error instanceof Error ? error.message : '单据保存失败，请重试' }
  finally { documentSaving.value = false }
}
async function downloadAttachment(attachment: OpportunityRow) {
  try {
    const response = await fetch(`/api/opportunities/${encodeURIComponent(detailId.value)}/attachments/${encodeURIComponent(attachment.id)}`, { headers: { Authorization: `Bearer ${props.token}` } })
    if (!response.ok) { let message = `下载失败（${response.status}）`; try { const body = await response.json(); message = body.message || message } catch {} throw new Error(message) }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = attachment.file_name || '附件'; anchor.click(); URL.revokeObjectURL(url)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '附件下载失败') }
}
function openAction(type: 'advance' | 'return' | 'terminate' | 'transfer') {
  actionType.value = type; actionReason.value = ''; actionError.value = ''; actionTarget.value = 'sampling'; actionOwner.value = detail.value?.owner_id || ''; actionOpen.value = true
}
const actionTitle = computed(() => ({ advance: currentStage.value === 'contract' ? '完成商机' : `推进至${opportunityStageLabel(opportunityStages[stageIndex(currentStage.value) + 1]?.code || '')}`, return: '退回至前序节点', terminate: '终止商机', transfer: '转交负责人' } as Record<string, string>)[actionType.value] || '商机操作')
async function submitAction() {
  if (!detail.value || !actionType.value) return
  if ((actionType.value === 'return' || actionType.value === 'terminate' || (actionType.value === 'advance' && advanceNeedsReason.value)) && !actionReason.value.trim()) { actionError.value = actionType.value === 'advance' && currentStage.value === 'contract' ? '请填写结案说明。' : '请填写原因。'; return }
  if (actionType.value === 'transfer' && !actionOwner.value) { actionError.value = '请选择新的负责人。'; return }
  actionLoading.value = true; actionError.value = ''
  const id = encodeURIComponent(detail.value.id)
  const expected_version = detail.value.version
  const request_id = crypto.randomUUID()
  let path = ''; let payload: OpportunityRow = {}
  if (actionType.value === 'advance') { path = `/opportunities/${id}/advance`; payload = { expected_version, request_id, reason: actionReason.value.trim() || undefined } }
  if (actionType.value === 'return') { path = `/opportunities/${id}/return`; payload = { expected_version, request_id, target_stage: actionTarget.value, reason: actionReason.value.trim() } }
  if (actionType.value === 'terminate') { path = `/opportunities/${id}/terminate`; payload = { expected_version, request_id, reason: actionReason.value.trim() } }
  if (actionType.value === 'transfer') { path = `/opportunities/${id}/transfer`; payload = { owner_id: actionOwner.value, reason: actionReason.value.trim() || undefined } }
  try {
    await request(path, { method: 'POST', body: opportunityBody(payload) })
    const type = actionType.value
    actionOpen.value = false; ElMessage.success(({ advance: '商机节点已更新', return: '商机已退回', terminate: '商机已终止', transfer: '负责人已转交' } as Record<string, string>)[type] || '操作成功')
    await loadDetail(detailId.value); await loadList()
  } catch (error) { actionError.value = error instanceof Error ? error.message : '操作失败；输入仍保留，请刷新后重试' }
  finally { actionLoading.value = false }
}
async function voidDocument(doc: OpportunityRow) {
  voidTarget.value = doc; voidReason.value = ''; voidOpen.value = true
}
async function submitVoid() {
  if (!voidTarget.value || !voidReason.value.trim()) return
  voidLoading.value = true
  try {
    await request(`/opportunities/${encodeURIComponent(detailId.value)}/documents/${encodeURIComponent(voidTarget.value.id)}/void`, { method: 'POST', body: opportunityBody({ reason: voidReason.value.trim() }) })
    voidOpen.value = false; ElMessage.success('单据已作废'); await loadDetail(detailId.value)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '作废失败') }
  finally { voidLoading.value = false }
}
function daysAtStage(enteredAt: unknown) {
  if (!enteredAt) return '—'
  return `${Math.max(0, Math.floor((Date.now() - new Date(String(enteredAt)).getTime()) / 86400000))} 天`
}
function documentFields(doc: OpportunityRow) {
  const values = doc.extra_data || {}
  return Object.entries(values)
    .filter(([key, value]) => stageFieldLabels[key] && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => {
      const displayValue = key === 'contract_amount'
        ? currency(value)
        : key === 'related_quote_id'
          ? detail.value?.quotes?.find((quote: OpportunityRow) => quote.id === value)?.quote_number || String(value)
          : String(value)
      return { key, label: stageFieldLabels[key], value: displayValue }
    })
}
watch([keyword, ownerFilter, stageFilter, statusFilter], () => { page.value = 1; void loadList() })
watch([page, pageSize], () => { void loadList() })
watch(() => form.customer_id, (customerId) => { if (catalogsLoaded.value && formOpen.value) void loadQuotesForCustomer(customerId) })
onMounted(() => { window.addEventListener('hashchange', syncHash); const id = hashOpportunityId(); if (id) void loadDetail(id); else void loadList(); if (mayManage.value) void loadCatalogs() })
onBeforeUnmount(() => { window.removeEventListener('hashchange', syncHash); listRequest++; detailRequest++ })
</script>

<template>
  <main class="ops-workspace opportunity-workspace" :aria-busy="loadingList || detailLoading">
    <template v-if="detailId">
      <div class="ops-toolbar opportunity-toolbar">
        <div class="opp-back-title"><el-button text @click="openList">← 商机列表</el-button><div v-if="detail"><p class="section-lead">{{ detail.number }}</p><h1>{{ detail.name }}</h1></div></div>
        <div class="ops-actions"><el-button :loading="detailLoading" @click="loadDetail(detailId)">刷新详情</el-button><el-button v-if="detail?.status==='in_progress' && (canEditDetail || canManageDetail)" @click="openEdit">编辑资料</el-button><el-button v-if="detail?.status==='in_progress' && canManageDetail" @click="openAction('transfer')">转交负责人</el-button><el-button v-if="canFlow" type="danger" plain @click="openAction('terminate')">终止商机</el-button></div>
      </div>
      <div v-if="detailLoading && !detail" class="ops-panel panel ops-empty" role="status">正在读取商机详情…</div>
      <section v-else-if="detailError" class="panel opp-error-panel" role="alert"><strong>商机详情暂时无法读取</strong><p>{{ detailError }}</p><div class="ops-actions"><el-button type="primary" @click="loadDetail(detailId)">重新读取</el-button><el-button @click="openList">返回列表</el-button></div></section>
      <template v-else-if="detail">
        <section class="panel opp-overview">
          <div class="opp-overview-heading"><div><span class="eyebrow">OPPORTUNITY · {{ detail.number }}</span><p>{{ detail.customer_name }}<span v-if="detail.owner_name"> · 负责人 {{ detail.owner_name }}</span></p></div><el-tag :type="detail.status==='completed'?'success':detail.status==='terminated'?'danger':'warning'" effect="plain">{{ statusText }}</el-tag></div>
          <div class="opp-facts"><div><label>当前节点</label><strong>{{ stageSummary }}</strong></div><div><label>本轮进入时间</label><strong>{{ opportunityDateTime(currentRun?.entered_at) }}</strong></div><div><label>当前节点停留</label><strong>{{ detail.status==='in_progress' ? daysAtStage(currentRun?.entered_at) : '—' }}</strong></div><div><label>预计金额</label><strong>{{ currency(detail.expected_amount) }}</strong></div><div><label>预计完成日期</label><strong>{{ opportunityDate(detail.expected_completion_date) }}</strong></div><div v-if="detail.termination_reason" class="opp-fact-wide"><label>终止原因</label><strong>{{ detail.termination_reason }}</strong></div><div v-if="detail.description" class="opp-fact-wide"><label>需求描述</label><strong>{{ detail.description }}</strong></div><div class="opp-fact-wide"><label>关联商品规格</label><div v-if="detail.products?.length" class="opp-linked-values"><span v-for="item in detail.products" :key="item.variant_id">{{ item.sku }} · {{ item.name }} · {{ item.specification }}<template v-if="item.unit"> / {{ item.unit }}</template></span></div><strong v-else>—</strong></div><div class="opp-fact-wide"><label>关联报价</label><div v-if="detail.quotes?.length" class="opp-linked-values"><span v-for="quote in detail.quotes" :key="quote.id">{{ quote.quote_number }} · {{ quoteStatusLabel(quote.status) }}</span></div><strong v-else>—</strong></div></div>
        </section>
        <section class="panel opp-progress-panel">
          <div class="opp-current-banner"><span>当前节点</span><strong>{{ stageSummary }}</strong><span v-if="detail.status==='in_progress'" class="opp-current-time">本轮已停留 {{ daysAtStage(currentRun?.entered_at) }}</span></div>
          <div class="opp-steps" role="group" aria-label="商机五节点进度">
            <template v-for="(stage, index) in opportunityStages" :key="stage.code"><button type="button" class="opp-step" :class="{ current: stage.code===currentStage, complete: index<stageIndex(currentStage) && detail.status!=='terminated', upcoming: index>stageIndex(currentStage) || (detail.status==='terminated' && index>stageIndex(currentStage)), terminated: detail.status==='terminated' && stage.code===currentStage }" :aria-current="stage.code===currentStage?'step':undefined" @click="selectStage(stage.code)"><span class="opp-step-mark">{{ index<stageIndex(currentStage) && detail.status!=='terminated' ? '✓' : index+1 }}</span><span class="opp-step-label">{{ stage.label }}</span><small>{{ stage.code===currentStage ? detail.status==='terminated'?'已终止停留':'当前节点' : index<stageIndex(currentStage)?'已完成':'未开始' }}</small></button><span v-if="index<opportunityStages.length-1" class="opp-step-line" :class="{ passed:index<stageIndex(currentStage) && detail.status!=='terminated' }" aria-hidden="true"></span></template>
          </div>
          <div class="ops-actions opp-flow-actions"><el-button v-if="canFlow && currentStage!=='contract'" type="primary" @click="openAction('advance')">完成{{ opportunityStageLabel(currentStage) }}，推进至{{ opportunityStageLabel(opportunityStages[stageIndex(currentStage)+1]?.code || '') }}</el-button><el-button v-else-if="canFlow && currentStage==='contract'" type="primary" @click="openAction('advance')">完成商机</el-button><el-button v-if="canFlow && stageIndex(currentStage)>0" @click="openAction('return')">退回至前序节点</el-button><span v-if="detail.status==='completed'" class="ops-muted">商机已成功结案，可在“完成”节点补录资料。</span><span v-if="detail.status==='terminated'" class="ops-muted">商机已终止，原单据和流转记录只读。</span></div>
        </section>
        <section class="panel opp-documents-panel">
          <div class="opp-section-head"><div><span class="eyebrow">DOCUMENTS</span><h2>{{ opportunityStageLabel(selectedStage) }} · 节点单据</h2><p v-if="selectedStage===currentStage && detail.status==='in_progress'">当前节点有效单据 {{ activeDocumentCount }} 份；保存单据不会自动推进。</p><p v-else-if="selectedStage==='completed' && detail.status==='completed'">已结案节点支持补录，补录不会改变完成状态。</p><p v-else-if="detail.status==='terminated'">终止后仅管理权限可在停留节点补录说明资料。</p><p v-else>查看该节点各轮执行记录；查看节点不会改变当前进度。</p></div><div class="ops-actions"><el-button v-if="visibleRuns.length>1" @click="showOldRounds=!showOldRounds">{{ showOldRounds?'查看当前轮次':'展开历史轮次' }}</el-button><el-button v-if="canAddDocument" type="primary" @click="openDocument">＋ 新增单据</el-button></div></div>
          <div v-if="visibleRuns.length" class="opp-round-tabs"><button v-for="run in displayedRuns" :key="run.id" type="button" :class="{active:run.id===selectedRun?.id}" @click="selectedRoundId=run.id"><strong>第 {{ run.round }} 轮</strong><span>{{ opportunityDate(run.entered_at) }}<template v-if="run.result==='returned'"> · 已退回</template></span></button></div>
          <div v-if="selectedRun" class="opp-run-meta"><span>本轮开始 {{ opportunityDateTime(selectedRun.entered_at) }}</span><span v-if="selectedRun.exited_at">结束 {{ opportunityDateTime(selectedRun.exited_at) }}</span><el-tag v-if="selectedRun.result==='returned'" type="warning" effect="plain">已退回</el-tag></div>
          <div v-if="selectedDocuments.length" class="opp-document-list">
            <article v-for="doc in selectedDocuments" :key="doc.id" class="opp-document" :class="{voided:doc.is_void}">
              <div class="opp-document-main"><div class="opp-document-title"><strong>{{ doc.name }}</strong><el-tag v-if="doc.is_void" type="danger" effect="plain" size="small">已作废</el-tag><el-tag v-else-if="doc.is_backfill" effect="plain" size="small">补录</el-tag></div><p>{{ doc.type }} · 业务日期 {{ opportunityDate(doc.business_date) }}</p><p v-if="doc.description" class="opp-document-description">{{ doc.description }}</p><div v-if="documentFields(doc).length" class="opp-business-fields"><span v-for="field in documentFields(doc)" :key="field.key"><b>{{ field.label }}</b>{{ field.value }}</span></div><p v-if="doc.is_void && doc.void_reason" class="opp-document-description">作废原因：{{ doc.void_reason }}</p><small>录入人 {{ doc.created_by_name || doc.created_by || '—' }} · {{ opportunityDateTime(doc.created_at) }}</small></div>
              <div class="opp-attachments"><span v-if="!doc.attachments?.length" class="ops-muted">无附件</span><button v-for="attachment in doc.attachments" :key="attachment.id" type="button" class="opp-file-link" @click="downloadAttachment(attachment)">↓ {{ attachment.file_name }} · {{ (Number(attachment.size||0)/1024/1024).toFixed(1) }} MB</button></div>
              <el-button v-if="!doc.is_void && (canEditDetail || canManageDetail) && detail.status==='in_progress'" link type="danger" @click="voidDocument(doc)">作废</el-button>
            </article>
          </div>
          <div v-else class="ops-empty opp-doc-empty">{{ selectedRun ? '本轮还没有单据记录。' : selectedStage===currentStage && detail.status==='in_progress' ? '当前节点还没有执行记录。' : '该节点暂无执行记录；查看不会改变当前节点。' }}</div>
          <div v-if="!visibleRuns.length && selectedStage!==currentStage" class="ops-empty opp-doc-empty">此节点尚未到达，暂不能录入单据。</div>
        </section>
        <section class="panel opp-history-panel"><div class="opp-section-head"><div><span class="eyebrow">ACTIVITY</span><h2>操作历史</h2></div></div><div v-if="detail.events?.length" class="ops-timeline"><article v-for="(event,index) in detail.events" :key="`${event.created_at}-${index}`"><strong>{{ ({created:'创建商机',entered_stage:'进入节点',advanced:'推进节点',returned:'退回节点',terminated:'终止商机',transferred:'转交负责人',document_added:'新增单据',document_voided:'作废单据',updated:'修改资料',completed:'完成商机'} as Record<string,string>)[event.action] || event.action }}</strong><span>{{ event.actor_name || '—' }} · {{ opportunityDateTime(event.created_at) }}<template v-if="event.from_stage || event.to_stage"> · {{ opportunityStageLabel(event.from_stage) }} → {{ opportunityStageLabel(event.to_stage) }}</template></span><p v-if="event.reason">{{ event.reason }}</p></article></div><div v-else class="ops-empty">暂无操作历史。</div></section>
      </template>
    </template>
    <template v-else>
      <div class="ops-toolbar opportunity-toolbar"><div><span class="eyebrow">PIPELINE</span><h1>商机管理</h1><p class="section-lead">按五个节点持续记录合作进度、单据与结案结果。</p></div><div class="ops-actions"><el-button :loading="loadingList" @click="loadList">刷新</el-button><el-button v-if="mayCreate" type="primary" @click="openCreate">＋ 新建商机</el-button></div></div>
      <div class="opp-filters"><label><span>关键词</span><el-input v-model="keyword" clearable placeholder="商机编号、名称或客户" /></label><label v-if="mayManage"><span>负责人</span><el-select v-model="ownerFilter" clearable placeholder="全部负责人"><el-option v-for="user in users" :key="user.id" :label="user.display_name || user.displayName || user.username" :value="user.id" /></el-select></label><label><span>当前节点</span><el-select v-model="stageFilter" clearable placeholder="全部节点"><el-option v-for="stage in opportunityStages" :key="stage.code" :label="stage.label" :value="stage.code" /></el-select></label><label><span>业务状态</span><el-select v-model="statusFilter" placeholder="全部状态"><el-option label="跟进中" value="in_progress"/><el-option label="已完成" value="completed"/><el-option label="已终止" value="terminated"/><el-option label="全部状态" value=""/></el-select></label></div>
          <section class="panel opp-list-panel"><div v-if="listError" class="opp-error-inline" role="alert"><span>{{ listError }}</span><el-button link type="primary" @click="loadList">重试</el-button></div><div class="ops-table-wrap"><table class="ops-table opp-table"><thead><tr><th>商机编号 / 名称</th><th>客户</th><th>负责人</th><th>当前节点</th><th>业务状态</th><th>节点停留</th><th>预计金额</th><th>最近更新</th><th>操作</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td><button type="button" class="opp-row-link" @click="loadDetail(row.id,true)"><strong>{{ row.number }}</strong><small>{{ row.name }}</small></button></td><td>{{ row.customer_name || '—' }}</td><td>{{ row.owner_name || '—' }}</td><td><span class="opp-stage-label">{{ opportunityStageLabel(row.current_stage) }}</span><small v-if="row.status==='terminated'" class="opp-sub-label">已终止停留</small></td><td><el-tag :type="row.status==='completed'?'success':row.status==='terminated'?'danger':'warning'" effect="plain" size="small">{{ opportunityStatusLabel(row.status) }}</el-tag></td><td>{{ row.status==='in_progress' ? daysAtStage(row.stage_entered_at) : '—' }}</td><td>{{ currency(row.expected_amount) }}</td><td>{{ opportunityDateTime(row.updated_at) }}</td><td><el-button link type="primary" @click="loadDetail(row.id,true)">查看</el-button></td></tr><tr v-if="!loadingList && !listError && rows.length===0"><td colspan="9" class="opp-no-results">{{ keyword || ownerFilter || stageFilter || statusFilter ? '没有符合筛选条件的商机。' : '尚无商机，创建一份档案以开始跟进。' }}</td></tr></tbody></table></div><div v-if="loadingList" class="opp-list-loading" role="status">正在读取商机…</div><el-pagination v-if="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" :total="total" layout="total, sizes, prev, pager, next" class="product-pagination" /></section>
    </template>

    <el-dialog v-model="formOpen" :title="editing?'编辑商机':'新建商机'" width="720px" class="ops-dialog" :close-on-click-modal="false"><div v-if="catalogError" class="opp-error-inline" role="alert"><span>{{ catalogError }}</span><el-button link type="primary" @click="retryCatalogs">重试加载</el-button></div><el-form label-position="top"><div class="ops-form-grid"><el-form-item label="商机名称" required><el-input v-model="form.name" maxlength="160" placeholder="例如：某客户便携风扇贴牌合作" /></el-form-item><el-form-item label="客户" required><el-select v-model="form.customer_id" filterable placeholder="选择客户" class="full"><el-option v-for="customer in customers.filter((item: OpportunityRow)=>item.active!==false)" :key="customer.id" :label="customer.name" :value="customer.id" /></el-select></el-form-item><el-form-item label="负责人"><el-select v-model="form.owner_id" class="full" :disabled="editing || !mayManage"><el-option v-if="!mayManage && props.userId" :label="props.userName || '我自己'" :value="props.userId"/><el-option v-for="user in users.filter((item: OpportunityRow)=>item.active!==false)" :key="user.id" :label="user.display_name || user.displayName || user.username" :value="user.id" /></el-select></el-form-item><el-form-item label="预计金额"><el-input v-model="form.expected_amount" inputmode="decimal" placeholder="可选" /></el-form-item><el-form-item label="预计完成日期"><el-date-picker v-model="form.expected_completion_date" value-format="YYYY-MM-DD" type="date" placeholder="选择日期" /></el-form-item><el-form-item label="关联商品" class="span-two">
          <div class="opp-product-rows">
            <div v-for="(_, index) in form.product_variant_ids" :key="index" class="opp-product-row">
              <ProductSelect v-model="form.product_variant_ids[index]" :token="token" :aria-label="`关联商品 ${index + 1}`" placeholder="搜索型号或名称" />
              <el-button text type="danger" :aria-label="`移除第 ${index + 1} 个商品`" @click="removeProduct(index)">移除</el-button>
            </div>
            <el-button text type="primary" @click="form.product_variant_ids.push('')">＋ 添加商品</el-button>
          </div>
        </el-form-item><el-form-item label="关联报价" class="span-two"><el-select v-model="form.quote_ids" multiple filterable collapse-tags collapse-tags-tooltip placeholder="选择同一客户的报价" class="full"><el-option v-for="quote in quoteChoices" :key="quote.id" :label="`${quote.quote_number || quote.quoteNumber} · ${quote.customer_snapshot?.name || quote.customer_name || ''} · ${quote.quote_date || quote.quoteDate || ''}`" :value="quote.id" :disabled="quote.status==='void'" /></el-select></el-form-item><el-form-item label="需求描述" class="span-two"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="3000" show-word-limit placeholder="补充客户需求、定制方向或需要跟进的事项" /></el-form-item></div></el-form><p v-if="formError" class="ops-error" role="alert">{{ formError }}</p><template #footer><el-button @click="formOpen=false">取消</el-button><el-button type="primary" :loading="formLoading" @click="saveOpportunity">{{ editing?'保存修改':'创建商机' }}</el-button></template></el-dialog>

    <el-dialog v-model="documentOpen" title="新增节点单据" width="680px" class="ops-dialog" :close-on-click-modal="false"><p class="dialog-hint">录入到“{{ opportunityStageLabel(selectedStage) }}”{{ selectedStage==='completed' || detail?.status==='terminated' || selectedRun?.round>1?'（补录）':'' }}。保存单据不会自动推进商机。</p><el-form label-position="top"><div class="ops-form-grid"><el-form-item label="单据名称" required><el-input v-model="documentForm.name" maxlength="160" placeholder="例如：样品试用意见" /></el-form-item><el-form-item label="单据类型" required><el-select v-model="documentForm.type" filterable allow-create default-first-option placeholder="选择或输入单据类型" class="full"><el-option v-for="type in ['打样需求','打样记录','样品照片','检测报告','送样单','快递凭证','签收记录','反馈记录','测试结果','修改要求','合同草稿','已签合同','补充协议','关联报价','结案说明','交接资料','其他凭证']" :key="type" :label="type" :value="type" /></el-select></el-form-item><el-form-item label="业务日期" required><el-date-picker v-model="documentForm.business_date" value-format="YYYY-MM-DD" type="date" placeholder="选择日期" /></el-form-item><el-form-item v-if="stageExtraFields[selectedStage]?.length" v-for="field in stageExtraFields[selectedStage]" :key="field" :label="stageFieldLabels[field]"><el-select v-if="field==='feedback_result'" v-model="extraFields.feedback_result" class="full"><el-option label="待明确" value="待明确"/><el-option label="通过" value="通过"/><el-option label="需修改" value="需修改"/><el-option label="不通过" value="不通过"/></el-select><el-select v-else-if="field==='related_quote_id'" v-model="extraFields.related_quote_id" clearable class="full" placeholder="选择客户报价"><el-option v-for="quote in quoteChoices" :key="quote.id" :label="quote.quote_number" :value="quote.id" /></el-select><el-date-picker v-else-if="field.endsWith('_date')" v-model="extraFields[field]" value-format="YYYY-MM-DD" type="date" placeholder="选择日期"/><el-input v-else v-model="extraFields[field]" :type="field==='sample_quantity' || field==='contract_amount'?'number':'text'" :placeholder="`填写${stageFieldLabels[field]}`"/></el-form-item><el-form-item label="附件"><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" class="opp-file-input" aria-label="选择单据附件" @change="chooseFiles" /><small class="ops-muted">支持 PDF、PNG/JPEG、DOCX、XLSX，单文件不超过 20 MB；每张单据最多 10 个附件。</small><ul v-if="selectedFiles.length" class="opp-selected-files"><li v-for="(file,index) in selectedFiles" :key="fileKey(file)"><span>{{ file.name }} · {{ (file.size/1024/1024).toFixed(1) }} MB{{ uploadedByKey[fileKey(file)]?' · 已上传暂存':'' }}</span><el-button link type="danger" @click="removeFile(index)">移除</el-button></li></ul></el-form-item><el-form-item label="说明" class="span-two"><el-input v-model="documentForm.description" type="textarea" :rows="3" maxlength="2000" placeholder="可选" /></el-form-item></div></el-form><p v-if="documentError" class="ops-error" role="alert">{{ documentError }}</p><template #footer><el-button @click="documentOpen=false">取消</el-button><el-button type="primary" :loading="documentSaving" @click="saveDocument">保存单据</el-button></template></el-dialog>

    <el-dialog v-model="actionOpen" :title="actionTitle" width="500px" class="ops-dialog" :close-on-click-modal="false"><div class="opp-action-summary"><span>当前节点</span><strong>{{ stageSummary }}</strong><template v-if="actionType==='advance'"><span>目标节点</span><strong>{{ opportunityStageLabel(opportunityStages[stageIndex(currentStage)+1]?.code || '') }}</strong><span>当前节点有效单据</span><strong>{{ activeDocumentCount }} 份</strong></template></div><p v-if="actionType==='advance' && activeDocumentCount===0" class="opp-inline-hint">当前节点没有有效单据。填写无单据推进原因后仍可继续。</p><p v-if="actionType==='advance' && currentStage==='feedback' && negativeFeedback" class="opp-inline-hint">当前反馈记录为“需修改”或“不通过”。推进至合同仍由负责人手动决定，并请填写原因。</p><el-form label-position="top"><el-form-item v-if="actionType==='return'" label="退回目标节点" required><el-select v-model="actionTarget" class="full"><el-option v-for="stage in opportunityStages.slice(0,stageIndex(currentStage))" :key="stage.code" :label="stage.label" :value="stage.code" /></el-select></el-form-item><el-form-item v-if="actionType==='transfer'" label="新负责人" required><el-select v-model="actionOwner" class="full"><el-option v-for="user in users" :key="user.id" :label="user.display_name || user.displayName || user.username" :value="user.id" /></el-select></el-form-item><el-form-item :label="actionType==='advance' && currentStage==='contract'?'结案说明':actionType==='advance' && activeDocumentCount===0?'无单据推进原因':'原因'" :required="actionType==='advance' ? advanceNeedsReason : actionType!=='transfer'"><el-input v-model="actionReason" type="textarea" :rows="3" :maxlength="1000" :placeholder="actionType==='transfer'?'可填写转交说明':'请简要说明本次操作原因'" /></el-form-item></el-form><p v-if="actionError" class="ops-error" role="alert">{{ actionError }}</p><template #footer><el-button @click="actionOpen=false">取消</el-button><el-button type="primary" :loading="actionLoading" :disabled="actionType==='advance' && advanceNeedsReason && !actionReason.trim()" @click="submitAction">确认{{ actionType==='advance'?'推进':actionType==='return'?'退回':actionType==='terminate'?'终止':'转交' }}</el-button></template></el-dialog>

    <el-dialog v-model="voidOpen" title="作废单据" width="460px" class="ops-dialog" :close-on-click-modal="false"><p>已保存的单据保留在历史中；作废后不能恢复，修正内容请新增替代单据。</p><el-form label-position="top"><el-form-item label="作废原因" required><el-input v-model="voidReason" type="textarea" :rows="3" maxlength="1000" placeholder="请说明作废原因" /></el-form-item></el-form><template #footer><el-button @click="voidOpen=false">取消</el-button><el-button type="danger" :loading="voidLoading" :disabled="!voidReason.trim()" @click="submitVoid">确认作废</el-button></template></el-dialog>
  </main>
</template>

<style scoped>
.opp-product-rows{width:100%;min-width:0;display:flex;flex-direction:column;gap:8px}.opp-product-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}.opp-product-rows>.el-button{align-self:flex-start;margin-left:0}

.opportunity-workspace{color:var(--ink,#162c28)}.opportunity-toolbar{align-items:flex-end;margin-bottom:16px}.opportunity-toolbar h1{font-size:22px;margin:6px 0}.opp-back-title{display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0;align-self:flex-start}.opp-back-title h1{margin:4px 0 0;font-size:21px;overflow-wrap:anywhere}.opp-back-title .section-lead{font:11px 'DM Mono',monospace;overflow-wrap:anywhere}.opp-overview,.opp-progress-panel,.opp-documents-panel,.opp-history-panel,.opp-list-panel{margin-bottom:15px;padding:20px}.opp-overview-heading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}.opp-overview-heading h1{font-size:22px;margin:8px 0 5px;letter-spacing:-.03em}.opp-overview-heading p{margin:0;color:var(--muted);font-size:13px}.opp-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:15px 20px;border-top:1px solid var(--line);margin-top:18px;padding-top:16px}.opp-facts>div{min-width:0}.opp-facts label,.opp-action-summary span{display:block;font-size:11px;color:var(--muted);margin-bottom:5px}.opp-facts strong{display:block;overflow-wrap:anywhere;font-size:13px;line-height:1.55}.opp-fact-wide{grid-column:1/-1}.opp-linked-values{display:flex;flex-direction:column;gap:4px}.opp-linked-values span{font-size:12px;line-height:1.6;overflow-wrap:anywhere;color:var(--ink,#162c28)}.opp-current-banner{display:flex;align-items:center;gap:12px;padding:11px 13px;background:#edf5f0;border:1px solid #dceae2;border-radius:8px;color:#285944}.opp-current-banner>span:first-child{font-size:11px}.opp-current-banner strong{font-size:13px}.opp-current-time{margin-left:auto;font-size:11px;color:#557765}.opp-steps{display:flex;align-items:stretch;overflow-x:auto;padding:21px 4px 17px}.opp-step{border:0;background:none;min-width:110px;flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0 6px;color:#73817b;cursor:pointer}.opp-step-mark{width:29px;height:29px;display:grid;place-items:center;border-radius:50%;border:1px solid #cad4cd;background:#fff;font-size:12px}.opp-step-label{font-size:12px;color:var(--ink)}.opp-step small{font-size:10px;color:var(--muted)}.opp-step.complete .opp-step-mark{border-color:#43846a;background:#e3f2e9;color:#276648}.opp-step.current .opp-step-mark{border:2px solid #176b55;background:#176b55;color:#fff;box-shadow:0 0 0 4px #dcefe4}.opp-step.current .opp-step-label{font-weight:700;color:#176b55}.opp-step.terminated .opp-step-mark{border-color:#a64a39;background:#a64a39}.opp-step-line{height:1px;min-width:22px;flex:1;background:#dce3de;align-self:flex-start;margin-top:14px}.opp-step-line.passed{background:#4b9871}.opp-flow-actions{border-top:1px solid #edf1ee;padding-top:14px}.opp-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}.opp-section-head h2{font-size:17px;margin:5px 0}.opp-section-head p{font-size:11px;color:var(--muted);margin:0}.opp-round-tabs{display:flex;gap:7px;overflow-x:auto;padding:8px 0}.opp-round-tabs button{display:flex;gap:10px;align-items:center;border:1px solid var(--line);background:#fbfcfb;border-radius:7px;padding:8px 11px;color:var(--ink);cursor:pointer;white-space:nowrap}.opp-round-tabs button.active{border-color:#6c9b80;background:#eef5f0}.opp-round-tabs strong{font-size:11px}.opp-round-tabs span{font-size:10px;color:var(--muted)}.opp-run-meta{display:flex;align-items:center;gap:13px;color:var(--muted);font-size:11px;padding:5px 0 10px}.opp-document{display:grid;grid-template-columns:minmax(200px,1fr) minmax(160px,.8fr) auto;gap:16px;align-items:start;border-top:1px solid var(--line);padding:15px 2px}.opp-document.voided{opacity:.72}.opp-document-main{min-width:0}.opp-document-title{display:flex;align-items:center;gap:8px}.opp-document-title strong{font-size:13px}.opp-document-main p{margin:5px 0;font-size:11px;color:#65756e}.opp-document-main .opp-document-description{white-space:pre-wrap;overflow-wrap:anywhere;color:#4f5f58;line-height:1.6}.opp-document-main small{display:block;color:var(--muted);font-size:10px;margin-top:8px}.opp-attachments{display:flex;flex-direction:column;align-items:flex-start;gap:6px}.opp-file-link{border:0;background:none;color:#176b55;text-align:left;overflow-wrap:anywhere;font-size:11px;cursor:pointer;padding:3px 0}.opp-file-link:hover{text-decoration:underline}.opp-doc-empty{border-top:1px solid var(--line)}.opp-history-panel .ops-timeline p{font-size:12px;color:#65756e;margin:4px 0 0}.opp-filters{display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:11px;margin-bottom:14px}.opp-filters label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--muted)}.opp-table{min-width:980px}.opp-table td{white-space:normal}.opp-row-link{display:block;border:0;background:none;text-align:left;color:inherit;padding:0;cursor:pointer}.opp-row-link strong,.opp-row-link small{display:block}.opp-row-link strong{font:11px 'DM Mono',monospace;color:#176b55}.opp-row-link small{font-size:12px;color:var(--ink);margin-top:4px}.opp-stage-label{font-weight:600}.opp-sub-label{display:block;color:#9c4d3e;font-size:10px;margin-top:4px}.opp-no-results{text-align:center!important;padding:30px!important;color:var(--muted)!important}.opp-list-loading{text-align:center;padding:13px;color:var(--muted);font-size:12px}.opp-error-inline{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;margin-bottom:10px;border:1px solid #efd2ca;background:#fff7f4;border-radius:7px;color:#994532;font-size:12px}.opp-error-panel{padding:24px}.opp-error-panel>strong{font-size:15px}.opp-error-panel p{color:#994532}.opp-action-summary{display:grid;grid-template-columns:1fr 1.3fr;gap:8px 14px;padding:12px;background:#f4f7f4;border-radius:8px;margin-bottom:13px}.opp-action-summary span{margin:0}.opp-action-summary strong{font-size:12px}.opp-inline-hint{background:#fbf5e9;border:1px solid #eee0c6;border-radius:6px;padding:9px 11px;color:#725a31;font-size:11px;line-height:1.6}.opp-file-input{font-size:12px;max-width:100%}.opp-selected-files{list-style:none;margin:8px 0 0;padding:0;width:100%}.opp-selected-files li{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--line);padding:6px 0;font-size:11px}.opp-selected-files li span{overflow-wrap:anywhere}.full{width:100%}.ops-error{line-height:1.5}.opp-row-link:focus-visible,.opp-file-link:focus-visible,.opp-step:focus-visible,.opp-round-tabs button:focus-visible{outline:2px solid #176b55;outline-offset:3px}
.opp-business-fields{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px}.opp-business-fields span{font-size:11px;color:#53665e}.opp-business-fields b{font-weight:600;color:#718078;margin-right:5px}@media(max-width:900px){.opp-facts{grid-template-columns:repeat(2,minmax(0,1fr))}.opp-filters{grid-template-columns:repeat(2,minmax(0,1fr))}.opp-document{grid-template-columns:1fr minmax(140px,.8fr)}.opp-document>.el-button{grid-column:2;justify-self:end}.opp-step{min-width:96px}}
@media(max-width:600px){.opp-overview,.opp-progress-panel,.opp-documents-panel,.opp-history-panel,.opp-list-panel{padding:16px}.opp-overview-heading{align-items:flex-start}.opp-overview-heading h1{font-size:18px}.opp-facts{grid-template-columns:1fr 1fr;gap:12px}.opp-current-banner{flex-wrap:wrap}.opp-current-time{margin-left:0;width:100%}.opp-steps{margin-inline:-9px}.opp-step{min-width:83px}.opp-step-line{min-width:10px}.opp-section-head{align-items:flex-start;flex-direction:column}.opp-section-head>.ops-actions{width:100%}.opp-document{grid-template-columns:1fr}.opp-document>.el-button{grid-column:auto;justify-self:start}.opp-filters{grid-template-columns:1fr}.opp-back-title{gap:2px;flex-direction:column;flex:1;min-width:0;align-self:flex-start}.opp-back-title h1{font-size:17px;overflow-wrap:anywhere}.opp-action-summary{grid-template-columns:1fr 1fr}.opp-toolbar{align-items:stretch}.opportunity-toolbar>.ops-actions{width:100%}}
</style>
