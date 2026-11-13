// 페이지 테스트(MSW) 기본 응답 — 앱 셸이 어느 화면에서나 부르는 부가 조회를 빈 성공 응답으로 깐다(WP-971).
// E2E 의 setupAuthMocks(e2e/fixtures/auth.fixture.ts)와 같은 기본값이다. 화면을 검증하는 테스트는
// server.use(...) 로 같은 경로를 다시 등록하면 그쪽이 우선한다(MSW 는 나중에 등록한 핸들러가 먼저).
// 여기 없는 요청은 setup.ts 가 테스트 실패로 처리한다 — 모킹 누락이 조용히 지나가지 않게.
import { http, HttpResponse } from 'msw'

import type { TokenResponse, UserResponse } from '@/types/auth'
import type { RoleResponse } from '@/types/role'

import { createTokenResponse, createUser } from '../../../e2e/factories/auth.factory'
import { defaultRelationTypes } from '../../../e2e/factories/issueRelation.factory'
import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'
import { defaultNotificationSettings } from '../../../e2e/factories/notificationSettings.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'
import { createEmptyWorkProfile } from '../../../e2e/factories/workProfile.factory'

export const MOCK_USER_ROLE: RoleResponse = { id: 2, name: 'USER', description: '일반 사용자', isSystem: true }
export const MOCK_ADMIN_ROLE: RoleResponse = { id: 1, name: 'ADMIN', description: '시스템 관리자', isSystem: true }

const API = '/api/v1'
const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
const emptyCursor = { items: [], nextCursor: null, hasMore: false }

/** 인증 — refresh·login 은 토큰을, /users/me 는 사용자+역할을 준다. */
export function authHandlers(
  user: UserResponse = createUser({ aiAvailable: true }),
  roles: RoleResponse[] = [MOCK_USER_ROLE],
  token: TokenResponse = createTokenResponse(),
) {
  return [
    http.post(`${API}/auth/refresh`, () => HttpResponse.json(token)),
    http.post(`${API}/auth/login`, () => HttpResponse.json(token)),
    http.get(`${API}/users/me`, () => HttpResponse.json({ ...user, roles })),
  ]
}

/**
 * 통합 SSE(/api/v1/events) — 열린 채 유지되는 스트림. 유한 본문이면 클라이언트가 곧 재연결하며
 * 활성 쿼리를 다시 불러 요청 횟수 단언을 흔든다(E2E 의 SSE hold 와 같은 이유). 요청이 끊기면 스트림도 닫는다.
 */
const holdEventStream = http.get(`${API}/events`, ({ request }) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request.signal.addEventListener('abort', () => {
        try {
          controller.close()
        } catch {
          // 이미 닫혔으면 무시
        }
      })
    },
  })
  return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
})

/**
 * 도움말 열기·검색 0건 기록(WP-1512) 기본 204 — 도움말을 여는 모든 테스트가 부른다(renderScreen 도 깐다).
 * 기록 본문을 보려는 테스트는 helpMetricHandlers 를 앞에 건다.
 */
