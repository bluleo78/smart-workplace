import type { DriveContentSearchResponse } from '../src/api/contentSearch'
import type { DriveSpace } from '../src/types/drive'
import { expect, test } from './fixtures/auth.fixture'

/** 드라이브 콘텐츠 검색 E2E — 검색 바 + 결과 리스트. API 모킹으로 백엔드 없이 동작. */
test('drive content search shows hits with snippet', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 드라이브 공간 목록 모킹 — DriveIndexRedirect 가 personal 공간으로 리다이렉트.
  const spaces: DriveSpace[] = [
    {
      id: 1,
      name: '내 드라이브',
      type: 'PERSONAL',
      archived: false,
    } as DriveSpace,
  ]
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route('**/api/v1/drive/spaces/1/items**', (route) =>
    route.fulfill({ json: { folders: [], files: [] } }),
  )
  await page.route('**/api/v1/drive/spaces/1', (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )

  // 콘텐츠 검색 응답 모킹.
  const searchResponse: DriveContentSearchResponse = {
    hits: [
      {
        driveFileId: 1,
        fileId: 10,
        spaceId: 2,
        spaceName: '재무팀',
        name: '예산안',
        mimeType: 'application/pdf',
        snippet: '내년도 <b>예산</b> 편성',
        score: 0.5,
      },
    ],
    semantic: true,
  }
  await page.route('**/api/v1/drive/search?*', (route) => route.fulfill({ json: searchResponse }))

  // 드라이브 진입 — IndexRedirect → /drive/spaces/1.
  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)

  // 콘텐츠 검색 바에 검색어 입력 + Enter.
  const searchInput = page.getByPlaceholder('콘텐츠 검색')
  await expect(searchInput).toBeVisible()
  await searchInput.fill('예산')
  await searchInput.press('Enter')

  // 결과 파일명 표시 확인.
  await expect(page.getByText('예산안')).toBeVisible()
  // snippet 텍스트(b 태그 제거 후)도 표시됨.
  await expect(page.getByText('내년도 예산 편성')).toBeVisible()
  // 스페이스 뱃지 표시.
  await expect(page.getByText('재무팀')).toBeVisible()
})
