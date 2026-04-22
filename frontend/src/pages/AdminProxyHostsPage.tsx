import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import {
  listProxyHosts,
  createProxyHost,
  deleteProxyHost,
  setProxyHostEnabled,
  updateProxyHostNote,
  checkProxyHost,
  type ProxyAllowedHost,
} from '../api/admin'
import { ApiError } from '../api/client'

const PAGE_SIZE = 20

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

function Pagination({
  total, offset, pageSize, onPageChange,
}: {
  total: number; offset: number; pageSize: number; onPageChange: (off: number) => void
}) {
  const totalPages = Math.ceil(total / pageSize)
  const currentPage = Math.floor(offset / pageSize)
  if (totalPages <= 1) return null
  const pages: number[] = []
  for (let p = Math.max(0, currentPage - 2); p <= Math.min(totalPages - 1, currentPage + 2); p++) {
    pages.push(p)
  }
  const btnCls = 'px-2 py-1 text-xs rounded border cursor-pointer transition-colors'
  return (
    <div className="flex items-center gap-1 mt-4 justify-center">
      <button
        disabled={currentPage === 0}
        onClick={() => onPageChange((currentPage - 1) * pageSize)}
        className={`${btnCls} border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] disabled:opacity-40 disabled:cursor-not-allowed`}
      >前へ</button>
      {pages.map(p => (
        <button
          key={p}
          onClick={() => onPageChange(p * pageSize)}
          className={`${btnCls} ${p === currentPage
            ? 'border-[#0d6efd] text-[#0d6efd] bg-[#0d6efd]/10'
            : 'border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'}`}
        >{p + 1}</button>
      ))}
      <button
        disabled={currentPage >= totalPages - 1}
        onClick={() => onPageChange((currentPage + 1) * pageSize)}
        className={`${btnCls} border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] disabled:opacity-40 disabled:cursor-not-allowed`}
      >次へ</button>
    </div>
  )
}

