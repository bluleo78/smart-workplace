// 드라이브 E2E — 폴더 생성 · 파일 업로드 · 다운로드 · 삭제 (백엔드 없이 page.route 모킹).
// 브라우저가 있어야 판정되는 것만 남긴다 — 공간 화면 배선(@wiring), 호버·키보드 포커스로만 보이는 행 작업(@input),
// XHR 업로드 진행률(@platform), 토스트가 헤더·툴바를 가리지 않음·이름 칸 정렬(@layout).
// 목록 열·폴더 만들기/이름 변경·업로드(여러 개·실패·취소·사용량 갱신)·휴지통·검색·경로·찾을 수 없는 공간·이동 창·썸네일 404 캐시·이미지 미리보기는
// src/pages/drive/drivePage.test.tsx, 행 ⋯ 메뉴·삭제 확인·보관/보기 전용 공간은 src/pages/drive/driveRows.test.tsx,
// 사이드바(머리말·사용량 바·채널 공간 숨김·팀 공간 만들기)는 src/pages/drive/driveSpaceCreate.test.tsx 가 지킨다(WP-971, WP-984).
import { truncateSync, writeFileSync } from 'node:fs'

import type { Locator, Page, Route } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStartAligned } from '../../fixtures/layout'
import { measureBox } from '../../fixtures/wait'

const SPACE_ID = 1

// 공간 목록(개인 + 팀) — DriveSidebar 가 마운트 시 페치한다.
async function stubSpaces(page: Page) {
  const fulfillGet = (body: unknown) => (route: Route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fallback()
  await page.route((url) => url.pathname === '/api/v1/drive/spaces', fulfillGet([personalSpace(), createSpace()]))
}

/** 행에 마우스를 올려 ⋯ 더보기를 열고 항목을 고른다 — 데스크톱 hover 묶음의 ⋯ 경로(WP-363). */
async function selectRowMenuItem(page: Page, row: Locator, name: string) {
  await row.hover()
  await row.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name }).click()
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

test('폴더 생성·업로드·다운로드·삭제 흐름', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  // 폴더 생성
  const folderPosts = trackRequests(page, 'POST', `/api/v1/drive/spaces/${SPACE_ID}/folders`)
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

  // 새 폴더 — Dialog(#135: window.prompt 대체)
  await page.getByRole('button', { name: '새 폴더' }).click()
  await expect(page.getByTestId('folder-name-input')).toBeVisible()
  await page.getByTestId('folder-name-input').fill('문서')
  // 확인 버튼은 모드별 동사+명사 라벨을 써야 한다 — 모호한 "확인" 금지 (#635)
  await expect(page.getByTestId('folder-name-confirm')).toHaveText('만들기')
  await page.getByTestId('folder-name-confirm').click()
  // exact — 접힌 행 액션 버튼(「문서 이동」 등)도 접근성 트리에 남으므로(WP-1782) 이름이 정확히 같은 버튼만 고른다.
  await expect(page.getByRole('button', { name: '문서', exact: true })).toBeVisible()
  // POST body — 입력한 이름이 정확히 전달된다.
  expect(folderPosts.lastBody<{ name?: string }>()?.name).toBe('문서')

  // 업로드(숨김 input 에 파일 주입)
  await page.getByTestId('file-input').setInputFiles({
    name: 'memo.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  })
  await expect(page.getByText('memo.txt')).toBeVisible()

  // 다운로드 트리거 — 호버 후 버튼 표시(#292 hover-reveal 패턴), download 이벤트는 환경에 따라 안 떠도 무방
  const downloadPromise = page.waitForEvent('download').catch(() => null)
  const memoItem = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  await memoItem.hover()
  await memoItem.getByRole('button', { name: '다운로드' }).click()
  await downloadPromise

  // 삭제 — AlertDialog(#135: window.confirm 대체). 호버 후 ⋯ 메뉴 맨 아래 항목으로 연다.
  await selectRowMenuItem(page, memoItem, '삭제')
  await expect(page.getByTestId('drive-confirm-dialog')).toBeVisible()
  await page.getByTestId('drive-confirm-confirm').click()
  await expect(page.getByText('memo.txt')).toHaveCount(0)
})

// #712 — 파일/폴더 행 액션이 group-hover 전용이라 키보드 사용자는 도달 불가하던 문제.
// WP-1782 — 노출만으로는 부족했다: 액션 묶음이 display:none 이라 Tab 으로 이름 버튼을 벗어나는 순간 blur 로 group-kbd 가 풀려
// 묶음이 사라지고 초점이 body 로 떨어졌다. 이제 묶음을 Tab 순서에 남겨 이름 → 다운로드 → 더보기 로 이어져야 한다.
test('파일 행 액션 — 키보드 Tab 으로 이름 다음 다운로드 버튼에 초점이 간다 (#712·WP-1782)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [createFile()] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await expect(page.getByText('memo.txt')).toBeVisible()

  const memoItem = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  const actions = memoItem.locator('[data-file-actions]')

  // 파일명 버튼에 포커스만 이동(마우스 hover 없음) — group-kbd 로 묶음이 펼쳐져야 한다.
  await memoItem.getByRole('button', { name: 'memo.txt', exact: true }).focus()
  await expect(actions).toBeVisible()
  // toBeVisible 은 opacity 를 보지 않는다 — 폭만 펼쳐지고 투명한 채 남는 회귀를 막는다(WP-1782).
  await expect(actions).toHaveCSS('opacity', '1')

  // Tab — 다음 초점은 다운로드 버튼(묶음이 사라져 body 로 떨어지면 안 된다).
  await page.keyboard.press('Tab')
  await expect(memoItem.getByRole('button', { name: 'memo.txt 다운로드', exact: true })).toBeFocused()

  // Tab 을 이어 공유 → 더보기 순서로 닿는다(인라인 목록 ROW_INLINE_ACTIONS: 다운로드·공유) — 순서를 명시로 고정.
  await page.keyboard.press('Tab')
  await expect(memoItem.getByTestId('share-link-btn')).toBeFocused()
  await page.keyboard.press('Tab')
  const more = memoItem.getByRole('button', { name: 'memo.txt 더보기', exact: true })
  await expect(more).toBeFocused()
  await expect(actions).toBeVisible()

  // Enter 로 메뉴를 열고 Escape 로 닫으면 초점이 더보기 버튼으로 돌아온다.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
})

