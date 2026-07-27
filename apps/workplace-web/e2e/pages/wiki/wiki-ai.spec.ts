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

function pageDetail(body = ''): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title: 'AI 대상 페이지',
    body,
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

// 공통 모킹: 스페이스(역할 가변) + 트리 + 페이지 GET/PUT(자동저장).
// body: 페이지 본문 초기값(기본 빈 문자열). 시각검증·placeholder 테스트에서 실데이터 길이를 주입한다.
async function setupWikiMocks(page: Page, role: WikiRole, body = '') {
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
              {
                id: PAGE_ID,
                parentId: null,
                title: 'AI 대상 페이지',
                position: 0,
                aiLastUsedAt: null,
              } as WikiPageSummary,
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
          body: JSON.stringify(pageDetail(body)),
        })
      }
      if (method === 'PUT') {
        version += 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...pageDetail(body), version }),
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

// ── AI 진입점 상시 노출 + 툴바 위치 회귀 (#733) ──────────────────────────────
//
// 배경: 이전에는 노트 페이지를 열었을 때 보이는 AI 어피던스가 0개였다(슬래시 메뉴는 '/' 타이핑,
// 버블 툴바는 텍스트 선택, "AI 초안 작성"은 ⋯ 드롭다운 내부 — 전부 사용자 액션 후에만 등장).
// 또한 버블 툴바가 선택 위치가 아닌 좌측 상단에 렌더되는 버그가 있었다.

// 실데이터 길이의 긴 한국어 본문 — 짧은 목데이터로만 보면 폭 오버플로/레이아웃 붕괴를 놓친다.
const LONG_BODY = [
  '# 나만의 요리 비법',
  '',
  '요리를 처음 시작하는 분도 부담 없이 따라 할 수 있도록, 자주 해 먹는 집밥 3가지를 계량과 단계별 순서까지 꼼꼼히 정리했습니다. 계량은 **1큰술 = 15ml, 1작은술 = 5ml, 1컵 = 200ml** 기준입니다.',
  '',
  '## 1. 계란볶음밥',
  '',
  '> 온 국민의 자취 요리. 찬밥만 있으면 10분 만에 완성됩니다.',
  '',
  '**분량**: 1인분 / **조리 시간**: 약 10분 / **난이도**: 하',
  '',
  '### 재료',
  '',
  '- 찬밥 1공기(약 200g)',
  '- 계란 2개, 대파 1/2대, 간장 1큰술, 참기름 1작은술',
  '',
  '### 만드는 순서',
  '',
  '1. 팬을 중불로 달군 뒤 기름을 두르고 대파를 넣어 파기름을 냅니다.',
  '2. 계란을 풀어 넣고 반쯤 익으면 찬밥을 넣어 덩어리를 풀어 줍니다.',
  '3. 간장을 팬 가장자리에 둘러 향을 올리고, 불을 끈 뒤 참기름으로 마무리합니다.',
].join('\n')

test('위키 AI 노출 — 헤더 AI 버튼이 상시 보이고 요약 액션을 실행한다 (#733)', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR', LONG_BODY)
  let aiAction: string | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['요약: ', '집밥 3가지 레시피'],
    onStart: (body) => {
      aiAction = body.action
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 사용자 액션 없이(타이핑·선택 없이) 즉시 보여야 한다 — 이게 이 이슈의 핵심.
  const aiButton = page.getByTestId('wiki-ai-header-button')
  await expect(aiButton).toBeVisible()
  await expect(aiButton).not.toHaveAttribute('aria-disabled', 'true')

  await aiButton.click()
  await page.getByTestId('wiki-ai-header-summarize').click()

  await expect.poll(() => aiAction).toBe('summarize')
  await expect(page.locator('.ProseMirror')).toContainText('요약: 집밥 3가지 레시피')
})

