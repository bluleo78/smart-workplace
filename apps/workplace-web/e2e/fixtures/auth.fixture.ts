import { type BrowserContext, type Page, test as base, type TestInfo } from '@playwright/test'

import type { TokenResponse, UserResponse } from '../../src/types/auth'
import type { RoleResponse } from '../../src/types/role'
import { createTokenResponse, createUser } from '../factories/auth.factory'
import { defaultNotificationSettings } from '../factories/notificationSettings.factory'
import { defaultRelationTypes } from '../factories/issueRelation.factory'
import { seedStatuses } from '../factories/projectStatus.factory'
import { mockApi } from './api-mock'
import { beginReusedTest, endReusedTest, REUSE_APP, type ReuseHolder, reusedSlot, reuseSlotFixture, setReusedStorage, slotOfContext } from './reuse-app'
import { collabTestToken, injectCollabNamespace, useCollabNamespaceForReusedPage } from './collab'
import { stubDraftsDefault } from './mail-drafts-mock'

// 인증 모킹 fixture.
// - 실제 백엔드 없이 인증된 상태 / 관리자 권한 상태의 page 를 제공.
// - 모든 시나리오에서 /api/v1/auth/refresh 도 미리 모킹 (StrictMode 마운트 시 호출).

// 기본 /api/v1/events 스텁 응답을 '열린 스트림'으로 바꿔치기하라는 표식 헤더(아래 fetch 래퍼가 인식).
const SSE_HOLD_HEADER = 'x-e2e-sse-hold'

const MOCK_USER_ROLE: RoleResponse = {
  id: 2, name: 'USER', description: '일반 사용자', isSystem: true,
}
const MOCK_ADMIN_ROLE: RoleResponse = {
  id: 1, name: 'ADMIN', description: '시스템 관리자', isSystem: true,
}