export const helpMetricBaseHandlers = [
  http.post(`${API}/help/metrics/open`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API}/help/metrics/search-miss`, () => new HttpResponse(null, { status: 204 })),
]

/** 앱 셸·공통 부가 조회 빈 기본값 — e2e/fixtures/auth.fixture.ts setupAuthMocks 와 같은 목록. */
export const shellHandlers = [
  holdEventStream,
  ...helpMetricBaseHandlers,
  http.get(`${API}/projects/:key/statuses`, () => HttpResponse.json(seedStatuses())),
  http.get(`${API}/projects/:key/issues/:n/chat/thread`, () =>
    HttpResponse.json({ threadId: 0, issueId: 0, archivedAt: null, members: [], recentMessages: [] }),
  ),
  http.get(`${API}/chat/threads/:id/messages`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/issues`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/watched-issues`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/activity`, () => HttpResponse.json({ items: [], nextCursor: null })),
  // 홈 「내 작업」 위젯의 어제/오늘 한 줄(WP-1484) — 0 요약.
  http.get(`${API}/me/overview/today`, () =>
    HttpResponse.json({ yesterday: '2026-01-01', yesterdayCompleted: 0, yesterdayCompletedWithAi: 0, yesterdayCompletedOnTime: 0, yesterdayCreated: 0, today: '2026-01-02', overdue: 0, oldestOverdueDays: null, dueToday: 0, waiting: 0 }),
  ),
  // 개요 탭 업무 프로파일 카드(WP-1485) — 끝낸 이슈 없음(NONE)으로 깔아 개요를 띄우는 다른 테스트가 모킹 누락으로 깨지지 않게 한다.
  http.get(`${API}/me/work-profile`, () => HttpResponse.json(createEmptyWorkProfile())),
  // 개인 보고(WP-1486) — 설정은 꺼짐 기본값(템플릿 없음·비서 있음), 「일일 보고 보기」 조회는 보고 없음(204).
  http.get(`${API}/me/report-settings`, () =>
    HttpResponse.json({ dailyEnabled: false, timeOfDay: '09:00', skipEmpty: true, dailyTemplatePageId: null, weeklyTemplatePageId: null, reportsPageId: null, spaceId: null, nextRunAt: null, assistantAvailable: true, lastError: null }),
  ),
  http.get(`${API}/me/reports`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/projects`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/members`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/drive/spaces`, () => HttpResponse.json([])),
  // 드라이브 사이드바 「공유받은 항목」 개수(WP-1539) — 빈 목록으로 깔아 사이드바를 띄우는 다른 테스트가 모킹 누락으로 깨지지 않게 한다.
  http.get(`${API}/drive/shared-with-me`, () => HttpResponse.json([])),
  http.get(`${API}/calendars`, () => HttpResponse.json([])),
  http.get(`${API}/messaging/threads/inbox/unread-count`, () => HttpResponse.json({ count: 0 })),
  http.get(`${API}/notification-settings`, () => HttpResponse.json(defaultNotificationSettings())),
  // versions(WP-888): 이슈 상세·목록 필터·타임라인이 늘 부른다 — 빈 목록이면 칸·필터·레인이 숨는다(E2E setupAuthMocks 와 같음).
  ...['cycles', 'cycles/progress', 'types', 'milestones', 'labels', 'members', 'saved-views', 'components', 'versions'].map((sub) =>
    http.get(`${API}/projects/:key/${sub}`, () => HttpResponse.json([])),
  ),
  // 프로젝트 설정 「리포트」의 주간 리포트 줄(WP-1483) — 서버 기본값(꺼짐·매주·월요일·09:00, 템플릿 없음, 읽기 전용).
  // 설정 화면을 띄우는 다른 테스트가 모킹 누락으로 깨지지 않게 깐다. 줄 자체의 판정은 ReportSettings.test.tsx.
  http.get(`${API}/projects/:key/report-settings`, () =>
    HttpResponse.json({ enabled: false, cadence: 'WEEKLY', weekday: 'MONDAY', timeOfDay: '09:00', templatePageId: null, nextRunAt: null, canManage: false }),
  ),
  http.get(`${API}/projects/:key/issues/:n/cycles`, () => HttpResponse.json([])),
  http.get(`${API}/projects/:key/issues/:n/drive-links`, () => HttpResponse.json([])),
  // 이슈 상세의 「AI 에게 맡기기」 칸(WP-1314) — 실행 일정 없음(204)과 담당 AI 후보 없음.
  http.get(`${API}/projects/:key/issues/:n/recurrence`, () => new HttpResponse(null, { status: 204 })),
  http.get(`${API}/projects/:key/issues/:n/recurrence/agents`, () => HttpResponse.json([])),
  http.get(`${API}/mail/accounts/:id/folders`, () => HttpResponse.json([])),
  http.get(`${API}/me/dashboard`, () => HttpResponse.json({ widgets: [] })),
  http.get(`${API}/me/mail-summary`, () => HttpResponse.json({ unreadCount: 0, recent: [] })),
  http.get(`${API}/me/messaging-summary`, () =>
    HttpResponse.json({ unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [] }),
  ),
  http.get(`${API}/me/priority-items`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/calendar/events`, () => HttpResponse.json([])),
  http.get(`${API}/calendar/tags`, () => HttpResponse.json([])),
  http.get(`${API}/messaging/channels`, () => HttpResponse.json([])),
  http.get(`${API}/messaging/dms`, () => HttpResponse.json([])),
  http.get(`${API}/me/pinned-views`, () => HttpResponse.json([])),
  // 프로젝트 즐겨찾기(WP-1001) — 기본은 빈 목록. 추가·해제는 성공만 돌려주고, 이관은 받은 key 를 그대로 돌려준다.
  // 토글 뒤 재조회까지 보는 테스트는 상태를 가진 핸들러를 server.use 로 다시 건다.
  http.get(`${API}/me/project-favorites`, () => HttpResponse.json({ projectKeys: [] })),
  http.put(`${API}/me/project-favorites/:key`, () => new HttpResponse(null, { status: 204 })),
  http.delete(`${API}/me/project-favorites/:key`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API}/me/project-favorites/import`, async ({ request }) => {
    const body = (await request.json()) as { projectKeys: string[] }
    return HttpResponse.json({ projectKeys: [...new Set(body.projectKeys)] })
  }),
  http.get(`${API}/issue-relation-types`, () => HttpResponse.json(defaultRelationTypes())),
  http.get(`${API}/home/sessions`, () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get(`${API}/home/sessions/:id/proposals`, () => HttpResponse.json([])),
  http.get(`${API}/ai/chat/active`, () => HttpResponse.json({ limit: 3, items: [] })),
  http.get(`${API}/users/me/ai-preferences`, () => HttpResponse.json({ suggestionsEnabled: true, memoryEnabled: true })),
  http.get(`${API}/users/me/ai-memories`, () => HttpResponse.json({ items: [], limit: 50 })),
  http.get(`${API}/users/me/ai-memories/changes`, () => HttpResponse.json({ items: [], nextCursor: null, count30d: 0 })),
  http.get(`${API}/shared-ai-memories/spaces`, () => HttpResponse.json({ items: [] })),
  // 프로젝트 설정의 「노트 공간」 영역(WP-1480, 소유자에게만) — 기본은 공간 없음(404). 영역을 검증하는 테스트는 자기 응답을 앞에 건다.
  http.get(`${API}/wiki/project-spaces/:key`, () => HttpResponse.json({ message: '노트 공간이 없습니다' }, { status: 404 })),
  http.post(`${API}/ai/suggestions`, () => HttpResponse.json({ items: [], enabled: true })),
  http.get(`${API}/wiki/pages/:id/mentions`, () => HttpResponse.json([])),
  http.get(`${API}/wiki/pages/:id/summary`, () =>
    HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
  ),
  http.get(`${API}/wiki/pages/:id/backlinks`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/user-groups`, () => HttpResponse.json({ shared: [], personal: [] })),
  // 아바타 주소 표(WP-1222) — 앱 루트(AvatarsProvider)가 로그인하면 한 번 부른다. 기본은 아무도 아바타가 없다(모두 이니셜).
  http.get(`${API}/users/avatars`, () => HttpResponse.json([])),
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 })),
  // 앱 링크 판정 설정(WP-1165) — 앱 셸이 한 번 부른다. 공개 호스트 없음(지금 호스트만 본다).
  http.get(`${API}/app-links/config`, () => HttpResponse.json({ appHost: null })),
  // 드라이브 공유 링크 카드(WP-1474) — 본문에 /s/sl_… 주소가 있는 화면이 부른다. 기본은 아무것도 드러내지 않는 410(만료·없는 링크).
  http.get(`${API}/app-links/shares/:token`, () => HttpResponse.json({ message: '공유 링크가 만료되었거나 해제되었습니다' }, { status: 410 })),
  http.get(`${API}/notifications`, () => HttpResponse.json([])),
  http.get(`${API}/mail/unread-summary`, () => HttpResponse.json({ workUnread: 0 })),
  // E2E 기본 스텁에는 없어 503 으로 새던 조회(WP-971 에서 발견) — 메일 계정이 없는 사용자로 둔다.
  http.get(`${API}/mail/accounts`, () => HttpResponse.json([])),
  http.get(`${API}/mail/drafts/count`, () => HttpResponse.json({ count: 0 })),
  http.get(`${API}/mail/drafts`, () => HttpResponse.json([])),
  // 메일 서명(WP-1517) — 작성창이 열기 전에 이 조회를 기다린다. 기본은 서명 없음(자동 넣기 없음).
  http.get(`${API}/mail/signature`, () => HttpResponse.json(createMailSignature())),
  http.post(`${API}/mail/messages/:id/read`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API}/mail/messages/:id/unread`, () => new HttpResponse(null, { status: 204 })),
]
