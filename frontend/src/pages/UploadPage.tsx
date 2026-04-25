import { useState, useRef, useEffect, type FormEvent } from "react";
import { uploadImage, type ImageItem } from "../api/images";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";

const ACCEPTED_TYPES = ".jpg,.jpeg,.png,.gif,.bmp,.webp,.tif,.tiff";

export default function UploadPage() {
  const { logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [maxWidth, setMaxWidth] = useState(2048);
  const [maxHeight, setMaxHeight] = useState(2048);
  const [rotate, setRotate] = useState(0);
  const [expireDays, setExpireDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImageItem | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let counter = 0;
    function onDragEnter(e: DragEvent) {
      e.preventDefault();
      counter++;
      setDragOver(true);
    }
    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      counter--;
      if (counter === 0) setDragOver(false);
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      counter = 0;
      setDragOver(false);
      const dropped = e.dataTransfer?.files[0];
      if (dropped && dropped.type.startsWith("image/")) {
        setFile(dropped);
        if (fileInputRef.current) {
          const dt = new DataTransfer();
          dt.items.add(dropped);
          fileInputRef.current.files = dt.files;
        }
      }
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("max_width", String(maxWidth));
      fd.append("max_height", String(maxHeight));
      fd.append("rotate", String(rotate));
      fd.append("expire_days", String(expireDays));
      const img = await uploadImage(fd);
      setResult(img);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await logout();
      } else {
        setError(err instanceof Error ? err.message : "アップロードに失敗しました");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setFile(null);
    setResult(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function copyUrl() {
    if (!result) return;
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputClass =
    "bg-[#2a2a2a] border border-[#444] rounded px-3 py-1.5 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd] w-full";
  const labelClass = "text-sm text-[#aaa] mb-1 block";

  return (
    <div className="relative">
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-[#0d6efd] bg-black/60">
          <span className="text-xl font-medium text-white">ここにドロップしてアップロード</span>
        </div>
      )}

      <div className="mx-auto max-w-lg">
        <div className="rounded-lg border border-[#333] bg-[#1e1e1e] p-6">
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
                className="w-full text-sm text-[#aaa] file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-[#2a2a2a] file:px-3 file:py-1.5 file:text-sm file:text-[#e0e0e0]"
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

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="cursor-pointer rounded bg-[#0d6efd] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "アップロード中..." : "アップロード"}
            </button>
          </form>
        </div>

        {result && (
          <div className="mt-4 rounded-lg border border-[#333] bg-[#1e1e1e] p-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-[#aaa]">アップロード完了</p>
              <button
                type="button"
                onClick={handleReset}
                className="cursor-pointer rounded border border-[#444] px-2 py-1 text-xs text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
              >
                別の画像をアップロード
              </button>
            </div>
            <div className="mb-4 flex gap-2">
              <input
                type="text"
                readOnly
                value={result.url}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 rounded border border-[#444] bg-[#2a2a2a] px-3 py-1.5 text-sm text-[#e0e0e0] focus:outline-none"
              />
              <button
                onClick={() => void copyUrl()}
                className="cursor-pointer rounded border border-[#444] px-3 py-1.5 text-sm whitespace-nowrap text-[#e0e0e0] hover:bg-[#2a2a2a]"
              >
                {copied ? "コピーしました" : "コピー"}
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
  );
}
