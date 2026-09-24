import type { components } from './schema'

type ErrorBody = components['schemas']['Error']

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

/** Deployment prefix without trailing slash: "" in dev, "/health" in production. */
export const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '')

/**
 * Prefixes an app-relative API path ("/api/me"). URLs returned by the API (attachment and
 * avatar URLs) already include the prefix and must be used as-is.
 */
export function apiUrl(path: string): string {
  return basePath + path
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(apiUrl(path), { credentials: 'same-origin', ...init, headers })

  if (!res.ok) {
    let body: ErrorBody | undefined
    try {
      body = (await res.json()) as ErrorBody
    } catch {
      body = undefined
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? 'http_error',
      body?.error.message ?? `请求失败（${res.status}）`,
      body?.error.fields,
    )
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
