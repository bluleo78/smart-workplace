import type { DriveFile, DriveSpace } from '../../../src/types/drive'
import { expect, test } from '../../fixtures/auth.fixture'

/**
 * #526 미리보기 패널 요약 카드. /summary 응답을 라우트 모킹으로 제어해
 * DONE→요약 표시 / 진행중→스켈레톤 / 없음→숨김 3 상태를 검증한다.
 * Office(미리보기 불가) 파일로 진입해 추가 콘텐츠 페치 모킹 없이 카드만 검증.
 */

// 드라이브 진입에 필요한 공통 모킹(drive-content-search.spec 미러) + Office 파일 1개.
async function setupDrive(page: import('@playwright/test').Page) {
  const spaces: DriveSpace[] = [
    { id: 1, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  const file: DriveFile = {
    id: 1,
    folderId: null,
    fileId: 10,
    name: '문서.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    sizeBytes: 1024,
    category: 'WORD', // IMAGE/PDF/TEXT 아님 → 미리보기 불가 → blob/text 페치 없음
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    versionCount: 1,
    available: true,
  }
  await page.route('**/api/v1/drive/spaces', (route) => route.fulfill({ json: spaces }))
  await page.route('**/api/v1/drive/spaces/1', (route) => route.fulfill({ json: spaces[0] }))
  await page.route('**/api/v1/drive/spaces/1/items**', (route) =>
    route.fulfill({ json: { folders: [], files: [file] } }),
  )
  await page.route('**/api/v1/drive/quota', (route) =>
    route.fulfill({ json: { usedBytes: 0, quotaBytes: 10737418240 } }),
  )
  // backlinks(참조된 곳) — 모달이 호출. 빈 배열로 안정화.
  await page.route('**/api/v1/drive/files/1/backlinks', (route) => route.fulfill({ json: [] }))
}

async function openPreview(page: import('@playwright/test').Page) {
  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)
  await page.getByRole('button', { name: '문서.docx' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

test('요약 DONE → 패널에 카드가 기본 펼침으로 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: '이 문서의 핵심 요약입니다.', status: 'DONE' } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  // WP-277: 카드는 접힘 없이 사이드 패널에 항상 펼쳐져 있다(패널 자체가 토글).
  await expect(page.getByTestId('viewer-side-panel').getByTestId('drive-summary-card')).toBeVisible()
  await expect(card).toContainText('핵심 요약')
})

test('요약에 마크다운 헤딩 포함 → 원시 기호(#) 대신 파싱된 heading 렌더 (#633)', async ({
  authenticatedPage: page,
}) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: '# 파일 요약: 문서.docx\n\n본문 내용입니다.', status: 'DONE' } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  // 파싱된 heading 요소로 렌더 — 원시 '#' 기호가 텍스트로 남지 않아야 한다.
  const heading = card.getByRole('heading', { name: '파일 요약: 문서.docx' })
  await expect(heading).toBeVisible()
  await expect(card).not.toContainText('# 파일 요약')
})

test('추출 진행중 → 스켈레톤 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'EXTRACTING' } }),
  )
  await openPreview(page)
  // 패널이 기본 펼침이라 클릭 없이 스켈레톤이 보인다.
  await expect(page.getByTestId('drive-summary-loading')).toBeVisible()
})

// #735: SKIPPED 는 이제 카드를 숨기지 않고 사유를 보여준다 — reason 미지정 시 폴백 문구.
// 요약 불가 카드는 기본 펼침이라 클릭 없이도 사유가 바로 보여야 한다.
test('요약 불가(SKIPPED, reason 없음) → 클릭 없이 사유 표시, 폴백 문구 표시', async ({
  authenticatedPage: page,
}) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED', reason: null } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('drive-summary-reason')).toHaveText('요약을 사용할 수 없습니다.')
})

test('다운로드 버튼이 상단 헤더에 있다', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED' } }),
  )
  await openPreview(page)
  // 헤더에 다운로드 버튼이 존재.
  // (콘텐츠 stub 이 없어 본문이 오류 화면이면 거기에도 '다운로드' 버튼이 있으므로 헤더로 한정한다.)
  const download = page.getByRole('dialog').locator('header').getByRole('button', { name: '다운로드', exact: true })
  await expect(download).toBeVisible()
  // 단순 존재가 아니라 '미리보기 본문보다 DOM 상위(헤더)' 배치를 검증 — 핵심 요구.
  const beforePreview = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="preview-download"]')
    const body = document.querySelector('[data-testid="preview-body"]')
    if (!btn || !body) return false
    // body 가 btn 을 뒤따르면(FOLLOWING) btn 이 더 앞 = 헤더 위치.
    return Boolean(btn.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(beforePreview).toBe(true)
})

// WP-274: 다운로드는 ghost 아이콘 버튼(툴팁·aria-label), 닫기 X 는 같은 액션 줄, 헤더에 "형식 · 크기" 줄.
test('헤더 — 형식·크기 표시, 아이콘 다운로드(툴팁)·닫기가 한 줄에 정렬', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED' } }),
  )
  let downloadRequested = false
  await page.route('**/api/v1/drive/files/1/download', (route) => {
    downloadRequested = true
    return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'x' })
  })
  await openPreview(page)
  const dialog = page.getByRole('dialog')

  // 열자마자 툴팁이 뜨지 않는다(첫 포커스가 다운로드 버튼으로 가면 툴팁이 첫 Escape 를 먹어 모달이 안 닫혔다).
  await expect(page.getByRole('tooltip')).toHaveCount(0)

  // 파일명 아래 보조 줄: 크기(묶음이 2건 이상이면 " · n / m" 카운터가 붙는다 — WP-277 뷰어 헤더. 확장자는 파일명·아이콘이 이미 알린다).
  await expect(dialog.getByTestId('preview-meta')).toHaveText('1.0 KB')

  // 다운로드는 글자 없는 아이콘 버튼 — 접근성 이름은 aria-label 로 유지된다.
  // 본문 오류 화면(콘텐츠 stub 없음)에도 '다운로드' 버튼이 있어 헤더로 한정한다.
  const download = dialog.locator('header').getByRole('button', { name: '다운로드', exact: true })
  await expect(download).toBeVisible()
  await expect(download).toHaveText('')
  // 강조(primary 채움) 버튼이 아니어야 한다 — 시선이 문서보다 버튼에 먼저 가던 문제.
  await expect(download).not.toHaveClass(/bg-primary/)

  // 호버 시 툴팁으로 의미를 알린다.
  await download.hover()
  await expect(page.getByRole('tooltip')).toHaveText('다운로드')

  // 닫기 X 는 기본 코너 버튼 대신 헤더 액션 줄에 하나만 있고, 다운로드와 세로 중심이 맞는다.
  const close = dialog.getByRole('button', { name: '닫기', exact: true })
  await expect(close).toHaveCount(1)
  const [d, c] = await Promise.all([download.boundingBox(), close.boundingBox()])
  expect(d && c).toBeTruthy()
  expect(Math.abs(d!.y + d!.height / 2 - (c!.y + c!.height / 2))).toBeLessThanOrEqual(1)
  expect(c!.x).toBeGreaterThan(d!.x)

  // 클릭 → 실제 다운로드 요청.
  await download.click()
  await expect.poll(() => downloadRequested).toBe(true)

  // 닫기 → 모달이 닫힌다.
  await close.click()
  await expect(page.getByTestId('preview-body')).toHaveCount(0)
})
