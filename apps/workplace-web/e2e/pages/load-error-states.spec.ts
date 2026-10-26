// 목록 불러오기 실패를 빈 상태와 구분한다(WP-865) — 드라이브·대화·노트·캘린더·홈 「지금 신경 쓸 일」.
// 예전엔 목록 API 가 500 이어도 「대화를 시작해 보세요」·「다 확인했습니다」 같은 빈 상태나 빈 본문·「준비 중…」으로 보여,
// 데이터가 없는 것처럼 오해하게 했다. 실패는 「…을(를) 불러오지 못했습니다」 + 다시 시도로 보이고, 다시 시도가 실제로 다시 부른다.
// 여기엔 실제 키보드 초점이 다시 시도 동안 버튼에 남는지(@input)만 남긴다. 화면별 실패 안내·다시 시도 재조회·빈 상태 구분은
// 페이지 테스트 src/pages/loadErrorRealtime.test.tsx 가 지킨다(WP-971, WP-982).
import type { Page } from '@playwright/test'

import { createChannel } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

/**
 * GET path 를 실패(500)로 가로채고, 돌려받은 함수를 부르면 그 뒤로는 body 로 성공한다.
 * 픽스처의 기본 모킹보다 나중에 등록해 이쪽이 이긴다. 부른 횟수도 센다(다시 시도가 실제 요청을 보내는지).
 */
async function failingThenOk(page: Page, path: string, body: unknown) {
  let failing = true
  const state = { calls: 0, recover: () => void (failing = false) }
  await page.route(
    (url) => url.pathname === path,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      state.calls += 1
      return failing
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '서버 오류' }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  return state
}

test.describe('목록 불러오기 실패 상태 (WP-865)', () => {
  // WP-881: 다시 부르는 동안 버튼이 disabled 로 꺼져 키보드 초점이 body 로 사라졌다.
  test('대화 — 키보드로 다시 시도하면 다시 부르는 동안·다시 실패해도 초점이 버튼에 남고, 성공하면 불러온 목록으로 옮긴다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const channels = await failingThenOk(page, '/api/v1/messaging/channels', [createChannel({ id: 3, name: '공지' })])
    // 다시 시도 응답만 늦춰 「다시 부르는 중」 상태를 확인할 수 있게 한다.
    let slow = false
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      async (route) => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 1500))
        return route.fallback()
      },
    )

    await page.goto('/chat')
    const retry = page.getByTestId('channel-list-error-retry')
    await expect(retry).toBeVisible()

    slow = true
    await retry.focus()
    await page.keyboard.press('Enter')
    // 다시 부르는 중 — 누름은 막혀도(aria-disabled) 초점은 그대로다.
    await expect(retry).toHaveAttribute('aria-disabled', 'true')
    await expect(retry).toBeFocused()
    // 다시 실패 — 같은 버튼에 남는다.
    await expect(retry).not.toHaveAttribute('aria-disabled')
    await expect(retry).toBeFocused()

    channels.recover()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('channel-link-3')).toContainText('공지')
    await expect(page.getByTestId('channel-list-error')).toHaveCount(0)
    // 안내가 있던 자리 뒤 — 불러온 채널 목록의 첫 링크로 초점이 옮겨 간다(body 로 사라지지 않음).
    await expect(page.getByTestId('channel-link-3')).toBeFocused()
  })
})