export async function setupAuthMocks(page: Page, user: UserResponse, roles: RoleResponse[], token: TokenResponse) {
  // 애니메이션/트랜지션 전역 비활성화 — Radix 다이얼로그·hover 툴바·Sonner 토스트의 전환이
  // Playwright actionability 의 "element is not stable" 을 유발해(부하 시 hover 가 풀리기 전에
  // 클릭을 못 끝냄) 비결정적 플래키의 큰 축이었다. 모든 페이지/네비게이션에 주입한다.
  //
  // 에러 토스트는 포인터 이벤트를 통과시킨다(WP-82). 모킹하지 않은 부가 API(503)가 띄운 에러 토스트가
  // 우하단 버튼을 덮으면 Playwright click 이 "intercepts pointer events" 로 토스트가 사라질 때(약 4초)까지
  // 재시도했다 — 39개 테스트에서 3~21초씩, 전체 합계 약 16% 가 이 대기였다. 토스트 표시·문구 단언은 그대로
  // 동작하고 클릭만 아래 요소로 전달된다. 에러 토스트 안의 버튼을 누르는 테스트(WP-55 ai-memory-result-line 의
  // "설정 열기")는 먼저 style[data-test-toast-passthrough] 를 제거한다.
  // 단, 이 규칙이 있으면 elementFromPoint 히트테스트에서 에러 토스트가 빠지므로 "토스트가 X 를 가리지 않는다"를
  // 히트테스트로 단언하는 spec 은 먼저 style[data-test-toast-passthrough] 를 제거해야 한다.
  if (!reusedSlot(page)) await installPageInitScripts(page)
  await mockProjectFavorites(page)
  await mockApi(page, 'POST', '/api/v1/auth/refresh', token)
  await mockApi(page, 'POST', '/api/v1/auth/login', token)
  await mockApi(page, 'GET', '/api/v1/users/me', { ...user, roles })
  // 프로젝트 상태 기본 스텁(WP-808) — 보드·목록·상세가 프로젝트마다 상태 목록을 불러오므로 기본 4상태(id 1~4)를 준다.
  // 미스텁 시 dev 프록시로 누수된다. GET 만 응답하고 추가·이름 변경(POST·PATCH)은 fallback — 그걸 검증하는 스펙이 자기 route 를
  // 나중에 등록(LIFO 우선)하므로, 상태 목록을 바꾸고 싶은 스펙도 같은 경로를 다시 등록하면 된다.
  await page.route('**/api/v1/projects/*/statuses', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seedStatuses()) })
      : route.fallback(),
  )
  // Phase 6d — 이슈 상세 진입 시 chat thread/messages 가 자동 lazy fetch 되므로,
  // 모든 인증 테스트에 빈 chat 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // chat 을 검증하는 spec 은 더 구체적 라우트를 나중에 등록 → 그쪽이 우선한다.
  await page.route('**/api/v1/projects/*/issues/*/chat/thread', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        threadId: 0,
        issueId: 0,
        archivedAt: null,
        members: [],
        recentMessages: [],
      }),
    }),
  )
  await page.route('**/api/v1/chat/threads/*/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
    }),
  )
  // Phase 7c — "/" 홈 셸이 마운트 시 기본 구성(my_tasks/issue_list/activity)을 자동 로드하며
  // /me/issues·/me/watched-issues·/me/activity 를 실제로 fetch 한다. 모든 인증 테스트가
  // 결국 "/" 에 착지하므로(예: 로그아웃) 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // mockApi 는 pathname 정확 매칭(쿼리스트링 무시) → ?assignee=me&size=50 등도 매칭된다.
  // 홈을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/watched-issues', { items: [], nextCursor: null, hasMore: false })
  await mockApi(page, 'GET', '/api/v1/me/activity', { items: [], nextCursor: null })
  // 공통 부가 조회 빈 기본 스텁(WP-85). 전체 E2E 에서 모킹 누락으로 503 이 가장 많이 난 목록·개수 조회들이다
  // (프로젝트 목록 543회, 드라이브 스페이스 285회, 사이클 252회, 유형 215회 …). 503 은 에러 토스트·재시도로 화면을
  // 다시 그려 클릭 타이밍 flaky 의 원인이 될 수 있어 빈 성공 응답으로 고정한다. 각 spec 이 나중에 등록한 라우트가 우선한다.
  const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }
  await mockApi(page, 'GET', '/api/v1/projects', emptyPage)
  await mockApi(page, 'GET', '/api/v1/members', emptyPage)
  await mockApi(page, 'GET', '/api/v1/drive/spaces', [])
  // 앱 링크 판정 설정(WP-1165) — 앱 셸이 한 번 부른다. 공개 호스트 없음(지금 호스트만 본다).
  await mockApi(page, 'GET', '/api/v1/app-links/config', { appHost: null })
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await mockApi(page, 'GET', '/api/v1/messaging/threads/inbox/unread-count', { count: 0 })
  // 알림 설정(WP-913) — 설정 › 알림 화면이 푸시 설정과 상관없이 늘 조회한다. 저장을 보는 spec 은 mockNotificationSettings 로 덮어쓴다.
  await mockApi(page, 'GET', '/api/v1/notification-settings', defaultNotificationSettings())
  // 프로젝트 하위 목록(/projects/{key}/cycles 등)과 이슈 하위 목록(/projects/{key}/issues/{n}/cycles 등).
  // components(WP-933): 이슈 상세·만들기·목록 필터가 구성요소 목록을 부른다 — 빈 목록이면 칸·필터가 숨는다(기존 화면 그대로).
  // versions(WP-888): 이슈 상세·목록 필터·타임라인이 버전 목록을 부른다 — 빈 목록이면 칸·필터·레인이 숨는다.
  // 메일 서버 메일함 목록(/mail/accounts/{id}/folders, WP-961) — 메일 사이드바가 늘 조회한다. 빈 목록 = 보관·내 메일함 숨김.
  const projectLists = /^\/api\/v1\/projects\/[^/]+\/(cycles|types|milestones|labels|members|saved-views|components|versions)$/
  const issueLists = /^\/api\/v1\/projects\/[^/]+\/issues\/\d+\/(cycles|drive-links)$/
  const mailFolders = /^\/api\/v1\/mail\/accounts\/\d+\/folders$/
  await page.route(
    (url) => projectLists.test(url.pathname) || issueLists.test(url.pathname) || mailFolders.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback(),
  )
  // WP-965: 메일 목록(받은편지함 전체·업무·보낸편지함)을 끝까지 내리면 서버에서 이전 메일을 더 가져온다 — 짧은 목록은 바로 끝이 보여 곧장 부른다.
  // 기본은 「더 없음」으로 응답해 목록 끝에 「더 이전 메일 없음」만 보이게 한다. 이어 받기를 검증하는 spec 은 나중에 등록(LIFO 우선).
  await page.route(
    (url) => /^\/api\/v1\/mail\/accounts\/\d+\/messages\/older$/.test(url.pathname),
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ running: false, fetched: 0, saved: 0, syncedSince: null, hasMore: false }),
          })
        : route.fallback(),
  )
  // 고정 홈 대시보드(Dashboard)가 "/" 마운트 시 레이아웃·위젯 데이터를 페치한다.
  // 모든 인증 테스트가 결국 "/" 에 착지하므로 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 대시보드를 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [] })
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { unreadCount: 0, recent: [] })
  // 홈 합성 레이어 「확인 필요」·「지금 신경 쓸 일」 소스 — 실패한 소스가 있으면 「다 확인했습니다」 대신 실패 안내라(WP-865) 빈 기본 스텁.
  await mockApi(page, 'GET', '/api/v1/me/messaging-summary', {
    unreadConversationCount: 0,
    needsReplyCount: 0,
    aiAttentionCount: 0,
    attentionCount: 0,
    recent: [],
  })
  // Task 11 — SynthesisLayer 가 usePriorityItems() 로 AI 우선순위 점수를 조회하므로
  // 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 정렬을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/priority-items', { items: [] })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  // 캘린더 사이드바 「태그」 묶음·태그 피커가 조회한다(WP-714) — 빈 기본 스텁으로 프록시 누수를 막는다
  await mockApi(page, 'GET', '/api/v1/calendar/tags', [])
  await mockApi(page, 'GET', '/api/v1/messaging/channels', [])
  await mockApi(page, 'GET', '/api/v1/messaging/dms', [])
  // 이슈 레이아웃의 IssueSidebar 가 마운트 시 /me/pinned-views(고정뷰)를 페치하므로
  // 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 고정뷰를 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/pinned-views', [])
  // WP-887: 이슈 「관계」 그룹(관계가 있을 때)·「＋ 관계 추가」 창이 관계 유형 목록을 부른다 — 기본 유형 6종 스텁. 검증 spec 이 나중에 등록하면 그쪽이 우선(LIFO).
  await mockApi(page, 'GET', '/api/v1/issue-relation-types', defaultRelationTypes())
  // #878: 팀 프로젝트 목록은 사이클 유무로 기본 그룹(사이클/없음)을 정하므로 /cycles 응답을 기다린다.
  // 미스텁이면 503+재시도 동안 스켈레톤이 떠 목록 단언이 느려지므로 빈 기본 스텁(=사이클 없음 → 평면 목록)을 깐다.
  // 사이클을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await page.route(
    (url) => /^\/api\/v1\/projects\/[^/]+\/cycles(\/progress)?$/.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback(),
  )
  // Phase 7d — "/" 홈 셸 마운트 시 세션 스위처가 /home/sessions 를 페치한다. 모든 인증 테스트가
  // 결국 "/" 에 착지하므로 빈 기본 목록 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 세션을 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  // WP-190: 앱 시작·SSE 재연결 때 생성 중 대화를 재동기화한다 — 미스텁이면 dev 프록시로 누수된다. 스펙이 나중에 등록한 route 가 우선(LIFO).
  await mockApi(page, 'GET', '/api/v1/ai/chat/active', { limit: 3, items: [] })
  // WP-139: 빈 AI 대화가 보이면 추천 설정·추천 질문을 부른다 — 미스텁이면 dev 프록시로 누수된다. 기본은 켜짐 + 빈 결과(고정 문구 유지).
  // 추천을 검증하는 spec 은 ai-suggestions-mock 으로 나중에 등록(LIFO 우선).
  // WP-55: 메모리 사용(기본 켜짐) + 빈 메모리 목록 — 설정 화면이 목록을 부른다. 검증 spec 은 ai-memory-mock 으로 나중에 등록(LIFO 우선).
  await mockApi(page, 'GET', '/api/v1/users/me/ai-preferences', { suggestionsEnabled: true, memoryEnabled: true })
  await mockApi(page, 'GET', '/api/v1/users/me/ai-memories', { items: [], limit: 50 })
  // WP-385: 설정 메모리 카드가 「AI가 정리한 기록」 첫 묶음(지난 30일 횟수)을 부른다 — 기본은 0번(안내 줄 숨김). 검증 spec 은 mockMemoryChanges 로 나중에 등록(LIFO 우선).
  await mockApi(page, 'GET', '/api/v1/users/me/ai-memories/changes', { items: [], nextCursor: null, count30d: 0 })
  // WP-386: 프로젝트 설정의 공용 메모리 링크·설정 공용 탭이 공간 목록을 부른다 — 기본은 빈 목록(링크 숨김). 검증 spec 은 shared-memory-mock 으로 나중에 등록(LIFO 우선).
  await mockApi(page, 'GET', '/api/v1/shared-ai-memories/spaces', { items: [] })
  await mockApi(page, 'POST', '/api/v1/ai/suggestions', { items: [], enabled: true })
  // #843: 세션 복원 시 미처리 확인카드(/home/sessions/:id/proposals)도 함께 페치한다 — 빈 기본 스텁.
  // 카드 복원을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await page.route(
    (url) => /^\/api\/v1\/home\/sessions\/[^/]+\/proposals$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // 위키 에디터가 마운트 시 useWikiMentions(page.id) 로 /wiki/pages/:id/mentions 를 페치하므로
  // 모든 wiki 스펙에서 빈 기본 스텁을 깔아 백엔드 프록시(localhost:9090) 누수를 막는다.
  // 멘션을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+\/mentions$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  // WP-301: 노트를 열 때마다 상단 요약 카드가 /wiki/pages/:id/summary 를 조회한다 — 미스텁이면 dev 프록시로 누수되고,
  // MISSING 으로 보이면 자동 생성(POST)까지 나간다. 기본은 TOO_SHORT(카드 없음·생성 안 함)로 두고,
  // 요약을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+\/summary$/.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ summary: null, status: 'TOO_SHORT', summaryVersion: null, pageVersion: 1, summarizedAt: null }),
          })
        : route.fallback(),
  )
  // 백링크(Task 9 예정)도 같은 자리에서 빈 기본 스텁으로 누수 예방.
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+\/backlinks$/.test(url.pathname),
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }),
  )
  // #93 그룹 트리가 마운트되므로 다른 authed 스펙 누수 방지용 기본 빈 트리
  await page.route(
    (url) => url.pathname === '/api/v1/user-groups',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shared: [], personal: [] }),
      }),
  )
  // 알림 인박스 기본 스텁 — 모든 인증 페이지에서 종/배지가 마운트되므로 기본값 제공.
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  // 메일 모바일 탭바 '업무' 미읽음 배지 기본 스텁(WP-186) — 미스텁 시 dev 프록시로 누수된다. 스펙이 나중에 등록한 route 가 우선(LIFO).
  await mockApi(page, 'GET', '/api/v1/mail/unread-summary', { workUnread: 0 })
  // 메일 임시저장(WP-577) 기본 스텁 — 사이드바 개수·작성창 자동 저장이 dev 프록시로 새지 않게(상세는 stubDraftsDefault).
  await stubDraftsDefault(page)
  // WP-214: 메일을 열면 상세 조회와 별도로 읽음 요청(POST /mail/messages/{id}/read)이 나간다 — 미스텁 시 dev 프록시로 누수되고
  // 실패 롤백(행이 다시 안 읽음 + 오류 토스트)이 메일 상세를 여는 모든 스펙을 흔든다. 읽음 요청을 검증하는 스펙은 나중에 등록(LIFO 우선).
  await page.route(
    (url) => /^\/api\/v1\/mail\/messages\/\d+\/(read|unread)$/.test(url.pathname),
    (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 204, body: '' }) : route.fallback(),
  )
  // 통합 SSE 단일 스트림 (#506): /api/v1/events 가 chat·messaging·notify 모두 대체.
  // 미스텁 시 백엔드 프록시로 누수되며, 백엔드 부재 시 503 재연결이 페이지 네비게이션과 레이스를
  // 일으켜(page.goto ERR_ABORTED/frame detached) 상세→목록 이동 테스트가 타임아웃된다.
  // 기본 스텁은 '열린 채 유지되는' 스트림이어야 한다(WP-59): 유한 본문은 응답 직후 끝나 클라이언트가 ~1초 뒤
  // 재연결하고, 재연결 catch-up(활성 쿼리 전체 재조회)이 스펙의 요청 카운트·시도 카운터·캐시를 흔든다.
  // route.fulfill 은 스트리밍 본문을 지원하지 않으므로 마커 헤더만 붙여 응답하고, 아래 fetch 래퍼가
  // 마커 응답을 '닫히지 않는 본문'으로 바꿔치기한다(onOpen 은 첫 연결 1회만 → catch-up 없음, isConnected=true 유지).
  // 미완료 route 핸들러를 남기지 않으므로 teardown 이 멈추지 않는다. SSE 를 검증하는 스펙은 자체 route 를
  // 나중에 등록(LIFO 우선)하며, 마커가 없으므로 기존처럼 동작한다.
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { [SSE_HOLD_HEADER]: '1' },
      body: '',
    }),
  )
  // 인증 컨텍스트가 마운트 시점에 hasSession 플래그를 보고 refresh 를 시도하므로
  // 미리 스토리지에 플래그를 심는다. 이어 쓰는 page(WP-1002)는 앱을 다시 띄울 때 넣는다.
  if (reusedSlot(page)) setReusedStorage(page, 'hasSession', '1')
  else await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
}


