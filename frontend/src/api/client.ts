export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface RefreshData {
  access_token: string
  username: string
  is_admin: boolean
  is_impersonating: boolean
}

let accessToken: string | null = null
let refreshPromise: Promise<RefreshData | null> | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

// Decode JWT exp from payload without a library (base64url decode)
function tokenExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return (payload.exp as number) * 1000
  } catch {
    return 0
  }
}

function isTokenExpiringSoon(): boolean {
  if (!accessToken) return true
  return tokenExpiresAt(accessToken) - Date.now() < 60_000
}

async function doRefresh(): Promise<RefreshData | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST' })
  if (!res.ok) {
    accessToken = null
    return null
  }
  const data = (await res.json()) as RefreshData
  accessToken = data.access_token
  return data
}

// Shared, deduplicated refresh — used by both useAuth init and apiFetch auto-refresh.
// Only one HTTP request is ever in-flight at a time, preventing rotation conflicts.
export function triggerRefresh(): Promise<RefreshData | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (isTokenExpiringSoon()) {
    await triggerRefresh()
  }

  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) }
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const res = await fetch(path, { ...init, headers })

  if (res.status === 401) {
    const data = await triggerRefresh()
    if (data && accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`
      const retried = await fetch(path, { ...init, headers })
      if (!retried.ok) {
        const body = await retried.json().catch(() => ({ error: retried.statusText }))
        throw new ApiError(retried.status, (body as { error?: string }).error ?? retried.statusText)
      }
      return retried
    }
    throw new ApiError(401, 'unauthorized')
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText)
  }

  return res
}
