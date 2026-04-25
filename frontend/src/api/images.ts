import { apiFetch } from "./client";

export interface ImageItem {
  id: string;
  url: string;
  thumb_url: string;
  filename: string;
  mime_type: string;
  width: number;
  height: number;
  size_bytes: number;
  uploaded_at: string;
  expires_at: string;
  expired: boolean;
}

export interface ListResponse {
  items: ImageItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListImagesQuery {
  limit: number;
  offset: number;
  sort?: "uploaded_at" | "expires_at" | "filename" | "size_bytes";
  order?: "asc" | "desc";
  expired?: boolean;
  filename?: string;
}

function buildQuery(params: ListImagesQuery): string {
  const q = new URLSearchParams();
  q.set("limit", String(params.limit));
  q.set("offset", String(params.offset));
  if (params.sort) q.set("sort", params.sort);
  if (params.order) q.set("order", params.order);
  if (params.expired !== undefined) q.set("expired", String(params.expired));
  if (params.filename) q.set("filename", params.filename);
  return q.toString();
}

export async function listImages(params: ListImagesQuery): Promise<ListResponse> {
  const res = await apiFetch(`/api/images?${buildQuery(params)}`);
  return res.json() as Promise<ListResponse>;
}

export async function uploadImage(formData: FormData): Promise<ImageItem> {
  const res = await apiFetch("/api/images", { method: "POST", body: formData });
  return res.json() as Promise<ImageItem>;
}

export async function deleteImage(id: string): Promise<void> {
  await apiFetch(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function listUserImages(
  userID: string,
  params: ListImagesQuery,
): Promise<ListResponse> {
  const res = await apiFetch(
    `/api/admin/users/${encodeURIComponent(userID)}/images?${buildQuery(params)}`,
  );
  return res.json() as Promise<ListResponse>;
}

export async function adminDeleteImage(id: string): Promise<void> {
  await apiFetch(`/api/admin/images/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
