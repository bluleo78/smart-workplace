// 드라이브 「별표」(WP-1698) — 사이드바 입구 → /drive/starred → 별표 목록 API → 행으로 이어지는 배선 한 건(@wiring).
// 목록 칸·빈 화면·빼기 토스트·되돌리기·폴더 이동 주소·보기 창·행 메뉴·공간 화면 메뉴 「별표」는 src/pages/drive/driveStarred.test.tsx 가 지킨다.
// 휴대폰 폭의 세 줄 행·누름 영역은 e2e/pages/mobile/drive-starred-layout.spec.ts(@layout).
import type { Route } from '@playwright/test'

import { personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import type { DriveStarredItem, DriveStarredPage } from '../../../src/types/drive'

const SPACE_ID = personalSpace().id

const starred: DriveStarredItem = {
  kind: 'FILE',
  id: 70,
  name: '2026 사업계획.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  fileId: 970,
  category: 'DOCUMENT',
  versionCount: 1,
  available: true,
  folderCount: null,
  fileCount: null,
  parentFolderId: null,
  path: '',
  spaceId: SPACE_ID,
  spaceName: '내 드라이브',
  updatedAt: '2026-11-12T03:00:00Z',
  starredAt: '2026-11-13T03:00:00Z',
}

/** GET 만 이 본문으로 답하고 그 밖은 다음 route 로 넘긴다. */
const getJson = (body: unknown) => (route: Route) =>
  route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    : route.fallback()

test('사이드바 「별표」를 누르면 /drive/starred 로 가서 별표 목록 API 결과를 행으로 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', getJson([personalSpace()]))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, getJson(personalSpace()))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, getJson({ folders: [], files: [] }))
  await page.route((u) => u.pathname === '/api/v1/drive/quota', getJson({ usedBytes: 0, quotaBytes: 1024 }))
  await page.route((u) => u.pathname === '/api/v1/drive/shared-with-me', getJson([]))
  const page1: DriveStarredPage = { items: [starred], nextCursor: null }
  await page.route((u) => u.pathname === '/api/v1/drive/starred', getJson(page1))
  const lists = trackRequests(page, 'GET', '/api/v1/drive/starred')

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByTestId('drive-nav-starred').click()

  await expect(page).toHaveURL(/\/drive\/starred$/)
  await expect(page.getByTestId('drive-nav-starred')).toHaveAttribute('aria-current', 'page')
  const row = page.getByTestId('drive-starred-row-file-70')
  await expect(row.getByRole('button', { name: '2026 사업계획.pdf', exact: true })).toBeVisible()
  await expect(row.getByTestId('drive-starred-space-file-70')).toHaveText('내 드라이브')
  await expect.poll(() => lists.count()).toBeGreaterThanOrEqual(1)
})
