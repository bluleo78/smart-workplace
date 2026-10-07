import { type BrowserContext, type Page, test as base } from '@playwright/test'

import type { TokenResponse, UserResponse } from '../../src/types/auth'
import type { RoleResponse } from '../../src/types/role'
import { createTokenResponse, createUser } from '../factories/auth.factory'
import { mockApi } from './api-mock'
import { injectCollabNamespace } from './collab'

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
  // 동작하고 클릭만 아래 요소로 전달된다(에러 토스트 안의 버튼을 누르는 테스트는 없다).
  // 단, 이 규칙이 있으면 elementFromPoint 히트테스트에서 에러 토스트가 빠지므로 "토스트가 X 를 가리지 않는다"를
  // 히트테스트로 단언하는 spec 은 먼저 style[data-test-toast-passthrough] 를 제거해야 한다.
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
  await mockApi(page, 'POST', '/api/v1/auth/refresh', token)
  await mockApi(page, 'POST', '/api/v1/auth/login', token)
  await mockApi(page, 'GET', '/api/v1/users/me', { ...user, roles })
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
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await mockApi(page, 'GET', '/api/v1/messaging/threads/inbox/unread-count', { count: 0 })
  // 프로젝트 하위 목록(/projects/{key}/cycles 등)과 이슈 하위 목록(/projects/{key}/issues/{n}/cycles 등).
  const projectLists = /^\/api\/v1\/projects\/[^/]+\/(cycles|types|milestones|labels|members|saved-views)$/
  const issueLists = /^\/api\/v1\/projects\/[^/]+\/issues\/\d+\/(cycles|drive-links)$/
  await page.route(
    (url) => projectLists.test(url.pathname) || issueLists.test(url.pathname),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback(),
  )
  // 고정 홈 대시보드(Dashboard)가 "/" 마운트 시 레이아웃·위젯 데이터를 페치한다.
  // 모든 인증 테스트가 결국 "/" 에 착지하므로 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 대시보드를 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [] })
  await mockApi(page, 'GET', '/api/v1/me/mail-summary', { unreadCount: 0, recent: [] })
  // Task 11 — SynthesisLayer 가 usePriorityItems() 로 AI 우선순위 점수를 조회하므로
  // 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 정렬을 검증하는 spec 은 더 구체적 응답을 나중에 등록 → LIFO 로 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/priority-items', { items: [] })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await mockApi(page, 'GET', '/api/v1/messaging/channels', [])
  await mockApi(page, 'GET', '/api/v1/messaging/dms', [])
  // 이슈 레이아웃의 IssueSidebar 가 마운트 시 /me/pinned-views(고정뷰)를 페치하므로
  // 빈 기본 스텁을 깔아 백엔드 프록시(ECONNREFUSED) 누수를 막는다.
  // 고정뷰를 검증하는 spec 은 더 구체적 목록을 나중에 등록 → 그쪽이 우선한다.
  await mockApi(page, 'GET', '/api/v1/me/pinned-views', [])
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
  await page.addInitScript((holdHeader) => {
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init)
      if (res.headers.get(holdHeader) !== '1') return res
      // 요청 signal abort(언마운트·재연결 정리) 시에만 본문을 에러로 끝내 reader.read() 루프를 풀어준다.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => {
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
  // 인증 컨텍스트가 마운트 시점에 hasSession 플래그를 보고 refresh 를 시도하므로
  // 미리 스토리지에 플래그를 심는다.
  await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
}

type AuthFixtures = {
  authenticatedPage: Page
  adminPage: Page
  /**
   * 노트 동시 편집 문서 네임스페이스(WP-172) — 테스트마다 고유. 모든 테스트 컨텍스트에 자동 주입되어
   * (localStorage 'e2e:collabNs') 병렬 worker·프로젝트·재시도가 동기화 서버의 같은 문서를 공유하지 않는다.
   */
  collabNs: string
  /** 같은 사용자로 로그인된 두 번째 브라우저 컨텍스트의 page — 같은 collabNs 문서에 붙는다(동시 편집 시나리오). */
  newAuthedPage: () => Promise<Page>
}

export const test = base.extend<AuthFixtures>({
  // auto — 노트를 열지 않는 테스트도 비용이 initScript 1개뿐이고, 노트를 여는 모든 spec 이 따로 요청하지 않아도 격리된다.
  // 문서 이름 규칙([^/]+)에 맞게 '/' 등은 '-' 로 바꾼다. 프로젝트·재시도까지 넣어 재시도가 이전 시도의 편집을 이어받지 않게 한다.
  collabNs: [
    async ({ context }, use, testInfo) => {
      const ns = `${testInfo.project.name}-${testInfo.testId}-r${testInfo.retry}-${testInfo.repeatEachIndex}`.replace(/[^\w-]/g, '-')
      await injectCollabNamespace(context, ns)
      await use(ns)
    },
    { auto: true },
  ],
  newAuthedPage: async ({ browser, collabNs }, use) => {
    const contexts: BrowserContext[] = []
    await use(async () => {
      // browser.newContext() 는 테스트 러너가 config 의 use(baseURL·뷰포트·serviceWorkers 등)를 기본값으로 넣어 준다.
      const ctx = await browser.newContext()
      contexts.push(ctx)
      await injectCollabNamespace(ctx, collabNs)
      const page = await ctx.newPage()
      await setupAuthMocks(page, createUser({ aiAvailable: true }), [MOCK_USER_ROLE], createTokenResponse())
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
