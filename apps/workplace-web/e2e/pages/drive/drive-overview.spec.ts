// 드라이브 콘텐츠 검색 AI Overview E2E(#593 편입) — 검색 → 내용 일치 → "AI Overview" 버튼 클릭 →
// GET 시작(correlationId) → 통합 /api/v1/events 로 델타 수신 → 카드에 누적 표시(백엔드 없이 모킹).
//
// 모킹 방식: GET .../search-overview 는 즉시 { correlationId } 를 반환하고, /api/v1/events 응답은
// 그 GET 이 도착할 때까지 보류했다가(await) 해당 correlationId 로 태그된 SSE 본문을 흘린다 — /events 는
// 앱 마운트 시 1회 연결되므로, 응답을 즉시 fulfill 하면 사용자 액션보다 먼저 도착해 유실된다
// (wiki-ai.spec.ts 의 "await 로 보류 후 fulfill" 패턴과 동일).
import type { Page } from '@playwright/test'

import type { DriveContentSearchResponse } from '../../../src/api/contentSearch'
import { createSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

async function setupDriveMocks(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createSpace()]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createSpace()),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [] }),
          })
        : route.fallback(),
  )

  // 파일명 검색 — 빈 결과(내용 일치 그룹만 있으면 충분).
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [], files: [] }),
          })
        : route.fallback(),
  )

  // 콘텐츠 하이브리드 검색 — 1건 히트로 "AI Overview" 버튼이 노출되게 한다.
  const contentSearchResponse: DriveContentSearchResponse = {
    hits: [
      {
        driveFileId: 20,
        fileId: 500,
        spaceId: SPACE_ID,
        spaceName: '팀 공간',
        name: '기획서.txt',
        mimeType: 'text/plain',
        snippet: '핵심 <b>내용</b> 발췌',
        score: 1,
      },
    ],
    semantic: false,
  }
  await page.route(
    (url) => url.pathname === '/api/v1/drive/search',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(contentSearchResponse),
          })
        : route.fallback(),
  )
}

// 델타 배열 → drive.overview.* SSE 본문(correlationId 포함, delta N개 + done).
function buildOverviewSse(deltas: string[], correlationId: string): string {
  const parts = deltas.map(
    (text) => `event: drive.overview.delta\ndata: ${JSON.stringify({ correlationId, text })}\n\n`,
  )
  parts.push(`event: drive.overview.done\ndata: ${JSON.stringify({ correlationId })}\n\n`)
  return parts.join('')
}

// GET 시작(JSON correlationId) + /events(SSE, 그 correlationId 로 델타) 를 함께 설정한다.
//
// correlationId 를 매 GET 호출마다 새로 발급하지 않고 고정값을 반환한다 — React 19 StrictMode(dev)가
// 이 카드의 useEffect 를 mount→cleanup→mount 로 두 번 실행해 GET 이 두 번 나가므로(첫 인스턴스는 즉시
// abort 되어 취소), 고정 id 여야 실제로 살아남는 두 번째 인스턴스도 동일 id 로 구독해 SSE 본문과
// correlationId 가 어긋나지 않는다(운영에선 마운트가 1회뿐이라 이 이슈 자체가 없다).
async function mockOverviewGeneration(
  page: Page,
  opts: {
    deltas: string[]
    onStart?: (query: string, spaceId?: string) => void
    onCancel?: (correlationId: string) => void
  },
) {
  const correlationId = 'corr-fixed'
  let resolveStarted: () => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })

  // 주의: 문자열 glob '*' 는 '/' 를 넘지 못한다 — DELETE .../search-overview/{id} 는 '*' 로 매칭되지
  // 않고 네트워크로 새어나간다. pathname prefix 술어로 GET/DELETE 양쪽을 함께 매칭한다.
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/drive/search-overview'),
    (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        const url = new URL(req.url())
        opts.onStart?.(url.searchParams.get('q') ?? '', url.searchParams.get('spaceId') ?? undefined)
        resolveStarted()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ correlationId }),
        })
      }
      if (req.method() === 'DELETE') {
        const id = req.url().split('/').pop() ?? ''
        opts.onCancel?.(id)
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return route.fallback()
    },
  )

  await page.route('**/api/v1/events', async (route) => {
    await started
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: buildOverviewSse(opts.deltas, correlationId),
    })
  })
}

test(
  '드라이브 AI Overview — 검색 → 버튼 클릭 → /events 델타가 카드에 누적 표시된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await setupDriveMocks(page)

    let startedQuery: string | null = null
    await mockOverviewGeneration(page, {
      deltas: ['핵심 요약: ', '문서 내용입니다.'],
      onStart: (q) => {
        startedQuery = q
      },
    })

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    await page.getByLabel('파일명 및 콘텐츠 검색').fill('기획서')
    await expect(page.getByTestId('drive-content-results')).toBeVisible()

    await page.getByTestId('drive-overview-btn').click()
    await expect.poll(() => startedQuery).toBe('기획서')

    await expect(page.getByTestId('drive-overview-card')).toContainText('핵심 요약: 문서 내용입니다.')
  },
)

test('드라이브 AI Overview — 카드 unmount 시 진행 중인 생성을 취소(DELETE)한다', async ({
  authenticatedPage: page,
}) => {
  await setupDriveMocks(page)

  let cancelledCorrelationId: string | null = null
  let resolveStarted: (correlationId: string) => void
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve
  })

  // 주의: 문자열 glob '*' 는 '/' 를 넘지 못한다 — DELETE .../search-overview/{id} 는 '*' 로 매칭되지
  // 않고 네트워크로 새어나간다. pathname prefix 술어로 GET/DELETE 양쪽을 함께 매칭한다.
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/drive/search-overview'),
    (route) => {
      const req = route.request()
      if (req.method() === 'GET') {
        const correlationId = 'corr-pending'
        resolveStarted(correlationId)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ correlationId }),
        })
      }
      if (req.method() === 'DELETE') {
        cancelledCorrelationId = req.url().split('/').pop() ?? ''
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      }
      return route.fallback()
    },
  )

  // done 을 보내지 않고 응답을 무한정 보류 — "생성 중" 상태를 유지해 unmount 취소를 검증한다.
  await page.route('**/api/v1/events', async (route) => {
    await started
    return new Promise(() => {})
  })

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await page.getByLabel('파일명 및 콘텐츠 검색').fill('기획서')
  await expect(page.getByTestId('drive-content-results')).toBeVisible()

  await page.getByTestId('drive-overview-btn').click()
  await expect(page.getByTestId('drive-overview-card')).toBeVisible()
  await started

  // StrictMode(dev) 이중 마운트가 첫 인스턴스를 즉시 abort 하며 이미 DELETE 를 1회 쐈을 수 있다 —
  // 이 시점의 값을 리셋해, 아래 "검색어를 비워 unmount" 가 실제로 새 DELETE 를 유발하는지만 검증한다.
  cancelledCorrelationId = null

  // 검색어를 비워 결과 화면을 벗어나면 DriveOverviewCard 가 unmount 되어 abort() 가 호출된다.
  await page.getByLabel('파일명 및 콘텐츠 검색').fill('')
  await expect(page.getByTestId('drive-overview-card')).toHaveCount(0)

  await expect.poll(() => cancelledCorrelationId).toBe('corr-pending')
})