/**
 * 문서를 열 때마다 도는 공통 시작 스크립트 — 애니메이션 끄기·에러 토스트 포인터 통과, SSE 열린 스트림 래퍼.
 * 이어 쓰는 page(WP-1002)는 워커당 한 번만 깐다(문서를 새로 열지 않으므로 다시 깔 필요가 없다).
 */
async function installPageInitScripts(page: Page) {
  await page.addInitScript(() => {
    const css = `*, *::before, *::after {
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      scroll-behavior: auto !important;
    }`
    // 토스트 포인터 통과 규칙은 별도 style 로 둔다 — 토스트가 버튼을 가리는지 히트테스트로 검증하는 spec 이
    // 이 태그만 제거하고 실제 화면과 같은 조건에서 단언할 수 있게 한다(drive.spec.ts #715).
    const toastCss = `[data-sonner-toast][data-type="error"] { pointer-events: none !important; }`
    const inject = () => {
      const style = document.createElement('style')
      style.setAttribute('data-test-no-animation', '')
      style.textContent = css
      document.head.appendChild(style)
      const toastStyle = document.createElement('style')
      toastStyle.setAttribute('data-test-toast-passthrough', '')
      toastStyle.textContent = toastCss
      document.head.appendChild(toastStyle)
    }
    if (document.head) inject()
    else document.addEventListener('DOMContentLoaded', inject)
  })
  await page.addInitScript((holdHeader) => {
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init)
      if (res.headers.get(holdHeader) !== '1') return res
      // 요청 signal abort(언마운트·재연결 정리) 시에만 본문을 에러로 끝내 reader.read() 루프를 풀어준다.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      // 열린 스트림 controller 모음 — pushHeldEvents(gatedEvents.ts)가 연결을 끊지 않고 프레임을 밀어 넣을 때 쓴다.
      const w = window as unknown as { __e2eHeldSse?: Set<ReadableStreamDefaultController<Uint8Array>> }
      const held = (w.__e2eHeldSse ??= new Set())
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          held.add(controller)
          const abort = () => {
            held.delete(controller)
            try {
              controller.error(new DOMException('Aborted', 'AbortError'))
            } catch {
              // 이미 닫힌 스트림이면 무시
            }
          }
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        },
      })
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
  }, SSE_HOLD_HEADER)
}

