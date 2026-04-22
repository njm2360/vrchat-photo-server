import { type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { loaded, username } = useAuth()

  if (!loaded) return null
  if (!username) return <Navigate to="/login" replace />
  return <>{children}</>
}
