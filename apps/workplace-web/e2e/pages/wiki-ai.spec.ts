// 위키 인에디터 /ai E2E — 슬래시 메뉴 → AI 액션 → SSE 스트림 소비 → 에디터 삽입 (백엔드 없이 모킹).
//
// SSE 모킹 한계: Playwright route.fulfill 은 본문을 한 방에 전달하므로 토큰 점진 렌더(progressive)
// 는 검증하지 않는다(설계 한계). 최종 합쳐진 텍스트가 에디터에 삽입되는지 + POST payload 의 action
// 만 파이프라인 전체로 검증한다.
import type { WikiPageDetail, WikiPageSummary, WikiRole, WikiSpace } from '../../src/types/wiki'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 300

// SSE 본문 — delta 2개 + done. 실제 개행(\n) 사용.
const SSE_BODY =
  'event: delta\ndata: {"text":"요약: "}\n\nevent: delta\ndata: {"text":"핵심 내용"}\n\nevent: done\ndata: {}\n\n'

function space(role: WikiRole): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

function pageDetail(): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title: 'AI 대상 페이지',
    body: '',
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  }
}

// 공통 모킹: 스페이스(역할 가변) + 트리 + 페이지 GET/PUT(자동저장).
async function setupWikiMocks(page: import('@playwright/test').Page, role: WikiRole) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([space(role)]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: PAGE_ID, parentId: null, title: 'AI 대상 페이지', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  // 멤버 목록(TEAM 사이드바가 페치할 수 있음) — 빈 기본 스텁.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  let version = 1
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail()),
        })
      }
      if (method === 'PUT') {
        // 자동저장 — version+1 로 응답(409 없음). AI 삽입이 'update' 를 발화해 PUT 이 온다.
        version += 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...pageDetail(), version }),
        })
      }
      return route.fallback()
    },
  )
}

test('위키 /ai — 슬래시 메뉴 → AI 요약 → SSE 스트림이 에디터에 삽입된다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')

  // /ai SSE 엔드포인트 — POST payload 캡처 + SSE 본문 fulfill.
  let aiAction: string | null = null
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    aiAction = (route.request().postDataJSON() as { action: string }).action
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: SSE_BODY,
    })
  })

  // 1) 페이지로 진입.
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 2) 에디터 포커스 후 "/" 입력 → 슬래시 메뉴 노출.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()

  // 3) 'AI 요약' 클릭.
  await page.getByTestId('wiki-slash-option-summarize').click()

  // 4) POST payload 의 action 검증.
  await expect.poll(() => aiAction).toBe('summarize')

  // 5) 에디터에 최종 합쳐진 텍스트 삽입 검증.
  await expect(page.locator('.ProseMirror')).toContainText('요약: 핵심 내용')
})

test('위키 /ai — AI 초안: 토픽 다이얼로그 입력 후 draft payload(prompt 포함) 전송', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'OWNER')

  // /ai SSE — POST payload(action·prompt) 캡처.
  let aiBody: { action: string; prompt?: string } | null = null
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    aiBody = route.request().postDataJSON() as { action: string; prompt?: string }
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // "/" → 메뉴 → 'AI 초안' → 토픽 다이얼로그 노출.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
  await page.getByTestId('wiki-slash-option-draft').click()

  // 토픽 입력(RenameDialog 재사용) 후 확인 → draft payload 전송.
  const topic = '회의록 템플릿'
  const dialogInput = page.getByRole('dialog').getByRole('textbox')
  await expect(dialogInput).toBeVisible()
  await dialogInput.fill(topic)
  await page.getByTestId('rename-dialog-confirm').click()

  // POST payload: action==='draft' + prompt===토픽.
  await expect.poll(() => aiBody?.action).toBe('draft')
  const captured = aiBody as { action: string; prompt?: string } | null
  expect(captured?.prompt).toBe(topic)
  // 스트림 결과가 에디터에 삽입된다.
  await expect(page.locator('.ProseMirror')).toContainText('요약: 핵심 내용')
})