/**
 * 프로젝트 즐겨찾기(WP-1001) 목 — 라우트라 이어 쓰는 page(WP-1002)도 테스트마다 다시 깔아야 해서 시작 스크립트와 따로 둔다.
 */
async function mockProjectFavorites(page: Page) {
  // 서버처럼 상태를 가진 목. 테스트(페이지)마다 새 집합이라 테스트 사이에 새지 않는다.
  // 예전처럼 localStorage(project-favorites:<userId>:<tenantId>)에 심은 즐겨찾기는 앱의 이관 경로로 이 집합에 들어온다.
  const projectFavorites = new Set<string>()
  const favoritesBody = () => JSON.stringify({ projectKeys: [...projectFavorites] })
  await page.route('**/api/v1/me/project-favorites**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const rest = decodeURIComponent(url.pathname.replace(/^.*\/me\/project-favorites\/?/, ''))
    if (req.method() === 'GET' && rest === '') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: favoritesBody() })
    }
    if (req.method() === 'POST' && rest === 'import') {
      for (const k of (req.postDataJSON() as { projectKeys: string[] }).projectKeys) projectFavorites.add(k)
      return route.fulfill({ status: 200, contentType: 'application/json', body: favoritesBody() })
    }
    if (req.method() === 'PUT' && rest) projectFavorites.add(rest)
    else if (req.method() === 'DELETE' && rest) projectFavorites.delete(rest)
    else return route.fallback()
    return route.fulfill({ status: 204, body: '' })
  })
}

