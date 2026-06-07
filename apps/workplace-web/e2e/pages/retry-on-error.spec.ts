// #134 에러 상태 재시도 버튼 E2E —
// 대표 2개(연락처 목록, 채널 상세)에서 API 500 주입 후
// 에러 메시지 + "다시 시도" 버튼이 표시되고, 버튼 클릭 시 재시도가 정상 수행되는지 검증.
import type { Page } from '@playwright/test'

import { page as makePage } from '../factories/contacts.factory'
import { createChannel } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// 연락처 목록 API 를 초기(retry 포함) 2회 500 → 이후 정상으로 전환하는 헬퍼.
// QueryClient 기본 retry=1 → initial+retry 2회 실패 후 isError=true.
// 3번째 호출(사용자의 "다시 시도" 클릭)부터 200 반환.
async function stubContactsListErrorThenOk(page: Page) {
  let callCount = 0
  await page.route(
    (url) => url.pathname === '/api/v1/contacts',
    (route) => {
      callCount++
      if (callCount <= 2) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makePage([])),
      })
    },
  )
}

// 채널 상세 API 를 초기(retry 포함) 2회 500 → 이후 정상으로 전환하는 헬퍼.
// useChannelDetail 은 retry:false 설정 → 1회 실패 시 즉시 isError=true.
async function stubChannelDetailErrorThenOk(page: Page, channelId: number) {
  let callCount = 0
  const channel = createChannel({ id: channelId, name: '테스트채널' })

  // 채널 상세(단건) — retry:false 이므로 1회 실패 후 즉시 에러 상태. 2번째(재시도)부터 200.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}`,
    (route) => {
      callCount++
      if (callCount === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channel),
      })
    },
  )

  // 채널 목록 — 정상 응답(사이드바용).
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([channel]),
      }),
  )

  // 채널 메시지 — 빈 목록(오류 분기가 아닌 정상 분기).
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/messages`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
      }),
  )

  // SSE 스트림 — 빈 keepalive
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: ':\n\n',
      }),
  )
}

// 연락처 목록 — 500 에러 시 에러 메시지 + 재시도 버튼 표시, 버튼 클릭 시 재조회 성공.
test(
  '연락처 목록 에러 — 재시도 버튼 표시 + 클릭 시 재조회',
  async ({ authenticatedPage: page }) => {
    await stubContactsListErrorThenOk(page)

    await page.goto('/contacts')

    // 에러 메시지가 보여야 함 — retry=1 이므로 initial+1회 재시도(~1s backoff) 후 isError=true.
    await expect(page.getByText('목록을 불러오지 못했습니다')).toBeVisible({ timeout: 10_000 })

    // "다시 시도" 버튼이 보여야 함
    const retryBtn = page.getByRole('button', { name: '다시 시도' }).first()
    await expect(retryBtn).toBeVisible()

    // 버튼 클릭 시 재조회 → 에러 메시지 사라짐(정상 목록 또는 빈 목록으로 전환)
    await retryBtn.click()
    await expect(page.getByText('목록을 불러오지 못했습니다')).not.toBeVisible()
  },
)

// 채널 상세 — 500 에러 시 에러 메시지 + 재시도 버튼 표시, 버튼 클릭 시 채널 진입 성공.
test(
  '채널 상세 에러 — 재시도 버튼 표시 + 클릭 시 채널 진입',
  async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 1
    await stubChannelDetailErrorThenOk(page, CHANNEL_ID)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // 채널 에러 상태 — data-testid="channel-not-found" 컨테이너
    await expect(page.getByTestId('channel-not-found')).toBeVisible()
    await expect(page.getByText('채널을 찾을 수 없습니다.')).toBeVisible()

    // "다시 시도" 버튼이 보여야 함
    const retryBtn = page.getByRole('button', { name: '다시 시도' })
    await expect(retryBtn).toBeVisible()

    // 버튼 클릭 시 재조회 → 에러 상태 사라짐
    await retryBtn.click()
    await expect(page.getByTestId('channel-not-found')).not.toBeVisible()
  },
)
