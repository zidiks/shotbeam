/*
 * HTTP client for the local engine, used by the UI and the MCP server alike.
 * Every route lives under /api; errors come back as { error } with a 4xx/5xx status.
 */

export const DEFAULT_ENGINE_PORT = 47811

export class EngineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export class EngineClient {
  constructor(
    readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  url(path: string): string {
    const u = `${this.baseUrl}${path}`
    if (!this.token) return u
    return `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) throw new EngineError(data?.error ?? `${res.status} ${res.statusText}`, res.status)
    return data as T
  }

  get<T>(path: string) {
    return this.request<T>('GET', path)
  }
  post<T>(path: string, body: unknown = {}) {
    return this.request<T>('POST', path, body)
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body)
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body)
  }
  del<T>(path: string) {
    return this.request<T>('DELETE', path)
  }
}

/** A change the engine announces over /api/events, so open views refresh. */
export type EngineEvent =
  | { type: 'changed'; entity: EntityName; id: string | null }
  | { type: 'job'; job: import('./model').Job }

export type EntityName =
  | 'project'
  | 'source'
  | 'asset'
  | 'reference'
  | 'format'
  | 'voice'
  | 'composition'
  | 'settings'

export function query(params: Record<string, string | number | boolean | null | undefined>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}