type AuthFixtures = {
  authenticatedPage: Page
  adminPage: Page
  /**
   * 노트 동시 편집 문서 네임스페이스(WP-172) — 테스트마다 고유. 모든 테스트 컨텍스트에 자동 주입되어
   * (localStorage 'e2e:collabNs') 병렬 worker·프로젝트·재시도가 동기화 서버의 같은 문서를 공유하지 않는다.
   */
  collabNs: string
  /**
   * 두 번째 브라우저 컨텍스트의 page — 같은 collabNs 문서에 붙는다(동시 편집 시나리오).
   * user 를 주면 그 사람으로 로그인한다: /users/me 와 동기화 서버 토큰(uid·name)을 함께 바꿔, 접속자 목록이 다른 사람으로 본다(WP-173).
   * 주지 않으면 기존처럼 같은 사용자(id 1).
   */
  newAuthedPage: (opts?: { user?: Partial<UserResponse> }) => Promise<Page>
}

/** 테스트마다 고유한 동기화 문서 네임스페이스 — 문서 이름 규칙([^/]+)에 맞게 '/' 등은 '-' 로 바꾼다. */
function collabNsName(testInfo: TestInfo): string {
  return `${testInfo.project.name}-${testInfo.testId}-r${testInfo.retry}-${testInfo.repeatEachIndex}`.replace(/[^\w-]/g, '-')
}

