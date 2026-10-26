// 페이지 테스트(MSW) 기본 응답 — 앱 셸이 어느 화면에서나 부르는 부가 조회를 빈 성공 응답으로 깐다(WP-971).
// E2E 의 setupAuthMocks(e2e/fixtures/auth.fixture.ts)와 같은 기본값이다. 화면을 검증하는 테스트는
// server.use(...) 로 같은 경로를 다시 등록하면 그쪽이 우선한다(MSW 는 나중에 등록한 핸들러가 먼저).
// 여기 없는 요청은 setup.ts 가 테스트 실패로 처리한다 — 모킹 누락이 조용히 지나가지 않게.
import { http, HttpResponse } from 'msw'

import type { TokenResponse, UserResponse } from '@/types/auth'
import type { RoleResponse } from '@/types/role'

import { createTokenResponse, createUser } from '../../../e2e/factories/auth.factory'
import { defaultRelationTypes } from '../../../e2e/factories/issueRelation.factory'
import { defaultNotificationSettings } from '../../../e2e/factories/notificationSettings.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

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

/** 앱 셸·공통 부가 조회 빈 기본값 — e2e/fixtures/auth.fixture.ts setupAuthMocks 와 같은 목록. */
export const shellHandlers = [
  holdEventStream,
  http.get(`${API}/projects/:key/statuses`, () => HttpResponse.json(seedStatuses())),
  http.get(`${API}/projects/:key/issues/:n/chat/thread`, () =>
    HttpResponse.json({ threadId: 0, issueId: 0, archivedAt: null, members: [], recentMessages: [] }),
  ),
  http.get(`${API}/chat/threads/:id/messages`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/issues`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/watched-issues`, () => HttpResponse.json(emptyCursor)),
  http.get(`${API}/me/activity`, () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get(`${API}/projects`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/members`, () => HttpResponse.json(emptyPage)),
  http.get(`${API}/drive/spaces`, () => HttpResponse.json([])),
  http.get(`${API}/calendars`, () => HttpResponse.json([])),
  http.get(`${API}/messaging/threads/inbox/unread-count`, () => HttpResponse.json({ count: 0 })),
  http.get(`${API}/notification-settings`, () => HttpResponse.json(defaultNotificationSettings())),
  // versions(WP-888): 이슈 상세·목록 필터·타임라인이 늘 부른다 — 빈 목록이면 칸·필터·레인이 숨는다(E2E setupAuthMocks 와 같음).
  ...['cycles', 'cycles/progress', 'types', 'milestones', 'labels', 'members', 'saved-views', 'components', 'versions'].map((sub) =>
    http.get(`${API}/projects/:key/${sub}`, () => HttpResponse.json([])),
  ),
  http.get(`${API}/projects/:key/issues/:n/cycles`, () => HttpResponse.json([])),
  http.get(`${API}/projects/:key/issues/:n/drive-links`, () => HttpResponse.json([])),
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
  http.get(`${API}/issue-relation-types`, () => HttpResponse.json(defaultRelationTypes())),
  http.get(`${API}/home/sessions`, () => HttpResponse.json({ items: [], nextCursor: null })),
  http.get(`${API}/home/sessions/:id/proposals`, () => HttpResponse.json([])),
  http.get(`${API}/ai/chat/active`, () => HttpResponse.json({ limit: 3, items: [] })),
  http.get(`${API}/users/me/ai-preferences`, () => HttpResponse.json({ suggestionsEnabled: true, memoryEnabled: true })),
  http.get(`${API}/users/me/ai-memories`, () => HttpResponse.json({ items: [], limit: 50 })),
  http.get(`${API}/users/me/ai-memories/changes`, () => HttpResponse.json({ items: [], nextCursor: null, count30d: 0 })),
  http.get(`${API}/shared-ai-memories/spaces`, () => HttpResponse.json({ items: [] })),
  http.post(`${API}/ai/suggestions`, () => HttpResponse.json({ items: [], enabled: true })),
  http.get(`${API}/wiki/pages/:id/mentions`, () => HttpResponse.json([])),
  http.get(`${API}/wiki/pages/:id/summary`, () =>
    HttpResponse.json({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
  ),
  http.get(`${API}/wiki/pages/:id/backlinks`, () => HttpResponse.json({ items: [] })),
  http.get(`${API}/user-groups`, () => HttpResponse.json({ shared: [], personal: [] })),
  http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 })),
  http.get(`${API}/notifications`, () => HttpResponse.json([])),
  http.get(`${API}/mail/unread-summary`, () => HttpResponse.json({ workUnread: 0 })),
  // E2E 기본 스텁에는 없어 503 으로 새던 조회(WP-971 에서 발견) — 메일 계정이 없는 사용자로 둔다.
  http.get(`${API}/mail/accounts`, () => HttpResponse.json([])),
  http.get(`${API}/mail/drafts/count`, () => HttpResponse.json({ count: 0 })),
  http.get(`${API}/mail/drafts`, () => HttpResponse.json([])),
  http.post(`${API}/mail/messages/:id/read`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API}/mail/messages/:id/unread`, () => new HttpResponse(null, { status: 204 })),
]
