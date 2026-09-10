// #799: 공간 파일 목록 + 검색 결과에 이름/크기/수정일 3열 헤더 도입 회귀.
// 헤더는 비인터랙티브 레이블(정렬 없음) — 버튼이 아니어야 하고, 폴더 행은 크기 "—".
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace(), createSpace()]),
          })
        : route.fallback(),
  )
}

function stubItems(page: Page, body: unknown) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        : route.fallback(),
  )
}

test('공간 파일 목록 — 이름/크기/수정일 3열 헤더와 값이 렌더링된다', async ({ authenticatedPage: page }) => {
  const folder = createFolder({ id: 10, name: '문서함', updatedAt: '2026-03-05T00:00:00Z' })
  // 실데이터 근접 — 긴 파일명 + 큰 용량(#799 시각검증 요구사항: 1440px 오버플로 확인 대상).
  const file = createFile({
    id: 20,
    name: '2026년_3분기_실적보고서_최종본_검토완료_배포용.pdf',
    sizeBytes: 15_728_640, // 15MB
    mimeType: 'application/pdf',
    category: 'PDF',
    updatedAt: '2026-08-21T03:15:00Z',
  })

  await stubSpaces(page)
  await stubItems(page, { folders: [folder], files: [file] })

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 헤더 — 순수 레이블(비인터랙티브): 버튼이 아니어야 정렬 어포던스로 오인되지 않는다.
  const header = page.getByTestId('drive-column-header')
  await expect(header).toBeVisible()
  await expect(header.getByText('이름')).toBeVisible()
  await expect(header.getByText('크기')).toBeVisible()
  await expect(header.getByText('수정일')).toBeVisible()
  await expect(header.getByRole('button')).toHaveCount(0)

  // 폴더 행 — 크기 컬럼은 "—", 수정일은 표시.
  const folderRow = page.getByRole('listitem').filter({ hasText: '문서함' })
  await expect(folderRow.getByText('—')).toBeVisible()
  await expect(folderRow.getByText('2026-03-05')).toBeVisible()

  // 파일 행 — formatFileSize 재사용 결과(15MB) + formatDateOnly(YYYY-MM-DD).
  const fileRow = page.getByRole('listitem').filter({ hasText: '실적보고서' })
  await expect(fileRow.getByText('15.0 MB')).toBeVisible()
  await expect(fileRow.getByText('2026-08-21')).toBeVisible()
})

test('검색 결과에도 3열 헤더와 크기/수정일 값이 적용된다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await stubItems(page, { folders: [], files: [] })

  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folders: [
            {
              id: 50,
              parentId: null,
              name: 'report-archive',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-02-10T00:00:00Z',
              folderPath: '',
            },
          ],
          files: [
            {
              id: 60,
              folderId: null,
              fileId: 100,
              name: 'report-final.txt',
              mimeType: 'text/plain',
              sizeBytes: 2048,
              category: 'TEXT',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-04-15T00:00:00Z',
              folderPath: '',
            },
          ],
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/search',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [], semantic: false }) }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  await page.getByLabel('파일명 및 콘텐츠 검색').fill('report')
  await expect(page.getByTestId('search-results')).toBeVisible()

  const header = page.getByTestId('drive-column-header')
  await expect(header).toBeVisible()
  await expect(header.getByRole('button')).toHaveCount(0)

  const folderRow = page.getByRole('listitem').filter({ hasText: 'report-archive' })
  await expect(folderRow.getByText('—')).toBeVisible()
  await expect(folderRow.getByText('2026-02-10')).toBeVisible()

  const fileRow = page.getByRole('listitem').filter({ hasText: 'report-final.txt' })
  await expect(fileRow.getByText('2.0 KB')).toBeVisible()
  await expect(fileRow.getByText('2026-04-15')).toBeVisible()
})
