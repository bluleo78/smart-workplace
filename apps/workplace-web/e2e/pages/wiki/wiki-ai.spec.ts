// 위키 인에디터 /ai E2E(#593 편입) — 슬래시 메뉴 → AI 액션 → POST 시작(correlationId) → 통합
// /api/v1/events 로 델타 수신 → 에디터 삽입 (백엔드 없이 모킹).
//
// 모킹 방식: POST .../ai 는 즉시 { correlationId } 를 반환하고, /api/v1/events 응답은 그 POST 가
// 도착할 때까지 보류했다가(await) 해당 correlationId 로 태그된 SSE 본문을 흘린다 — /events 는 앱 마운트
// 시 1회 연결되므로, 응답을 즉시 fulfill 하면 사용자 액션보다 먼저 도착해 유실된다(messaging-progress.spec.ts
// 의 "await 로 보류 후 fulfill" 패턴과 동일).
//
// SSE 모킹 한계: Playwright route.fulfill 은 본문을 한 방에 전달하므로 토큰 점진 렌더(progressive)
// 는 검증하지 않는다(설계 한계). 최종 합쳐진 텍스트가 에디터에 삽입되는지 + POST payload 의 action
// 만 파이프라인 전체로 검증한다.
import type { Page } from '@playwright/test'
import type { WikiPageDetail, WikiPageSummary, WikiRole, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 300

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
async function setupWikiMocks(page: Page, role: WikiRole) {
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

// 델타 배열 → wiki.ai.* SSE 본문(correlationId 포함, delta N개 + done).
function buildWikiAiSse(deltas: string[], correlationId: string): string {
  const parts = deltas.map(
    (text) => `event: wiki.ai.delta\ndata: ${JSON.stringify({ correlationId, text })}\n\n`,
  )
  parts.push(`event: wiki.ai.done\ndata: ${JSON.stringify({ correlationId })}\n\n`)
  return parts.join('')
}

// POST 시작(JSON correlationId) + /events(SSE, 그 correlationId 로 델타) 를 함께 설정한다.
// onStart 로 요청 payload(action/prompt/selection)를 캡처할 수 있다.
async function mockWikiAiGeneration(
  page: Page,
  opts: {
    deltas: string[]
    onStart?: (body: { action: string; prompt?: string; selection?: string }) => void
  },
) {
  let resolveStarted: (correlationId: string) => void
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve
  })

  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const body = route.request().postDataJSON() as {
      action: string
      prompt?: string
      selection?: string
    }
    opts.onStart?.(body)
    const correlationId = `corr-${Math.random().toString(36).slice(2)}`
    resolveStarted(correlationId)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ correlationId }),
    })
  })

  await page.route('**/api/v1/events', async (route) => {
    const correlationId = await started
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: buildWikiAiSse(opts.deltas, correlationId),
    })
  })
}

test('위키 /ai — 슬래시 메뉴 → AI 요약 → /events 스트림이 에디터에 삽입된다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')

  let aiAction: string | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['요약: ', '핵심 내용'],
    onStart: (body) => {
      aiAction = body.action
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()

  await page.getByTestId('wiki-slash-option-summarize').click()

  await expect.poll(() => aiAction).toBe('summarize')
  await expect(page.locator('.ProseMirror')).toContainText('요약: 핵심 내용')
})

test('위키 /ai 슬래시 메뉴 — 매칭 없는 검색어 입력 시 팝오버 유지 + 빈 상태 안내 (#670)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/제목없음')

  // 매칭 항목이 없어도 팝오버는 사라지지 않고 안내 문구가 남아야 한다.
  const popover = page.getByTestId('wiki-slash-popover')
  await expect(popover).toBeVisible()
  await expect(page.getByTestId('wiki-slash-empty')).toContainText('일치하는 명령이 없습니다')
  await expect(page.getByTestId('wiki-slash-option-summarize')).toHaveCount(0)
})

test('위키 /ai — AI 초안: 토픽 다이얼로그 입력 후 draft payload(prompt 포함) 전송', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'OWNER')

  let aiBody: { action: string; prompt?: string } | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['요약: ', '핵심 내용'],
    onStart: (body) => {
      aiBody = body
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
  await page.getByTestId('wiki-slash-option-draft').click()

  const topic = '회의록 템플릿'
  const dialogInput = page.getByRole('dialog').getByRole('textbox')
  await expect(dialogInput).toBeVisible()
  await dialogInput.fill(topic)
  await page.getByTestId('rename-dialog-confirm').click()

  await expect.poll(() => aiBody?.action).toBe('draft')
  expect((aiBody as { prompt?: string } | null)?.prompt).toBe(topic)
  await expect(page.locator('.ProseMirror')).toContainText('요약: 핵심 내용')
})

