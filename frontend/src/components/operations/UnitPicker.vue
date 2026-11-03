<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { opsRequest, pageParams, type Row } from './shared'

const props=withDefaults(defineProps<{token:string;productId?:string;status?:string;warehouseId?:string;reservedOrderId?:string;dispatchOrderId?:string;multiple?:boolean;modelValue?:string[]}>(),{multiple:true,modelValue:()=>[]})
const emit=defineEmits<{ 'update:modelValue':[value:string[]]; change:[units:Row[]] }>()
const q=ref(''),page=ref(1),size=ref(10),rows=ref<Row[]>([]),total=ref(0),loading=ref(false),error=ref('')
const selected=computed(()=>new Set(props.modelValue))
let timer:ReturnType<typeof setTimeout>|undefined,requestId=0
async function load(){const request=++requestId;loading.value=true;error.value='';try{const params=pageParams(page.value,size.value,q.value);if(props.productId)params.set('product_id',props.productId);if(props.status)params.set('status',props.status);if(props.warehouseId)params.set('warehouse_id',props.warehouseId);if(props.reservedOrderId)params.set('reserved_order_id',props.reservedOrderId);if(props.dispatchOrderId)params.set('dispatch_order_id',props.dispatchOrderId);const result=await opsRequest<{items:Row[];total:number}>(props.token,`/units?${params}`);if(request!==requestId)return;rows.value=result.items;total.value=result.total}catch(e){if(request===requestId)error.value=e instanceof Error?e.message:'单件查询失败'}finally{if(request===requestId)loading.value=false}}
watch([()=>props.productId,()=>props.status,()=>props.warehouseId,()=>props.reservedOrderId,()=>props.dispatchOrderId],()=>{page.value=1;void load()})
watch(page,()=>void load())
watch(size,()=>{page.value=1;void load()})
watch(q,()=>{clearTimeout(timer);page.value=1;timer=setTimeout(()=>void load(),280)})
onMounted(()=>void load())
function toggle(unit:Row){const values=new Set(props.modelValue);if(values.has(unit.id))values.delete(unit.id);else{if(!props.multiple)values.clear();values.add(unit.id)}const next=[...values];emit('update:modelValue',next);emit('change',next.map(id=>rows.value.find(row=>row.id===id)).filter(Boolean) as Row[])}
function label(unit:Row){return [unit.sku,unit.serial_number||unit.batch_number,unit.status==='available'?'可用':unit.status,unit.warehouse_name].filter(Boolean).join(' · ')}
</script>

<template><div class="ops-unit-picker"><div class="ops-inline" style="margin-bottom:8px"><el-input v-model="q" clearable placeholder="搜索型号、序列号或批次"/><el-select v-model="size" style="width:105px"><el-option :value="10" label="10 条/页"/><el-option :value="20" label="20 条/页"/><el-option :value="50" label="50 条/页"/></el-select></div><p v-if="error" class="ops-error">{{ error }}</p><div class="ops-unit-list"><label v-for="unit in rows" :key="unit.id" class="ops-unit-option"><el-checkbox :model-value="selected.has(unit.id)" @change="toggle(unit)"/><span :title="label(unit)"><strong>{{ unit.serial_number||unit.batch_number||unit.id }}</strong><small>{{ unit.sku }} · {{ unit.name }} · {{ unit.status==='available'?'可用':unit.status }}{{ unit.warehouse_name?` · ${unit.warehouse_name}`:'' }}</small></span></label><div v-if="!rows.length&&!loading" class="ops-muted" style="padding:14px;text-align:center">没有符合条件的单件</div></div><div class="ops-pagination" style="justify-content:space-between"><span>已选 {{ modelValue.length }} 件 · 共 {{ total }} 件</span><div class="ops-inline"><el-button :disabled="page<=1" @click="page--">上一页</el-button><span>第 {{ page }} 页</span><el-button :disabled="page*size>=total" @click="page++">下一页</el-button></div></div></div></template>

<style scoped>.ops-unit-picker{width:100%;min-width:0}.ops-unit-list{max-height:260px;overflow:auto;border:1px solid var(--line,#e5e1d8);background:#fff}.ops-unit-option{display:flex;align-items:center;gap:8px;min-height:45px;padding:7px 10px;border-bottom:1px solid #eee9df;cursor:pointer}.ops-unit-option span{min-width:0}.ops-unit-option strong,.ops-unit-option small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ops-unit-option strong{font-size:12px}.ops-unit-option small{margin-top:2px;color:#777269;font-size:11px}</style>