// WP-1782 — 폴더 행도 같은 구조다: 이름 → 이동 → 더보기 로 Tab 이 이어지고, Shift+Tab 으로 되돌아오며,
// 다음 행의 체크박스에서 거꾸로 들어와도 숨은 더보기 버튼에 닿아야 한다(접힌 묶음이 Tab 순서에 남아 있음).
test('폴더 행 액션 — Tab 으로 이동·더보기에 닿고 Shift+Tab 으로 되돌아온다 (WP-1782)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [createFolder({ id: 10, name: '문서' })], files: [createFile()] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  const folderRow = page.getByTestId('drive-row-folder-10')
  const move = folderRow.getByRole('button', { name: '문서 이동', exact: true })
  const more = folderRow.getByRole('button', { name: '문서 더보기', exact: true })

  // 정방향 — 마우스 없이 이름 버튼에서 Tab.
  await folderRow.getByRole('button', { name: '문서', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(move).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(more).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(move).toBeFocused()

  // 역방향 진입 — 파일 행 체크박스에서 Shift+Tab 하면 앞 행(폴더)의 더보기에 닿는다.
  await page.getByTestId('select-file-20').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(more).toBeFocused()
  // toBeVisible 은 opacity 를 보지 않는다 — 펼쳐져 실제로 보이는지는 opacity 로 본다(WP-1782).
  await expect(folderRow.locator('[data-folder-actions]')).toHaveCSS('opacity', '1')
})

// WP-1782 — 접힌 묶음은 Tab 순서에 남기려 렌더는 하되 폭 0·포인터 꺼짐이어야 한다. 폭이 남거나 gap 을 남기면
// 이름 칸이 줄어들고(예전 display:none 과 다른 레이아웃) 보이지 않는 버튼이 클릭을 가로챈다.
test('숨은 행 액션은 폭 0·포인터 꺼짐이고 행 간격도 거둔다 (WP-1782)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [createFile()] }))
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 마우스를 행에서 치우고 어떤 요소에도 초점이 없는 상태.
  await page.mouse.move(0, 0)
  const row = page.getByTestId('drive-row-file-20')
  const actions = row.locator('[data-file-actions]')
  await expect(actions).toHaveCount(1)

  // 계산된 폭으로 본다 — 폭 0 요소의 boundingBox 는 엔진에 따라 null 일 수 있다.
  await expect(actions).toHaveCSS('width', '0px')
  await expect(actions).toHaveCSS('pointer-events', 'none')

  // 묶음은 행 맨 끝 — 수정일 열 오른쪽 끝이 행 오른쪽 끝에서 px-1(4px) 안쪽이어야 한다(숨은 묶음이 gap-2 를 남기지 않음).
  const dateBox = await row.locator('span.w-24').boundingBox()
  const rowBox = await row.boundingBox()
  expect(dateBox).not.toBeNull()
  expect(rowBox).not.toBeNull()
  const dateRight = dateBox!.x + dateBox!.width
  const rowRight = rowBox!.x + rowBox!.width
  expect(Math.abs(dateRight - (rowRight - 4))).toBeLessThanOrEqual(1)
})

