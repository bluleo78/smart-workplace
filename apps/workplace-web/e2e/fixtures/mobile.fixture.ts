// 모바일 셸 E2E 공용 — 채팅 목록·SSE 최소 스텁과 가로 넘침 단언.
// 인증은 auth.fixture 의 authenticatedPage(aiAvailable:true)를 그대로 쓴다.
import { expect, type Locator, type Page } from '@playwright/test'

import { createChannel, createDm } from '../factories/messaging.factory'
import type { ChannelResponse, DmResponse } from '../../src/types/messaging'

export { expect, test } from './auth.fixture'

/** 채널·DM 목록과 채널 상세를 모킹한다. 채널·DM 배열을 주입할 수 있다(WP-135). 반환값은 첫 채널. */
export async function stubChat(
  page: Page,
  opts: { unread?: number; channels?: ChannelResponse[]; dms?: DmResponse[] } = {},
) {
  const channel = createChannel({ id: 1, name: '모바일-개편', unreadCount: opts.unread ?? 0 })
  const channels = opts.channels ?? [channel]
  const dms = opts.dms ?? [createDm({ id: 2, unreadCount: 0 })]
  await page.route((u) => u.pathname === '/api/v1/messaging/channels', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: channels }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: channels[0] }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/dms', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: dms }) : r.fallback())
  return channels[0]
}

/** 390px 뷰포트에서 문서가 가로로 넘치지 않는지. */
export async function expectNoHorizontalOverflow(page: Page) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(w).toBeLessThanOrEqual(390)
}

/**
 * 대상 요소가 실제로 맨 위에 있는지(가려지지 않았는지) — toBeVisible 은 가림을 보지 않는다.
 * Radix 모달은 body 에 pointer-events:none 을 걸어 가린 층(시트)이 히트 테스트에서 빠지므로,
 * 판정하는 순간만 body 의 pointer-events 를 되돌려 쌓임 순서 그대로 elementFromPoint 를 읽는다.
 * containerSelector — 대상 중심점의 최상단 요소가 이 선택자 안에 있어야 통과.
 */
export async function expectOnTop(page: Page, target: Locator, containerSelector: string) {
  const b = (await target.boundingBox())!
  const onTop = await page.evaluate(
    ([x, y, sel]) => {
      const prev = document.body.style.pointerEvents
      document.body.style.pointerEvents = 'auto'
      try {
        return document.elementFromPoint(x, y)?.closest(sel) != null
      } finally {
        document.body.style.pointerEvents = prev
      }
    },
    [b.x + b.width / 2, b.y + b.height / 2, containerSelector] as const,
  )
  expect(onTop).toBe(true)
}

/** 지금 history 항목의 router state(usr) 직렬화 — state 모드 히스토리 표식(예: issueCreate) 존재 단언용. */
export function historyMarks(page: Page) {
  return page.evaluate(() => JSON.stringify(history.state?.usr ?? null))
}
