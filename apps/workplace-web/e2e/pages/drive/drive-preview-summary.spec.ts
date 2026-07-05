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
    versionCount: 1,
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

test('요약 DONE → 카드 표시(기본 접힘, 클릭 시 펼침)', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: '이 문서의 핵심 요약입니다.', status: 'DONE' } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  // chevron affordance 존재.
  await expect(page.locator('[data-testid="drive-summary-card"] > summary .lucide-chevron-right')).toBeVisible()
  // 기본 접힘: <details> open=false.
  await expect(card).toHaveJSProperty('open', false)
  // 헤더 클릭 → 펼쳐져 요약 본문 노출.
  await card.locator('summary').click()
  await expect(card).toHaveJSProperty('open', true)
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
  await card.locator('summary').click()
  // 파싱된 heading 요소로 렌더 — 원시 '#' 기호가 텍스트로 남지 않아야 한다.
  const heading = card.getByRole('heading', { name: '파일 요약: 문서.docx' })
  await expect(heading).toBeVisible()
  await expect(card).not.toContainText('# 파일 요약')
})

test('추출 진행중 → 펼치면 스켈레톤 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'EXTRACTING' } }),
  )
  await openPreview(page)
  // 접힘 상태에선 스켈레톤 비노출.
  await expect(page.getByTestId('drive-summary-loading')).toBeHidden()
  // 펼치면 스켈레톤 노출.
  await page.getByTestId('drive-summary-card').locator('summary').click()
  await expect(page.getByTestId('drive-summary-loading')).toBeVisible()
})

test('요약 없음 → 카드 숨김', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED' } }),
  )
  await openPreview(page)
  await expect(page.getByTestId('drive-summary-card')).toHaveCount(0)
})

test('다운로드 버튼이 상단 헤더에 있다', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'SKIPPED' } }),
  )
  await openPreview(page)
  // 헤더에 다운로드 버튼이 존재.
  const download = page.getByRole('button', { name: '다운로드' })
  await expect(download).toBeVisible()
  // 단순 존재가 아니라 '미리보기 본문보다 DOM 상위(헤더)' 배치를 검증 — 핵심 요구.
  const beforePreview = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '다운로드')
    const body = document.querySelector('[data-testid="preview-body"]')
    if (!btn || !body) return false
    // body 가 btn 을 뒤따르면(FOLLOWING) btn 이 더 앞 = 헤더 위치.
    return Boolean(btn.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  expect(beforePreview).toBe(true)
})
