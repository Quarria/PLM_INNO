export type OpportunityRow = Record<string, any>

export async function opportunityRequest<T = any>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api${path}`, { ...options, headers })
  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    try {
      const body = await response.json()
      message = Array.isArray(body.message) ? body.message.join('；') : body.message || message
    } catch { /* keep status message */ }
    throw new Error(message)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const opportunityBody = (value: unknown) => JSON.stringify(value)
export const opportunityStages = [
  { code: 'sampling', label: '打样' },
  { code: 'delivery', label: '送样' },
  { code: 'feedback', label: '客户反馈' },
  { code: 'contract', label: '合同' },
  { code: 'completed', label: '完成' },
] as const

export function opportunityDate(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('zh-CN')
}
export function opportunityDateTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
export const opportunityStageLabel = (code: string) => opportunityStages.find((stage) => stage.code === code)?.label || code || '—'
export const opportunityStatusLabel = (status: string) => ({ in_progress: '跟进中', completed: '已完成', terminated: '已终止' } as Record<string, string>)[status] || status || '—'
