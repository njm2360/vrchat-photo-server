import { useState } from "react";
import { useNavigate } from "react-router";
import { login } from "../api/auth";
import { ApiError, setAccessToken } from "../api/client";
import { useAuth } from "../hooks/useAuth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { updateAuth } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const data = await login(username, password);
      setAccessToken(data.access_token);
      updateAuth(data.username, data.is_admin);
      navigate("/upload", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError("試行回数が多すぎます。しばらく待ってから再試行してください。");
        } else {
          setError("ログインに失敗しました");
        }
      } else {
        setError("ネットワークエラーが発生しました");
      }
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#121212]">
      <div className="w-full max-w-sm rounded-lg border border-[#333] bg-[#1e1e1e] p-8 shadow-lg">
        <h1 className="mb-6 text-center text-xl font-semibold text-[#e0e0e0]">ログイン</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm text-[#aaa]" htmlFor="username">
              ユーザー名
            </label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded border border-[#444] bg-[#2a2a2a] px-3 py-2 text-sm text-[#e0e0e0] focus:border-[#0d6efd] focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-[#aaa]" htmlFor="password">
              パスワード
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border border-[#444] bg-[#2a2a2a] px-3 py-2 text-sm text-[#e0e0e0] focus:border-[#0d6efd] focus:outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 cursor-pointer rounded bg-[#0d6efd] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "ログイン中..." : "ログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
