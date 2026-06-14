import { Navigate, Outlet } from 'react-router-dom'

import { useAuth } from '../hooks/useAuth'

// 인증 보호 라우트 — 미인증 시 /login 으로.
export function ProtectedRoute() {
  const { isLoading, isAuthenticated } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}
