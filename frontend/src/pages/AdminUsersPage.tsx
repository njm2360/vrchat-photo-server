import { useState, useEffect, useCallback, useRef } from 'react'
import { setAccessToken } from '../api/client'
import { useNavigate } from 'react-router'
import {
  listUsers,
  createUser,
  deleteUser,
  deleteUserImages,
  resetPassword,
  setAdmin,
  renameUser,
  setDisabled,
  checkUsername,
  impersonateUser,
  revokeUserSessions,
  type UserSummary,
  type ListUsersQuery,
} from '../api/admin'
import { ApiError } from '../api/client'
import { useAuth } from '../hooks/useAuth'

const PAGE_SIZE = 20

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

type UsernameCheckState = 'idle' | 'checking' | 'available' | 'taken'

function UsernameInput({
  value, onChange, checkState, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  checkState: UsernameCheckState
  autoFocus?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-[#aaa]">ユーザー名</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className={`bg-[#2a2a2a] border rounded px-3 py-1.5 text-[#e0e0e0] text-sm focus:outline-none w-full ${checkState === 'available' ? 'border-green-600 focus:border-green-500' :
          checkState === 'taken' ? 'border-red-600 focus:border-red-500' :
            'border-[#444] focus:border-[#0d6efd]'
          }`}
      />
      <span className={`text-xs h-3 ${checkState === 'checking' ? 'text-[#666]' :
        checkState === 'available' ? 'text-green-500' :
          checkState === 'taken' ? 'text-red-400' : ''
        }`}>
        {checkState === 'checking' && '確認中...'}
        {checkState === 'available' && '使用可能'}
        {checkState === 'taken' && '既に使われています'}
      </span>
    </div>
  )
}

function useUsernameCheck(skipValue?: string) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<UsernameCheckState>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onChange(v: string) {
    setValue(v)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!v.trim()) { setState('idle'); return }
    if (skipValue && v.trim() === skipValue) { setState('idle'); return }
    setState('checking')
    timerRef.current = setTimeout(() => {
      checkUsername(v.trim())
        .then(({ available }) => setState(available ? 'available' : 'taken'))
        .catch(() => setState('idle'))
    }, 1000)
  }

  function reset(initialValue = '') {
    if (timerRef.current) clearTimeout(timerRef.current)
    setValue(initialValue)
    setState('idle')
  }

  const canSubmit = value.trim() !== '' &&
    state !== 'taken' &&
    state !== 'checking' &&
    (skipValue == null || value.trim() !== skipValue)

  return { value, state, onChange, reset, canSubmit }
}

function SortBtn({ col, label, sort, order, onSort }: {
  col: string; label: string; sort: string; order: 'asc' | 'desc'; onSort: (col: string) => void
}) {
  const active = sort === col
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 cursor-pointer transition-colors whitespace-nowrap font-medium ${active ? 'text-[#e0e0e0]' : 'hover:text-[#e0e0e0]'}`}
    >
      {label}
      <span className="text-[9px] ml-0.5 opacity-60">{active ? (order === 'asc' ? '▲' : '▼') : '⇅'}</span>
    </button>
  )
}

