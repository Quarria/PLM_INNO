<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { opsRequest, type Row } from './shared'

const props = defineProps<{ token: string; modelValue?: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; select: [product: Row | null] }>()
const query = ref('')
const results = ref<Row[]>([])
const selected = ref<Row | null>(null)
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const opened = ref(false)
let requestId = 0
let selectedLookup = 0
let timer: ReturnType<typeof setTimeout> | undefined

watch(() => props.modelValue, async (id) => {
  const lookup = ++selectedLookup
  if (!id) { selected.value = null; return }
  if (selected.value?.id === id) return
  try {
    const result = await opsRequest<{ items: Row[]; hasMore: boolean }>(props.token, `/catalog?id=${encodeURIComponent(id)}&page=1`)
    if (lookup === selectedLookup && props.modelValue === id) selected.value = result.items.find((p) => p.id === id) || null
  } catch (e) { ElMessage.error(e instanceof Error ? e.message : '商品读取失败') }
}, { immediate: true })

function search(value: string, reset = true) {
  query.value = value
  if (reset) { page.value = 1; results.value = [] }
  clearTimeout(timer)
  timer = setTimeout(() => { void load() }, 240)
}
async function load() {
  const request = ++requestId
  loading.value = true
  try {
    const result = await opsRequest<{ items: Row[]; hasMore: boolean }>(props.token, `/catalog?q=${encodeURIComponent(query.value.trim())}&page=${page.value}`)
    if (request !== requestId) return
    results.value = page.value === 1 ? result.items : [...results.value, ...result.items]
    hasMore.value = result.hasMore
  } catch (e) { if (request === requestId) ElMessage.error(e instanceof Error ? e.message : '商品搜索失败') }
  finally { if (request === requestId) loading.value = false }
}
function choose(product: Row) {
  selected.value = product; opened.value = false; query.value = ''
  emit('update:modelValue', product.id); emit('select', product)
}
function clear() { selected.value = null; emit('update:modelValue', ''); emit('select', null) }
function more() { page.value += 1; void load() }
</script>

<template>
  <div class="ops-product-picker" @keydown.esc="opened = false">
    <div class="ops-picker-selected" v-if="selected">
      <span :title="`${selected.sku} · ${selected.name}`"><strong>{{ selected.sku }}</strong> · {{ selected.name }}</span>
      <button type="button" aria-label="清除商品" @click="clear">×</button>
    </div>
    <el-input v-else v-model="query" :placeholder="placeholder || '搜索型号或商品名称'" @focus="opened = true; search(query)" @input="(v:string) => { opened = true; search(v) }" />
    <div v-if="opened && !selected" class="ops-picker-menu">
      <div v-if="loading && !results.length" class="ops-picker-note">正在搜索…</div>
      <button v-for="product in results" :key="product.id" type="button" class="ops-picker-option" @click="choose(product)">
        <span :title="`${product.sku} · ${product.name}`"><strong>{{ product.sku }}</strong> · {{ product.name }}</span>
      </button>
      <div v-if="!loading && !results.length" class="ops-picker-note">没有匹配的商品</div>
      <button v-if="hasMore" type="button" class="ops-picker-more" :disabled="loading" @click="more">{{ loading ? '正在加载…' : '加载更多商品' }}</button>
      <button type="button" class="ops-picker-close" @click="opened = false">收起</button>
    </div>
  </div>
</template>

<style scoped>
.ops-product-picker{position:relative;width:100%;min-width:0}.ops-picker-selected{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:40px;padding:0 10px;border:1px solid #c9cfc0;border-radius:4px;background:var(--paper,#fff);color:var(--ink,#292820);font-size:13px}.ops-picker-selected span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ops-picker-selected button{border:0;background:transparent;color:#9a3d2b;font-size:19px;cursor:pointer}.ops-picker-menu{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;max-height:300px;overflow:auto;border:1px solid #c9cfc0;border-radius:4px;background:var(--paper,#fff);box-shadow:0 8px 22px #25241d24}.ops-picker-option{display:grid;grid-template-columns:1fr;gap:3px;width:100%;padding:8px 11px;border:0;border-bottom:1px solid #eee9df;background:transparent;text-align:left;cursor:pointer}.ops-picker-option:hover{background:#f5f2eb}.ops-picker-option strong{font-size:12px;color:var(--ink,#292820)}.ops-picker-option strong small{margin-left:6px;font-weight:400;color:#777269}.ops-picker-option span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#48453f;font-size:13px}.ops-picker-option>small,.ops-picker-note{color:#777269;font-size:11px}.ops-picker-note{padding:13px;text-align:center}.ops-picker-more,.ops-picker-close{width:100%;padding:8px;border:0;background:#f7f5ef;color:#7d382a;cursor:pointer}.ops-picker-close{background:#fff;color:#777269}
</style>
