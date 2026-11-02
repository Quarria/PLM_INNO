<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type ProductOption = { id: string; sku: string; name: string; kind: string }
const props = withDefaults(defineProps<{ modelValue: string; token: string; excludeBundles?: boolean; excludeId?: string; placeholder?: string }>(), { excludeBundles: false, excludeId: '', placeholder: '搜索型号或名称' })
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [option: ProductOption | null] }>()
const options = ref<ProductOption[]>([])
const selected = ref<ProductOption | null>(null)
const loading = ref(false)
const error = ref('')
const query = ref('')
const page = ref(0)
const hasMore = ref(false)
let requestId = 0
let timer: ReturnType<typeof setTimeout> | undefined
const shownOptions = computed(() => selected.value && !options.value.some((o) => o.id === selected.value!.id) ? [selected.value, ...options.value] : options.value)
async function getOptions(params: URLSearchParams) {
  const response = await fetch(`/api/product-options?${params}`, { headers: { Authorization: `Bearer ${props.token}` } })
  if (!response.ok) throw new Error('商品加载失败，请重试')
  return await response.json() as { items: ProductOption[]; hasMore: boolean }
}
async function load(reset = false) {
  if (!reset && (loading.value || !hasMore.value)) return
  const id = ++requestId
  const nextPage = reset ? 1 : page.value + 1
  if (reset) { options.value = []; page.value = 0; hasMore.value = false }
  loading.value = true; error.value = ''
  const params = new URLSearchParams({ q: query.value, page: String(nextPage) })
  if (props.excludeBundles) params.set('excludeBundles', 'true')
  if (props.excludeId) params.set('excludeId', props.excludeId)
  try {
    const result = await getOptions(params)
    if (id !== requestId) return
    options.value = reset ? result.items : [...options.value, ...result.items.filter((item) => !options.value.some((existing) => existing.id === item.id))]
    page.value = nextPage; hasMore.value = result.hasMore
  } catch (e) { if (id === requestId) error.value = e instanceof Error ? e.message : '商品加载失败' }
  finally { if (id === requestId) loading.value = false }
}
function search(value: string) {
  query.value = value
  ++requestId
  options.value = []; page.value = 0; hasMore.value = false; loading.value = true
  clearTimeout(timer)
  timer = setTimeout(() => { void load(true) }, 300)
}
function opened(open: boolean) {
  if (open) { clearTimeout(timer); query.value = ''; void load(true) }
}
function choose(id: string) {
  const option = shownOptions.value.find((item) => item.id === id) || null
  selected.value = option; emit('update:modelValue', id); emit('change', option)
}
watch(() => props.modelValue, async (id) => {
  if (!id) { selected.value = null; return }
  if (selected.value?.id === id) return
  const existing = options.value.find((option) => option.id === id)
  if (existing) { selected.value = existing; return }
  try { const result = await getOptions(new URLSearchParams({ id })); if (props.modelValue === id) selected.value = result.items[0] || null }
  catch { if (props.modelValue === id) error.value = '已选商品加载失败' }
}, { immediate: true })
</script>

<template>
  <el-select :model-value="modelValue" :placeholder="placeholder" filterable remote :remote-method="search" :loading="loading" :reserve-keyword="false" class="product-select" @visible-change="opened" @change="choose" @end-reached="(direction: string) => direction === 'bottom' && load()">
    <el-option v-for="option in shownOptions" :key="option.id" :label="`${option.sku} · ${option.name}`" :value="option.id" />
    <template #empty><div class="product-select-message">{{ error || (loading ? '正在加载商品…' : '没有匹配的商品') }}</div></template>
    <template #footer><div v-if="error" class="product-select-message"><el-button link type="primary" @click.stop="load(true)">加载失败，点击重试</el-button></div><div v-else-if="hasMore" class="product-select-message"><el-button link type="primary" :loading="loading" @click.stop="load()">加载更多</el-button></div></template>
  </el-select>
</template>