export default function AdminUsersPage() {
  const { username: selfUsername, isAdmin: selfIsAdmin, updateAuth } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<UserSummary[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(false)

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const createUsername = useUsernameCheck()
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)

  // PW reset modal
  const [resetTarget, setResetTarget] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [showResetPw, setShowResetPw] = useState(false)

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<UserSummary | null>(null)
  const renameUsername = useUsernameCheck(renameTarget?.username)
  const [renameError, setRenameError] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  // Action menu
  const [actionMenuUser, setActionMenuUser] = useState<UserSummary | null>(null)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Row actions
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [disablingId, setDisablingId] = useState<string | null>(null)
  const [clearingImagesId, setClearingImagesId] = useState<string | null>(null)

  // Filter / sort
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'disabled'>('')
  const [roleFilter, setRoleFilter] = useState<'' | 'admin' | 'user'>('')
  const [sort, setSort] = useState<NonNullable<ListUsersQuery['sort']>>('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async (off: number) => {
    setListLoading(true)
    try {
      const data = await listUsers({
        limit: PAGE_SIZE,
        offset: off,
        search: debouncedSearch || undefined,
        role: (roleFilter || undefined) as ListUsersQuery['role'],
        status: (statusFilter || undefined) as ListUsersQuery['status'],
        sort,
        order,
      })
      setUsers(data.users ?? [])
      setTotal(data.total)
      setOffset(off)
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ユーザー一覧の取得に失敗しました')
    } finally {
      setListLoading(false)
    }
  }, [debouncedSearch, roleFilter, statusFilter, sort, order])

  useEffect(() => { void load(0) }, [load])

  useEffect(() => {
    const anyOpen = showCreate || !!resetTarget || !!renameTarget || !!actionMenuUser
    if (!anyOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      closeCreate()
      closeReset()
      closeRename()
      setActionMenuUser(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showCreate, resetTarget, renameTarget, actionMenuUser]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(col: string) {
    if (col === sort) setOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    else { setSort(col as NonNullable<ListUsersQuery['sort']>); setOrder('desc') }
  }

  function closeCreate() {
    setShowCreate(false)
    createUsername.reset()
    setNewPassword('')
    setNewIsAdmin(false)
    setShowNewPw(false)
    setCreateError('')
  }

  function closeReset() {
    setResetTarget(null)
    setResetPw('')
    setResetError('')
    setShowResetPw(false)
  }

  function closeRename() {
    setRenameTarget(null)
    renameUsername.reset()
    setRenameError('')
  }

  async function handleCreate() {
    setCreateError('')
    setCreateLoading(true)
    try {
      await createUser(createUsername.value.trim(), newPassword, newIsAdmin)
      closeCreate()
      await load(0)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : '作成に失敗しました')
    } finally {
      setCreateLoading(false)
    }
  }

  async function handleRevokeSessions(user: UserSummary) {
    if (!window.confirm(`「${user.username}」の全セッションを無効化しますか？\n次回アクセス時に再ログインが必要になります。`)) return
    try {
      await revokeUserSessions(user.id)
      await load(offset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'セッションの無効化に失敗しました')
    }
  }

  async function handleImpersonate(user: UserSummary) {
    if (!window.confirm(`「${user.username}」としてログインしますか？`)) return
    try {
      const data = await impersonateUser(user.id)
      setAccessToken(data.access_token)
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'なりすましに失敗しました')
    }
  }

  async function handleDelete(user: UserSummary) {
    if (!window.confirm(`ユーザー「${user.username}」を削除しますか？\n画像も全て削除されます。`)) return
    setDeletingId(user.id)
    try {
      await deleteUser(user.id)
      await load(offset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '削除に失敗しました')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleToggleAdmin(user: UserSummary) {
    const next = !user.is_admin
    const msg = next
      ? `「${user.username}」に管理者権限を付与しますか？`
      : `「${user.username}」の管理者権限を剥奪しますか？`
    if (!window.confirm(msg)) return
    setTogglingId(user.id)
    try {
      await setAdmin(user.id, next)
      await load(offset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '権限変更に失敗しました')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleToggleDisabled(user: UserSummary) {
    const next = !user.is_disabled
    const msg = next
      ? `「${user.username}」を無効化しますか？\nログインできなくなり、既存のセッションも削除されます。`
      : `「${user.username}」を有効化しますか？`
    if (!window.confirm(msg)) return
    setDisablingId(user.id)
    try {
      await setDisabled(user.id, next)
      await load(offset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '変更に失敗しました')
    } finally {
      setDisablingId(null)
    }
  }

  async function handleClearImages(user: UserSummary) {
    if (!window.confirm(`「${user.username}」の画像を全て削除しますか？`)) return
    setClearingImagesId(user.id)
    try {
      await deleteUserImages(user.id)
      await load(offset)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '削除に失敗しました')
    } finally {
      setClearingImagesId(null)
    }
  }

  async function handleResetPassword() {
    if (!resetTarget) return
    setResetError('')
    setResetLoading(true)
    try {
      await resetPassword(resetTarget, resetPw)
      closeReset()
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : 'リセットに失敗しました')
    } finally {
      setResetLoading(false)
    }
  }

  async function handleRename() {
    if (!renameTarget) return
    setRenameError('')
    setRenameLoading(true)
    try {
      const newName = renameUsername.value.trim()
      await renameUser(renameTarget.id, newName)
      if (renameTarget.username === selfUsername) {
        updateAuth(newName, selfIsAdmin)
      }
      closeRename()
      await load(offset)
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : '変更に失敗しました')
    } finally {
      setRenameLoading(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE)
  const pageNums: number[] = []
  for (let i = Math.max(0, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
    pageNums.push(i)
  }

  const btnCls = 'text-sm px-3 py-1.5 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer'
  const pgBtnCls = 'px-2 py-1 text-xs rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-[#e0e0e0]">ユーザー管理</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => void load(offset)} disabled={listLoading} className={btnCls}>
            {listLoading ? '読込中...' : '更新'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-3 py-1.5 rounded bg-[#0d6efd] hover:bg-blue-600 text-white cursor-pointer"
          >
            + 新規ユーザー作成
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-900/30 border border-red-700 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ユーザー名で検索..."
          className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-1 text-sm text-[#e0e0e0] placeholder-[#555] focus:outline-none focus:border-[#666]"
        />
        <div className="flex gap-1">
          {(['', 'active', 'disabled'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`px-2 py-1 text-xs rounded border cursor-pointer transition-colors ${statusFilter === f ? 'border-[#0d6efd] text-[#0d6efd] bg-[#0d6efd]/10' : 'border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'}`}>
              {{ '': '全て', active: '有効', disabled: '無効' }[f]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['', 'admin', 'user'] as const).map(f => (
            <button key={f} onClick={() => setRoleFilter(f)}
              className={`px-2 py-1 text-xs rounded border cursor-pointer transition-colors ${roleFilter === f ? 'border-[#0d6efd] text-[#0d6efd] bg-[#0d6efd]/10' : 'border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'}`}>
              {{ '': '全ロール', admin: '管理者', user: '一般' }[f]}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[#555]">{total} 件</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#333]">
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr className="bg-[#1e1e1e] text-[#aaa] text-left">
              <th className="px-4 py-2.5">
                <SortBtn col="username" label="ユーザー名" sort={sort} order={order} onSort={handleSort} />
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">管理者</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">状態</th>
              <th className="px-4 py-2.5">
                <SortBtn col="created_at" label="作成日" sort={sort} order={order} onSort={handleSort} />
              </th>
              <th className="px-4 py-2.5">
                <SortBtn col="last_login_at" label="最終ログイン" sort={sort} order={order} onSort={handleSort} />
              </th>
              <th className="px-4 py-2.5 text-right">
                <SortBtn col="image_count" label="画像数" sort={sort} order={order} onSort={handleSort} />
              </th>
              <th className="px-4 py-2.5 text-right">
                <SortBtn col="storage_bytes" label="ストレージ" sort={sort} order={order} onSort={handleSort} />
              </th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user, i) => (
              <tr
                key={user.id}
                className={`border-t border-[#2a2a2a] ${i % 2 === 0 ? 'bg-[#161616]' : 'bg-[#121212]'} ${user.is_disabled ? 'opacity-50' : ''}`}
              >
                <td className="px-4 py-2.5 text-[#e0e0e0] font-medium">
                  {user.username}
                  {user.username === selfUsername && (
                    <span className="ml-1.5 text-xs text-[#666]">(自分)</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {user.is_admin
                    ? <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-400 border border-blue-700">管理者</span>
                    : <span className="text-[#555] text-xs">—</span>}
                </td>
                <td className="px-4 py-2.5">
                  {user.is_disabled
                    ? <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">無効</span>
                    : <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/30 text-green-500 border border-green-800">有効</span>}
                </td>
                <td className="px-4 py-2.5 text-[#888] text-xs">{formatDate(user.created_at)}</td>
                <td className="px-4 py-2.5 text-[#888] text-xs">{formatDate(user.last_login_at)}</td>
                <td className="px-4 py-2.5 text-[#aaa] text-right">{user.image_count}</td>
                <td className="px-4 py-2.5 text-[#aaa] text-right">{formatBytes(user.storage_bytes)}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setMenuPos({ x: rect.left, y: rect.bottom + 4 })
                      setActionMenuUser(user)
                    }}
                    className="text-sm px-2 py-0.5 rounded border border-[#444] text-[#aaa] hover:border-[#666] hover:text-[#e0e0e0] cursor-pointer leading-tight"
                    title="操作"
                  >
                    ···
                  </button>
                </td>
              </tr>
            ))}
            {listLoading && users.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[#555]">読み込み中...</td></tr>
            )}
            {!listLoading && users.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-[#555]">
                {search || statusFilter || roleFilter ? '条件に一致するユーザーがいません' : 'ユーザーがいません'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 mt-4">
          <button
            onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
            disabled={currentPage === 0}
            className={pgBtnCls}
          >
            前へ
          </button>
          {pageNums.map(p => (
            <button
              key={p}
              onClick={() => void load(p * PAGE_SIZE)}
              className={`px-2.5 py-1 text-xs rounded cursor-pointer ${p === currentPage
                ? 'bg-[#0d6efd] text-white border border-[#0d6efd]'
                : 'border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
                }`}
            >
              {p + 1}
            </button>
          ))}
          <button
            onClick={() => void load(Math.min((totalPages - 1) * PAGE_SIZE, offset + PAGE_SIZE))}
            disabled={currentPage === totalPages - 1}
            className={pgBtnCls}
          >
            次へ
          </button>
          <span className="ml-2 text-xs text-[#888]">{currentPage + 1} / {totalPages} ページ</span>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeCreate}>
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-6 w-96 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[#e0e0e0] font-medium mb-4">新規ユーザー作成</h2>
            <div className="flex flex-col gap-3">
              <UsernameInput value={createUsername.value} onChange={createUsername.onChange} checkState={createUsername.state} autoFocus />
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#aaa]">パスワード（8文字以上）</label>
                <div className="relative">
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-1.5 pr-14 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd] w-full"
                  />
                  <button type="button" onClick={() => setShowNewPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#888] hover:text-[#aaa]">
                    {showNewPw ? '非表示' : '表示'}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-[#aaa] cursor-pointer">
                <input type="checkbox" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} className="accent-[#0d6efd]" />
                管理者
              </label>
              {createError && <p className="text-red-400 text-sm">{createError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button onClick={closeCreate} className="text-sm px-3 py-1.5 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] cursor-pointer">
                  キャンセル
                </button>
                <button
                  onClick={() => void handleCreate()}
                  disabled={createLoading || !createUsername.canSubmit || newPassword.length < 8}
                  className="text-sm px-3 py-1.5 rounded bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
                >
                  {createLoading ? '作成中...' : '作成'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PW reset modal */}
      {resetTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeReset}>
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[#e0e0e0] font-medium mb-4">パスワードリセット</h2>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#aaa]">新しいパスワード（8文字以上）</label>
                <div className="relative">
                  <input
                    type={showResetPw ? 'text' : 'password'}
                    value={resetPw}
                    onChange={(e) => setResetPw(e.target.value)}
                    autoFocus
                    className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-1.5 pr-14 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd] w-full"
                  />
                  <button type="button" onClick={() => setShowResetPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#888] hover:text-[#aaa]">
                    {showResetPw ? '非表示' : '表示'}
                  </button>
                </div>
              </div>
              {resetError && <p className="text-red-400 text-sm">{resetError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button onClick={closeReset} className="text-sm px-3 py-1.5 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] cursor-pointer">
                  キャンセル
                </button>
                <button
                  onClick={() => void handleResetPassword()}
                  disabled={resetLoading || resetPw.length < 8}
                  className="text-sm px-3 py-1.5 rounded bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
                >
                  {resetLoading ? 'リセット中...' : 'リセット'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action dropdown menu */}
      {actionMenuUser && (
        <div className="fixed inset-0 z-50" onClick={() => setActionMenuUser(null)}>
          <div
            className="absolute bg-[#1e1e1e] border border-[#333] rounded-lg shadow-xl py-1 w-48"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setActionMenuUser(null); void navigate(`/admin/users/${actionMenuUser.id}/images`) }}
              className="w-full text-sm px-4 py-2 text-left text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] cursor-pointer"
            >
              画像一覧
            </button>
            <button
              onClick={() => { setActionMenuUser(null); setRenameTarget(actionMenuUser); renameUsername.reset(actionMenuUser.username); setRenameError('') }}
              className="w-full text-sm px-4 py-2 text-left text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] cursor-pointer"
            >
              名前変更
            </button>
            {actionMenuUser.username !== selfUsername && (<>
              <button
                onClick={() => { setActionMenuUser(null); void handleImpersonate(actionMenuUser) }}
                className="w-full text-sm px-4 py-2 text-left text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] cursor-pointer"
              >
                なりすましログイン
              </button>
              <button
                onClick={() => { setActionMenuUser(null); setResetTarget(actionMenuUser.id); setResetPw(''); setResetError(''); setShowResetPw(false) }}
                className="w-full text-sm px-4 py-2 text-left text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0] cursor-pointer"
              >
                パスワードリセット
              </button>
              <div className="my-1 border-t border-[#2a2a2a]" />
              <button
                onClick={() => { setActionMenuUser(null); void handleToggleAdmin(actionMenuUser) }}
                disabled={togglingId === actionMenuUser.id}
                className={`w-full text-sm px-4 py-2 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${actionMenuUser.is_admin ? 'text-orange-400 hover:bg-orange-900/20' : 'text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]'}`}
              >
                {togglingId === actionMenuUser.id ? '変更中...' : actionMenuUser.is_admin ? '管理者権限を解除' : '管理者権限を付与'}
              </button>
              <button
                onClick={() => { setActionMenuUser(null); void handleToggleDisabled(actionMenuUser) }}
                disabled={disablingId === actionMenuUser.id}
                className={`w-full text-sm px-4 py-2 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${actionMenuUser.is_disabled ? 'text-green-500 hover:bg-green-900/20' : 'text-yellow-500 hover:bg-yellow-900/20'}`}
              >
                {disablingId === actionMenuUser.id ? '変更中...' : actionMenuUser.is_disabled ? 'アカウントを有効化' : 'アカウントを無効化'}
              </button>
              <div className="my-1 border-t border-[#2a2a2a]" />
              <button
                onClick={() => { setActionMenuUser(null); void handleDelete(actionMenuUser) }}
                disabled={deletingId === actionMenuUser.id}
                className="w-full text-sm px-4 py-2 text-left text-red-500 hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {deletingId === actionMenuUser.id ? '削除中...' : 'ユーザーを削除'}
              </button>
            </>)}
            <div className="my-1 border-t border-[#2a2a2a]" />
            <button
              onClick={() => { setActionMenuUser(null); void handleRevokeSessions(actionMenuUser) }}
              className="w-full text-sm px-4 py-2 text-left text-red-500 hover:bg-red-900/20 cursor-pointer"
            >
              セッションを全て無効化
            </button>
            <button
              onClick={() => { setActionMenuUser(null); void handleClearImages(actionMenuUser) }}
              disabled={clearingImagesId === actionMenuUser.id}
              className="w-full text-sm px-4 py-2 text-left text-red-500 hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {clearingImagesId === actionMenuUser.id ? '削除中...' : '画像を全て削除'}
            </button>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeRename}>
          <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[#e0e0e0] font-medium mb-1">ユーザー名変更</h2>
            <p className="text-xs text-[#666] mb-4">現在: {renameTarget.username}</p>
            <div className="flex flex-col gap-3">
              <UsernameInput value={renameUsername.value} onChange={renameUsername.onChange} checkState={renameUsername.state} autoFocus />
              {renameError && <p className="text-red-400 text-sm">{renameError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button onClick={closeRename} className="text-sm px-3 py-1.5 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] cursor-pointer">
                  キャンセル
                </button>
                <button
                  onClick={() => void handleRename()}
                  disabled={renameLoading || !renameUsername.canSubmit}
                  className="text-sm px-3 py-1.5 rounded bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white cursor-pointer"
                >
                  {renameLoading ? '変更中...' : '変更'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