test('위키 AI 노출 — 헤더 AI 초안: 토픽 다이얼로그를 열고 draft 를 전송한다 (#733)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'OWNER')
  let aiBody: { action: string; prompt?: string } | null = null
  await mockWikiAiGeneration(page, {
    deltas: ['초안 '],
    onStart: (body) => {
      aiBody = body
    },
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.getByTestId('wiki-ai-header-button').click()
  await page.getByTestId('wiki-ai-header-draft').click()

  const dialogInput = page.getByRole('dialog').getByRole('textbox')
  await expect(dialogInput).toBeVisible()
  await dialogInput.fill('주간 회고')
  await page.getByTestId('rename-dialog-confirm').click()

  await expect.poll(() => aiBody?.action).toBe('draft')
  expect((aiBody as { prompt?: string } | null)?.prompt).toBe('주간 회고')
})

test('위키 AI 노출 — VIEWER 는 버튼이 숨지 않고 비활성 + 사유가 노출된다 (#733)', async ({
  authenticatedPage: page,
}) => {
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

  // "기능 없음"이 아니라 "권한 없음"임을 알 수 있어야 한다 — 버튼은 보이고 사유가 텍스트로 뜬다.
  const aiButton = page.getByTestId('wiki-ai-header-button')
  await expect(aiButton).toBeVisible()
  await expect(aiButton).toHaveAttribute('aria-disabled', 'true')

  await aiButton.hover()
  await expect(page.getByTestId('wiki-ai-header-reason')).toContainText('읽기 전용')

  // 비활성이므로 클릭해도 생성이 시작되지 않는다.
  await aiButton.click({ force: true })
  await page.waitForTimeout(300)
  expect(aiCalled).toBe(0)
})

test('위키 AI 노출 — 빈 본문에 placeholder 힌트와 초안 CTA 가 뜨고, 내용이 있으면 사라진다 (#733)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // placeholder — 빈 본문에서 '/' 진입점을 알리는 유일한 상시 힌트.
  await expect(page.locator('.ProseMirror p').first()).toHaveAttribute(
    'data-placeholder',
    /'\/' 를 눌러 AI 사용/,
  )
  const cta = page.getByTestId('wiki-ai-empty-cta')
  await expect(cta).toBeVisible()

  // CTA → 초안 다이얼로그.
  await page.getByTestId('wiki-ai-empty-draft').click()
  await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible()
  await page.keyboard.press('Escape')

  // 본문이 채워지면 CTA 는 사라진다.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('직접 작성한 내용')
  await expect(cta).toHaveCount(0)
})

test('위키 AI 노출 — VIEWER 는 빈 본문 CTA 가 노출되지 않는다 (#733)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'VIEWER')
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  await expect(page.getByTestId('wiki-ai-empty-cta')).toHaveCount(0)
})