/**
 * page·context 를 워커 안에서 이어 쓴다(WP-1002, 기본 켬, 상세는 reuse-app.ts).
 * 브라우저 설정은 Playwright 기본 page 와 같은 option fixture 에서 읽는다 — 파일의 test.use(뷰포트·터치 등)가 그대로 먹는다.
 * E2E_REUSE_APP=0 이면 Playwright 기본(테스트마다 새 컨텍스트) 그대로다.
 */
const withReuse = REUSE_APP
  ? base.extend<object, { _reuseSlot: ReuseHolder }>({
      _reuseSlot: [reuseSlotFixture(installPageInitScripts), { scope: 'worker' }],
      context: async ({ _reuseSlot, contextOptions, baseURL, viewport, hasTouch, isMobile, deviceScaleFactor, userAgent, locale, timezoneId, colorScheme, serviceWorkers, permissions, geolocation, offline, extraHTTPHeaders, javaScriptEnabled, storageState }, use) => {
        const options = { ...contextOptions, baseURL, viewport, hasTouch, isMobile, deviceScaleFactor, userAgent, locale, timezoneId, colorScheme, serviceWorkers, permissions, geolocation, offline, extraHTTPHeaders, javaScriptEnabled, storageState }
        await use((await _reuseSlot.get(options)).context)
      },
      page: async ({ _reuseSlot, context }, use, testInfo) => {
        const slot = slotOfContext(context)!
        await beginReusedTest(slot)
        await use(slot.page)
        await endReusedTest(slot, testInfo, _reuseSlot.discard)
      },
    })
  : base

