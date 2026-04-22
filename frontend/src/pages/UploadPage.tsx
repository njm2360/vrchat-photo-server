import { useState, useRef, type FormEvent, type DragEvent } from 'react'
import { uploadImage, type ImageItem } from '../api/images'
import { ApiError } from '../api/client'
import { useAuth } from '../hooks/useAuth'

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff'

export default function UploadPage() {
  const { logout } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [maxWidth, setMaxWidth] = useState(2048)
  const [maxHeight, setMaxHeight] = useState(2048)
  const [rotate, setRotate] = useState(0)
  const [expireDays, setExpireDays] = useState(7)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImageItem | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)

  function handleDragEnter(e: DragEvent) {
    e.preventDefault()
    setDragCounter((c) => c + 1)
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault()
    setDragCounter((c) => c - 1)
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragCounter(0)
    const dropped = e.dataTransfer.files[0]
    if (dropped && dropped.type.startsWith('image/')) {
      setFile(dropped)
      if (fileInputRef.current) {
        const dt = new DataTransfer()
        dt.items.add(dropped)
        fileInputRef.current.files = dt.files
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('max_width', String(maxWidth))
      fd.append('max_height', String(maxHeight))
      fd.append('rotate', String(rotate))
      fd.append('expire_days', String(expireDays))
      const img = await uploadImage(fd)
      setResult(img)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout()
      } else {
        setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
      }
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setFile(null)
    setResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function copyUrl() {
    if (!result) return
    await navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inputClass =
    'bg-[#2a2a2a] border border-[#444] rounded px-3 py-1.5 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd] w-full'
  const labelClass = 'text-sm text-[#aaa] mb-1 block'

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragCounter > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 border-4 border-dashed border-[#0d6efd] pointer-events-none">
          <span className="text-white text-xl font-medium">
            ここにドロップしてアップロード
          </span>
        </div>
      )}

      <div className="max-w-lg mx-auto">
        <div className="bg-[#1e1e1e] border border-[#333] rounded-lg p-6">
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
            <div>
              <label className={labelClass} htmlFor="file">
                画像ファイル
              </label>
              <input
                id="file"
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="text-sm text-[#aaa] file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#2a2a2a] file:text-[#e0e0e0] file:cursor-pointer w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="maxWidth">
                  最大幅 (px)
                </label>
                <input
                  id="maxWidth"
                  type="number"
                  min={1}
                  max={2048}
                  value={maxWidth}
                  onChange={(e) => setMaxWidth(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="maxHeight">
                  最大高さ (px)
                </label>
                <input
                  id="maxHeight"
                  type="number"
                  min={1}
                  max={2048}
                  value={maxHeight}
                  onChange={(e) => setMaxHeight(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="rotate">
                  回転
                </label>
                <select
                  id="rotate"
                  value={rotate}
                  onChange={(e) => setRotate(Number(e.target.value))}
                  className={inputClass}
                >
                  <option value={0}>0°</option>
                  <option value={90}>90°</option>
                  <option value={180}>180°</option>
                  <option value={270}>270°</option>
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="expireDays">
                  有効期限
                </label>
                <select
                  id="expireDays"
                  value={expireDays}
                  onChange={(e) => setExpireDays(Number(e.target.value))}
                  className={inputClass}
                >
                  {[1, 3, 5, 7, 14, 21, 28].map((d) => (
                    <option key={d} value={d}>
                      {d}日
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium cursor-pointer"
            >
              {loading ? 'アップロード中...' : 'アップロード'}
            </button>
          </form>
        </div>

        {result && (
          <div className="mt-4 bg-[#1e1e1e] border border-[#333] rounded-lg p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-[#aaa]">アップロード完了</p>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs px-2 py-1 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer"
              >
                別の画像をアップロード
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                readOnly
                value={result.url}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 bg-[#2a2a2a] border border-[#444] rounded px-3 py-1.5 text-[#e0e0e0] text-sm focus:outline-none"
              />
              <button
                onClick={() => void copyUrl()}
                className="px-3 py-1.5 rounded border border-[#444] text-sm text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer whitespace-nowrap"
              >
                {copied ? 'コピーしました' : 'コピー'}
              </button>
            </div>
            <a href={result.url} target="_blank" rel="noreferrer">
              <img
                src={result.thumb_url}
                alt={result.filename}
                className="max-w-full rounded border border-[#444]"
              />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
