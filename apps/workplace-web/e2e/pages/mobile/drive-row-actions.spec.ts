// 모바일 드라이브 행 액션(WP-216) — 2줄 행, 행마다 ⋮ → 액션 시트, 길게 누르기 → 다중 선택 모드 + 하단 일괄 작업 바.
// 데스크톱 호버 액션은 터치로 열 수 없어(WP-207/208) 모바일에선 이 경로가 유일한 진입점이다.
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { json, longPress, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

const SPACE_ID = 1
// 실데이터 폭 검증용 긴 이름.
const LONG_FILE = '2026_하반기_스마트워크플레이스_도입제안서_최종_검토반영_v3_고객사송부본.pdf'
const FOLDER = createFolder({ id: 10, name: '고객사별 견적 및 계약 검토 자료' })
const FILE = createFile({ id: 70, name: LONG_FILE, mimeType: 'application/pdf', category: 'PDF', sizeBytes: 4_400_000 })
const MISSING = createFile({ id: 71, name: '원본유실_회의록.docx', available: false })

async function stubDrive(page: Page, { archived = false } = {}) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace({ archived })])) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createSpace({ archived }))) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ folders: [FOLDER], files: [FILE, MISSING] })) : r.fallback())
  await page.route(/\/api\/v1\/drive\/files\/\d+\/thumbnail/, (r) => r.fulfill({ status: 404 }))
}

