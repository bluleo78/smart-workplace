// 휴대폰 메일 상세 조회 실패 → 다시 시도 성공의 초점 복원(WP-1911) — jsdom 은 가시성 필터(getClientRects)를
// 못 재서 초점 이동을 못 보니 실제 브라우저로 본다. 백엔드 없이 page.route 모킹(mail-ai.spec.ts 와 같은 방식).
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('메일 조회 실패 복원', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('상세 첫 조회 실패 → 다시 시도로 성공하면 초점이 상세 팬 안으로 간다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary({ id: 10 })])
    let calls = 0
    await page.route((u) => u.pathname === '/api/v1/mail/messages/10', (route) => {
      calls += 1
      // 앱은 5xx 를 한 번 자동 재시도한다(shouldRetryQuery) — 첫 조회 실패를 재현하려면 자동 재시도까지 실패시켜야
      // 오류 안내가 보인다. 그 뒤(3번째 호출) 「다시 시도」로 성공한다.
      if (calls <= 2) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '오류' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail({ id: 10 })) })
    })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-10').click()
    const retry = page.getByTestId('mail-detail-error').getByRole('button', { name: /다시 시도/ })
    await expect(retry).toBeVisible()
    await retry.click()
    await expect(page.getByTestId('mail-detail')).toBeVisible()
    // LoadErrorState 가 안내를 떼고 requestAnimationFrame 뒤에 초점을 옮기므로, 그 사이를 poll 로 기다린다.
    // 기대 초점 대상은 상세의 첫 조작 요소(답장 단추)다 — pane 안에 있기만 하면 상단바 뒤로 단추로 떨어져도
    // 통과해 버리던 것을 막는다(WP-1911 리뷰 반려). 뒤로 단추로 가면 LoadErrorState 의 focusAfterRetry 로 골라 넘긴다.
    await expect
      .poll(() =>
        page.evaluate(() => ({
          isBody: document.activeElement === document.body,
          inPane: !!document.activeElement?.closest('[data-testid="mail-detail-pane"]'),
          testId: document.activeElement?.getAttribute('data-testid') ?? null,
        })),
      )
      .toEqual({ isBody: false, inPane: true, testId: 'mail-reply' })
  })
})
