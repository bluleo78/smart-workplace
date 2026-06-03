import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { AdminModuleLayout } from './components/admin/AdminModuleLayout'
import { AdminRoute } from './components/AdminRoute'
import { IssueModuleLayout } from './components/issue/IssueModuleLayout'
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
const AgentManagementPage = lazy(() => import('./pages/admin/AgentManagementPage'))
const ProjectListPage = lazy(() => import('./pages/projects/ProjectListPage'))
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'))
const ProjectSettingsPage = lazy(() => import('./pages/projects/ProjectSettingsPage'))
const CyclesPage = lazy(() => import('./pages/projects/CyclesPage'))
const IssueDetailPage = lazy(() => import('./pages/projects/IssueDetailPage'))
const MyTasksPage = lazy(() => import('./pages/me/MyTasksPage'))
const AiDelegatedTasksPage = lazy(() => import('./pages/me/AiDelegatedTasksPage'))
const ChatModuleLayout = lazy(() =>
  import('./components/chat/ChatModuleLayout').then((m) => ({ default: m.ChatModuleLayout })),
)
const ChannelListPage = lazy(() => import('./pages/chat/ChannelListPage'))
const ChannelPage = lazy(() => import('./pages/chat/ChannelPage'))
const DmPage = lazy(() => import('./pages/chat/DmPage'))
const DriveModuleLayout = lazy(() =>
  import('./components/drive/DriveModuleLayout').then((m) => ({ default: m.DriveModuleLayout })),
)
const DrivePage = lazy(() =>
  import('./pages/drive/DrivePage').then((m) => ({ default: m.DrivePage })),
)
const DriveIndexRedirect = lazy(() =>
  import('./pages/drive/DriveIndexRedirect').then((m) => ({ default: m.DriveIndexRedirect })),
)
const ContactModuleLayout = lazy(() =>
  import('./components/contacts/ContactModuleLayout').then((m) => ({
    default: m.ContactModuleLayout,
  })),
)
const ContactsPage = lazy(() =>
  import('./pages/contacts/ContactsPage').then((m) => ({ default: m.ContactsPage })),
)
const MailModuleLayout = lazy(() =>
  import('./components/mail/MailModuleLayout').then((m) => ({ default: m.MailModuleLayout })),
)
const MailInboxPage = lazy(() =>
  import('./pages/mail/MailInboxPage').then((m) => ({ default: m.MailInboxPage })),
)

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

              {/* 이슈 모듈 — 2차 사이드바(내 태스크 + 프로젝트 목록) 가 감싼다 */}
              <Route element={<IssueModuleLayout />}>
                {/* 프로젝트 / 이슈 */}
                <Route path="projects" element={<ProjectListPage />} />
                <Route path="projects/:key" element={<ProjectDetailPage />} />
                <Route path="projects/:key/settings" element={<ProjectSettingsPage />} />
                <Route path="projects/:key/cycles" element={<CyclesPage />} />
                <Route path="projects/:key/issues/:number" element={<IssueDetailPage />} />

                {/* 하위호환 — 구버전 경로를 새 탭으로 리다이렉트 */}
                <Route path="me/watched" element={<Navigate to="/me/tasks/watched" replace />} />

                {/* 내 작업 — 할당/내가 만든/구독 3탭 */}
                <Route path="me/tasks" element={<Navigate to="/me/tasks/assigned" replace />} />
                <Route path="me/tasks/:tab" element={<MyTasksPage />} />

                {/* AI 위임 작업 — 내가 만든 이슈 중 AI 담당 */}
                <Route path="me/ai-tasks" element={<AiDelegatedTasksPage />} />
              </Route>

              {/* 채팅 모듈 — 2차 사이드바(채널 목록) 가 감싼다 */}
              <Route element={<ChatModuleLayout />}>
                <Route path="chat" element={<ChannelListPage />} />
                <Route path="chat/channels/:id" element={<ChannelPage />} />
                <Route path="chat/dms/:id" element={<DmPage />} />
              </Route>

              {/* 드라이브 모듈 — 2차 사이드바(공간 목록) 가 감싼다 */}
              <Route element={<DriveModuleLayout />}>
                <Route path="drive" element={<DriveIndexRedirect />} />
                <Route path="drive/spaces/:spaceId" element={<DrivePage />} />
              </Route>

              {/* 연락처 모듈 — 통합 디렉토리(읽기 전용) */}
              <Route element={<ContactModuleLayout />}>
                <Route path="contacts" element={<ContactsPage />} />
              </Route>

              {/* 메일 모듈 — 받은편지함 동기화·읽기(읽기 전용). accountId 미지정 시 첫 계정으로 */}
              <Route element={<MailModuleLayout />}>
                <Route path="mail" element={<MailInboxPage />} />
                <Route path="mail/:accountId" element={<MailInboxPage />} />
              </Route>

              {/* 관리자 영역 — AdminRoute 가 ADMIN 역할 검증 후 통과 */}
              <Route element={<AdminRoute />}>
                {/* 관리 모듈 — 2차 사이드바(사용자/역할/감사로그/AGENT) 가 감싼다 */}
                <Route element={<AdminModuleLayout />}>
                  <Route path="admin/users" element={<UserListPage />} />
                  <Route path="admin/users/:id" element={<UserDetailPage />} />
                  <Route path="admin/roles" element={<RoleListPage />} />
                  <Route path="admin/roles/:id" element={<RoleDetailPage />} />
                  <Route path="admin/audit-logs" element={<AuditLogListPage />} />
                  <Route path="admin/agents" element={<AgentManagementPage />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  )
}
