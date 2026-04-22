import { apiFetch } from './client'

export interface UserSummary {
  id: string
  username: string
  is_admin: boolean
  is_disabled: boolean
  created_at: string
  last_login_at: string | null
  image_count: number
  storage_bytes: number
}

export interface ListUsersQuery {
  limit: number
  offset: number
  search?: string
  role?: 'admin' | 'user'
  status?: 'active' | 'disabled'
  sort?: 'username' | 'created_at' | 'last_login_at' | 'image_count' | 'storage_bytes'
  order?: 'asc' | 'desc'
}

export interface ListUsersResponse {
  users: UserSummary[]
  total: number
  limit: number
  offset: number
}

function buildUsersQuery(p: ListUsersQuery): string {
  const q = new URLSearchParams()
  q.set('limit', String(p.limit))
  q.set('offset', String(p.offset))
  if (p.search) q.set('search', p.search)
  if (p.role) q.set('role', p.role)
  if (p.status) q.set('status', p.status)
  if (p.sort) q.set('sort', p.sort)
  if (p.order) q.set('order', p.order)
  return q.toString()
}

export async function checkUsername(username: string): Promise<{ available: boolean }> {
  const res = await apiFetch(`/api/admin/users/check?username=${encodeURIComponent(username)}`)
  return res.json()
}

export async function listUsers(params: ListUsersQuery): Promise<ListUsersResponse> {
  const res = await apiFetch(`/api/admin/users?${buildUsersQuery(params)}`)
  return res.json()
}

export async function createUser(
  username: string,
  password: string,
  isAdmin: boolean,
): Promise<UserSummary> {
  const res = await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, is_admin: isAdmin }),
  })
  return res.json()
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' })
}

export async function resetPassword(id: string, password: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export async function setAdmin(id: string, isAdmin: boolean): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/admin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_admin: isAdmin }),
  })
}

export async function renameUser(id: string, username: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/username`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  })
}

export async function deleteUserImages(id: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/images`, { method: 'DELETE' })
}

export async function impersonateUser(id: string): Promise<{ access_token: string; username: string; is_admin: boolean }> {
  const res = await apiFetch(`/api/admin/users/${id}/impersonate`, { method: 'POST' })
  return res.json()
}

export async function revokeUserSessions(id: string): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/sessions`, { method: 'DELETE' })
}

export async function setDisabled(id: string, disabled: boolean): Promise<void> {
  await apiFetch(`/api/admin/users/${id}/disabled`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled }),
  })
}

export interface ProxyCacheItem {
  url: string
  file_id: string
  cached_at: string
  expires_at: string
}

export interface ListProxyCacheResponse {
  items: ProxyCacheItem[]
  total: number
  limit: number
  offset: number
}

export async function listProxyCache(params: {
  limit: number
  offset: number
  url?: string
  sort?: string
  order?: 'asc' | 'desc'
}): Promise<ListProxyCacheResponse> {
  const q = new URLSearchParams()
  q.set('limit', String(params.limit))
  q.set('offset', String(params.offset))
  if (params.url) q.set('url', params.url)
  if (params.sort) q.set('sort', params.sort)
  if (params.order) q.set('order', params.order)
  const res = await apiFetch(`/api/admin/proxy/cache?${q.toString()}`)
  return res.json()
}

export async function deleteProxyCache(url: string): Promise<void> {
  const q = new URLSearchParams({ url })
  await apiFetch(`/api/admin/proxy/cache?${q.toString()}`, { method: 'DELETE' })
}

export interface ProxyAllowedHost {
  id: string
  pattern: string
  note: string
  created_at: string
  created_by_username: string
  updated_at: string
  updated_by_username: string
  enabled: boolean
}

export interface ListProxyHostsResponse {
  items: ProxyAllowedHost[]
  total: number
  limit: number
  offset: number
}

export async function listProxyHosts(params: {
  limit: number
  offset: number
  pattern?: string
}): Promise<ListProxyHostsResponse> {
  const q = new URLSearchParams()
  q.set('limit', String(params.limit))
  q.set('offset', String(params.offset))
  if (params.pattern) q.set('pattern', params.pattern)
  const res = await apiFetch(`/api/admin/proxy/hosts?${q.toString()}`)
  return res.json()
}

export async function createProxyHost(pattern: string, note: string): Promise<ProxyAllowedHost> {
  const res = await apiFetch('/api/admin/proxy/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, note }),
  })
  return res.json()
}

export async function deleteProxyHost(id: string): Promise<void> {
  await apiFetch(`/api/admin/proxy/hosts/${id}`, { method: 'DELETE' })
}

export async function setProxyHostEnabled(id: string, enabled: boolean): Promise<void> {
  await apiFetch(`/api/admin/proxy/hosts/${id}/enabled`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

export async function checkProxyHost(url: string): Promise<{ allowed: boolean; matched_pattern: string | null }> {
  const q = new URLSearchParams({ url })
  const res = await apiFetch(`/api/admin/proxy/hosts/check?${q.toString()}`)
  return res.json()
}

export async function updateProxyHostNote(id: string, note: string): Promise<void> {
  await apiFetch(`/api/admin/proxy/hosts/${id}/note`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  })
}
