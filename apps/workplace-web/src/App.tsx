import { type ComponentType, lazy, type ReactNode, Suspense, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'

import { AdminRoute } from './components/AdminRoute'
import { IssueModuleLayout } from './components/issue/IssueModuleLayout'
import { AppLayout } from './components/layout/AppLayout'
import { PageLoader } from './components/layout/PageLoader'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AvatarsProvider } from './components/users/AvatarsProvider'
import { WikiSharePublicViewContext } from './components/wiki/wikiSharePublicView'
import { useAuth } from './hooks/useAuth'
import { useRouteDocumentTitle } from './hooks/useDocumentTitle'
import { useIsMobile } from './hooks/useIsMobile'

// 페이지는 라우트 진입 시점에만 로드해 초기 번들을 가볍게 유지한다.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const SsoCompletePage = lazy(() => import('./pages/SsoCompletePage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const UserListPage = lazy(() => import('./pages/admin/UserListPage'))
const UserDetailPage = lazy(() => import('./pages/admin/UserDetailPage'))
const RoleListPage = lazy(() => import('./pages/admin/RoleListPage'))
const SsoSettingsPage = lazy(() => import('./pages/admin/SsoSettingsPage'))
const RoleDetailPage = lazy(() => import('./pages/admin/RoleDetailPage'))
const AuditLogListPage = lazy(() => import('./pages/admin/AuditLogListPage'))
const AgentManagementPage = lazy(() => import('./pages/admin/AgentManagementPage'))
const ProjectListPage = lazy(() => import('./pages/projects/ProjectListPage'))
const ProjectDetailPage = lazy(() => import('./pages/projects/ProjectDetailPage'))
const ProjectSettingsPage = lazy(() => import('./pages/projects/ProjectSettingsPage'))
const CyclesPage = lazy(() => import('./pages/projects/CyclesPage'))
const TimelinePage = lazy(() => import('./pages/projects/timeline/TimelinePage'))
const VersionsPage = lazy(() => import('./pages/projects/versions/VersionsPage'))
const VersionDetailPage = lazy(() => import('./pages/projects/versions/VersionDetailPage'))
const IssueDetailPage = lazy(() => import('./pages/projects/IssueDetailPage'))
const MyTasksPage = lazy(() => import('./pages/me/MyTasksPage'))
const AiDelegatedTasksPage = lazy(() => import('./pages/me/AiDelegatedTasksPage'))
const ChatModuleLayout = lazy(() =>
  import('./components/chat/ChatModuleLayout').then((m) => ({ default: m.ChatModuleLayout })),
)
const ChannelListPage = lazy(() => import('./pages/chat/ChannelListPage'))
const ChannelPage = lazy(() => import('./pages/chat/ChannelPage'))
const DmPage = lazy(() => import('./pages/chat/DmPage'))
const NewMessagePage = lazy(() => import('./pages/chat/NewMessagePage'))
const SelfDmRedirect = lazy(() => import('./pages/chat/SelfDmRedirect'))
const ThreadsInboxPage = lazy(() => import('./pages/chat/ThreadsInboxPage'))
const DriveModuleLayout = lazy(() =>
  import('./components/drive/DriveModuleLayout').then((m) => ({ default: m.DriveModuleLayout })),
)
const DrivePage = lazy(() =>
  import('./pages/drive/DrivePage').then((m) => ({ default: m.DrivePage })),
)
const DriveIndexRedirect = lazy(() =>
  import('./pages/drive/DriveIndexRedirect').then((m) => ({ default: m.DriveIndexRedirect })),
)
// 공개 공유 링크 다운로드 랜딩 — 인증 없이 접근 가능.
const ShareLinkPage = lazy(() => import('./pages/drive/ShareLinkPage'))
// #80: 가상 첨부 뷰 — 이슈/메시지 업로드 파일 크로스링크.
const DriveAttachmentsView = lazy(() =>
  import('./pages/drive/DriveAttachmentsView').then((m) => ({ default: m.DriveAttachmentsView })),
)

const WikiModuleLayout = lazy(() =>
  import('./components/wiki/WikiModuleLayout').then((m) => ({ default: m.WikiModuleLayout })),
)
const WikiPage = lazy(() => import('./pages/wiki/WikiPage').then((m) => ({ default: m.WikiPage })))
// WP-579 공유 링크 화면 — 노트 사이드바 없이 링크로 볼 수 있는 페이지만. 외부 보기는 로그인 없이.
const WikiSharePage = lazy(() => import('./pages/wiki/WikiSharePage').then((m) => ({ default: m.WikiSharePage })))
// WP-579 노트 알림 입구 — 멤버면 노트로, 공유 대상이면 공유 화면으로 보낸다.
const WikiOpenPage = lazy(() => import('./pages/wiki/WikiOpenPage').then((m) => ({ default: m.WikiOpenPage })))
const WikiPublicSharePage = lazy(() =>
  import('./pages/wiki/WikiPublicSharePage').then((m) => ({ default: m.WikiPublicSharePage })),
)

