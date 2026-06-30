// 드라이브 프리뷰 포맷 E2E — Markdown 렌더·SVG 이미지·CSV 표 검증.
// drive.spec.ts 의 파일목록 + 프리뷰 모달 진입 패턴을 그대로 복제한다.
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1

// 드라이브 사이드바가 마운트 시 페치하는 공간 목록.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              {
                id: SPACE_ID,
                type: 'PERSONAL',
                name: '내 드라이브',
                ownerId: 1,
                role: 'OWNER',
                archived: false,
                createdAt: '2026-06-01T00:00:00Z',
              },
            ]),
          })
        : route.fallback(),
  )
  // 쿼터 — 사이드바 하단 usage 바.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ usedBytes: 0, quotaBytes: 10737418240 }),
      }),
  )
}

// 최소 SVG — 브라우저가 크기를 갖도록 width/height 명시.
const SVG_BODY = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>`

test.describe('드라이브 프리뷰 포맷', () => {
  // Markdown 파일: mimeType='text/markdown', category='TEXT'
  // /content → '# 제목\n\n**굵게**'  →  h1 "제목" + bold "굵게"
  test('Markdown 파일은 서식 렌더된다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)

    const MD_FILE = {
      id: 80,
      folderId: null,
      fileId: 300,
      name: 'readme.md',
      mimeType: 'text/markdown',
      sizeBytes: 30,
      category: 'TEXT',
      createdAt: '2026-01-01T00:00:00Z',
    }

    // 파일 목록
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [MD_FILE] }),
            })
          : route.fallback(),
    )
    // 썸네일(TEXT 파일은 썸네일 미제공 → 404 허용)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    // 콘텐츠: Markdown 본문
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/content`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/markdown',
          body: '# 제목\n\n**굵게**',
        }),
    )
    // AI 요약 — 모달에서 useDriveFileSummary 가 호출하므로 모킹 필요.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    // 백링크
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${MD_FILE.id}/backlinks`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    // 파일 버튼 클릭 → 미리보기 모달 진입
    await page.getByRole('button', { name: 'readme.md' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()

    // MarkdownMessage 가 렌더됐는지(data-testid="markdown-content")
    await expect(body.getByTestId('markdown-content')).toBeVisible()
    // # 제목 → <h1>제목</h1> → heading role
    await expect(body.getByRole('heading', { name: '제목' })).toBeVisible()
    // **굵게** → <strong>굵게</strong>
    await expect(body.locator('strong', { hasText: '굵게' })).toBeVisible()
  })

  // SVG 파일: mimeType='image/svg+xml', category='IMAGE'
  // resolvePreviewKind → 'IMAGE' → img 태그로 렌더
  test('SVG 파일은 이미지로 렌더된다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)

    const SVG_FILE = {
      id: 90,
      folderId: null,
      fileId: 400,
      name: 'diagram.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: SVG_BODY.length,
      category: 'IMAGE',
      createdAt: '2026-01-01T00:00:00Z',
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [SVG_FILE] }),
            })
          : route.fallback(),
    )
    // 썸네일도 SVG 로 모킹(IMAGE 카드는 썸네일 fetch)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${SVG_FILE.id}/thumbnail`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_BODY }),
    )
    // 콘텐츠: SVG 본문 (blob URL 로 변환돼 img.src 에 주입됨)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${SVG_FILE.id}/content`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG_BODY }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${SVG_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${SVG_FILE.id}/backlinks`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'diagram.svg' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()
    // IMAGE kind → <img> 태그 렌더
    await expect(body.locator('img')).toBeVisible()
  })

  // CSV 파일: mimeType='text/csv', category='DATA'
  // /content → 'a,b\n1,2' → 헤더(a,b) + 데이터 행(1,2)
  test('CSV 파일은 표로 렌더된다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)

    const CSV_FILE = {
      id: 100,
      folderId: null,
      fileId: 500,
      name: 'data.csv',
      mimeType: 'text/csv',
      sizeBytes: 10,
      category: 'DATA',
      createdAt: '2026-01-01T00:00:00Z',
    }

    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [CSV_FILE] }),
            })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${CSV_FILE.id}/thumbnail`,
      (route) => route.fulfill({ status: 404, body: '' }),
    )
    // 콘텐츠: CSV 본문 — 헤더 a,b / 데이터행 1,2
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${CSV_FILE.id}/content`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/csv',
          body: 'a,b\n1,2',
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${CSV_FILE.id}/summary`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: null, status: 'PENDING' }),
        }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/drive/files/${CSV_FILE.id}/backlinks`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: 'data.csv' }).click()

    const body = page.getByTestId('preview-body')
    await expect(body).toBeVisible()

    // CsvTablePreview: data-testid="csv-table" + 헤더 + 셀
    const table = body.getByTestId('csv-table')
    await expect(table).toBeVisible()
    // 헤더 검증(columnheader role)
    await expect(table.getByRole('columnheader', { name: 'a' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'b' })).toBeVisible()
    // 데이터 셀 검증
    await expect(table.getByRole('cell', { name: '1' })).toBeVisible()
    await expect(table.getByRole('cell', { name: '2' })).toBeVisible()
  })
})
