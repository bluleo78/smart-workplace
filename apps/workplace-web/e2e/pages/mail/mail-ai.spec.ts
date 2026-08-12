// 메일 AI 비서 E2E — 배지/요약/답장 초안. 백엔드 없이 page.route 모킹.
import type { Page } from '@playwright/test'

import { createUser } from '../../factories/auth.factory'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

/** 목록 1건(id 7, alice 발신) + 상세 모킹 — 인용문(#765) 테스트 공용. */
async function mockInboxMessage(page: Page, overrides: Parameters<typeof detail>[0] = {}) {
  await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
  await mockApi(page, 'GET', '/api/v1/mail/messages/7',
    detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문', ...overrides }))
}

test.describe('메일 AI 비서', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // aiAvailable: true — AI 비서가 활성화된 사용자 모킹(기본값 false 를 덮어씀).
    await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser({ aiAvailable: true }), roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }] })
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  })

  test('목록 배지 — 카테고리 칩 + 답장필요 점', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, aiCategory: '업무', aiNeedsReply: true })]) }),
    )
    await page.goto('/mail/1')
    // AiSignalBadge 는 sr-only "AI " 접두(스크린리더용)를 포함하므로 가시 텍스트는 toContainText 로 검증.
    await expect(page.getByTestId('mail-badge-category-7')).toContainText('업무')
    await expect(page.getByTestId('mail-badge-needsreply-7')).toBeVisible()
  })

  test('목록 배지 클릭 — 행 버튼 중첩 없이 카테고리 필터만 동작 (#577)', async ({ authenticatedPage: page }) => {
    // <button> 안에 <button> 이 중첩되면(#577) React 가 콘솔에 DOM 유효성 경고를 낸다 —
    // 다이얼로그 열기 전에 리스너를 걸어 회귀 여부를 직접 검증한다.
    const nestedButtonWarnings: string[] = []
    page.on('console', (msg) => {
      if (/cannot (be|contain) a( nested)? <?button/i.test(msg.text())) {
        nestedButtonWarnings.push(msg.text())
      }
    })
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, aiCategory: '업무', aiNeedsReply: true })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7 }))
    await page.goto('/mail/1')

    const row = page.getByTestId('mail-row-7')
    await expect(row).toBeVisible()
    // 행 wrapper 는 <button> 이 아니라 role="button" div — 내부 카테고리 배지가 독립된 <button>.
    await expect(row.evaluate((el) => el.tagName)).resolves.toBe('DIV')
    await expect(page.getByTestId('mail-badge-category-7').evaluate((el) => el.tagName)).resolves.toBe('BUTTON')

    // 배지 클릭 → 카테고리 필터 쿼리스트링만 반영되고 행 선택(상세 패널 오픈)은 발생하지 않아야 한다
    // (stopPropagation 유지 검증 — 중첩 제거가 클릭 분리 동작을 깨지 않았는지).
    await page.getByTestId('mail-badge-category-7').click()
    await expect(page).toHaveURL(/category=/)
    await expect(page.getByTestId('mail-detail-empty')).toBeVisible()

    // 행 자체는 여전히 클릭으로 선택 가능해야 한다.
    await row.click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()

    expect(nestedButtonWarnings, nestedButtonWarnings.join('\n')).toHaveLength(0)
  })

  test('요약 스트립 — 열람 시 자동 로드', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7 })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, bodyText: '본문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 자동요약' })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await expect(page.getByTestId('mail-ai-summary')).toContainText('자동요약')
  })

  test('메일 AI 요약은 AI 라벨이 붙은 아우라로 표시된다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7 })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, bodyText: '본문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• AI 아우라 요약 텍스트' })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    const summaryEl = page.getByTestId('mail-ai-summary')
    await expect(summaryEl).toBeVisible()
    await expect(summaryEl).toContainText('AI 요약')
    await expect(summaryEl).toContainText('AI 아우라 요약 텍스트')
  })

  test('AI 답장 초안 → 작성 도크 본문 프리필', async ({ authenticatedPage: page }) => {
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })
    await page.route((u) => u.pathname === '/api/v1/mail/messages/7/reply-draft',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draftBody: 'AI가 작성한 답장' }) }))
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-ai-reply-draft').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-composer-body')).toContainText('AI가 작성한 답장')
  })

  // 인용문 분리(#765) 회귀 — AI 검토 요청에 남의 원문이 실려 AI 가 착각하지 않는지 검증.
  test('AI 검토 요청에 인용문이 실리지 않는다', async ({ authenticatedPage: page }) => {
    await mockInboxMessage(page)

    let coachReq: { bodyHtml: string; bodyText: string } | null = null
    // 코칭은 계정 경로가 아니라 /api/v1/mail/draft-coaching 이다(mailMessages.ts:120).
    await page.route(
      (u) => u.pathname === '/api/v1/mail/draft-coaching',
      async (route) => {
        coachReq = route.request().postDataJSON()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ notes: [], improvedBodyHtml: '<p>다듬은 본문</p>' }),
        })
      },
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('확인했습니다.')
    await page.getByText('AI 검토', { exact: true }).click()

    await expect.poll(() => coachReq).not.toBeNull()
    // AI 가 남의 메일을 내 초안으로 착각하던 문제(#765)
    expect(coachReq!.bodyHtml).not.toContain('<blockquote>')
    expect(coachReq!.bodyHtml).not.toContain('님이 작성')
    expect(coachReq!.bodyHtml).toContain('확인했습니다')
    // 백엔드는 코칭에서 bodyText 만 읽으므로(mailAgent) 이 필드에 인용문이 없는지가 실제 관문이다.
    expect(coachReq!.bodyText).not.toContain('님이 작성')
    expect(coachReq!.bodyText).not.toContain('원문')
    expect(coachReq!.bodyText).toContain('확인했습니다')
  })

  test('개선본으로 교체해도 인용문이 남는다', async ({ authenticatedPage: page }) => {
    await mockInboxMessage(page)
    await page.route(
      (u) => u.pathname === '/api/v1/mail/draft-coaching',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ notes: [], improvedBodyHtml: '<p>다듬은 본문</p>' }),
        }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-reply').click()
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('확인했습니다.')
    await page.getByText('AI 검토', { exact: true }).click()
    await page.getByText('개선본으로 교체', { exact: true }).click()

    await expect(page.getByTestId('mail-composer-body')).toContainText('다듬은 본문')
    await expect(page.getByTestId('mail-compose-quote')).toBeVisible()
  })

  test('AI 답장 초안의 HTML 특수문자가 이스케이프된다', async ({ authenticatedPage: page }) => {
    await mockInboxMessage(page)
    await page.route(
      (u) => u.pathname === '/api/v1/mail/messages/7/reply-draft',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ draftBody: '조건은 a < b & c 입니다' }),
        }),
    )

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-ai-reply-draft').click()
    // escape 없이 삽입되면 '<' 이후가 태그로 먹혀 텍스트가 사라진다.
    await expect(page.getByTestId('mail-composer-body')).toContainText('a < b & c')
  })

  // 초안 생성은 LLM 호출이라 수 초 걸린다 — 그동안 버튼이 로딩(비활성+스피너 라벨)을 보여야 한다(클릭 후 무반응 방지).
  test('AI 답장 초안 — 생성 중 로딩 상태 표시', async ({ authenticatedPage: page }) => {
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })

    // reply-draft 응답을 게이트로 잡아둬 인-플라이트 상태를 결정적으로 검증.
    let release: () => void = () => {}
    const gate = new Promise<void>((res) => { release = res })
    await page.route((u) => u.pathname === '/api/v1/mail/messages/7/reply-draft', async (route) => {
      await gate
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draftBody: 'AI가 작성한 답장' }) })
    })

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    const btn = page.getByTestId('mail-ai-reply-draft')
    await btn.click()

    // 응답 전: 로딩 라벨 + 비활성.
    await expect(btn).toContainText('초안 작성 중')
    await expect(btn).toBeDisabled()

    // 응답 후: 도크 오픈 + 본문 프리필, 버튼 원복.
    release()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    await expect(page.getByTestId('mail-composer-body')).toContainText('AI가 작성한 답장')
  })

  // aiAvailable false 일 때 — 요약 카드·답장 버튼 미렌더 + 요약 API 요청 0건.
  test('aiAvailable false — 요약 카드·답장 버튼 숨김, 요약 API 미호출', async ({ authenticatedPage: page }) => {
    // aiAvailable: false 로 덮어씀 — beforeEach 의 true 모킹보다 나중에 등록되어 우선 적용.
    await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser({ aiAvailable: false }), roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }] })
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7 })]) }),
    )
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, bodyText: '본문' }))

    // 요약 API 요청이 들어오면 테스트 실패 — aiAvailable false 일 때 fetch 자체를 안 해야 한다.
    let summaryRequested = false
    await page.route((u) => /\/mail\/messages\/\d+\/summary/.test(u.pathname), (route) => {
      summaryRequested = true
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summary: '요약' }) })
    })

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-detail').waitFor()

    expect(summaryRequested).toBe(false)
    await expect(page.getByTestId('mail-ai-summary')).not.toBeVisible()
    await expect(page.getByTestId('mail-ai-reply-draft')).not.toBeVisible()
  })

  // 본문이 길면 작성창이 무한정 늘어나지 않고 에디터 영역이 스크롤돼야 한다(도크 높이 고정).
  test('긴 본문 — 에디터가 늘어나지 않고 스크롤', async ({ authenticatedPage: page }) => {
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, fromAddress: 'alice@example.com' })]) }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7', detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문' }))
    await mockApi(page, 'GET', '/api/v1/mail/messages/7/summary', { summary: '• 요약' })
    // 50줄짜리 긴 초안 → 에디터 콘텐츠가 max-height 를 넘김.
    const longBody = Array.from({ length: 50 }, (_, i) => `${i + 1}번째 줄입니다.`).join('\n')
    await page.route((u) => u.pathname === '/api/v1/mail/messages/7/reply-draft',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draftBody: longBody }) }))

    await page.goto('/mail/1')
    await page.getByTestId('mail-row-7').click()
    await page.getByTestId('mail-ai-reply-draft').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()

    // 에디터는 max-height 로 묶여 clientHeight < scrollHeight(스크롤 발생)이고, 뷰포트의 절반을 넘지 않는다.
    const body = page.getByTestId('mail-composer-body')
    const metrics = await body.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      vh: window.innerHeight,
    }))
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.vh * 0.5)
  })
})