test('위키 /ai — 진행 중 스트림이 있으면 새 액션이 이전 스트림을 중단한다(latest wins)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')

  // 첫 호출(summarize)은 응답을 보류해 스트림을 in-flight 로 유지한다. 두 번째 호출(continue)이
  // 도착하면 컴포넌트가 첫 스트림을 abort → fetch 가 취소되어 첫 본문은 절대 삽입되지 않는다.
  // 두 번째 호출만 정상 SSE 본문을 흘려 에디터에 삽입한다. 첫 스트림이 abort 되지 않았다면
  // 두 본문이 교차 삽입되어 '요약: 핵심 내용' 이 함께 나타나(non-interleaving 검증 실패).
  const SECOND_BODY =
    'event: delta\ndata: {"text":"이어쓰기 "}\n\nevent: delta\ndata: {"text":"완료"}\n\nevent: done\ndata: {}\n\n'
  const actions: string[] = []

  await page.route('**/api/v1/wiki/pages/*/ai', async (route) => {
    const action = (route.request().postDataJSON() as { action: string }).action
    actions.push(action)
    if (action === 'summarize') {
      // 보류 — 응답하지 않는다. 컴포넌트가 두 번째 트리거에서 이 스트림을 abort 하면 fetch 가
      // 취소되어 아래 fulfill 본문은 클라이언트에 전달되지 않는다(abort 가 안 됐다면 1s 후 교차 삽입).
      await page.waitForTimeout(1000)
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY }).catch(() => {})
      return
    }
    // continue — 정상 SSE 본문.
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: SECOND_BODY })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 1) 첫 액션(AI 요약) 트리거 → 스트림 in-flight + '생성 중…' 표시.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-summarize').click()
  await expect(page.getByTestId('wiki-ai-busy')).toBeVisible()
  await expect.poll(() => actions).toEqual(['summarize'])

  // 2) 진행 중에 두 번째 액션(AI 이어쓰기) 트리거 → 첫 스트림 abort, 두 번째 진행.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-continue').click()

  // 3) 두 번째(continue) 본문만 삽입된다.
  await expect(page.locator('.ProseMirror')).toContainText('이어쓰기 완료')

  // 4) 두 액션이 순서대로 전송됐다(첫 스트림 abort 후 두 번째 진행 — latest wins).
  await expect.poll(() => actions).toEqual(['summarize', 'continue'])

  // 5) 보류 라우트의 fulfill 시점(1s)을 지나도 첫 스트림(summarize) 본문은 끝내 삽입되지 않는다
  //    (abort 가 fetch 를 취소했기 때문). abort 가 없었다면 여기서 '요약: 핵심 내용' 이 교차 삽입된다.
  await page.waitForTimeout(1500)
  await expect(page.locator('.ProseMirror')).not.toContainText('요약: 핵심 내용')
})

// ── 팝업 max-height 회귀 (#250) ─────────────────────────────────────────────
// WikiSlashMenu 에 max-h-60(240px) 이 적용되어 항목이 많아도 팝업이 뷰포트를 넘지 않는다.
// 슬래시 메뉴는 현재 3개 항목만 있어 overflow 가 발생하지 않으므로 max-height 클래스 적용 여부를
// computed style 로 검증한다.

test('위키 /ai 슬래시 메뉴 — max-height(240px) 클래스 적용으로 뷰포트 넘침 방지', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')

  await page.route('**/api/v1/wiki/pages/*/ai', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }),
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // '/' 입력 → 슬래시 메뉴 노출.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  const popover = page.getByTestId('wiki-slash-popover')
  await expect(popover).toBeVisible()

  // computedStyle 로 max-height 가 240px(15rem) 으로 제한됨을 검증한다.
  const maxHeight = await popover.evaluate(
    (el) => parseFloat(window.getComputedStyle(el).maxHeight),
  )
  expect(maxHeight).toBeLessThanOrEqual(240)
})

test('위키 /ai — VIEWER 는 슬래시 AI 메뉴가 노출되지 않는다', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'VIEWER')

  // /ai 호출이 발생하면 안 됨 — 호출 카운터.
  let aiCalled = 0
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    aiCalled += 1
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE_BODY })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // "/" 입력해도 슬래시 메뉴(allow 게이트로 차단)가 뜨지 않는다.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')

  // 팝업이 뜰 시간을 충분히 준 뒤에도 미노출.
  await page.waitForTimeout(500)
  await expect(page.getByTestId('wiki-slash-popover')).toHaveCount(0)
  expect(aiCalled).toBe(0)
})