// WP-643 — 단일 파일 업로드 중 버튼에 진행률(%)을 보인다. 라우트 가로채기에선 실제 전송 진행 이벤트가 한 번에 끝나므로,
// 업로드 XHR 의 upload 객체에 42% 진행 이벤트를 직접 흘려(브라우저가 보내는 것과 같은 ProgressEvent) 표시를 확인한다.
// 실제 XHR 업로드 진행 이벤트가 필요해 E2E 에 둔다(@platform) — jsdom+MSW 의 XHR 은 upload 진행 이벤트를 흘리지 못한다.
// WP-1531: 진행률은 오른쪽 아래 업로드 패널의 파일 행(「42% · 크기」·진행 막대)에 보이고, 단추는 「업로드 중…」으로 막힌다.
test('단일 파일 업로드 중 패널 행에 진행률(%)과 막대가 보이고, 끝나면 「업로드」로 돌아온다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))
  let resolveUpload!: () => void
  const held = new Promise<void>((r) => (resolveUpload = r))
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    async (route) => {
      await held
      await route.fulfill({ status: 201, json: {} })
    },
  )
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024) })
  const btn = page.getByTestId('drive-upload')
  await expect(btn).toHaveText('업로드 중…')
  await expect(btn).toBeDisabled()
  const row = page.getByTestId('drive-upload-panel').getByTestId('drive-upload-row')
  await expect(row).toHaveAttribute('data-status', 'uploading')
  await expect(row).toContainText('42%')
  await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
  resolveUpload()
  await expect(btn).toHaveText('업로드')
  await expect(page.getByTestId('drive-upload-panel')).toContainText('1개 업로드 완료')
})

// WP-1531: 안내는 토스트가 아니라 업로드 패널의 실패 행(「100MB 초과」, 다시 시도 없음)이다.
// 패널은 오른쪽 아래에 떠 있어 머리의 업로드 단추를 가리지 않아야 한다(#715 의 「안내가 툴바를 막지 않는다」 의도).
test('100MB 초과 파일은 업로드 요청 없이 패널 실패 행으로 안내하고, 패널이 업로드 단추를 가리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }, testInfo) => {
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [], files: [] }))
  // 업로드 엔드포인트가 호출되면 안 된다(클라이언트 사전 차단).
  const uploads = trackRequests(page, 'ANY', `/api/v1/drive/spaces/${SPACE_ID}/files`)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{}' }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 100MB+1B 더미 파일 → 한도(100MB, WP-803) 초과. Playwright 는 50MB 넘는 buffer 를 받지 않아 디스크 파일(희소 파일)로 넘긴다.
  const huge = testInfo.outputPath('huge.bin')
  writeFileSync(huge, '')
  truncateSync(huge, 100 * 1024 * 1024 + 1)
  await page.getByTestId('file-input').setInputFiles(huge)

  const panel = page.getByTestId('drive-upload-panel')
  const row = panel.getByTestId('drive-upload-row')
  await expect(row).toHaveAttribute('data-status', 'failed')
  await expect(row).toContainText('100MB 초과')
  await expect(row.getByTestId('drive-upload-retry')).toHaveCount(0)
  await expect(page.getByText('파일 크기가 100MB를 초과합니다.')).toHaveCount(0)
  expect(uploads.count()).toBe(0)

  // 패널은 화면 안 오른쪽 아래에 있고, 업로드 단추 가운데를 덮지 않는다.
  await expect(panel).toBeInViewport()
  await expect(page.getByTestId('drive-upload')).toBeInViewport()
  const uploadBox = await measureBox(page.getByTestId('drive-upload'))
  const coveredByPanel = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="drive-upload-panel"]') != null,
    [uploadBox.x + uploadBox.width / 2, uploadBox.y + uploadBox.height / 2],
  )
  expect(coveredByPanel).toBe(false)
  const panelBox = await measureBox(panel)
  const viewport = page.viewportSize()!
  expect(viewport.width - (panelBox.x + panelBox.width)).toBeLessThanOrEqual(24)
  expect(viewport.height - (panelBox.y + panelBox.height)).toBeLessThanOrEqual(24)
})

