// 드라이브 벌크 작업 E2E — 멀티셀렉트 체크박스 + 벌크 툴바(이동/ZIP/삭제) 시나리오.
import type { Page } from '@playwright/test'

import { createFile, createFolder, personalSpace, createSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1
const FOLDER_ID = 10
const FILE_ID = 20

// 공간 목록 스텁 — DriveSidebar 마운트 시 페치.
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

// 폴더1(id=10) + 파일1(id=20) 고정 items 스텁.
async function stubItems(page: Page) {
  const folder = createFolder({ id: FOLDER_ID, name: '문서' })
  const file = createFile({ id: FILE_ID, name: 'memo.txt' })
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ folders: [folder], files: [file] }),
          })
        : route.fallback(),
  )
}

// 검색 결과 스텁 — 폴더1(id=10) + 파일1(id=20) 고정. q query param 은 검증하지 않음(#588 은 선택 UI 초점).
async function stubSearch(page: Page) {
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/search`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          folders: [
            { id: FOLDER_ID, parentId: null, name: '문서', createdAt: '2026-01-01T00:00:00Z', folderPath: null },
          ],
          files: [
            {
              id: FILE_ID,
              folderId: null,
              fileId: 200,
              name: 'memo.txt',
              mimeType: 'text/plain',
              sizeBytes: 3,
              category: 'TEXT',
              createdAt: '2026-01-01T00:00:00Z',
              folderPath: null,
            },
          ],
        }),
      }),
  )
}

test.describe('드라이브 벌크 작업', () => {
  test('폴더·파일 체크 시 벌크 툴바에 선택 개수가 표시된다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    // 초기 상태: 벌크 툴바 없음
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)

    // 폴더 선택
    await page.getByTestId(`select-folder-${FOLDER_ID}`).check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 1개')

    // 파일 추가 선택
    await page.getByTestId(`select-file-${FILE_ID}`).check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')

    // 선택 해제 → 툴바 사라짐
    await page.getByTestId('bulk-clear').click()
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
  })

  test('벌크 삭제 — AlertDialog 확인 후 DELETE 요청에 fileIds/folderIds 전달', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)

    // 삭제 엔드포인트 — body 캡처 후 204 반환.
    let deleteBody: unknown = null
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      async (route) => {
        if (route.request().method() === 'DELETE') {
          deleteBody = route.request().postDataJSON()
          await route.fulfill({ status: 204, body: '' })
        } else {
          await route.fallback()
        }
      },
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    await page.getByTestId(`select-folder-${FOLDER_ID}`).check()
    await page.getByTestId(`select-file-${FILE_ID}`).check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')

    // 벌크 삭제 버튼 → AlertDialog 표시 → 기존 단건 삭제와 동일한 확인 버튼 클릭.
    await page.getByTestId('bulk-delete').click()
    await expect(page.getByTestId('drive-confirm-dialog')).toBeVisible()
    await page.getByTestId('drive-confirm-confirm').click()

    // DELETE body 검증
    await expect.poll(() => deleteBody).toMatchObject({ fileIds: [FILE_ID], folderIds: [FOLDER_ID] })
  })

  test('벌크 이동 — 폴더 선택 후 PATCH .../items/move 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)

    let moveBody: unknown = null
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items/move`,
      async (route) => {
        if (route.request().method() === 'PATCH') {
          moveBody = route.request().postDataJSON()
          await route.fulfill({ status: 204, body: '' })
        } else {
          await route.fallback()
        }
      },
    )
    // FolderPickerModal 이 items 를 페치 — 빈 폴더로 응답.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items` && url.search.includes('parentId'),
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ folders: [], files: [] }),
        }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    await page.getByTestId(`select-file-${FILE_ID}`).check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 1개')

    // 이동 버튼 → FolderPickerModal 열림
    await page.getByTestId('bulk-move').click()
    await expect(page.getByTestId('folder-picker')).toBeVisible()

    // '여기로' 클릭 — 루트(null)로 이동.
    await page.getByTestId('folder-picker-confirm').click()

    await expect.poll(() => moveBody).toMatchObject({ fileIds: [FILE_ID], folderIds: [] })
  })

  test('벌크 ZIP 다운로드 — POST .../download-zip 요청에 fileIds/folderIds 전달', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)

    let zipBody: unknown = null
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/download-zip`,
      async (route) => {
        if (route.request().method() === 'POST') {
          zipBody = route.request().postDataJSON()
          // 빈 blob 으로 응답 — 실제 ZIP 내용 불필요.
          await route.fulfill({ status: 200, contentType: 'application/zip', body: '' })
        } else {
          await route.fallback()
        }
      },
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    await page.getByTestId(`select-folder-${FOLDER_ID}`).check()
    await page.getByTestId(`select-file-${FILE_ID}`).check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')

    await page.getByTestId('bulk-zip').click()

    // 삭제/이동 시나리오와 동일하게 request body 검증
    await expect.poll(() => zipBody).toMatchObject({ fileIds: [FILE_ID], folderIds: [FOLDER_ID] })
  })

  test('전체선택 — select-all 클릭 시 모든 항목이 선택되고, 다시 클릭 시 해제된다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    // 초기 상태: 툴바 없음
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)

    // 전체선택 → 폴더1 + 파일1 = 2개
    await page.getByTestId('select-all').check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')
    await expect(page.getByTestId(`select-folder-${FOLDER_ID}`)).toBeChecked()
    await expect(page.getByTestId(`select-file-${FILE_ID}`)).toBeChecked()

    // 다시 클릭(해제) → 툴바 사라짐
    await page.getByTestId('select-all').uncheck()
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
  })

  // #588: 검색 결과 화면에도 비검색 모드와 동일한 체크박스/전체선택/벌크 툴바가 있어야 한다.
  test('검색 결과에서도 체크박스·전체선택·벌크 삭제가 동작한다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    await stubItems(page)
    await stubSearch(page)
    // 통합 검색이므로 콘텐츠 검색도 항상 함께 호출됨 — 이 테스트는 파일명 결과만 검증하므로 빈 결과로 모킹.
    await page.route(
      (url) => url.pathname === '/api/v1/drive/search',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: [], semantic: false }) }),
    )

    let deleteBody: unknown = null
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      async (route) => {
        if (route.request().method() === 'DELETE') {
          deleteBody = route.request().postDataJSON()
          await route.fulfill({ status: 204, body: '' })
        } else {
          await route.fallback()
        }
      },
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()

    // 검색 실행 → 결과 목록으로 전환
    await page.getByLabel('파일명 및 콘텐츠 검색').fill('memo')
    await expect(page.getByTestId('search-results')).toBeVisible()

    // 검색 결과 행에 체크박스가 존재 — 이슈 #588 재현 조건(기존에는 완전 누락).
    await expect(page.getByTestId(`select-folder-${FOLDER_ID}`)).toBeVisible()
    await expect(page.getByTestId(`select-file-${FILE_ID}`)).toBeVisible()

    // 전체선택 → 검색 결과 2건 모두 선택 + 벌크 툴바 노출
    await page.getByTestId('select-all').check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')

    // 벌크 삭제 → AlertDialog 확인 → DELETE 요청에 검색 결과 id 전달
    await page.getByTestId('bulk-delete').click()
    await expect(page.getByTestId('drive-confirm-dialog')).toBeVisible()
    await page.getByTestId('drive-confirm-confirm').click()

    await expect.poll(() => deleteBody).toMatchObject({ fileIds: [FILE_ID], folderIds: [FOLDER_ID] })

    // 삭제 후 검색 결과가 재조회되며 선택 상태가 초기화된다(벌크 툴바 사라짐).
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
  })
})
