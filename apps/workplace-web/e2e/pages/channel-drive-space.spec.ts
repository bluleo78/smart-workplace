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
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
      }),
  )
}

test('채널 파일 버튼 → 드로워로 파일 공간 인라인 표시', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await stubChannelView(page)
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spaceId: SPACE_ID, archived: false }) }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: SPACE_ID, type: 'CHANNEL', name: '파일채널', ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' }) }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('channel-files-button').click()

  // 드로워가 열리고 DrivePage 가 그 안에 렌더된다. 페이지는 여전히 채널 URL.
  await expect(page.getByTestId('drive-space-drawer')).toBeVisible()
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/chat/channels/${CHANNEL_ID}`))
  // 대화 컨텍스트(채널 헤더)가 사라지지 않았다.
  await expect(page.getByTestId('channel-header')).toBeVisible()

  // "전체에서 열기" → 풀페이지 드라이브로.
  await page.getByTestId('drive-drawer-open-full').click()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}`))
})

test('드로워는 ESC 로 닫힌다', async ({ authenticatedPage: page }) => {
  await stubChannelView(page)
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ spaceId: SPACE_ID, archived: false }) }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: SPACE_ID, type: 'CHANNEL', name: '파일채널', ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' }) }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('channel-files-button').click()
  await expect(page.getByTestId('drive-space-drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('drive-space-drawer')).toHaveCount(0)
})

test(
  '드로워 폴더 진입 시 상위 URL 에 folderId 가 노출되지 않는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // 루트 items — 폴더 1개(하위탐색 대상).
    const FOLDER_ID = 100

    await stubChannelView(page)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ spaceId: SPACE_ID, archived: false }),
        }),
    )
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
    // items 스텁: 루트 → 폴더 1개, 하위(parentId=FOLDER_ID) → 빈 목록.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) => {
        const parentId = new URL(route.request().url()).searchParams.get('parentId')
        const body =
          parentId === String(FOLDER_ID)
            ? { folders: [], files: [] }
            : { folders: [{ id: FOLDER_ID, parentId: null, name: '테스트폴더', createdAt: '2026-06-01T00:00:00Z' }], files: [] }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      },
    )
    // 폴더 진입 시 breadcrumb 경로 로드 — FOLDER_ID 폴더명 반환.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/folders/${FOLDER_ID}/path`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ id: FOLDER_ID, name: '테스트폴더' }]),
        }),
    )

    // 1. 채널 페이지 진입 → "파일" 클릭 → 드로워 열림.
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await page.getByTestId('channel-files-button').click()
    await expect(page.getByTestId('drive-space-drawer')).toBeVisible()
    await expect(page.getByTestId('drive-page')).toBeVisible()

    // 2. 드로워 안 폴더 행 클릭(상위 채널 URL 유지).
    const drawer = page.getByTestId('drive-space-drawer')
    await drawer.getByRole('button', { name: '테스트폴더' }).click()

    // 3. 핵심 단언: 상위 URL 에 folderId 가 없음 — 드로워는 state 모드 폴더 탐색.
    await expect(page).toHaveURL(new RegExp(`/chat/channels/${CHANNEL_ID}`))
    expect(new URL(page.url()).searchParams.get('folderId')).toBeNull()

    // 4. 폴더 진입이 실제로 일어났는지 보강 — 빈 폴더 empty-state 표시.
    await expect(drawer.getByTestId('drive-empty-folder')).toBeVisible()
  },
)

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

test('드로워(embedded) 에서도 통합 검색이 동작하지만 AI Overview는 숨긴다', async ({
  authenticatedPage: page,
}) => {
  await stubChannelView(page)
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/drive-space`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ spaceId: SPACE_ID, archived: false }),
      }),
  )
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
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )
  // 파일명 검색 — 빈 결과.
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) }),
  )
  // 콘텐츠 검색 — 결과 1건.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/search',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hits: [
            {
              driveFileId: 1,
              fileId: 10,
              spaceId: SPACE_ID,
              spaceName: '파일채널',
              name: '회의록.txt',
              mimeType: 'text/plain',
              snippet: '오늘 <b>회의</b> 내용',
              score: 0.5,
            },
          ],
          semantic: true,
        }),
      }),
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('channel-files-button').click()
  await expect(page.getByTestId('drive-space-drawer')).toBeVisible()

  const drawer = page.getByTestId('drive-space-drawer')
  await drawer.getByLabel('파일명 및 콘텐츠 검색').fill('회의')

  // 콘텐츠 일치 결과는 embedded 에서도 보인다.
  await expect(drawer.getByTestId('drive-content-hit')).toBeVisible()
  await expect(drawer.getByText('회의록.txt')).toBeVisible()

  // AI Overview 버튼은 embedded 에서 숨겨진다(공간 협소).
  await expect(drawer.getByTestId('drive-overview-btn')).toHaveCount(0)
})
