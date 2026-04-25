import { useState } from 'react'
import { useNavigate } from 'react-router'
import { login } from '../api/auth'
import { ApiError, setAccessToken } from '../api/client'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const navigate = useNavigate()
  const { updateAuth } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setError('')
    setLoading(true)
    try {
      const data = await login(username, password)
      setAccessToken(data.access_token)
      updateAuth(data.username, data.is_admin)
      navigate('/upload', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setError('試行回数が多すぎます。しばらく待ってから再試行してください。')
        } else {
          setError('ログインに失敗しました')
        }
      } else {
        setError('ネットワークエラーが発生しました')
      }
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#121212]">
      <div className="w-full max-w-sm bg-[#1e1e1e] border border-[#333] rounded-lg p-8 shadow-lg">
        <h1 className="text-xl font-semibold text-[#e0e0e0] mb-6 text-center">
          ログイン
        </h1>
        <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }} className="flex flex-col gap-4">
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
              onChange={e => setUsername(e.target.value)}
              className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-2 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd]"
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
              onChange={e => setPassword(e.target.value)}
              className="bg-[#2a2a2a] border border-[#444] rounded px-3 py-2 text-[#e0e0e0] text-sm focus:outline-none focus:border-[#0d6efd]"
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 bg-[#0d6efd] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium cursor-pointer"
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
