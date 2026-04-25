import { NavLink, Outlet, useNavigate } from "react-router";
import { useState, useRef, useEffect, type FormEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { renameUsername } from "../api/profile";
import { ApiError } from "../api/client";

const navLink = ({ isActive }: { isActive: boolean }) =>
  isActive
    ? "text-white border-b-2 border-[#0d6efd] pb-0.5 text-sm"
    : "text-[#aaa] hover:text-[#e0e0e0] text-sm";

export default function Layout() {
  const { logout, isAdmin, username, isImpersonating, updateAuth, stopImpersonating } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const [renameOpen, setRenameOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function openRename() {
    setMenuOpen(false);
    setNewUsername("");
    setRenameError("");
    setRenameOpen(true);
  }

  async function handleRename(e: FormEvent) {
    e.preventDefault();
    setRenameError("");
    setRenameLoading(true);
    try {
      const res = await renameUsername(newUsername.trim());
      updateAuth(res.username, isAdmin);
      setRenameOpen(false);
    } catch (err) {
      setRenameError(
        err instanceof ApiError
          ? err.message || "ユーザー名の変更に失敗しました"
          : "ネットワークエラーが発生しました",
      );
    } finally {
      setRenameLoading(false);
    }
  }

  return (
    <>
      <nav className="flex items-center justify-between border-b border-[#333] bg-[#1e1e1e] px-4 py-2">
        <span className="font-semibold text-[#e0e0e0]">ImagePad用画像リサイズツール</span>
        <div className="flex items-center gap-4">
          <NavLink to="/upload" className={navLink}>
            アップロード
          </NavLink>
          <NavLink to="/images" className={navLink}>
            画像一覧
          </NavLink>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex cursor-pointer items-center gap-1.5 text-[#aaa] hover:text-[#e0e0e0]"
              aria-label="ユーザーメニュー"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
              </svg>
              <span className="text-xs text-[#888]">{username}</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 z-50 mt-2 w-48 rounded border border-[#444] bg-[#2a2a2a] shadow-lg">
                <button
                  onClick={openRename}
                  className="w-full px-4 py-2 text-left text-sm text-[#ccc] hover:bg-[#333] hover:text-white"
                >
                  ユーザー名変更
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void navigate("/profile");
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-[#ccc] hover:bg-[#333] hover:text-white"
                >
                  パスワード変更
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void navigate("/admin/users");
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-[#ccc] hover:bg-[#333] hover:text-white"
                    >
                      ユーザー管理
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void navigate("/admin/proxy/hosts");
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-[#ccc] hover:bg-[#333] hover:text-white"
                    >
                      許可ホスト管理
                    </button>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void navigate("/admin/proxy/cache");
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-[#ccc] hover:bg-[#333] hover:text-white"
                    >
                      プロキシキャッシュ管理
                    </button>
                  </>
                )}
                <hr className="border-[#444]" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-900/30 hover:text-red-300"
                >
                  ログアウト
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {renameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setRenameOpen(false)}
        >
          <div
            className="w-80 rounded-lg border border-[#333] bg-[#1e1e1e] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-base font-semibold text-[#e0e0e0]">ユーザー名変更</h2>
            <p className="mb-4 text-xs text-[#666]">現在: {username}</p>
            <form onSubmit={(e) => void handleRename(e)} className="flex flex-col gap-3">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => {
                  setNewUsername(e.target.value);
                  setRenameError("");
                }}
                placeholder="新しいユーザー名"
                required
                autoFocus
                autoComplete="username"
                className="w-full rounded border border-[#444] bg-[#2a2a2a] px-3 py-2 text-sm text-[#e0e0e0] focus:border-[#0d6efd] focus:outline-none"
              />
              {renameError && <p className="text-xs text-red-400">{renameError}</p>}
              <div className="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameOpen(false)}
                  className="cursor-pointer px-3 py-1.5 text-sm text-[#aaa] hover:text-[#e0e0e0]"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={renameLoading || newUsername.trim() === ""}
                  className="cursor-pointer rounded bg-[#0d6efd] px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {renameLoading ? "変更中..." : "変更"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isImpersonating && (
        <div className="flex items-center justify-between border-b border-yellow-700/60 bg-yellow-900/40 px-4 py-1.5 text-sm text-yellow-300">
          <span>「{username}」としてログイン中</span>
          <button
            onClick={() => void stopImpersonating()}
            className="cursor-pointer rounded border border-yellow-600 px-2 py-0.5 text-xs hover:bg-yellow-800/50"
          >
            管理者に戻る
          </button>
        </div>
      )}

      <main className="p-4">
        <Outlet />
      </main>
    </>
  );
}
