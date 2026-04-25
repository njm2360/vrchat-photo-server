import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  listUserImages,
  adminDeleteImage,
  type ImageItem,
  type ListImagesQuery,
} from "../api/images";
import ImageList from "../components/ImageList";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "expired";
type SortCol = ListImagesQuery["sort"] & string;

export default function AdminUserImagesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [items, setItems] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [filename, setFilename] = useState("");
  const [debouncedFilename, setDebouncedFilename] = useState("");
  const [sort, setSort] = useState<SortCol>("uploaded_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilename(filename), 500);
    return () => clearTimeout(t);
  }, [filename]);

  const expired = statusFilter === "all" ? undefined : statusFilter === "expired";

  const load = useCallback(
    async (off: number) => {
      if (!id) return;
      setLoading(true);
      setError("");
      try {
        const res = await listUserImages(id, {
          limit: PAGE_SIZE,
          offset: off,
          sort: sort as ListImagesQuery["sort"],
          order,
          filename: debouncedFilename || undefined,
          expired,
        });
        setItems(res.items);
        setTotal(res.total);
        setOffset(off);
      } catch {
        setError("読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    },
    [id, sort, order, debouncedFilename, expired],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  function handleSort(col: string) {
    if (col === sort) {
      setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSort(col as SortCol);
      setOrder("desc");
    }
  }

  async function handleDelete(item: ImageItem) {
    if (!window.confirm(`「${item.filename}」を削除しますか？`)) return;
    setDeletingId(item.id);
    try {
      await adminDeleteImage(item.id);
      await load(offset);
    } catch {
      setError("削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  const btnCls =
    "text-xs px-2 py-1 rounded border border-[#444] text-[#aaa] hover:text-[#e0e0e0] hover:bg-[#2a2a2a] cursor-pointer";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => void navigate("/admin/users")} className={btnCls}>
          ← ユーザー管理に戻る
        </button>
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="ファイル名で検索..."
          className="rounded border border-[#444] bg-[#2a2a2a] px-3 py-1 text-sm text-[#e0e0e0] placeholder-[#555] focus:border-[#666] focus:outline-none"
        />
        <div className="flex gap-1">
          {(["all", "active", "expired"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`cursor-pointer rounded border px-2 py-1 text-xs transition-colors ${
                statusFilter === f
                  ? "border-[#0d6efd] bg-[#0d6efd]/10 text-[#0d6efd]"
                  : "border-[#444] text-[#aaa] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
              }`}
            >
              {{ all: "全て", active: "有効", expired: "期限切れ" }[f]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-[#aaa]">{total > 0 ? `全 ${total} 件` : ""}</span>
          <button
            onClick={() => void load(offset)}
            disabled={loading}
            className={`${btnCls} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            更新
          </button>
        </div>
      </div>
      <ImageList
        items={items}
        total={total}
        offset={offset}
        pageSize={PAGE_SIZE}
        loading={loading}
        error={error}
        deletingId={deletingId}
        sort={sort}
        order={order}
        onSort={handleSort}
        onDelete={(item) => void handleDelete(item)}
        onPageChange={(off) => void load(off)}
      />
    </div>
  );
}
