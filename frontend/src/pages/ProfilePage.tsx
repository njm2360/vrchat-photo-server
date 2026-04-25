import { useState, type FormEvent } from "react";
import { changePassword } from "../api/profile";
import { ApiError } from "../api/client";
import { useAuth } from "../hooks/useAuth";

export default function ProfilePage() {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      // セッションが全削除されるので再ログインが必要
      setTimeout(() => void logout(), 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError("現在のパスワードが正しくありません");
        } else {
          setError(err.message || "パスワードの変更に失敗しました");
        }
      } else {
        setError("ネットワークエラーが発生しました");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center">
      <div className="mt-8 w-full max-w-sm rounded-lg border border-[#333] bg-[#1e1e1e] p-8 shadow-lg">
        <h1 className="mb-6 text-xl font-semibold text-[#e0e0e0]">パスワード変更</h1>
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm text-[#aaa]" htmlFor="current-password">
              現在のパスワード
            </label>
            <div className="relative">
              <input
                id="current-password"
                type={showCurrentPw ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded border border-[#444] bg-[#2a2a2a] px-3 py-2 pr-16 text-sm text-[#e0e0e0] focus:border-[#0d6efd] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw((v) => !v)}
                className="absolute top-1/2 right-2 -translate-y-1/2 px-1 text-xs text-[#888] hover:text-[#aaa]"
              >
                {showCurrentPw ? "非表示" : "表示"}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm text-[#aaa]" htmlFor="new-password">
              新しいパスワード（8文字以上）
            </label>
            <div className="relative">
              <input
                id="new-password"
                type={showNewPw ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded border border-[#444] bg-[#2a2a2a] px-3 py-2 pr-16 text-sm text-[#e0e0e0] focus:border-[#0d6efd] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNewPw((v) => !v)}
                className="absolute top-1/2 right-2 -translate-y-1/2 px-1 text-xs text-[#888] hover:text-[#aaa]"
              >
                {showNewPw ? "非表示" : "表示"}
              </button>
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && (
            <p className="text-sm text-green-400">
              パスワードを変更しました。まもなく自動でログアウトします。
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 cursor-pointer rounded bg-[#0d6efd] px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "変更中..." : "パスワードを変更"}
          </button>
        </form>
      </div>
    </div>
  );
}
