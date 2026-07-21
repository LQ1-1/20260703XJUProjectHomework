const DEFAULT_API_BASE = '/api'

export function getApiBaseUrl(): string {
  return trimTrailingSlash(import.meta.env.VITE_API_BASE || DEFAULT_API_BASE)
}

export function getWsBaseUrl(): string | undefined {
  const base = import.meta.env.VITE_WS_BASE?.trim()
  return base ? trimTrailingSlash(base) : undefined
}

export function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${getApiBaseUrl()}${normalizedPath}`
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
