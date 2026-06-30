// 메일 상세 E2E — AI 요약 카드 + 생성 중 스켈레톤.
import { createUser } from '../factories/auth.factory'
import { detail as mailDetail, mailAccount, summary as mailSummary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

/**
 * 메일 페이지 공통 모킹 + 첫 번째 메일 상세 열기.
 * aiEnabled: 계정의 AI 사용 여부.
 * aiAvailable: 사용자 수준 AI 비서 활성화 여부(기본 true — 요약 게이트 통과용).
 */
async function openFirstMail(page: import('@playwright/test').Page, aiEnabled = true, aiAvailable = true) {
  // aiAvailable: true 일 때만 /users/me 를 덮어써 요약 게이트를 통과시킨다.
  if (aiAvailable) {
    await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser({ aiAvailable: true }), roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }] })
  }
  // 계정 목록: AI 사용 상태 제어.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled })])
  // 동기화 상태.
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
  // 메시지 목록 — 1건.
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([mailSummary()]) }),
  )
  // 메시지 상세.
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', mailDetail())

  await page.goto('/mail/1')
  // 첫 메일 행 클릭.
  await page.getByTestId('mail-row-10').click()
  // 상세 패널 노출 대기.
  await expect(page.getByTestId('mail-detail')).toBeVisible()
}

// P2: 사이드바 필터 nav — needsReply / category.
test.describe('사이드바 필터', () => {
  test('사이드바 회신필요 클릭 → needsReply 필터로 목록 조회', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    // 회신필요 건수(>0 이어야 사이드바에 표시).
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 2 })

    // 메시지 목록 요청을 가로채 needsReply 파라미터 캡처.
    let lastNeedsReply: string | null = null
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => {
        lastNeedsReply = new URL(route.request().url()).searchParams.get('needsReply')
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      },
    )

    await page.goto('/mail/1')

    // 회신필요 필터 nav 항목 클릭.
    await page.getByTestId('mail-filter-needsreply').click()

    // URL 에 needsReply=true 반영.
    await expect(page).toHaveURL(/needsReply=true/)
    // 목록 API 에 needsReply 파라미터 전송.
    await expect.poll(() => lastNeedsReply).toBe('true')
  })

  test('사이드바 분류(업무) 클릭 → category 필터로 목록 조회', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })

    // 메시지 목록 요청을 가로채 category 파라미터 캡처.
    let lastCategory: string | null = null
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => {
        lastCategory = new URL(route.request().url()).searchParams.get('category')
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      },
    )

    await page.goto('/mail/1')

    // 분류 > 업무 필터 nav 항목 클릭.
    await page.getByTestId('mail-filter-category-업무').click()

    // URL 에 category=업무 반영(URL 인코딩).
    await expect(page).toHaveURL(/category=%EC%97%85%EB%AC%B4/)
    // 목록 API 에 category 파라미터 전송.
    await expect.poll(() => lastCategory).toBe('업무')
  })
})

// P2: 회신필요 처리완료 pill + 긍정 빈 상태.
test.describe('회신필요 처리완료', () => {
  test('회신필요 행 처리완료 → POST 호출 + 행 제거 + 되돌리기 토스트', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 1 })
    let listCall = 0
    await page.route((url) => url.pathname === '/api/v1/mail/accounts/1/messages', (route) => {
      listCall += 1
      // 1차 조회: 회신필요 메일 1건. invalidate 후 2차 조회: 빈 목록(처리완료로 빠짐).
      const rows = listCall === 1
        ? [mailSummary({ id: 10, subject: '검토 요청', aiCategory: '업무', aiNeedsReply: true })]
        : []
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
    let posted = false
    await page.route('**/mail/accounts/1/messages/10/needs-reply-done', (route) => {
      if (route.request().method() === 'POST') posted = true
      route.fulfill({ status: 200, body: '' })
    })
    await page.goto('/mail/1?needsReply=true')
    await page.getByTestId('mail-row-10').hover()
    await page.getByTestId('mail-resolve-10').click()
    await expect.poll(() => posted).toBe(true)
    // 토스트 제목 '처리완료' 는 행의 resolve 버튼 텍스트와 충돌(strict-mode 위반) → 토스트 고유의
    // '되돌리기' 액션 버튼으로 토스트 노출을 검증한다.
    await expect(page.getByRole('button', { name: '되돌리기' })).toBeVisible()
    await expect(page.getByTestId('mail-row-10')).toHaveCount(0)
  })

  test('회신필요 0건 → 긍정 빈 상태', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })
    await page.route((url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/mail/1?needsReply=true')
    await expect(page.getByTestId('mail-needsreply-empty')).toBeVisible()
  })
})

// P2: 분류 필터 빈 상태 — 해당 분류 메일 없을 때 중립 문구.
test.describe('분류 필터 빈 상태', () => {
  test('category 필터 0건 → mail-category-empty 표시', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { running: false })
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/needs-reply-count', { count: 0 })
    // 업무 분류 메일 0건.
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/mail/1?category=%EC%97%85%EB%AC%B4')

    // 분류 필터 중립 빈 상태 표시, 일반 빈 상태 미표시.
    await expect(page.getByTestId('mail-category-empty')).toBeVisible()
    await expect(page.getByTestId('mail-list-empty')).toHaveCount(0)
    await expect(page.getByTestId('mail-needsreply-empty')).toHaveCount(0)
  })
})

test.describe('메일 AI 요약', () => {
  test(
    'AI 요약 카드와 생성중 스켈레톤',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 요약 응답을 지연시켜 로딩 상태 노출.
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      await page.route('**/mail/messages/*/summary', async (route) => {
        await gate
        await route.fulfill({ json: { summary: '• 핵심 1\n• 핵심 2' } })
      })

      await openFirstMail(page, true)

      // 요약 응답 전 — 로딩 스켈레톤이 표시되어야 함.
      await expect(page.getByTestId('mail-ai-summary-loading')).toBeVisible()

      // 응답 해제 → 요약 텍스트로 대체.
      release()
      await expect(page.getByTestId('mail-ai-summary')).toContainText('핵심 1')
      await expect(page.getByTestId('mail-ai-summary-loading')).toHaveCount(0)
    },
  )

  test('개인 비서 OFF 계정, 객관 요약 없음 → 카드 미표시', async ({ authenticatedPage: page }) => {
    // 개인 비서 비활성 + 객관 요약도 없는 경우 — 카드가 표시되지 않아야 한다.
    await mockApi(page, 'GET', '/api/v1/mail/messages/10/summary', { summary: null })
    await openFirstMail(page, false)
    await expect(page.getByTestId('mail-ai-summary')).toHaveCount(0)
    await expect(page.getByTestId('mail-ai-summary-loading')).toHaveCount(0)
  })

  test('개인 비서 OFF 계정이어도 객관 요약이 있으면 카드 표시', async ({ authenticatedPage: page }) => {
    // 개인 비서(aiEnabled=false)지만 공통 비서가 생성한 객관 요약이 있으면 카드가 표시되어야 한다.
    await mockApi(page, 'GET', '/api/v1/mail/messages/10/summary', { summary: '• 객관 요약 텍스트' })
    await openFirstMail(page, false)
    const summaryEl = page.getByTestId('mail-ai-summary')
    await expect(summaryEl).toBeVisible()
    await expect(summaryEl).toContainText('객관 요약 텍스트')
    // 개인 비서 꺼짐이므로 생성 중 스켈레톤은 미표시
    await expect(page.getByTestId('mail-ai-summary-loading')).toHaveCount(0)
  })
})
