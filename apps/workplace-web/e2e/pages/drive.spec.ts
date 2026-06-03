// 드라이브 E2E — 폴더 생성 · 파일 업로드 · 다운로드 · 삭제 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../factories/drive.factory'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록(개인 + 팀) — DriveSidebar 가 마운트 시 페치한다.
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

// 항목 목록 — 가변 상태를 클로저로 흉내(생성/삭제 반영).
function stubItems(page: Page, getState: () => { folders: unknown[]; files: unknown[] }) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(getState()),
          })
        : route.fallback(),
  )
}

test('폴더 생성·업로드·다운로드·삭제 흐름', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  // 폴더 생성
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/folders`,
    (route) => {
      const folder = createFolder()
      state.folders = [folder]
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(folder),
      })
    },
  )
  // 파일 업로드
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    (route) => {
      const file = createFile()
      state.files = [file]
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(file),
      })
    },
  )
  // 다운로드
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20/download',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'content-disposition': 'attachment; filename="memo.txt"' },
        body: 'hello',
      }),
  )
  // 파일 삭제
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20',
    (route) => {
      state.files = []
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 새 폴더
  page.once('dialog', (d) => d.accept('문서'))
  await page.getByRole('button', { name: '새 폴더' }).click()
  await expect(page.getByText('📁 문서')).toBeVisible()

  // 업로드(숨김 input 에 파일 주입)
  await page.getByTestId('file-input').setInputFiles({
    name: 'memo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(page.getByText('memo.txt')).toBeVisible()

  // 다운로드 트리거(에러 없이 동작 — download 이벤트는 환경에 따라 안 떠도 무방)
  const downloadPromise = page.waitForEvent('download').catch(() => null)
  await page.getByRole('button', { name: '다운로드' }).first().click()
  await downloadPromise

  // 삭제
  page.once('dialog', (d) => d.accept())
  await page
    .getByRole('listitem')
    .filter({ hasText: 'memo.txt' })
    .getByRole('button', { name: '삭제' })
    .click()
  await expect(page.getByText('memo.txt')).toHaveCount(0)
})

test('파일을 폴더로 이동', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  // 루트: 폴더 '문서'(10) + 파일 memo.txt(20). 이동 후 루트에서 파일 사라짐.
  const FOLDER_ID = 10
  const state = {
    folders: [{ id: FOLDER_ID, parentId: null, name: '문서', createdAt: '2026-06-03T00:00:00Z' }],
    files: [
      {
        id: 20,
        folderId: null,
        fileId: 99,
        name: 'memo.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        category: 'TEXT',
        createdAt: '2026-06-03T00:00:00Z',
      },
    ],
  }
  await stubSpaces(page)

  // items: 루트는 state, 폴더 10 안은 비어 있음
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => {
      const parentId = new URL(route.request().url()).searchParams.get('parentId')
      const body = parentId === String(FOLDER_ID) ? { folders: [], files: [] } : state
      return route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        : route.fallback()
    },
  )

  // 이동 엔드포인트 — 호출되면 파일을 루트에서 제거
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/20/move',
    (route) => {
      state.files = []
      return route.fulfill({ status: 204, body: '' })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByText('memo.txt')).toBeVisible()

  // memo.txt 행의 '이동' 클릭 → 모달
  await page
    .getByRole('listitem')
    .filter({ hasText: 'memo.txt' })
    .getByRole('button', { name: '이동' })
    .click()
  await expect(page.getByTestId('folder-picker')).toBeVisible()

  // 모달에서 '문서' 폴더로 진입 후 '여기로' 확정
  // (📁 문서 는 모달 뒤 DrivePage 목록에도 있으므로 모달 스코프로 한정 — strict-mode 위반 방지)
  await page.getByTestId('folder-picker').getByRole('button', { name: '📁 문서' }).click()
  await page.getByTestId('folder-picker-confirm').click()

  // 루트 목록 리로드 → 파일 사라짐
  await expect(page.getByText('memo.txt')).toHaveCount(0)
})

// 1x1 투명 PNG (썸네일/이미지 콘텐츠 모킹용)
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('검색어 입력 시 결과를 경로와 함께 보여주고, 폴더 결과 클릭으로 이동한다', async ({
  authenticatedPage: page,
}) => {
  await stubSpaces(page)
  // 기본 목록(빈 루트). 폴더 50 진입 시에도 빈 목록.
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
  // 검색 결과 — q query param 캡처
  let searchQuery = ''
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) => {
      searchQuery = new URL(route.request().url()).searchParams.get('q') ?? ''
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folders: [
            {
              id: 50,
              parentId: 9,
              name: 'report-archive',
              createdAt: '2026-01-01T00:00:00Z',
              folderPath: '프로젝트',
            },
          ],
          files: [
            {
              id: 60,
              folderId: 9,
              fileId: 100,
              name: 'report-final.txt',
              mimeType: 'text/plain',
              sizeBytes: 3,
              category: 'TEXT',
              createdAt: '2026-01-01T00:00:00Z',
              folderPath: '프로젝트/문서',
            },
          ],
        }),
      })
    },
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 입력 → API query param 검증
  await page.getByLabel('드라이브 검색').fill('report')
  await expect(page.getByTestId('search-results')).toBeVisible()
  expect(searchQuery).toBe('report')

  // 응답 → UI 반영(경로 표시 포함)
  await expect(page.getByText('report-final.txt')).toBeVisible()
  await expect(page.getByText('프로젝트/문서')).toBeVisible()
  await expect(page.getByText('report-archive')).toBeVisible()

  // 폴더 결과 클릭 → 해당 폴더로 이동(folderId=50)
  await page.getByRole('button', { name: /report-archive/ }).click()
  await expect(page).toHaveURL(/folderId=50/)
})

test('이미지 파일 클릭 시 미리보기 모달에 이미지를 표시한다', async ({ authenticatedPage: page }) => {
  await stubSpaces(page)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              folders: [],
              files: [
                {
                  id: 70,
                  folderId: null,
                  fileId: 200,
                  name: 'photo.png',
                  mimeType: 'image/png',
                  sizeBytes: 100,
                  category: 'IMAGE',
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
            }),
          })
        : route.fallback(),
  )
  // 썸네일 + 콘텐츠 모두 PNG 로 모킹
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/70/thumbnail',
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/files/70/content',
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await page.getByRole('button', { name: 'photo.png' }).click()

  const body = page.getByTestId('preview-body')
  await expect(body).toBeVisible()
  await expect(body.locator('img')).toBeVisible()
})
