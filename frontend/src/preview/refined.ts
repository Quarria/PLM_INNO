import { createApp } from 'vue'
import DesignPreview from './DesignPreview.vue'
import './preview.css'
import './ledger.css'
import './refined.css'
createApp(DesignPreview, { refined: true }).mount('#app')
