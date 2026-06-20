// #76 E2E — 채널 '파일' 버튼 → ensure → 드라이브 공간 진입 + 읽기전용 배너.
// 채널 페이지 진입 시 필요한 스텁 패턴은 messaging-thread-unread.spec.ts 를 따른다.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'

const CHANNEL_ID = 880
const SPACE_ID = 8800

// 채널 페이지 마운트에 필요한 최소 스텁 — 미스텁 SSE 로 인한 frame-detached 타임아웃 방지.
async function stubChannelView(page: Page) {
  // 채널 목록 — LNB 가 마운트 시 페치한다(auth.fixture 빈 스텁 덮어씀).
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: CHANNEL_ID,
                kind: 'CHANNEL',
                name: '파일채널',
                visibility: 'PUBLIC',
                member: true,
                role: 'OWNER',
                archived: false,
                memberCount: 1,
                unreadCount: 0,
                hasUnreadThreads: false,
                createdAt: '2026-06-01T00:00:00Z',
              },
            ]),
          })
        : route.fallback(),
  )
  // 채널 상세 — ChannelPage 가 마운트 시 헤더용으로 페치한다.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: CHANNEL_ID,
              kind: 'CHANNEL',
              name: '파일채널',
              visibility: 'PUBLIC',
              member: true,
              role: 'OWNER',
              archived: false,
              memberCount: 1,
              unreadCount: 0,
              hasUnreadThreads: false,
              createdAt: '2026-06-01T00:00:00Z',
            }),
          })
        : route.fallback(),
  )
  // 멤버 목록.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { userId: 1, name: '나', kind: 'HUMAN', role: 'OWNER', joinedAt: '2026-06-01T00:00:00Z' },
            ]),
          })
        : route.fallback(),
  )
  // 메시지 목록 — 빈 목록.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
  // SSE 스트림 — 즉시 닫히는 빈 event-stream(미스텁 시 frame-detached 타임아웃 발생).
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
      }),
  )
}

test('채널 파일 버튼 → 드라이브 공간 진입', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubChannelView(page)
  // ensure 엔드포인트 → spaceId 반환.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ spaceId: SPACE_ID, archived: false }),
      }),
  )
  // 드라이브 공간 조회 — archived false.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: SPACE_ID,
          type: 'CHANNEL',
          name: '파일채널',
          ownerId: 1,
          role: 'EDITOR',
          archived: false,
          createdAt: '2026-06-01T00:00:00Z',
        }),
      }),
  )
  // 공간 아이템 빈 목록.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ folders: [], files: [] }),
      }),
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('channel-files-button').click()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}`))
  await expect(page.getByTestId('drive-readonly-banner')).toHaveCount(0)
})

test('보관 채널 공간은 읽기전용 배너', async ({ authenticatedPage: page }) => {
  // 드라이브 공간 조회 — archived true.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: SPACE_ID,
          type: 'CHANNEL',
          name: '보관채널',
          ownerId: 1,
          role: 'EDITOR',
          archived: true,
          createdAt: '2026-06-01T00:00:00Z',
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ folders: [], files: [] }),
      }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-readonly-banner')).toBeVisible()
  // 배너뿐 아니라 쓰기 액션이 실제로 비활성인지 검증(배너만으로는 disabled 회귀를 못 잡음).
  await expect(page.getByTestId('drive-new-folder')).toBeDisabled()
  await expect(page.getByTestId('drive-upload')).toBeDisabled()
})
