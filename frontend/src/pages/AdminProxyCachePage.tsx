import { useState, useEffect, useCallback } from 'react'
import { listProxyCache, deleteProxyCache, type ProxyCacheItem } from '../api/admin'

const PAGE_SIZE = 20

type StatusFilter = 'all' | 'active' | 'expired'
type SortCol = 'url' | 'cached_at' | 'expires_at'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

function SortBtn({ col, sort, order, onSort }: { col: SortCol; sort: SortCol; order: 'asc' | 'desc'; onSort: (col: string) => void }) {
  const active = sort === col
  return (
    <button onClick={() => onSort(col)} className="ml-1 text-[#666] hover:text-[#aaa] cursor-pointer">
      {active ? (order === 'asc' ? '▲' : '▼') : '⇅'}
    </button>
  )
}

function Pagination({ total, offset, pageSize, onPageChange }: { total: number; offset: number; pageSize: number; onPageChange: (off: number) => void }) {
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
          className={`${btnCls} ${p === currentPage ? 'border-[#0d6efd] text-[#0d6efd] bg-[#0d6efd]/10' : 'border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'}`}
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

export default function AdminProxyCachePage() {
  const [items, setItems] = useState<ProxyCacheItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null)

  const [urlSearch, setUrlSearch] = useState('')
  const [debouncedUrl, setDebouncedUrl] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortCol>('cached_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUrl(urlSearch), 500)
    return () => clearTimeout(t)
  }, [urlSearch])

  const load = useCallback(async (off: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await listProxyCache({
        limit: PAGE_SIZE,
        offset: off,
        url: debouncedUrl || undefined,
        sort,
        order,
      })
      setItems(res.items ?? [])
      setTotal(res.total)
      setOffset(off)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [debouncedUrl, sort, order])

  useEffect(() => { void load(0) }, [load])

  function handleSort(col: string) {
    const c = col as SortCol
    if (c === sort) {
      setOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(c)
      setOrder('desc')
    }
  }

  async function handleDelete(item: ProxyCacheItem) {
    if (!window.confirm(`以下のキャッシュを削除しますか？\n${item.url}`)) return
    setDeletingUrl(item.url)
    try {
      await deleteProxyCache(item.url)
      await load(offset)
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeletingUrl(null)
    }
  }

  const now = new Date()
  const filtered = statusFilter === 'all'
    ? items
    : items.filter(item => {
      const expired = new Date(item.expires_at) < now
      return statusFilter === 'expired' ? expired : !expired
    })

  const btnCls = 'text-xs px-2 py-1 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer'

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={urlSearch}
          onChange={e => setUrlSearch(e.target.value)}
          placeholder="URLで検索..."
          className="flex-1 min-w-48 bg-[#2a2a2a] border border-[#444] rounded px-3 py-1 text-sm text-[#e0e0e0] placeholder-[#555] focus:outline-none focus:border-[#666]"
        />
        <div className="flex gap-1">
          {(['all', 'active', 'expired'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-2 py-1 text-xs rounded border cursor-pointer transition-colors ${statusFilter === f
                ? 'border-[#0d6efd] text-[#0d6efd] bg-[#0d6efd]/10'
                : 'border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
                }`}
            >
              {{ all: '全て', active: '有効', expired: '期限切れ' }[f]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[#aaa]">{total > 0 ? `全 ${total} 件` : ''}</span>
          <button onClick={() => void load(offset)} disabled={loading} className={`${btnCls} disabled:opacity-50 disabled:cursor-not-allowed`}>
            更新
          </button>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

      {loading && filtered.length === 0 ? (
        <p className="text-[#666] text-sm">読み込み中...</p>
      ) : filtered.length === 0 ? (
        <p className="text-[#666] text-sm">キャッシュがありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-[#ccc] border-collapse">
            <thead>
              <tr className="border-b border-[#333] text-[#888] text-xs">
                <th className="text-left py-2 pr-4 font-normal">
                  URL
                  <SortBtn col="url" sort={sort} order={order} onSort={handleSort} />
                </th>
                <th className="text-left py-2 pr-4 font-normal whitespace-nowrap">
                  キャッシュ日時
                  <SortBtn col="cached_at" sort={sort} order={order} onSort={handleSort} />
                </th>
                <th className="text-left py-2 pr-4 font-normal whitespace-nowrap">
                  有効期限
                  <SortBtn col="expires_at" sort={sort} order={order} onSort={handleSort} />
                </th>
                <th className="text-left py-2 pr-4 font-normal">状態</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const expired = new Date(item.expires_at) < now
                return (
                  <tr key={item.url} className="border-b border-[#2a2a2a] hover:bg-[#1a1a1a]">
                    <td className="py-2 pr-4 max-w-xs">
                      <span
                        className="block truncate text-[#aaa] font-mono text-xs"
                        title={item.url}
                      >
                        {item.url}
                      </span>
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs text-[#888]">
                      {formatDate(item.cached_at)}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-xs text-[#888]">
                      {formatDate(item.expires_at)}
                    </td>
                    <td className="py-2 pr-4">
                      {expired
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-[#333] text-[#888]">期限切れ</span>
                        : <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/40 text-green-400">有効</span>
                      }
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => void handleDelete(item)}
                        disabled={deletingUrl === item.url}
                        className="text-xs px-2 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        {deletingUrl === item.url ? '削除中...' : '削除'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination total={total} offset={offset} pageSize={PAGE_SIZE} onPageChange={(off) => void load(off)} />
    </div>
  )
}
