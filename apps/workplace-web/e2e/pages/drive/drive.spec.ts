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
  await expect(page.getByRole('button', { name: '문서' })).toBeVisible()
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
test('파일 행 액션 — 마우스 없이 키보드 포커스만으로 노출됨 (#712)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const state = { folders: [] as unknown[], files: [createFile()] }
  await stubSpaces(page)
  await stubItems(page, () => state)

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await expect(page.getByText('memo.txt')).toBeVisible()

  const memoItem = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  const actions = memoItem.locator('[data-file-actions]')
  // hover 전: 액션 wrapper 는 display:none 이어야 한다.
  await expect(actions).toHaveCSS('display', 'none')

  // 파일명 버튼에 포커스만 이동(마우스 hover 없음) — group-focus-within 으로 노출돼야 한다.
  await memoItem.getByRole('button', { name: 'memo.txt' }).focus()
  await expect(actions).toHaveCSS('display', 'flex')
  await expect(memoItem.getByRole('button', { name: '다운로드' })).toBeVisible()
})

// WP-643 — 단일 파일 업로드 중 버튼에 진행률(%)을 보인다. 라우트 가로채기에선 실제 전송 진행 이벤트가 한 번에 끝나므로,
// 업로드 XHR 의 upload 객체에 42% 진행 이벤트를 직접 흘려(브라우저가 보내는 것과 같은 ProgressEvent) 표시를 확인한다.
// 실제 XHR 업로드 진행 이벤트가 필요해 E2E 에 둔다(@platform) — jsdom+MSW 의 XHR 은 upload 진행 이벤트를 흘리지 못한다.
test('단일 파일 업로드 중 버튼에 진행률(%)이 보이고, 끝나면 「업로드」로 돌아온다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
  await expect(btn).toHaveText('업로드 중… 42%')
  resolveUpload()
  await expect(btn).toHaveText('업로드')
})

test('100MB 초과 파일은 업로드 요청 없이 클라이언트에서 안내한다', { tag: '@layout' }, async ({ authenticatedPage: page }, testInfo) => {
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

  await expect(page.getByText('파일 크기가 100MB를 초과합니다.')).toBeVisible()
  expect(uploads.count()).toBe(0)

  // #715 — 에러 토스트가 헤더 툴바(검색/새 폴더/업로드)를 가려 클릭을 막지 않아야 한다.
  const toaster = page.locator('[data-sonner-toaster]')
  await expect(toaster).toHaveAttribute('data-y-position', 'top')
  await expect(page.getByTestId('drive-upload')).toBeInViewport()
  const uploadBox = await page.getByTestId('drive-upload').boundingBox()
  expect(uploadBox).not.toBeNull()
  if (uploadBox) {
    // fixture 의 에러 토스트 포인터 통과 규칙을 걷어내고 실제 화면과 같은 조건에서 히트테스트한다 —
    // 규칙이 남아 있으면 elementFromPoint 가 토스트를 건너뛰어 이 단언이 공허해진다(auth.fixture.ts).
    await page.evaluate(() => document.querySelector('style[data-test-toast-passthrough]')?.remove())
    // 토스트가 진입 위치가 아닌 최종 위치에 자리 잡은 뒤 검사한다.
    await expect(page.locator('[data-sonner-toast]').first()).toHaveAttribute('data-mounted', 'true')
    const centerX = uploadBox.x + uploadBox.width / 2
    const centerY = uploadBox.y + uploadBox.height / 2
    // 토스트가 버튼 위에 겹쳐 있으면 elementFromPoint 가 토스트(li[data-sonner-toast])를 반환한다.
    const coveredByToast = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-sonner-toast]') !== null,
      [centerX, centerY],
    )
    expect(coveredByToast).toBe(false)
  }
})

// WP-95 — 헤더(z-45)가 토스트(z-40) 위에 그려지므로 토스트가 헤더에 걸치면 윗부분이 잘린다.
// 390px 는 Sonner 모바일 규칙(≤600px), 800px 는 Sonner 데스크톱 규칙인데 레이아웃은 모바일(햄버거 영역)인 구간,
// 1280px 는 데스크톱 레이아웃. 세 구간 모두 토스트 상단이 헤더 하단 아래여야 한다.
for (const width of [390, 800, 1280]) {
  test(`폭 ${width}px 에서 토스트가 헤더에 가려 잘리지 않는다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 844 })
    await stubSpaces(page)
    await stubItems(page, () => ({ folders: [], files: [] }))
    // 작은 파일 + 업로드 400 → 에러 토스트. 위치만 보면 되므로 가장 가벼운 토스트 경로를 쓴다.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ status: 400, message: '업로드 실패' }) })
          : route.fallback(),
    )

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-page')).toBeVisible()
    await page.getByTestId('file-input').setInputFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })

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
  // 파일 행 액션은 group-hover 로만 표시되는 래퍼(display 토글) — 호버 전에는 숨김.
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
