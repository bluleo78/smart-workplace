// 모바일 셸 E2E 공용 — 채팅 목록·SSE 최소 스텁과 가로 넘침 단언.
// 인증은 auth.fixture 의 authenticatedPage(aiAvailable:true)를 그대로 쓴다.
import { expect, type Page } from '@playwright/test'

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

/** 지금 history 항목의 router state(usr) 직렬화 — state 모드 히스토리 표식(예: issueCreate) 존재 단언용. */
export function historyMarks(page: Page) {
  return page.evaluate(() => JSON.stringify(history.state?.usr ?? null))
}
