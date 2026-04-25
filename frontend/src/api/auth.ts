import { apiFetch, ApiError } from "./client";

export interface LoginResponse {
  access_token: string;
  username: string;
  is_admin: boolean;
}

export interface ImpersonateExitResponse {
  access_token: string;
  username: string;
  is_admin: boolean;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<{
  username: string;
  is_admin: boolean;
  is_impersonating: boolean;
}> {
  const res = await apiFetch("/api/auth/me");
  return res.json();
}

export async function exitImpersonation(): Promise<ImpersonateExitResponse> {
  const res = await apiFetch("/api/auth/impersonation/exit", {
    method: "POST",
  });
  return res.json();
}
