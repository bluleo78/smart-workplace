import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'

import { AdminRoute } from './components/AdminRoute'
import { AppLayout } from './components/layout/AppLayout'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Skeleton } from './components/ui/skeleton'

// 페이지는 라우트 진입 시점에만 로드해 초기 번들을 가볍게 유지한다.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const UserListPage = lazy(() => import('./pages/admin/UserListPage'))
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage'))
const RoleListPage = lazy(() => import('./pages/admin/RoleListPage'))
const RoleDetailPage = lazy(() => import('./pages/admin/RoleDetailPage'))
const AuditLogListPage = lazy(() => import('./pages/admin/AuditLogListPage'))
const ProjectListPage = lazy(() => import('./pages/projects/ProjectListPage'))
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'))
const ProjectSettingsPage = lazy(() => import('./pages/projects/ProjectSettingsPage'))
const IssueDetailPage = lazy(() => import('./pages/projects/IssueDetailPage'))
const WatchedIssuesPage = lazy(() => import('./pages/me/WatchedIssuesPage'))

function PageLoader() {
  return (
    <div className="container mx-auto p-8">
      <Skeleton className="h-8 w-48 mb-4" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export default function App() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* 공개 라우트 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* 인증 필요 — ProtectedRoute 가 미인증 시 /login 리다이렉트, 통과 시 AppLayout 렌더 */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<HomePage />} />
              <Route path="profile" element={<ProfilePage />} />

              {/* 프로젝트 / 이슈 */}
              <Route path="projects" element={<ProjectListPage />} />
              <Route path="projects/:key" element={<ProjectDetailPage />} />
              <Route path="projects/:key/settings" element={<ProjectSettingsPage />} />
              <Route path="projects/:key/issues/:number" element={<IssueDetailPage />} />

              {/* 내 태스크 — 구독 중인 이슈 목록 */}
              <Route path="me/watched" element={<WatchedIssuesPage />} />

              {/* 관리자 영역 — AdminRoute 가 ADMIN 역할 검증 후 통과 */}
              <Route element={<AdminRoute />}>
                <Route path="admin/users" element={<UserListPage />} />
                <Route path="admin/users/:id" element={<UserDetailPage />} />
                <Route path="admin/roles" element={<RoleListPage />} />
                <Route path="admin/roles/:id" element={<RoleDetailPage />} />
                <Route path="admin/audit-logs" element={<AuditLogListPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  )
}