// WP-95 — 헤더(z-45)가 토스트(z-40) 위에 그려지므로 토스트가 헤더에 걸치면 윗부분이 잘린다.
// 390px 는 Sonner 모바일 규칙(≤600px), 800px 는 Sonner 데스크톱 규칙인데 레이아웃은 모바일(햄버거 영역)인 구간,
// 1280px 는 데스크톱 레이아웃. 세 구간 모두 토스트 상단이 헤더 하단 아래여야 한다.
for (const width of [390, 800, 1280]) {
  test(`폭 ${width}px 에서 토스트가 헤더에 가려 잘리지 않는다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 844 })
    await stubSpaces(page)
    await stubItems(page, () => ({ folders: [], files: [] }))
    // 휴지통 화면에 끌어 오면 뜨는 안내 토스트(drive-add-blocked, WP-1167)로 잰다 — 업로드 결과는 WP-1531 부터 토스트가 아니라
    // 업로드 패널에 보여, 요청 없이 띄울 수 있는 가장 가벼운 토스트 경로가 이것이다.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/trash`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()
    // 좁은 폭은 머리 동작이 ⋯ 메뉴 안이라 메뉴를 먼저 연다.
    const trashToggle = page.getByTestId('trash-toggle')
    if (!(await trashToggle.isVisible())) await page.getByTestId('page-header').getByRole('button', { name: '더보기' }).click()
    await trashToggle.click()
    await expect(page.getByTestId('trash-view')).toBeVisible()
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await page.getByTestId('drive-dropzone').dispatchEvent('dragover', { dataTransfer })
    await expect(page.getByText('휴지통 화면에서는 올리거나 만들 수 없어요. 폴더 보기로 돌아가 주세요.')).toBeVisible()

    // 진입 애니메이션이 아닌 최종 위치에서 잰다.
    const toast = page.locator('[data-sonner-toast]').first()
    await expect(toast).toHaveAttribute('data-mounted', 'true')
    // 셸·토스트가 자리 잡는 찰나의 null·옛 배치 측정을 넘기도록 재측정하며 단언한다(WP-225).
    await expect(async () => {
      const [headerBox, toastBox] = await Promise.all([measureBox(page.getByTestId('page-header')), measureBox(toast)])
      expect(toastBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height)
    }).toPass()
  })
}

// #135 — window.prompt/confirm → shadcn Dialog/AlertDialog 교체 검증

// #292 — 파일/폴더 액션 버튼 hover-reveal 패턴 회귀 테스트
test('파일/폴더 액션 버튼이 기본 상태에서는 숨겨지고 호버 시에만 표시된다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const folder = createFolder({ id: 10, name: '문서' })
  const file = createFile({ id: 20, name: 'memo.txt' })
  await stubSpaces(page)
  await stubItems(page, () => ({ folders: [folder], files: [file] }))

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()

  // 기본 상태: 액션 버튼이 숨겨져 있어야 함
  const folderItem = page.getByRole('listitem').filter({ hasText: '문서' })
  const fileItem = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  await expect(folderItem.locator('[data-folder-actions]')).toBeHidden()
  // 파일 행 액션 래퍼는 width 0·투명으로 접혀 있다(WP-1782). 빈 박스는 toBeHidden 이 숨김으로 취급하므로 호버 전에는 숨김.
  await expect(fileItem.locator('[data-file-actions]')).toBeHidden()

  // 호버 시: 액션 버튼이 표시되어야 함
  // 폴더 행은 이동만 인라인, 나머지는 ⋯ — 삭제는 인라인에 없다.
  await folderItem.hover()
  await expect(folderItem.getByRole('button', { name: '이동' })).toBeVisible()
  await expect(folderItem.getByRole('button', { name: /더보기/ })).toBeVisible()
  await expect(folderItem.getByRole('button', { name: /삭제/ })).toHaveCount(0)

  // 파일 행은 다운로드·공유만 인라인. 이름 변경·이동·복사·버전 이력·삭제는 ⋯ 더보기 메뉴.
  await fileItem.hover()
  await expect(fileItem.getByRole('button', { name: '다운로드' })).toBeVisible()
  await expect(fileItem.getByRole('button', { name: '공유' })).toBeVisible()
  await expect(fileItem.getByRole('button', { name: /더보기/ })).toBeVisible()
  await expect(fileItem.getByRole('button', { name: /삭제/ })).toHaveCount(0)
})

// 페이지 레이아웃 통합(Page) — 폴더 행·파일 행·열 헤더의 "이름" 칸이 같은 x 에서 시작한다(폴더 행만 px-1 이 빠져 4px 어긋나던 것).
test('데스크톱 — 폴더 행 이름·파일 행 이름·열 헤더 이름 칸이 같은 x', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await stubSpaces(page)
  await stubItems(page, () => ({
    folders: [createFolder({ id: 10, name: '문서함' })],
    files: [createFile({ id: 20, name: 'report.pdf' })],
  }))
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  const folderName = page.getByTestId('drive-row-folder-10').getByText('문서함', { exact: true })
  const fileName = page.getByTestId('drive-row-file-20').getByText('report.pdf', { exact: true })
  await expectStartAligned(folderName, fileName)
  await expectStartAligned(page.getByTestId('drive-column-header').getByText('이름', { exact: true }), fileName)
})
