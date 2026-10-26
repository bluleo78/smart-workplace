// 메일 AI 비서 E2E — 긴 AI 답장 초안에서 에디터 높이가 묶여 스크롤되는지(@layout)만 남긴다. 백엔드 없이 page.route 모킹.
// 목록 배지·요약(자동·생략·없음·옮긴 뒤 격리·실패)·답장 초안(프리필·이스케이프·로딩·✕ 저장)·aiAvailable 게이트는
// src/pages/mail/mailAi.test.tsx, 코칭 요청의 인용문 제외·교체 뒤 인용문 유지는 src/pages/mail/mailCompose.test.tsx(vitest, WP-984)가 지킨다.
import { createUser } from '../../factories/auth.factory'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('메일 AI 비서', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // aiAvailable: true — AI 비서가 활성화된 사용자 모킹(기본값 false 를 덮어씀).
    await mockApi(page, 'GET', '/api/v1/users/me', { ...createUser({ aiAvailable: true }), roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }] })
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount({ aiEnabled: true })])
  })

  // 본문이 길면 작성창이 무한정 늘어나지 않고 에디터 영역이 스크롤돼야 한다(도크 높이 고정).
  test('긴 본문 — 에디터가 늘어나지 않고 스크롤', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
