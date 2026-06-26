import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

// opener.postMessage 스파이 설치(팝업 컨텍스트 모사) — 콜백 페이지는 실제로 항상 팝업이므로
// opener 가 존재한다. opener 가 없으면 페이지가 /settings/mail 로 navigate 하여 에러 UI 가
// 사라지는 별개 경로를 타므로, 모든 케이스에서 팝업 컨텍스트를 모사해 에러/성공 UI 를 안정적으로 검증한다.
async function installOpenerSpy(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __posted: unknown[] }).__posted = []
    Object.defineProperty(window, 'opener', {
      configurable: true,
      value: {
        postMessage: (msg: unknown) =>
          (window as unknown as { __posted: unknown[] }).__posted.push(msg),
      },
    })
  })
}

// 팝업 콜백 페이지: code/state → POST /complete 중계 → 결과 통지 + 성공/실패 UI.
// opener.postMessage 를 스파이로 가로채 통지 페이로드를 검증한다.
test.describe('M365 OAuth 콜백 페이지', () => {
  test('성공: code/state 를 POST /complete 로 보내고 성공 UI + opener 통지', async ({ page }) => {
    await installOpenerSpy(page)

    let postedBody: unknown = null
    await page.route('**/api/v1/mail/oauth/m365/complete', async (route) => {
      postedBody = route.request().postDataJSON()
      await route.fulfill({ status: 200, json: { connected: true } })
    })

    await page.goto('/oauth/m365/callback?code=AUTHCODE&state=STATE123')

    await expect(page.getByText('연결되었습니다.', { exact: false })).toBeVisible()
    expect(postedBody).toEqual({ code: 'AUTHCODE', state: 'STATE123' })
    const posted = await page.evaluate(
      () => (window as unknown as { __posted: unknown[] }).__posted,
    )
    expect(posted).toContainEqual({ source: 'm365-oauth', ok: true })
  })

  test('동의 거부(error 파라미터): 백엔드 호출 없이 실패 UI', async ({ page }) => {
    await installOpenerSpy(page)

    let called = false
    await page.route('**/api/v1/mail/oauth/m365/complete', async (route) => {
      called = true
      await route.fulfill({ status: 200, json: { connected: true } })
    })

    await page.goto('/oauth/m365/callback?error=access_denied')

    await expect(page.getByText('연결에 실패했습니다')).toBeVisible()
    expect(called).toBe(false)
    // opener 에 실패 통지(error 파라미터 그대로 전달)
    const posted = await page.evaluate(
      () => (window as unknown as { __posted: unknown[] }).__posted,
    )
    expect(posted).toContainEqual({ source: 'm365-oauth', ok: false, error: 'access_denied' })
  })

  test('백엔드 400: 실패 UI 표시', async ({ page }) => {
    await installOpenerSpy(page)

    await page.route('**/api/v1/mail/oauth/m365/complete', async (route) => {
      await route.fulfill({ status: 400, json: { connected: false, error: 'invalid_request' } })
    })

    await page.goto('/oauth/m365/callback?code=AUTHCODE&state=BAD')

    await expect(page.getByText('연결에 실패했습니다')).toBeVisible()
    // 교환 실패 → opener 에 connect_failed 통지
    const posted = await page.evaluate(
      () => (window as unknown as { __posted: unknown[] }).__posted,
    )
    expect(posted).toContainEqual({ source: 'm365-oauth', ok: false, error: 'connect_failed' })
  })
})