export default function AdminProxyHostsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ProxyAllowedHost[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [patternSearch, setPatternSearch] = useState('')
  const [debouncedPattern, setDebouncedPattern] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [addPattern, setAddPattern] = useState('')
  const [addNote, setAddNote] = useState('')
  const [addError, setAddError] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const [checkUrl, setCheckUrl] = useState('')
  const [checkResult, setCheckResult] = useState<{ allowed: boolean; matched_pattern: string | null } | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)

  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteValue, setEditingNoteValue] = useState('')
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPattern(patternSearch), 500)
    return () => clearTimeout(t)
  }, [patternSearch])

  const load = useCallback(async (off: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await listProxyHosts({
        limit: PAGE_SIZE,
        offset: off,
        pattern: debouncedPattern || undefined,
      })
      setItems(res.items ?? [])
      setTotal(res.total)
      setOffset(off)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [debouncedPattern])

  useEffect(() => { void load(0) }, [load])

  async function handleAdd() {
    setAddError('')
    setAddLoading(true)
    try {
      await createProxyHost(addPattern.trim(), addNote.trim())
      setShowAdd(false)
      setAddPattern('')
      setAddNote('')
      await load(offset)
    } catch (err) {
      setAddError(err instanceof ApiError ? (err.message || '登録に失敗しました') : '登録に失敗しました')
    } finally {
      setAddLoading(false)
    }
  }

  async function handleCheck() {
    if (!checkUrl.trim()) return
    setCheckLoading(true)
    setCheckResult(null)
    try {
      const res = await checkProxyHost(checkUrl.trim())
      setCheckResult(res)
    } catch {
      setError('チェックに失敗しました')
    } finally {
      setCheckLoading(false)
    }
  }

  async function handleToggle(item: ProxyAllowedHost) {
    setTogglingId(item.id)
    try {
      await setProxyHostEnabled(item.id, !item.enabled)
      await load(offset)
    } catch {
      setError('更新に失敗しました')
    } finally {
      setTogglingId(null)
    }
  }

  function startEditNote(item: ProxyAllowedHost) {
    setEditingNoteId(item.id)
    setEditingNoteValue(item.note)
    setTimeout(() => noteInputRef.current?.focus(), 0)
  }

  async function saveNote(id: string) {
    setSavingNoteId(id)
    try {
      await updateProxyHostNote(id, editingNoteValue)
      setEditingNoteId(null)
      await load(offset)
    } catch {
      setError('メモの更新に失敗しました')
    } finally {
      setSavingNoteId(null)
    }
  }

  async function handleDelete(item: ProxyAllowedHost) {
    if (!window.confirm(`「${item.pattern}」を削除しますか？`)) return
    setDeletingId(item.id)
    try {
      await deleteProxyHost(item.id)
      await load(offset)
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeletingId(null)
    }
  }

  const btnCls = 'text-xs px-2 py-1 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => void navigate('/admin/users')} className={btnCls}>
          ← ユーザー管理に戻る
        </button>
        <input
          type="text"
          value={patternSearch}
          onChange={e => setPatternSearch(e.target.value)}
          placeholder="パターンで検索..."
          className="flex-1 min-w-48 bg-[#2a2a2a] border border-[#444] rounded px-3 py-1 text-sm text-[#e0e0e0] placeholder-[#555] focus:outline-none focus:border-[#666]"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[#aaa]">{total > 0 ? `全 ${total} 件` : ''}</span>
          <button
            onClick={() => void load(offset)}
            disabled={loading}
            className={`${btnCls} disabled:opacity-50 disabled:cursor-not-allowed`}
          >更新</button>
          <button
            onClick={() => { setShowAdd(true); setAddPattern(''); setAddNote(''); setAddError('') }}
            className="text-xs px-3 py-1 rounded border border-[#0d6efd] text-[#0d6efd] hover:bg-[#0d6efd]/10 cursor-pointer"
          >+ 追加</button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 p-3 bg-[#1a1a1a] border border-[#2a2a2a] rounded">
        <span className="text-xs text-[#666] whitespace-nowrap">URL チェック</span>
        <input
          type="text"
          value={checkUrl}
          onChange={e => { setCheckUrl(e.target.value); setCheckResult(null) }}
          onKeyDown={e => e.key === 'Enter' && void handleCheck()}
          placeholder="example.com または https://example.com/image.png"
          className="flex-1 bg-[#2a2a2a] border border-[#444] rounded px-3 py-1 text-sm text-[#e0e0e0] placeholder-[#555] focus:outline-none focus:border-[#666] font-mono"
        />
        <button
          onClick={() => void handleCheck()}
          disabled={checkLoading || !checkUrl.trim()}
          className={`${btnCls} disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap`}
        >
          {checkLoading ? '確認中...' : '確認'}
        </button>
        {checkResult && (
          checkResult.allowed
            ? <span className="text-xs text-green-400 whitespace-nowrap">
              ✓ 許可 <span className="text-[#666]">({checkResult.matched_pattern})</span>
            </span>
            : <>
              <span className="text-xs text-red-400 whitespace-nowrap">✗ 拒否</span>
              <button
                onClick={() => {
                  const host = (() => { try { return new URL(checkUrl).hostname } catch { return checkUrl } })()
                  setAddPattern(host)
                  setAddNote('')
                  setAddError('')
                  setShowAdd(true)
                }}
                className="text-xs px-2 py-0.5 rounded border border-[#0d6efd] text-[#0d6efd] hover:bg-[#0d6efd]/10 cursor-pointer whitespace-nowrap"
              >
                このホストを許可する
              </button>
            </>
        )}
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {loading && items.length === 0 ? (
        <p className="text-[#666] text-sm">読み込み中...</p>
      ) : items.length === 0 ? (
        <p className="text-[#666] text-sm">許可ホストがありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[#ccc] border-collapse">
            <thead>
              <tr className="border-b border-[#333] text-[#888] text-xs">
                <th className="text-left py-2 pr-3 font-normal">パターン</th>
                <th className="text-left py-2 pr-3 font-normal">メモ</th>
                <th className="text-left py-2 pr-3 font-normal">状態</th>
                <th className="text-left py-2 pr-3 font-normal whitespace-nowrap">追加日時 / 追加者</th>
                <th className="text-left py-2 pr-3 font-normal whitespace-nowrap">更新日時 / 更新者</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-[#2a2a2a] hover:bg-[#1a1a1a]">
                  <td className="py-2 pr-3">
                    <span className="font-mono text-sm text-[#e0e0e0]">{item.pattern}</span>
                  </td>
                  <td className="py-2 pr-3 max-w-xs">
                    {editingNoteId === item.id ? (
                      <form
                        onSubmit={e => { e.preventDefault(); void saveNote(item.id) }}
                        className="flex items-center gap-1"
                      >
                        <input
                          ref={noteInputRef}
                          type="text"
                          value={editingNoteValue}
                          onChange={e => setEditingNoteValue(e.target.value)}
                          className="flex-1 min-w-0 bg-[#2a2a2a] border border-[#555] rounded px-2 py-0.5 text-xs text-[#e0e0e0] focus:outline-none focus:border-[#0d6efd]"
                          onKeyDown={e => e.key === 'Escape' && setEditingNoteId(null)}
                        />
                        <button
                          type="submit"
                          disabled={savingNoteId === item.id}
                          className="text-xs px-1.5 py-0.5 rounded border border-[#0d6efd] text-[#0d6efd] hover:bg-[#0d6efd]/10 disabled:opacity-50 cursor-pointer"
                        >
                          {savingNoteId === item.id ? '...' : '保存'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNoteId(null)}
                          className="text-xs px-1.5 py-0.5 rounded border border-[#444] text-[#888] hover:text-[#ccc] cursor-pointer"
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <button
                        onClick={() => startEditNote(item)}
                        className="text-xs text-[#888] hover:text-[#ccc] text-left w-full truncate group cursor-pointer"
                        title="クリックして編集"
                      >
                        {item.note
                          ? <span title={item.note}>{item.note}</span>
                          : <span className="text-[#444] group-hover:text-[#666]">メモを追加...</span>
                        }
                      </button>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => void handleToggle(item)}
                      disabled={togglingId === item.id}
                      className={`text-xs px-2 py-0.5 rounded border cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${item.enabled
                        ? 'border-green-700 text-green-400 hover:bg-red-900/20 hover:text-red-400 hover:border-red-700'
                        : 'border-[#555] text-[#666] hover:bg-green-900/20 hover:text-green-400 hover:border-green-700'
                        }`}
                      title={item.enabled ? 'クリックで無効化' : 'クリックで有効化'}
                    >
                      {togglingId === item.id ? '...' : item.enabled ? '有効' : '無効'}
                    </button>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="text-xs text-[#888]">{formatDate(item.created_at)}</div>
                    <div className="text-xs text-[#666]">{item.created_by_username}</div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="text-xs text-[#888]">{formatDate(item.updated_at)}</div>
                    <div className="text-xs text-[#666]">{item.updated_by_username}</div>
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => void handleDelete(item)}
                      disabled={deletingId === item.id}
                      className="text-xs px-2 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {deletingId === item.id ? '削除中...' : '削除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination total={total} offset={offset} pageSize={PAGE_SIZE} onPageChange={(off) => void load(off)} />

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-[#1e1e1e] border border-[#333] rounded-lg p-6 w-96 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-[#e0e0e0] mb-1">許可ホストを追加</h2>
            <p className="text-xs text-[#666] mb-4">
              例: <code className="text-[#aaa]">example.com</code>、
              <code className="text-[#aaa]">*.example.com</code>
            </p>
            <form onSubmit={e => { e.preventDefault(); void handleAdd() }} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#aaa]">パターン <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={addPattern}
                  onChange={e => { setAddPattern(e.target.value); setAddError('') }}
                  placeholder="example.com"
                  required
                  autoFocus
                  className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-2 text-[#e0e0e0] text-sm font-mono focus:outline-none focus:border-[#0d6efd] w-full"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#aaa]">メモ（任意）</label>
                <input
                  type="text"
                  value={addNote}
                  onChange={e => setAddNote(e.target.value)}
                  placeholder="追加理由など"
                  className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-2 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd] w-full"
                />
              </div>
              {addError && <p className="text-red-400 text-xs">{addError}</p>}
              <div className="flex gap-2 justify-end mt-1">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-3 py-1.5 text-sm text-[#aaa] hover:text-[#e0e0e0] cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={addLoading || addPattern.trim() === ''}
                  className="px-3 py-1.5 text-sm bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded cursor-pointer"
                >
                  {addLoading ? '登録中...' : '追加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
