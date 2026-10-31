// 모바일 드라이브 행 액션(WP-216) — 2줄 행, 행마다 ⋮ → 액션 시트, 길게 누르기 → 다중 선택 모드 + 하단 일괄 작업 바.
// 데스크톱 호버 액션은 터치로 열 수 없어(WP-207/208) 모바일에선 이 경로가 유일한 진입점이다.
// 브라우저가 있어야 판정되는 것만 남긴다 — 길게 누르기·선택 범위·포커스(@input), 다운로드·업로드 진행(@platform),
// ⋮·하단 바 위치(@layout), 공간 화면 배선 1건(@wiring). 공유·삭제·폴더 이름 변경 요청, 원본 유실·보관 공간 비활성,
// 행 탭 미리보기 주소는 페이지 테스트 src/pages/mobile/driveRowActions.test.tsx(휴대폰)·
// src/pages/mobile/driveRowActionsTablet.test.tsx(터치 태블릿 체크박스 선택)가 지킨다(WP-971).
import type { Locator, Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { json, longPress, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { pausePageClock } from '../../fixtures/touch'

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
  test('행은 이름 + 크기·수정일 둘째 줄 — 열 헤더·체크박스 없이 ⋮ 만 보인다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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

  test('파일 ⋮ → 시트에서 다운로드하면 다운로드 요청이 나간다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.route('**/api/v1/drive/files/70/download', (r) =>
      r.fulfill({ status: 200, contentType: 'application/pdf', body: 'x' }))
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('drive-row-more-file-70').tap()
    const sheet = page.getByTestId('drive-row-sheet')
    await expect(sheet).toContainText(LONG_FILE)
    for (const key of ['download', 'share', 'rename', 'move', 'copy', 'versions', 'delete']) {
      await expect(sheet.getByTestId(`mobile-action-${key}`)).toBeEnabled()
    }
    // WP-363: 삭제는 맨 아래, 구분선 하나를 사이에 두고 떨어져 있다(데스크톱·태블릿 ⋯ 와 같은 모양).
    await expect(sheet.getByRole('separator')).toHaveCount(1)
    await expect(sheet.locator('[role="separator"] + button')).toHaveAttribute('data-testid', 'mobile-action-delete')
    const req = page.waitForRequest('**/api/v1/drive/files/70/download')
    await sheet.getByTestId('mobile-action-download').tap()
    await req
    await expect(sheet).toBeHidden()
  })

  // 이름 변경 칸의 선택 범위 — 파일 이름은 확장자(.pdf) 앞까지 선택된 채 열려야 한다.
  const STEM_SELECTION = [0, LONG_FILE.length - '.pdf'.length]
  const selectionOf = (input: Locator) => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])

  test('파일 ⋮ → 이름 변경 — 확장자 앞까지 선택된 다이얼로그에서 바꾸면 PATCH 가 나간다(WP-335)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
    await page.route('**/api/v1/drive/files/70', (r) =>
      r.request().method() === 'PATCH' ? r.fulfill(json({ ...FILE, name: '도입제안서.pdf' })) : r.fallback())
    await page.goto(`/drive/spaces/${SPACE_ID}`)

    await page.getByTestId('drive-row-more-file-70').tap()
    await page.getByTestId('mobile-action-rename').tap()
    const input = page.getByTestId('rename-dialog-input')
    await expect(input).toHaveValue(LONG_FILE)
    expect(await selectionOf(input)).toEqual(STEM_SELECTION)
    await page.keyboard.type('도입제안서')
    await page.getByTestId('rename-dialog-confirm').tap()
    await patches.waitFor()
    expect(patches.lastBody<{ name: string }>()).toEqual({ name: '도입제안서.pdf' })
    await expect(input).toBeHidden()
  })

  // 페이지 시계(타이머·rAF)를 멈춘 채 연다 — 처음 선택이 타이머·다음 프레임에 기대면 부하에서 사용자 입력보다 늦게 돈다.
  // 시계가 멈춰 있어도 열리자마자 확장자 앞까지 선택돼 있어야 한다.
  async function openRenameWithPausedClock(page: Page) {
    await stubDrive(page)
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('drive-row-more-file-70').tap()
    await pausePageClock(page)
    await page.getByTestId('mobile-action-rename').tap()
    const input = page.getByTestId('rename-dialog-input')
    await expect(input).toHaveValue(LONG_FILE)
    await expect(input).toBeFocused()
    expect(await selectionOf(input)).toEqual(STEM_SELECTION)
    return input
  }

  test('이름 변경 — 열자마자 치기 시작해도 뒤늦게 다시 거는 선택이 친 글자를 덮어쓰지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const input = await openRenameWithPausedClock(page)
    await page.keyboard.type('도')
    await page.clock.runFor(1000) // 멈췄던 타이머·프레임이 한꺼번에 돌아도
    await expect(page.getByTestId('drive-row-sheet')).toBeHidden() // 시트가 닫히며 포커스가 오간 뒤에도
    await page.keyboard.type('입제안서')
    await expect(input).toHaveValue('도입제안서.pdf')
  })

  test('이름 변경 — 열자마자 옮긴 커서도 뒤늦게 처음 선택으로 되돌아가지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const input = await openRenameWithPausedClock(page)
    await page.keyboard.press('End')
    await page.clock.runFor(1000)
    await expect(page.getByTestId('drive-row-sheet')).toBeHidden()
    await page.keyboard.type('x')
    await expect(input).toHaveValue(`${LONG_FILE}x`)
  })

  test('이름 변경 — 고치다 취소하고 다시 열면 원래 이름이 확장자 앞까지 선택된 채로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const input = await openRenameWithPausedClock(page)
    await page.keyboard.type('도입')
    await page.getByRole('button', { name: '취소' }).tap()
    await expect(input).toBeHidden()
    await page.getByTestId('drive-row-more-file-70').tap()
    await page.getByTestId('mobile-action-rename').tap()
    await expect(input).toHaveValue(LONG_FILE)
    await expect(input).toBeFocused()
    expect(await selectionOf(input)).toEqual(STEM_SELECTION)
  })

  test('길게 누르면 선택 모드 — 탭은 선택 토글(미리보기 안 열림), 하단 바로 일괄 삭제, ✕ 로 종료', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    const bulkDeletes = trackRequests(page, 'DELETE', `/api/v1/drive/spaces/${SPACE_ID}/items`)
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
      r.request().method() === 'DELETE' ? r.fulfill({ status: 204 }) : r.fallback())
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
    await bulkDeletes.waitFor()
    expect(bulkDeletes.lastBody()).toEqual({ fileIds: [70], folderIds: [] })

    // 새 선택 → ✕ 로 선택 모드 종료, ⋮ 복귀.
    await longPress(page, page.getByTestId('drive-row-file-70'))
    await expect(bar).toBeVisible()
    await bar.getByTestId('bulk-clear').tap()
    await expect(page.getByTestId('bulk-toolbar')).toHaveCount(0)
    await expect(page.getByTestId('drive-row-more-file-70')).toBeVisible()
  })

  test('선택 모드에서 체크박스를 직접 탭해도 표시와 선택 수가 함께 바뀐다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('채널 파일 드로워에서도 ⋮ 시트와 선택 모드 하단 바가 화면 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

// WP-237: ≥1024 터치 태블릿 — 폭은 데스크톱이지만 hover 가 없어 hover 액션 묶음 대신 ⋯ 하나로 같은 행 액션 목록을
// 드롭다운으로 연다(화면 폭 하단 시트는 휴대폰 전용 — 다른 태블릿 행 메뉴와 일관).
// 길게 누르기 다중선택은 폭 기준(휴대폰) 그대로라 태블릿은 데스크톱처럼 체크박스로 선택한다.
test.describe('드라이브 행 액션 — 터치 태블릿(≥1024px)', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('파일 행은 hover 묶음 없이 ⋯ 만 — 드롭다운의 다운로드가 다운로드 요청을 보낸다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    await page.route('**/api/v1/drive/files/70/download', (r) =>
      r.fulfill({ status: 200, contentType: 'application/pdf', body: 'x' }))
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const row = page.getByTestId('drive-row-file-70')
    await expect(row).toBeVisible()
    // hover 액션 묶음은 렌더하지 않는다 — 데스크톱 체크박스는 그대로 보인다(선택 진입 경로).
    await expect(row.locator('[data-file-actions]')).toHaveCount(0)
    await expect(page.getByTestId('select-file-70')).toBeVisible()
    const more = page.getByTestId('drive-row-more-file-70')
    await expect(more).toBeVisible()
    expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    await more.tap()
    await expect(page.getByTestId('drive-row-sheet')).toHaveCount(0)
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    // 휴대폰 시트와 같은 작업 목록(링크 복사·채팅·이슈로 보내기·다운로드·공유·이름 변경·이동·복사·버전·삭제, WP-1236).
    await expect(menu.getByRole('menuitem')).toHaveCount(9)
    // WP-363: 삭제 앞에만 구분선 — 데스크톱 ⋯·휴대폰 시트와 같은 모양.
    await expect(menu.getByRole('separator')).toHaveCount(1)
    await expect(menu.locator('[role="separator"] + [role="menuitem"]')).toHaveAttribute('data-testid', 'drive-row-action-delete')
    const req = page.waitForRequest('**/api/v1/drive/files/70/download')
    await page.getByTestId('drive-row-action-download').click()
    await req
    await expect(menu).toBeHidden()
  })

  test('폴더 행 ⋯ → 이름 변경 PATCH, 삭제는 확인 후 DELETE', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubDrive(page)
    const patches = trackRequests(page, 'PATCH', '/api/v1/drive/folders/10')
    const deletes = trackRequests(page, 'DELETE', '/api/v1/drive/folders/10')
    await page.route('**/api/v1/drive/folders/10', (r) => {
      const m = r.request().method()
      if (m === 'PATCH') return r.fulfill(json({ ...FOLDER, name: '계약 자료' }))
      if (m === 'DELETE') return r.fulfill({ status: 204 })
      return r.fallback()
    })
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const row = page.getByTestId('drive-row-folder-10')
    await expect(row).toBeVisible()
    await expect(row.getByRole('button', { name: '이름변경' })).toHaveCount(0)

    await page.getByTestId('drive-row-more-folder-10').tap()
    await page.getByTestId('drive-row-action-rename').click()
    // 드롭다운이 닫힌 뒤에도 이름 변경 다이얼로그가 열린 채 유지된다(포커스 복귀로 닫히지 않음).
    await expect(page.getByTestId('folder-name-input')).toBeVisible()
    await page.getByTestId('folder-name-input').fill('계약 자료')
    await page.getByTestId('folder-name-confirm').tap()
    await expect.poll(() => patches.lastBody()).toEqual({ name: '계약 자료' })

    await page.getByTestId('drive-row-more-folder-10').tap()
    await page.getByTestId('drive-row-action-delete').click()
    await expect(page.getByTestId('drive-confirm-confirm')).toBeVisible()
    await page.getByTestId('drive-confirm-confirm').tap()
    await deletes.waitFor()
  })
})

// WP-643: 모바일은 헤더 업로드 버튼이 ⋯ 메뉴 안이라, 업로드 중 진행률·취소를 목록 위 진행 줄로 보인다.
test('모바일 단일 파일 업로드 — 목록 위에 진행률(%)과 취소가 보이고, 끝나면 사라진다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  // 라우트 가로채기에선 실제 전송 진행 이벤트가 한 번에 끝나므로 업로드 XHR 에 42% 진행 이벤트를 직접 흘린다.
  await page.addInitScript(() => {
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof FormData) {
        const upload = this.upload
        setTimeout(() => upload.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: 42, total: 100 })), 0)
      }
      return send.call(this, body)
    }
  })
  await stubDrive(page)
  let resolveUpload!: () => void
  const held = new Promise<void>((r) => (resolveUpload = r))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`, async (r) => {
    await held
    await r.fulfill(json(createFile({ id: 90, name: 'big.pdf' })))
  })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-row-file-70')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024) })
  const progress = page.getByTestId('upload-progress')
  await expect(progress).toBeVisible()
  await expect(progress).toContainText('업로드 중… 42%')
  await expect(progress.getByTestId('upload-progress-cancel')).toBeVisible()
  resolveUpload()
  await expect(progress).toHaveCount(0)
})
