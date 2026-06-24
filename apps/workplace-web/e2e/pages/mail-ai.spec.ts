// 메일 AI 비서 E2E — 배지/요약/답장 초안. 백엔드 없이 page.route 모킹.
import { detail, mailAccount, summary } from '../factories/mail.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

test.describe('메일 AI 비서', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  })

  test('목록 배지 — 카테고리 칩 + 답장필요 점', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([summary({ id: 7, aiCategory: '업무', aiNeedsReply: true })]) }),
    )
    await page.goto('/mail/1')
    await expect(page.getByTestId('mail-badge-category-7')).toHaveText('업무')
    await expect(page.getByTestId('mail-badge-needsreply-7')).toBeVisible()
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
