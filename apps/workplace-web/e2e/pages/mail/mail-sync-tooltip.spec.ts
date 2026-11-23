// 메일 동기화 아이콘 단추 툴팁(WP-1864) — 저장소 규칙(.work-loop/project.md 2절 「웹 테스트를 어디에 쓰나」)에
// 따라 실제 브라우저 입력·호버(@input 태그)는 E2E 로 본다. jsdom 은 가시성(getClientRects)·포인터 이벤트 경로를
// 실제 브라우저와 다르게 재므로, 키보드 Tab 초점 이동과 busy(응답 붙잡힘) 중 disabled 단추 호버가 실제로
// 「지금 새로고침」 툴팁을 띄우는지를 Chromium 에서 고정한다. (단순 hover 단언 하나는 vitest 와 중복이라
// 거기서만 본다.)
//
// busy 중 호버는 실제 브라우저에서도 뜬다 — 컨트롤러 실측: 트리거가 단추가 아니라 바깥 span 이라 disabled
// 단추를 지나는 pointerover·pointerenter·pointermove·mouseenter 도 span 에서 잡히고 눌림(click)만 막힌다.
// busy 케이스가 이 사실을 고정한다.
import type { Page } from '@playwright/test'

import type { MailUnreadCounts } from '../../../src/types/mailMessage'
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const COUNTS: MailUnreadCounts = {
  classificationActive: false,
  inbox: 0,
  byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
}

/**
 * 받은편지함(/mail/1, 메일 0건)을 목으로 깔고 계정 동기화 POST 를 붙잡는 함수를 돌려준다.
 * 빈 목이라 빈 상태와 동기화 줄이 함께 보인다. release() 를 부르면 붙잡힌 응답이 풀려 busy 가 끝난다.
 */
async function stubInbox(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', COUNTS)
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/sync-status', { phase: 'IDLE', total: 0, done: 0, running: false })

  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let posted = 0
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/sync',
    async (r) => {
      if (r.request().method() !== 'POST') return r.fallback()
      posted += 1
      await gate
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fetched: 0, saved: 0 }) })
    },
  )
  return { release: () => release(), posted: () => posted }
}

test.describe('메일 동기화 단추 툴팁(WP-1864)', () => {
  test('키보드 Tab 으로 초점을 옮기면 「지금 새로고침」 툴팁이 뜬다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubInbox(page)
    await page.goto('/mail/1')
    const button = page.getByTestId('mail-sync')
    await expect(button).toBeVisible()
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // 고정 지점(필터 줄 키워드 칸)에 초점을 먼저 놓고 Tab 한 번으로 단추에 닿는지 본다 — 60회 루프 대신
    // toBeFocused 로 확인한다. 단추에 JS focus() 를 직접 걸어 닿는 것은 금지다 — Tab 이 실제 순서로 닿는지가 대상이라서.
    await page.getByTestId('mail-search').focus()
    await page.keyboard.press('Tab')
    await expect(button).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('지금 새로고침')
  })

  test('동기화 중(busy)에 단추가 disabled 여도 호버하면 툴팁이 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const gate = await stubInbox(page)
    await page.goto('/mail/1')
    const button = page.getByTestId('mail-sync')
    await expect(button).toBeVisible()

    // 누르는 동안 응답을 붙잡아 busy 를 만든다 — POST 가 간 뒤(게이트 앞) 단추는 꺼진다.
    await button.click()
    await expect.poll(() => gate.posted()).toBe(1)
    await expect(button).toBeDisabled()

    // 누르느라 단추 위에 있던 포인터를 먼저 빼, 그 전에 열렸던 툴팁이 남아 있는 게 아닌지 가린다.
    await page.mouse.move(0, 0)
    await expect(page.getByRole('tooltip')).toHaveCount(0)

    // 꺼진 단추에는 disabled:pointer-events-none 이라 Playwright 의 hover(히트 대상 확인)가 막힌다 — 단추 한가운데로
    // 포인터를 옮겨 사용자가 그 자리에 마우스를 올린 것과 같은 이벤트가 span(트리거)에 닿고 툴팁이 뜨는지 본다.
    const box = await button.boundingBox()
    if (box == null) throw new Error('동기화 단추 자리(박스)를 찾지 못했습니다')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByRole('tooltip')).toHaveText('지금 새로고침')

    gate.release()
    await expect(button).toBeEnabled()
  })
})