test('위키 변형 툴바 — 좌측 상단이 아니라 선택영역 바로 위에 렌더된다 (#733 회귀)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR', LONG_BODY)
  await mockWikiAiGeneration(page, { deltas: [] })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 본문 중간의 한 문단을 선택한다(문서 시작이 아닌 위치라 위치 버그가 드러난다).
  const target = page.locator('.ProseMirror p').filter({ hasText: '팬을 중불로 달군' }).first()
  await expect(target).toBeVisible()
  await target.dblclick()
  await page.keyboard.press('ControlOrMeta+a')
  // 전체 선택은 문서 처음부터라 위치 판별이 흐려진다 — 해당 문단만 다시 선택.
  await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    el.dispatchEvent(new Event('mouseup', { bubbles: true }))
  })

  const toolbar = page.getByTestId('wiki-ai-toolbar')
  await expect(toolbar).toBeVisible()

  // 1) tippy popper 가 스크롤 컨테이너 밖(위치 어긋남 방지)이면서 #root 안(React 이벤트 위임
  //    유지 — 밖으로 나가면 onClick 이 죽는다)에 붙었는가.
  const placement = await toolbar.evaluate((el) => {
    const root = el.closest('[data-tippy-root]')
    if (!root) return { hasRoot: false, inReactRoot: false, inScroller: true }
    const scroller = document.querySelector('.ProseMirror')?.closest('.overflow-y-auto') ?? null
    return {
      hasRoot: true,
      inReactRoot: document.getElementById('root')?.contains(root) === true,
      inScroller: scroller?.contains(root) === true,
    }
  })
  expect(placement).toEqual({ hasRoot: true, inReactRoot: true, inScroller: false })

  // 2) 선택 rect 기준으로 가로 중심이 근접하고, 세로로는 선택 위쪽에 있어야 한다.
  const selRect = await page.evaluate(() => {
    const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect()
    return r ? { top: r.top, left: r.left, right: r.right } : null
  })
  expect(selRect).not.toBeNull()
  const box = (await toolbar.boundingBox())!
  const selCenterX = (selRect!.left + selRect!.right) / 2
  const barCenterX = box.x + box.width / 2
  // 좌측 상단(0,0) 버그면 아래 두 단언이 모두 깨진다.
  expect(Math.abs(barCenterX - selCenterX)).toBeLessThan(120)
  expect(box.y + box.height).toBeLessThanOrEqual(selRect!.top + 12)

  // 3) 툴바가 한 줄로 유지되는가(tippy 기본 maxWidth 350px 면 줄바꿈된다).
  expect(box.height).toBeLessThan(60)
})