/**
 * 노트 공유 링크 입구(WP-579) — 로그인 상태면 앱 셸(AppLayout) 안에서 공유 화면을, 아니면 외부 보기를 그린다.
 * 로그인했어도 링크의 워크스페이스 멤버가 아니고 외부 링크면(공유 화면이 링크 열기 응답으로 알려 옴) 앱 셸 밖 외부 보기로 바꾼다.
 */
function WikiShareGate() {
  const { isLoading, isAuthenticated } = useAuth()
  const { token = '' } = useParams()
  // 외부 보기로 바꾼 토큰 — 같은 링크의 하위 페이지로 옮겨도 유지하고, 다른 링크(토큰)로 가면 다시 판정한다.
  const [publicToken, setPublicToken] = useState<string | null>(null)
  if (isLoading) return <PageLoader />
  if (!isAuthenticated || publicToken === token) return <WikiPublicSharePage />
  return (
    <WikiSharePublicViewContext.Provider value={setPublicToken}>
      <AppLayout />
    </WikiSharePublicViewContext.Provider>
  )
}
const WikiIndexRedirect = lazy(() =>
  import('./pages/wiki/WikiIndexRedirect').then((m) => ({ default: m.WikiIndexRedirect })),
)
const ContactModuleLayout = lazy(() =>
  import('./components/contacts/ContactModuleLayout').then((m) => ({
    default: m.ContactModuleLayout,
  })),
)
const ContactsPage = lazy(() =>
  import('./pages/contacts/ContactsPage').then((m) => ({ default: m.ContactsPage })),
)
const CalendarModuleLayout = lazy(() =>
  import('./components/calendar/CalendarModuleLayout').then((m) => ({
    default: m.CalendarModuleLayout,
  })),
)
const CalendarPage = lazy(() =>
  import('./pages/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })),
)
const MailModuleLayout = lazy(() =>
  import('./components/mail/MailModuleLayout').then((m) => ({ default: m.MailModuleLayout })),
)
const MailInboxPage = lazy(() =>
  import('./pages/mail/MailInboxPage').then((m) => ({ default: m.MailInboxPage })),
)
const M365CallbackPage = lazy(() => import('./pages/oauth/M365CallbackPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const AppsPage = lazy(() => import('./pages/apps/AppsPage'))
const TabEditPage = lazy(() => import('./pages/apps/TabEditPage'))
// 알림 탭으로 새 창이 열릴 때의 진입점 — 미인증도 접근 가능(로그인 후 목적지로 복귀).
const PushOpenPage = lazy(() => import('./pages/PushOpenPage'))
const ProfileSettingsPage = lazy(() => import('./pages/settings/ProfileSettingsPage'))
const MailSettingsPage = lazy(() => import('./pages/settings/MailSettingsPage'))
const NotificationSettingsPage = lazy(() => import('./pages/settings/NotificationSettingsPage'))
const AssistantSettingsPage = lazy(() => import('./pages/settings/AssistantSettingsPage'))
const TokenSettingsPage = lazy(() => import('./pages/settings/TokenSettingsPage'))
const MySharesPage = lazy(() => import('./pages/settings/MySharesPage'))
const WikiSharingPage = lazy(() => import('./pages/admin/WikiSharingPage'))
const WorkAppSettingsPage = lazy(() => import('./pages/settings/apps/WorkAppSettingsPage'))
const SettingsModuleLayout = lazy(() =>
  import('./components/layout/SettingsModuleLayout').then((m) => ({ default: m.SettingsModuleLayout })),
)

// 모바일(<lg)에선 모듈 루트가 "사이드바 목록" 화면이므로 인덱스 리다이렉트를 건너뛴다(WP-124).
function DesktopOnly({ children }: { children: ReactNode }) {
  return useIsMobile() ? null : <>{children}</>
}

// 모바일 전용 화면(앱 목록·탭바 순서 편집) 가드 — 데스크톱엔 해당 화면이 없으므로 홈으로 되돌린다(WP-126).
function MobileOnly({ children }: { children: ReactNode }) {
  return useIsMobile() ? <>{children}</> : <Navigate to="/" replace />
}

// 구 /admin/* 딥링크를 /settings/* 로 치환 리다이렉트(하위경로·쿼리 보존).
function AdminRedirect() {
  const { pathname, search } = useLocation()
  const target = pathname.replace(/^\/admin/, '/settings') + search
  return <Navigate to={target} replace />
}

// 채널/DM 화면은 채널 id 마다 새로 마운트한다(WP-418). key 없이 재사용하면 AI 유령 버블·캐치업 카드 열림/닫힘·진입 시점 스냅샷 같은
// 채널별 상태가 다음 채널로 넘어가, 화면·훅마다 채널 전환 리셋을 손수 둬야 했다(하나라도 빠지면 이전 채널 상태가 샌다).
// 라우트 파라미터 값을 key 로 Page 를 그린다 — 채널·DM 라우트가 같은 래퍼를 쓴다.
function KeyedByParam({ component: Page, param }: { component: ComponentType; param: string }) {
  const params = useParams()
  return <Page key={params[param]} />
}

/** 주소별 기본 탭 제목(화면 이름)을 맞춘다 — 항목 화면은 useDocumentTitle 로 덮는다(WP-814). */
function RouteDocumentTitle() {
  useRouteDocumentTitle()
  return null
}

export default function App() {
  return (
    <PageErrorBoundary>
      {/* 아바타 주소 표(WP-1222) — 로그인한 동안 한 번 받아 모든 아바타가 userId 로 찾는다. */}
      <AvatarsProvider>
        <RouteDocumentTitle />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* 공개 라우트 */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            {/* WP-48 SSO 완료 착지 — 토큰 없이 도착하므로 ProtectedRoute 밖 */}
            <Route path="/login/sso/complete" element={<SsoCompletePage />} />
            {/* 공유 링크 다운로드 랜딩 — 인증 불필요 */}
            <Route path="/s/:token" element={<ShareLinkPage />} />
            {/* M365 OAuth 팝업 콜백 — 토큰 없는 팝업이 착지하므로 ProtectedRoute 밖 공개 라우트 */}
            <Route path="/oauth/m365/callback" element={<M365CallbackPage />} />
            {/* 알림 탭 진입점 — 공개 라우트(미로그인이면 목적지를 저장하고 로그인으로) */}
            <Route path="/push-open" element={<PushOpenPage />} />
            {/* 노트 공유 링크(WP-579) — 로그인했으면 앱 셸 안 공유 화면, 아니면 외부 보기(외부 링크) 또는 로그인으로.
                스페이스 밖 사람이 여는 화면이라 노트 사이드바(모듈 레이아웃) 밖에 둔다. */}
            <Route path="/wiki/share/:token" element={<WikiShareGate />}>
              <Route index element={<WikiSharePage />} />
              <Route path="pages/:pageId" element={<WikiSharePage />} />
            </Route>
            {/* 인증 필요 — ProtectedRoute 가 미인증 시 /login 리다이렉트, 통과 시 AppLayout 렌더 */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route index element={<HomePage />} />
                {/* 모바일 전용 화면(WP-126) — 알림은 데스크톱 접근 시 홈 + 인박스 Popover 로(페이지 자체 처리), 앱 목록류는 MobileOnly 가 홈으로. */}
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="apps" element={<MobileOnly><AppsPage /></MobileOnly>} />
                <Route path="apps/tabs" element={<MobileOnly><TabEditPage /></MobileOnly>} />

                {/* 이슈 모듈 — 2차 사이드바(내 태스크 + 프로젝트 목록) 가 감싼다 */}
                <Route element={<IssueModuleLayout />}>
                  {/* 프로젝트 / 이슈 */}
                  {/* /tasks — 작업 모듈 허브. 데스크톱은 기존 진입점으로, 모바일은 IssueModuleLayout 이 rootPath 에서 사이드바 목록을 그려 본문 불필요. */}
                  <Route path="tasks" element={<DesktopOnly><Navigate to="/me/tasks/assigned" replace /></DesktopOnly>} />
                  <Route path="projects" element={<ProjectListPage />} />
                  <Route path="projects/:key" element={<ProjectDetailPage />} />
                  <Route path="projects/:key/settings" element={<ProjectSettingsPage />} />
                  <Route path="projects/:key/cycles" element={<CyclesPage />} />
                  <Route path="projects/:key/versions" element={<VersionsPage />} />
                  <Route path="projects/:key/versions/:versionId" element={<VersionDetailPage />} />
                  <Route path="projects/:key/timeline" element={<TimelinePage />} />
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
                  <Route path="chat/new" element={<NewMessagePage />} />
                  <Route path="chat/channels/:id" element={<KeyedByParam component={ChannelPage} param="id" />} />
                  <Route path="chat/threads/inbox" element={<ThreadsInboxPage />} />
                  <Route path="chat/dms/self" element={<SelfDmRedirect />} />
                  <Route path="chat/dms/:id" element={<KeyedByParam component={DmPage} param="id" />} />
                </Route>

                {/* 드라이브 모듈 — 2차 사이드바(공간 목록) 가 감싼다 */}
                <Route element={<DriveModuleLayout />}>
                  <Route path="drive" element={<DesktopOnly><DriveIndexRedirect /></DesktopOnly>} />
                  <Route path="drive/spaces/:spaceId" element={<DrivePage />} />
                  {/* #80: 가상 첨부 뷰 — 이슈/메시지 업로드 파일 크로스링크 */}
                  <Route path="drive/attachments" element={<DriveAttachmentsView />} />
                </Route>

                {/* 노트 알림 입구(WP-579) — 갈 곳을 정해 바로 넘기므로 노트 사이드바(모듈 레이아웃) 밖에 둔다. */}
                <Route path="wiki/open/:pageId" element={<WikiOpenPage />} />

                {/* 위키 모듈 — 2차 사이드바(스페이스/페이지 트리) 가 감싼다 */}
                <Route element={<WikiModuleLayout />}>
                  <Route path="wiki" element={<DesktopOnly><WikiIndexRedirect /></DesktopOnly>} />
                  <Route path="wiki/spaces/:spaceId" element={<WikiPage />} />
                  <Route path="wiki/spaces/:spaceId/pages/:pageId" element={<WikiPage />} />
                </Route>

                {/* 연락처 모듈 — 통합 디렉토리(읽기 전용) */}
                <Route element={<ContactModuleLayout />}>
                  <Route path="contacts" element={<ContactsPage />} />
                </Route>

                {/* 캘린더 모듈 */}
                <Route element={<CalendarModuleLayout />}>
                  <Route path="calendar" element={<CalendarPage />} />
                </Route>

                {/* 메일 모듈 — 받은편지함 동기화·읽기(읽기 전용). accountId 미지정 시 첫 계정으로 */}
                <Route element={<MailModuleLayout />}>
                  <Route path="mail" element={<MailInboxPage />} />
                  <Route path="mail/:accountId" element={<MailInboxPage />} />
                </Route>

                {/* 설정 모듈 — 2차 사이드바(개인/관리) 가 감싼다 */}
                <Route element={<SettingsModuleLayout />}>
                  {/* 개인 설정 — 전체 로그인 사용자 */}
                  <Route path="settings" element={<DesktopOnly><Navigate to="/settings/profile" replace /></DesktopOnly>} />
                  <Route path="settings/profile" element={<ProfileSettingsPage />} />
                  <Route path="settings/mail" element={<MailSettingsPage />} />
                  <Route path="settings/notifications" element={<NotificationSettingsPage />} />
                  <Route path="settings/assistant" element={<AssistantSettingsPage />} />
                  <Route path="settings/tokens" element={<TokenSettingsPage />} />
                  <Route path="settings/my-shares" element={<MySharesPage />} />

                  {/* 워크스페이스 관리 — AdminRoute 가 ADMIN 역할 검증 후 통과 */}
                  <Route element={<AdminRoute />}>
                    <Route path="settings/users" element={<UserListPage />} />
                    <Route path="settings/users/:id" element={<UserDetailPage />} />
                    <Route path="settings/roles" element={<RoleListPage />} />
                    <Route path="settings/roles/:id" element={<RoleDetailPage />} />
                    <Route path="settings/sso" element={<SsoSettingsPage />} />
                    {/* 앱 설정(WP-887) — 앱마다 한 화면. 옛 노트 공유 주소는 새 주소로 보낸다. */}
                    <Route path="settings/apps/work" element={<WorkAppSettingsPage />} />
                    <Route path="settings/apps/wiki" element={<WikiSharingPage />} />
                    <Route path="settings/wiki-sharing" element={<Navigate to="/settings/apps/wiki" replace />} />
                    <Route path="settings/audit-logs" element={<AuditLogListPage />} />
                    <Route path="settings/agents" element={<AgentManagementPage />} />
                  </Route>
                </Route>

                {/* 호환 리다이렉트 — 구 경로 흡수 */}
                <Route path="profile" element={<Navigate to="/settings/profile" replace />} />
                <Route path="admin/*" element={<AdminRedirect />} />

                {/* 없는 주소 — 앱 셸(사이드바·헤더·main) 안에서 그려 다른 메뉴로 바로 갈 수 있게 한다(WP-924).
                    로그인 전이면 ProtectedRoute 가 로그인으로 보낸 뒤 돌아와 이 화면을 본다. */}
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </AvatarsProvider>
    </PageErrorBoundary>
  )
}
