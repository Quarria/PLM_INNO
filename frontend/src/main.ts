import { createApp } from 'vue'
import {
  ElButton, ElCheckbox, ElCheckboxGroup, ElDatePicker, ElDialog, ElDrawer, ElEmpty,
  ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElLoading, ElOption, ElPagination,
  ElRadioButton, ElRadioGroup, ElSelect, ElTable, ElTableColumn, ElTag, ElTooltip,
} from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'

const app = createApp(App)
for (const component of [
  ElButton, ElCheckbox, ElCheckboxGroup, ElDatePicker, ElDialog, ElDrawer, ElEmpty,
  ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElOption, ElPagination, ElRadioButton, ElRadioGroup,
  ElSelect, ElTable, ElTableColumn, ElTag, ElTooltip,
]) app.component(component.name!, component)
app.directive('loading', ElLoading.directive)
app.mount('#app')
