import { useState } from "react";
import type { ImageItem } from "../api/images";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function SortBtn({
  col,
  label,
  sort,
  order,
  onSort,
}: {
  col: string;
  label: string;
  sort?: string;
  order?: "asc" | "desc";
  onSort?: (col: string) => void;
}) {
  if (!onSort) return <span>{label}</span>;
  const active = sort === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex cursor-pointer items-center gap-0.5 whitespace-nowrap transition-colors ${
        active ? "text-[#e0e0e0]" : "hover:text-[#e0e0e0]"
      }`}
    >
      {label}
      <span className="ml-0.5 text-[9px] opacity-60">
        {active ? (order === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </button>
  );
}

interface Props {
  items: ImageItem[];
  total: number;
  offset: number;
  pageSize: number;
  loading: boolean;
  error: string;
  deletingId: string | null;
  sort?: string;
  order?: "asc" | "desc";
  onDelete: (item: ImageItem) => void;
  onPageChange: (offset: number) => void;
  onSort?: (col: string) => void;
}

export default function ImageList({
  items,
  total,
  offset,
  pageSize,
  loading,
  error,
  deletingId,
  sort,
  order,
  onDelete,
  onPageChange,
  onSort,
}: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyUrl(item: ImageItem) {
    await navigator.clipboard.writeText(item.url);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const totalPages = Math.ceil(total / pageSize);
  const currentPage = Math.floor(offset / pageSize);

  const btnClass =
    "px-2 py-1 text-xs rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer";

  if (loading) return <p className="py-8 text-center text-sm text-[#aaa]">読み込み中...</p>;
  if (error) return <p className="py-4 text-sm text-red-400">{error}</p>;
  if (items.length === 0)
    return <p className="py-8 text-center text-sm text-[#555]">画像がありません</p>;

  const pageNums: number[] = [];
  for (let i = Math.max(0, currentPage - 2); i <= Math.min(totalPages - 1, currentPage + 2); i++) {
    pageNums.push(i);
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#333]">
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]"></th>
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]">
                <SortBtn
                  col="filename"
                  label="ファイル名"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal whitespace-nowrap text-[#aaa]">
                サイズ(px)
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]">
                <SortBtn
                  col="size_bytes"
                  label="ファイルサイズ"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]">
                <SortBtn
                  col="uploaded_at"
                  label="アップロード日"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]">
                <SortBtn
                  col="expires_at"
                  label="有効期限"
                  sort={sort}
                  order={order}
                  onSort={onSort}
                />
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal whitespace-nowrap text-[#aaa]">
                状態
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal whitespace-nowrap text-[#aaa]">
                URL
              </th>
              <th className="px-3 py-2 text-left text-xs font-normal text-[#aaa]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={`border-b border-[#2a2a2a] ${item.expired ? "opacity-50" : ""}`}
              >
                <td className="px-3 py-2">
                  {item.expired ? (
                    <img
                      src={item.thumb_url}
                      alt={item.filename}
                      className="h-12 w-12 rounded border border-[#444] object-cover grayscale"
                    />
                  ) : (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <img
                        src={item.thumb_url}
                        alt={item.filename}
                        className="h-12 w-12 rounded border border-[#444] object-cover"
                      />
                    </a>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[#e0e0e0]">
                  <span
                    className="block max-w-[200px] overflow-hidden text-ellipsis"
                    title={item.filename}
                  >
                    {item.filename}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[#e0e0e0]">
                  {item.width}×{item.height}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-[#e0e0e0]">
                  {formatBytes(item.size_bytes)}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-[#888]">
                  {formatDate(item.uploaded_at)}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap text-[#888]">
                  {formatDate(item.expires_at)}
                </td>
                <td className="px-3 py-2">
                  {item.expired ? (
                    <span className="rounded bg-[#2a2a2a] px-2 py-0.5 text-xs text-[#888]">
                      期限切れ
                    </span>
                  ) : (
                    <span className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-400">
                      有効
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {!item.expired && (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        readOnly
                        value={item.url}
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                        className="w-36 rounded border border-[#444] bg-[#2a2a2a] px-2 py-1 text-xs text-[#e0e0e0] focus:outline-none"
                      />
                      <button
                        onClick={() => void copyUrl(item)}
                        className={`${btnClass} whitespace-nowrap`}
                      >
                        {copiedId === item.id ? "コピー済" : "コピー"}
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onDelete(item)}
                    disabled={deletingId === item.id}
                    className="cursor-pointer rounded border border-red-800 px-2 py-1 text-xs whitespace-nowrap text-red-400 hover:bg-red-900/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === item.id ? "削除中..." : "削除"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(0, offset - pageSize))}
            disabled={currentPage === 0}
            className={`${btnClass} disabled:cursor-not-allowed disabled:opacity-30`}
          >
            前へ
          </button>
          {pageNums.map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p * pageSize)}
              className={`cursor-pointer rounded px-2.5 py-1 text-xs ${
                p === currentPage
                  ? "border border-[#0d6efd] bg-[#0d6efd] text-white"
                  : "border border-[#444] text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
              }`}
            >
              {p + 1}
            </button>
          ))}
          <button
            onClick={() => onPageChange(Math.min((totalPages - 1) * pageSize, offset + pageSize))}
            disabled={currentPage === totalPages - 1}
            className={`${btnClass} disabled:cursor-not-allowed disabled:opacity-30`}
          >
            次へ
          </button>
          <span className="ml-2 text-xs text-[#888]">
            {currentPage + 1} / {totalPages} ページ
          </span>
        </div>
      )}
    </div>
  );
}
