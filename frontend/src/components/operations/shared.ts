export type Row = Record<string, any>

export async function opsRequest<T = any>(token: string, path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`/api/operations${path}`, { ...options, headers })
  if (!response.ok) {
    let message = `操作失败（${response.status}）`
    try {
      const body = await response.json()
      message = Array.isArray(body.message) ? body.message.join('；') : body.message || message
    } catch { /* use status message */ }
    throw new Error(message)
  }
  return response.status === 204 ? undefined as T : response.json()
}

export const jsonBody = (value: unknown) => JSON.stringify(value)
export const money = (value: unknown) => `¥${Number(value || 0).toFixed(2)}`
export const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
export function localDateTimeInput(value = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`
}
export const can = (permissions: string[], permission: string) => permissions.includes('*') || permissions.includes(permission)
export function apiError(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试' }
export function pageParams(page: number, size: number, q: string) {
  return new URLSearchParams({ page: String(page), size: String(size), q: q.trim() })
}