test('위키 AI 노출 — 빈 상태 "AI 초안으로 시작" 이 페이지를 만들고 토픽 입력을 띄운다 (#733)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR')
  // 트리를 빈 배열로 덮어써 "표시할 페이지가 없습니다" 빈 상태를 만든다.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      if (method === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail()),
        })
      }
      return route.fallback()
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('wiki-empty-state')).toBeVisible()

  await page.getByTestId('wiki-empty-state-ai-draft').click()

  // 생성된 페이지로 이동한 뒤 초안 토픽 입력이 곧바로 열려 있어야 한다.
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}$`))
  await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible()
})

test('위키 변형 툴바 — 톤 드롭다운이 좌측 상단이 아니라 트리거 바로 아래에 열린다 (#733 회귀)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR', LONG_BODY)
  await mockWikiAiGeneration(page, { deltas: [] })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  const target = page.locator('.ProseMirror p').filter({ hasText: '팬을 중불로 달군' }).first()
  await expect(target).toBeVisible()
  await target.dblclick()
  await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    el.dispatchEvent(new Event('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('wiki-ai-toolbar')).toBeVisible()

  const trigger = page.getByTestId('wiki-ai-tb-rewrite_tone')
  const tBox = (await trigger.boundingBox())!
  await trigger.click()
  await expect(page.getByTestId('wiki-ai-tone-격식체')).toBeVisible()

  // 1) 드롭다운을 여는 동안 툴바가 hide 되면 안 된다. tippy 는 hide 시 popper 를 DOM 에서 통째로
  //    제거하므로, 툴바가 사라지면 Radix 는 앵커(트리거)를 잃고 메뉴를 0×0@(0,0) 기준으로 그린다.
  const anchorAlive = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="wiki-ai-tb-rewrite_tone"]')
    return { connected: btn?.isConnected === true, tippyRoots: document.querySelectorAll('[data-tippy-root]').length }
  })
  expect(anchorAlive).toEqual({ connected: true, tippyRoots: 1 })

  // 2) 메뉴는 트리거 바로 아래(align=start, sideOffset=4)에 위치해야 한다. 좌측 상단 버그면 (0, 4).
  const menu = page.locator('[data-slot="dropdown-menu-content"]').first()
  const mBox = (await menu.boundingBox())!
  expect(Math.abs(mBox.x - tBox.x)).toBeLessThan(24)
  expect(mBox.y).toBeGreaterThan(tBox.y)
  expect(mBox.y - (tBox.y + tBox.height)).toBeLessThan(24)

  // 3) 항목 선택이 실제로 동작하는가(툴바가 살아있어야 클릭이 닿는다).
  await page.getByTestId('wiki-ai-tone-격식체').click()
  await expect(page.getByTestId('wiki-ai-tone-격식체')).toHaveCount(0)
})

test('위키 변형 툴바 — 뷰포트 하단 선택에서도 톤 드롭다운이 화면 안에 들어온다 (#733 회귀)', async ({
  authenticatedPage: page,
}) => {
  await setupWikiMocks(page, 'EDITOR', LONG_BODY)
  await mockWikiAiGeneration(page, { deltas: [] })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 선택을 뷰포트 하단에 붙인다 — Portal 을 없애면서 Radix Content 의 컨테이닝 블록이
  // transform 이 걸린 [data-tippy-root] 로 바뀌었으므로, flip/shift 충돌 처리가 여전히
  // 뷰포트 기준으로 동작하는지 확인해야 한다(headroom 이 넉넉한 문서 중앙에선 안 걸린다).
  // 문서 끝 문단은 컨테이너 하단 패딩 때문에 뷰포트 바닥에 완전히 붙지 않는다. 중간 문단을 골라
  // 스크롤 위치를 직접 계산해 해당 문단 바닥을 뷰포트 바닥에 붙인다.
  const target = page.locator('.ProseMirror p').nth(3)
  await target.dblclick()
  // 문단 전체가 아니라 **마지막 줄의 끝 몇 글자**만 선택한다. 전체를 선택하면 tippy 의 기준 rect 가
  // 문단 전체가 되어 툴바가 문단 위로 올라가고, 아래 여백이 넉넉해져 충돌 처리가 개입하지 않는다.
  await target.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    while (walker.nextNode()) last = walker.currentNode as Text
    if (!last) throw new Error('텍스트 노드 없음')
    const range = document.createRange()
    range.setStart(last, Math.max(0, last.length - 5))
    range.setEnd(last, last.length)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    el.dispatchEvent(new Event('mouseup', { bubbles: true }))
  })
  await expect(page.getByTestId('wiki-ai-toolbar')).toBeVisible()

  // 스크롤로는 문단을 바닥까지 붙일 수 없다(문서 길이 한계). 대신 선택 바로 아래에서 뷰포트가
  // 끝나도록 높이를 줄여, 메뉴가 열릴 공간이 부족한 상태를 만든다.
  const selBottom = await page.evaluate(
    () => window.getSelection()!.getRangeAt(0).getBoundingClientRect().bottom,
  )
  await page.setViewportSize({ width: 1280, height: Math.round(selBottom) + 24 })
  await target.evaluate((el) => el.dispatchEvent(new Event('mouseup', { bubbles: true })))
  await expect(page.getByTestId('wiki-ai-toolbar')).toBeVisible()

  const vp = page.viewportSize()!
  const tBox = (await page.getByTestId('wiki-ai-tb-rewrite_tone').boundingBox())!
  // 이 테스트가 공허해지지 않도록: 트리거 아래 여백이 메뉴 높이(약 138px)보다 작아야
  // flip/shift 가 실제로 개입한다.
  expect(vp.height - (tBox.y + tBox.height)).toBeLessThan(138)

  await page.getByTestId('wiki-ai-tb-rewrite_tone').click()
  await expect(page.getByTestId('wiki-ai-tone-격식체')).toBeVisible()

  const mBox = (await page.locator('[data-slot="dropdown-menu-content"]').first().boundingBox())!
  expect(mBox.y).toBeGreaterThanOrEqual(0)
  expect(mBox.x).toBeGreaterThanOrEqual(0)
  expect(mBox.y + mBox.height).toBeLessThanOrEqual(vp.height)
  expect(mBox.x + mBox.width).toBeLessThanOrEqual(vp.width)
})
