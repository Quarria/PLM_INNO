<script setup lang="ts">
import CampaignsPanel from './operations/CampaignsPanel.vue'
import SalesPanel from './operations/SalesPanel.vue'
import InventoryPanel from './operations/InventoryPanel.vue'

withDefaults(defineProps<{
  section: 'campaigns' | 'sales' | 'inventory' | string
  token: string
  permissions: string[]
  initialProductId?: string
}>(), { initialProductId: '' })
</script>

<template>
  <main class="ops-workspace">
    <CampaignsPanel v-if="section === 'campaigns'" :token="token" :permissions="permissions" :initial-product-id="initialProductId" />
    <SalesPanel v-else-if="section === 'sales'" :token="token" :permissions="permissions" :initial-product-id="initialProductId" />
    <InventoryPanel v-else :token="token" :permissions="permissions" :initial-product-id="initialProductId" />
  </main>
</template>

<style>
.ops-workspace { color: var(--ink, #292820); }
.ops-toolbar { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:18px; }
.ops-toolbar .section-lead { margin-top:5px; }
.ops-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.ops-toolbar > .ops-actions { flex:0 0 auto; justify-content:flex-end; max-width:100%; }
.ops-actions .el-button + .el-button { margin-left:0; }
.ops-panel { margin-bottom:16px; }
.ops-panel > h3 { margin:0 22px 12px; color:var(--ink,#292820); font-size:15px; }
.ops-panel > .ops-pagination { padding:12px 22px; }
.ops-panel > .ops-detail { padding: 0 22px; }
.ops-panel > .ops-inline { padding-inline: 22px; }
.ops-tabs { display:flex; align-items:center; gap:5px; margin-bottom:14px; padding-bottom:8px; border-bottom:1px solid var(--line,#e5e1d8); }
.ops-tabs button { padding:8px 12px; border:0; border-radius:3px; background:transparent; color:var(--muted,#777269); cursor:pointer; }
.ops-tabs button.active { background:#f1eee6; color:var(--ink,#292820); box-shadow:inset 0 -2px var(--red,#963c29); }
.ops-table-wrap { overflow:auto; border:1px solid var(--line,#e5e1d8); background:var(--paper,#fff); }
.ops-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:13px; }
.ops-table th { height:40px; padding:8px 11px; background:#f2f0ea; color:#615b52; text-align:left; font-size:12px; font-weight:600; }
.ops-table td { height:57px; padding:9px 11px; border-top:1px solid #e5e1d8; color:#48453f; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ops-table tr:hover td { background:#faf9f5; }
.ops-table .ops-row-title { color:var(--ink,#292820); font-weight:600; }
.ops-row-actions { display:flex; align-items:center; gap:6px; white-space:nowrap; }
.ops-search { width:min(300px,100%); }
.ops-pagination { display:flex; align-items:center; justify-content:flex-end; gap:8px; padding:12px 0 2px; color:var(--muted,#777269); font-size:12px; }
.ops-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 14px; }
.ops-form-grid > .span-two { grid-column:1/-1; }
.ops-dialog { max-width: calc(100vw - 32px); }
.ops-dialog .el-form-item { display: flex; flex-direction: column; align-items: stretch; min-width: 0; }
.ops-dialog .el-form-item__label { justify-content: flex-start; width: auto; height: auto; line-height: 1.5; padding: 0 0 8px; }
.ops-dialog .el-form-item__content { width: 100%; min-width: 0; margin-left: 0 !important; }
.ops-dialog .el-form-item__content > .el-select,
.ops-dialog .el-form-item__content > .el-date-editor,
.ops-dialog .el-form-item__content > .el-input-number { width: 100%; }
.ops-inline { display:flex; align-items:center; gap:8px; min-width:0; }
.ops-inline > * { min-width:0; }
.ops-rule-row,.ops-line-row { display:grid; grid-template-columns:1.1fr 120px 130px 110px 1fr auto; gap:8px; align-items:center; padding:10px 0; border-top:1px solid var(--line,#e5e1d8); }
.ops-muted { color:var(--muted,#777269); font-size:12px; }
.ops-detail { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 24px; margin-bottom:16px; }
.ops-detail > div { min-width:0; }
.ops-detail > .span-two { grid-column:1/-1; }
.ops-detail label { display:block; color:var(--muted,#777269); font-size:11px; margin-bottom:4px; }
.ops-detail strong { display:block; overflow-wrap:anywhere; color:var(--ink,#292820); font-size:13px; line-height:1.6; }
.ops-timeline { border-left:1px solid #d8d2c6; margin:8px 0 4px 7px; padding-left:19px; }
.ops-timeline article { position:relative; padding:0 0 17px; }
.ops-timeline article:before { content:''; position:absolute; width:8px; height:8px; left:-24px; top:4px; border-radius:50%; background:var(--red,#963c29); }
.ops-timeline strong,.ops-timeline span { display:block; }
.ops-timeline span { margin-top:3px; color:var(--muted,#777269); font-size:12px; }
.ops-empty { padding:35px 12px; text-align:center; color:var(--muted,#777269); }
.ops-error { color:#9a3d2b; font-size:12px; margin:8px 0; }
.ops-chip { display:inline-block; max-width:100%; padding:3px 7px; border:1px solid #e2d8c9; border-radius:3px; background:#f5f1e9; color:#625e56; font-size:11px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; }
@media(max-width:800px){.ops-toolbar{align-items:flex-start;flex-direction:column}.ops-toolbar>.ops-actions{justify-content:flex-start}.ops-form-grid,.ops-detail{grid-template-columns:1fr}.ops-form-grid>.span-two,.ops-detail>.span-two{grid-column:auto}.ops-panel>.ops-detail,.ops-panel>.ops-inline{padding-inline:16px}.ops-panel>h3{margin-inline:16px}.ops-panel>.ops-pagination{padding-inline:16px}.ops-rule-row{grid-template-columns:1fr 1fr}.ops-line-row{grid-template-columns:1fr 1fr}.ops-table{min-width:720px}.ops-actions{width:100%}}
</style>