export const test = withReuse.extend<AuthFixtures>({
  // auto — 노트를 열지 않는 테스트도 비용이 initScript 1개뿐이고, 노트를 여는 모든 spec 이 따로 요청하지 않아도 격리된다.
  // 문서 이름 규칙([^/]+)에 맞게 '/' 등은 '-' 로 바꾼다. 프로젝트·재시도까지 넣어 재시도가 이전 시도의 편집을 이어받지 않게 한다.
  collabNs: [
    // 이어 쓰는 page(WP-1002)는 컨텍스트를 테스트끼리 같이 쓰므로 시작 스크립트 대신 앱을 다시 띄울 때 넣는다.
    REUSE_APP
      ? async ({ page }, use, testInfo) => {
          const ns = collabNsName(testInfo)
          useCollabNamespaceForReusedPage(page, ns, (key, value) => setReusedStorage(page, key, value))
          await use(ns)
        }
      : async ({ context }, use, testInfo) => {
          const ns = collabNsName(testInfo)
          await injectCollabNamespace(context, ns)
          await use(ns)
        },
    { auto: true },
  ],
  newAuthedPage: async ({ browser, collabNs }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (opts) => {
      // browser.newContext() 는 테스트 러너가 config 의 use(baseURL·뷰포트·serviceWorkers 등)를 기본값으로 넣어 준다.
      const ctx = await browser.newContext()
      contexts.push(ctx)
      await injectCollabNamespace(ctx, collabNs)
      const page = await ctx.newPage()
      const user = createUser({ aiAvailable: true, ...opts?.user })
      // 다른 사람으로 열면 동기화 서버도 그 사람으로 보도록 토큰에 uid·name 을 싣는다(테스트 모드 인증 스텁 규약).
      const token = opts?.user ? createTokenResponse({ accessToken: collabTestToken(user) }) : createTokenResponse()
      await setupAuthMocks(page, user, [MOCK_USER_ROLE], token)
      return page
    })
    for (const ctx of contexts) await ctx.close()
  },
  authenticatedPage: async ({ page }, use) => {
    // aiAvailable:true — 기존 AI affordance 테스트들이 칩/카드를 기대하므로 기본 활성.
    await setupAuthMocks(page, createUser({ aiAvailable: true }), [MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
  adminPage: async ({ page }, use) => {
    await setupAuthMocks(page, createUser(), [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], createTokenResponse())
    await use(page)
  },
})

export { expect } from '@playwright/test'