test('위키 /ai — 진행 중 생성이 있으면 새 액션이 이전 생성을 취소한다(latest wins)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')

  // 이전에는 fetch abort(연결 끊김 감지)가 취소였지만, /events 분리 후에는 명시적 DELETE 호출이
  // 취소 메커니즘이다(#593 설계) — 이 테스트는 그 DELETE 호출과, 취소된 첫 생성의 텍스트가 최종
  // 결과에 섞이지 않는지를 직접 검증한다.
  const started: Array<{ action: string; correlationId: string }> = []
  const cancelled: string[] = []
  let seq = 0
  let resolveSecondStarted: (correlationId: string) => void
  const secondStarted = new Promise<string>((resolve) => {
    resolveSecondStarted = resolve
  })

  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const action = (route.request().postDataJSON() as { action: string }).action
    seq += 1
    const correlationId = `corr-${seq}`
    started.push({ action, correlationId })
    if (started.length === 2) resolveSecondStarted(correlationId)
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ correlationId }),
    })
  })
  await page.route('**/api/v1/wiki/pages/*/ai/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    cancelled.push(route.request().url().split('/').pop() as string)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.route('**/api/v1/events', async (route) => {
    const correlationId = await secondStarted
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: buildWikiAiSse(['이어쓰기 ', '완료'], correlationId),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 1) 첫 액션(AI 요약) 트리거.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-summarize').click()
  await expect.poll(() => started.map((s) => s.action)).toEqual(['summarize'])

  // 2) 두 번째 액션(AI 이어쓰기) 트리거 — 첫 생성이 DELETE 로 취소되고 두 번째가 시작된다.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await page.getByTestId('wiki-slash-option-continue').click()
  await expect.poll(() => started.map((s) => s.action)).toEqual(['summarize', 'continue'])
  await expect.poll(() => cancelled).toEqual([started[0].correlationId])

  // 3) 두 번째 생성의 텍스트만 삽입되고, 첫 생성의 텍스트는 나타나지 않는다.
  await expect(page.locator('.ProseMirror')).toContainText('이어쓰기 완료')
  await expect(page.locator('.ProseMirror')).not.toContainText('요약')
})

// ── 팝업 max-height 회귀 (#250) ─────────────────────────────────────────────
test('위키 /ai 슬래시 메뉴 — max-height(240px) 클래스 적용으로 뷰포트 넘침 방지', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  await mockWikiAiGeneration(page, { deltas: [] })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  const popover = page.getByTestId('wiki-slash-popover')
  await expect(popover).toBeVisible()

  const maxHeight = await popover.evaluate((el) => parseFloat(window.getComputedStyle(el).maxHeight))
  expect(maxHeight).toBeLessThanOrEqual(240)
})

// ── 변형 툴바 (#541) ───────────────────────────────────────────────────────
async function typeAndSelectAll(page: Page, text: string) {
  await page.locator('.ProseMirror').click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+a')
}

test('위키 변형 — 선택 후 다듬기: polish payload + 선택영역 교체', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  let aiBody: { action: string; selection?: string } | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['다듬어진 ', '문장'],
    onStart: (body) => {
      aiBody = body
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await typeAndSelectAll(page, '원본 문장')

  await expect(page.getByTestId('wiki-ai-toolbar')).toBeVisible()
  await page.getByTestId('wiki-ai-tb-polish').click()

  await expect.poll(() => aiBody?.action).toBe('polish')
  expect((aiBody as { selection?: string } | null)?.selection).toBe('원본 문장')

  await expect(page.locator('.ProseMirror')).toContainText('다듬어진 문장')
  await expect(page.locator('.ProseMirror')).not.toContainText('원본 문장')
})

test('위키 변형 — 톤 드롭다운: rewrite_tone payload(prompt=격식체)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  let aiBody: { action: string; prompt?: string } | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['다듬어진 ', '문장'],
    onStart: (body) => {
      aiBody = body
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await typeAndSelectAll(page, '원본 문장')

  await page.getByTestId('wiki-ai-tb-rewrite_tone').click()
  await page.getByTestId('wiki-ai-tone-격식체').click()

  await expect.poll(() => aiBody?.action).toBe('rewrite_tone')
  expect((aiBody as { prompt?: string } | null)?.prompt).toBe('격식체')
})

test('위키 변형 — VIEWER 는 변형 툴바가 노출되지 않는다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, 'VIEWER')
  let aiCalled = 0
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    aiCalled += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ correlationId: 'unused' }),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await typeAndSelectAll(page, '원본 문장')

  await page.waitForTimeout(500)
  await expect(page.getByTestId('wiki-ai-toolbar')).toHaveCount(0)
  expect(aiCalled).toBe(0)
})

test('위키 변형 — 단일 undo 로 변형 전 원본으로 복원된다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, 'EDITOR')
  await mockWikiAiGeneration(page, { deltas: ['다듬어진 ', '문장'] })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await typeAndSelectAll(page, '원본 문장')
  await page.waitForTimeout(600)

  await expect(page.getByTestId('wiki-ai-toolbar')).toBeVisible()
  await page.getByTestId('wiki-ai-tb-polish').click()
  await expect(page.locator('.ProseMirror')).toContainText('다듬어진 문장')
  await expect(page.locator('.ProseMirror')).not.toContainText('원본 문장')

  await page.locator('.ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.ProseMirror')).toContainText('원본 문장')
  await expect(page.locator('.ProseMirror')).not.toContainText('다듬어진 문장')
})

test('위키 /ai — VIEWER 는 슬래시 AI 메뉴가 노출되지 않는다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, 'VIEWER')

  let aiCalled = 0
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    aiCalled += 1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ correlationId: 'unused' }),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')

  await page.waitForTimeout(500)
  await expect(page.getByTestId('wiki-slash-popover')).toHaveCount(0)
  expect(aiCalled).toBe(0)
})
