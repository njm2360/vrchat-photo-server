import { useState } from 'react'
import type { ImageItem } from '../api/images'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

function SortBtn({ col, label, sort, order, onSort }: {
  col: string
  label: string
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (col: string) => void
}) {
  if (!onSort) return <span>{label}</span>
  const active = sort === col
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 cursor-pointer transition-colors whitespace-nowrap ${
        active ? 'text-[#e0e0e0]' : 'hover:text-[#e0e0e0]'
      }`}
    >
      {label}
      <span className="text-[9px] ml-0.5 opacity-60">
        {active ? (order === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </button>
  )
}

interface Props {
  items: ImageItem[]
  total: number
  offset: number
  pageSize: number
  loading: boolean
  error: string
  deletingId: string | null
  sort?: string
  order?: 'asc' | 'desc'
  onDelete: (item: ImageItem) => void
  onPageChange: (offset: number) => void
  onSort?: (col: string) => void
}

export default function ImageList({
  items, total, offset, pageSize, loading, error, deletingId,
  sort, order, onDelete, onPageChange, onSort,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copyUrl(item: ImageItem) {
    await navigator.clipboard.writeText(item.url)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const totalPages = Math.ceil(total / pageSize)
  const currentPage = Math.floor(offset / pageSize)

  const btnClass = 'px-2 py-1 text-xs rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer'

  if (loading) return <p className="text-sm text-[#aaa] py-8 text-center">読み込み中...</p>
  if (error) return <p className="text-sm text-red-400 py-4">{error}</p>
  if (items.length === 0) return <p className="text-sm text-[#555] py-8 text-center">画像がありません</p>

  const pageNums: number[] = []
  for (let i = Math.max(0, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
    pageNums.push(i)
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse min-w-max text-sm">
          <thead>
            <tr className="border-b border-[#333]">
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal"></th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal">
                <SortBtn col="filename" label="ファイル名" sort={sort} order={order} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal whitespace-nowrap">サイズ(px)</th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal">
                <SortBtn col="size_bytes" label="ファイルサイズ" sort={sort} order={order} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal">
                <SortBtn col="uploaded_at" label="アップロード日" sort={sort} order={order} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal">
                <SortBtn col="expires_at" label="有効期限" sort={sort} order={order} onSort={onSort} />
              </th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal whitespace-nowrap">状態</th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal whitespace-nowrap">URL</th>
              <th className="px-3 py-2 text-left text-xs text-[#aaa] font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={`border-b border-[#2a2a2a] ${item.expired ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2">
                  {item.expired ? (
                    <img src={item.thumb_url} alt={item.filename} className="w-12 h-12 object-cover rounded border border-[#444] grayscale" />
                  ) : (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <img src={item.thumb_url} alt={item.filename} className="w-12 h-12 object-cover rounded border border-[#444]" />
                    </a>
                  )}
                </td>
                <td className="px-3 py-2 text-[#e0e0e0] whitespace-nowrap">
                  <span className="block max-w-[200px] overflow-hidden text-ellipsis" title={item.filename}>{item.filename}</span>
                </td>
                <td className="px-3 py-2 text-[#e0e0e0] whitespace-nowrap">{item.width}×{item.height}</td>
                <td className="px-3 py-2 text-[#e0e0e0] whitespace-nowrap">{formatBytes(item.size_bytes)}</td>
                <td className="px-3 py-2 text-[#888] text-xs whitespace-nowrap">{formatDate(item.uploaded_at)}</td>
                <td className="px-3 py-2 text-[#888] text-xs whitespace-nowrap">{formatDate(item.expires_at)}</td>
                <td className="px-3 py-2">
                  {item.expired
                    ? <span className="text-xs px-2 py-0.5 rounded bg-[#2a2a2a] text-[#888]">期限切れ</span>
                    : <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-400">有効</span>}
                </td>
                <td className="px-3 py-2">
                  {!item.expired && (
                    <div className="flex items-center gap-1">
                      <input
                        type="text" readOnly value={item.url}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        className="w-36 bg-[#2a2a2a] border border-[#444] rounded px-2 py-1 text-xs text-[#e0e0e0] focus:outline-none"
                      />
                      <button onClick={() => void copyUrl(item)} className={`${btnClass} whitespace-nowrap`}>
                        {copiedId === item.id ? 'コピー済' : 'コピー'}
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onDelete(item)}
                    disabled={deletingId === item.id}
                    className="px-2 py-1 text-xs rounded border border-red-800 text-red-400 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                  >
                    {deletingId === item.id ? '削除中...' : '削除'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 mt-4">
          <button
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
            disabled={currentPage === 0}
            className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            前へ
          </button>
          {pageNums.map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p * pageSize)}
              className={`px-2.5 py-1 text-xs rounded cursor-pointer ${
                p === currentPage
                  ? 'bg-[#0d6efd] text-white border border-[#0d6efd]'
                  : 'border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a]'
              }`}
            >
              {p + 1}
            </button>
          ))}
          <button
            onClick={() => onPageChange(Math.min((totalPages - 1) * pageSize, offset + pageSize))}
            disabled={currentPage === totalPages - 1}
            className={`${btnClass} disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            次へ
          </button>
          <span className="ml-2 text-xs text-[#888]">{currentPage + 1} / {totalPages} ページ</span>
        </div>
      )}
    </div>
  )
}