test.describe('모바일 드라이브 행 액션', () => {
  test('행은 이름 + 크기·수정일 둘째 줄 — 열 헤더·체크박스 없이 ⋮ 만 보인다', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const row = page.getByTestId('drive-row-file-70')
    await expect(row).toContainText(LONG_FILE)
    await expect(row).toContainText('4.2 MB')
    await expect(page.getByTestId('drive-row-folder-10')).toContainText('폴더 ·')
    await expect(page.getByTestId('drive-column-header')).toBeHidden()
    await expect(page.getByTestId('select-file-70')).toHaveCount(0)
    await expect(page.getByTestId('select-all')).toHaveCount(0)
    await expect(page.getByTestId('drive-row-more-file-70')).toBeVisible()
    // 긴 이름이 ⋮ 를 화면 밖으로 밀어내지 않는다(390px 폭).
    const more = (await page.getByTestId('drive-row-more-file-70').boundingBox())!
    expect(more.x + more.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(more.height).toBeGreaterThanOrEqual(44)
  })

  test('파일 ⋮ → 시트에서 다운로드하면 다운로드 요청이 나간다', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.route('**/api/v1/drive/files/70/download', (r) =>
      r.fulfill({ status: 200, contentType: 'application/pdf', body: 'x' }))
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('drive-row-more-file-70').tap()
    const sheet = page.getByTestId('drive-row-sheet')
    await expect(sheet).toContainText(LONG_FILE)
    for (const key of ['download', 'share', 'move', 'copy', 'versions', 'delete']) {
      await expect(sheet.getByTestId(`mobile-action-${key}`)).toBeEnabled()
    }
    const req = page.waitForRequest('**/api/v1/drive/files/70/download')
    await sheet.getByTestId('mobile-action-download').tap()
    await req
    await expect(sheet).toBeHidden()
  })

  test('파일 ⋮ → 공유 링크는 공유 모달, 삭제는 확인 후 DELETE', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.route('**/api/v1/drive/files/70/share-links', (r) => r.fulfill(json([])))
    let deleted = false
    await page.route('**/api/v1/drive/files/70', (r) => {
      if (r.request().method() !== 'DELETE') return r.fallback()
      deleted = true
      return r.fulfill({ status: 204 })
    })
    await page.goto(`/drive/spaces/${SPACE_ID}`)

    await page.getByTestId('drive-row-more-file-70').tap()
    await page.getByTestId('mobile-action-share').tap()
    await expect(page.getByTestId('share-link-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('share-link-modal')).toBeHidden()

    await page.getByTestId('drive-row-more-file-70').tap()
    await page.getByTestId('mobile-action-delete').tap()
    await page.getByTestId('drive-confirm-confirm').tap()
    await expect.poll(() => deleted).toBe(true)
  })

  test('폴더 ⋮ → 이름 변경은 새 이름으로 PATCH', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    let body: unknown = null
    await page.route('**/api/v1/drive/folders/10', (r) => {
      if (r.request().method() !== 'PATCH') return r.fallback()
      body = r.request().postDataJSON()
      return r.fulfill(json({ ...FOLDER, name: '계약 자료' }))
    })
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('drive-row-more-folder-10').tap()
    const sheet = page.getByTestId('drive-row-sheet')
    await expect(sheet.getByTestId('mobile-action-download')).toHaveCount(0)
    await sheet.getByTestId('mobile-action-rename').tap()
    await expect(page.getByTestId('folder-name-input')).toHaveValue(FOLDER.name)
    await page.getByTestId('folder-name-input').fill('계약 자료')
    await page.getByTestId('folder-name-confirm').tap()
    await expect.poll(() => body).toEqual({ name: '계약 자료' })
  })

  test('원본 유실 파일은 다운로드·공유·복사가 비활성, 보관된 공간은 쓰기 작업이 비활성', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('drive-row-more-file-71').tap()
    const sheet = page.getByTestId('drive-row-sheet')
    await expect(sheet.getByTestId('mobile-action-download')).toBeDisabled()
    await expect(sheet.getByTestId('mobile-action-share')).toBeDisabled()
    await expect(sheet.getByTestId('mobile-action-copy')).toBeDisabled()
    await expect(sheet.getByTestId('mobile-action-move')).toBeEnabled()
    await expect(sheet.getByTestId('mobile-action-delete')).toBeEnabled()
  })

  test('보관된 공간 — 폴더 시트의 쓰기 작업이 모두 비활성', async ({ authenticatedPage: page }) => {
    await stubDrive(page, { archived: true })
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-readonly-banner')).toBeVisible()
    await page.getByTestId('drive-row-more-folder-10').tap()
    for (const key of ['rename', 'move', 'copy', 'delete']) {
      await expect(page.getByTestId(`mobile-action-${key}`)).toBeDisabled()
    }
  })

  test('길게 누르면 선택 모드 — 탭은 선택 토글(미리보기 안 열림), 하단 바로 일괄 삭제, ✕ 로 종료', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    let bulkBody: unknown = null
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items`, (r) => {
      if (r.request().method() !== 'DELETE') return r.fallback()
      bulkBody = r.request().postDataJSON()
      return r.fulfill({ status: 204 })
    })
    await page.goto(`/drive/spaces/${SPACE_ID}`)

    await longPress(page, page.getByTestId('drive-row-file-70'))
    const bar = page.getByTestId('bulk-toolbar')
    await expect(bar).toContainText('1개 선택')
    // 길게 누른 뒤의 click 은 삼켜져 미리보기가 열리지 않는다.
    await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
    await expect(page.getByTestId('select-file-70')).toBeChecked()
    // 선택 모드에선 ⋮ 대신 체크박스.
    await expect(page.getByTestId('drive-row-more-file-70')).toHaveCount(0)

    // 폴더 행 탭 → 폴더가 열리지 않고 선택에 추가.
    await page.getByTestId('drive-row-folder-10').tap()
    await expect(bar).toContainText('2개 선택')
    await expect(page.getByTestId('select-folder-10')).toBeChecked()
    await expect(page.getByTestId('drive-breadcrumb')).not.toContainText(FOLDER.name)

    // 다시 탭하면 해제.
    await page.getByTestId('drive-row-folder-10').tap()
    await expect(bar).toContainText('1개 선택')

    await bar.getByTestId('bulk-delete').tap()
    await page.getByTestId('drive-confirm-confirm').tap()
    await expect.poll(() => bulkBody).toEqual({ fileIds: [70], folderIds: [] })

    // 새 선택 → ✕ 로 선택 모드 종료, ⋮ 복귀.
    await longPress(page, page.getByTestId('drive-row-file-70'))
    await expect(bar).toBeVisible()
    await bar.getByTestId('bulk-clear').tap()
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('drive-row-more-file-70')).toBeVisible()
  })

  test('선택 모드가 아니면 행 탭은 그대로 미리보기를 연다', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.route('**/api/v1/drive/files/70/content', (r) =>
      r.fulfill({ status: 200, contentType: 'application/pdf', body: 'x' }))
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByRole('button', { name: LONG_FILE, exact: true }).tap()
    await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}\\?preview=70$`))
  })

  test('선택 모드에서 체크박스를 직접 탭해도 표시와 선택 수가 함께 바뀐다', async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await longPress(page, page.getByTestId('drive-row-file-70'))
    const bar = page.getByTestId('bulk-toolbar')
    await expect(bar).toContainText('1개 선택')

    // eslint-disable-next-line playwright/no-force-option -- 모바일 체크박스는 pointer-events-none 이라 그 좌표 탭(행이 받음)을 검증하려면 강제 탭이 필요하다
    await page.getByTestId('select-folder-10').tap({ force: true })
    await expect(page.getByTestId('select-folder-10')).toBeChecked()
    await expect(bar).toContainText('2개 선택')
    // eslint-disable-next-line playwright/no-force-option -- 모바일 체크박스는 pointer-events-none 이라 그 좌표 탭을 검증하려면 강제 탭이 필요하다
    await page.getByTestId('select-file-70').tap({ force: true })
    await expect(page.getByTestId('select-file-70')).not.toBeChecked()
    await expect(bar).toContainText('1개 선택')
  })

  test('채널 파일 드로워에서도 ⋮ 시트와 선택 모드 하단 바가 화면 안에 보인다', async ({ authenticatedPage: page }) => {
    const CH_SPACE = 8800
    await stubChannelMessages(page)
    await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/drive-space', (r) =>
      r.fulfill(json({ spaceId: CH_SPACE, archived: false })))
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${CH_SPACE}`, (r) =>
      r.fulfill(json(createSpace({ id: CH_SPACE, type: 'CHANNEL', name: '모바일-개편' }))))
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${CH_SPACE}/items`, (r) =>
      r.fulfill(json({ folders: [FOLDER], files: [FILE] })))
    await page.route(/\/api\/v1\/drive\/files\/\d+\/thumbnail/, (r) => r.fulfill({ status: 404 }))
    await page.goto('/chat/channels/1')
    await page.getByTestId('channel-files-button').tap()
    const drawer = page.getByTestId('drive-space-drawer')

    await drawer.getByTestId('drive-row-more-file-70').tap()
    await expect(page.getByTestId('drive-row-sheet')).toContainText(LONG_FILE)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('drive-row-sheet')).toBeHidden()

    await longPress(page, drawer.getByTestId('drive-row-file-70'))
    const bar = drawer.getByTestId('bulk-toolbar')
    await expect(bar).toContainText('1개 선택')
    const box = (await bar.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  })
})
