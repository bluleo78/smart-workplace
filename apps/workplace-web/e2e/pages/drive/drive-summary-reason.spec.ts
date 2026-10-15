import type { DriveFile, DriveSpace } from '../../../src/types/drive'
import { expect, test } from '../../fixtures/auth.fixture'

/**
 * #735 요약 카드 사유 표시. /summary 응답의 reason 필드를 라우트 모킹으로 제어해
 * 서버 사유가 평문 그대로 카드에 닿는지(SKIPPED) 검증한다.
 * 상태→표시 판정(스켈레톤·지연 안내·폴백 문구)과 폴링 상한(40회)은 src/lib/driveSummary.test.ts 가 맡는다(WP-410) —
 * 상한 초과 지연 안내는 40회 왕복이 필요해 E2E 로는 수 초가 걸렸다. 스켈레톤·DONE 표시는 drive-preview-summary.spec 이 본다.
 * drive-preview-summary.spec 의 셋업(Office 파일, drive-content-search.spec 미러)을 그대로 따른다.
 */

async function setupDrive(page: import('@playwright/test').Page) {
  const spaces: DriveSpace[] = [
    { id: 1, name: '내 드라이브', type: 'PERSONAL', archived: false } as DriveSpace,
  ]
  const file: DriveFile = {
    id: 1,
    folderId: null,
    fileId: 10,
    name: '압축.zip',
    mimeType: 'application/zip',
    sizeBytes: 1024,
    category: 'OTHER', // IMAGE/PDF/TEXT 아님 → 미리보기 불가 → blob/text 페치 없음
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    versionCount: 1,
    // #739: 원본 blob 정상 존재 — 유실 배지/클릭 차단 대상이 아님(요약 사유 표시가 이 스펙의 관심사).
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
  await page.route('**/api/v1/drive/files/1/backlinks', (route) => route.fulfill({ json: [] }))
}

async function openPreview(page: import('@playwright/test').Page) {
  await page.goto('/drive')
  await page.waitForURL(/drive\/spaces\/\d+/)
  await page.getByRole('button', { name: '압축.zip' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
}

// #735: 요약 불가는 기본 펼침(defaultOpen=summaryUnavailable) — 클릭 없이 바로 사유가 보여야
// "왜 요약이 없는지" 를 숨기지 않는다는 계약을 검증한다. click() 을 넣으면 접힌 상태에서도
// 통과해버려 이 회귀를 못 잡는다.
test('SKIPPED(사유 있음) → 클릭 없이 카드가 보임, 사유 평문 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({
      json: { summary: null, status: 'SKIPPED', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' },
    }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('drive-summary-reason')).toHaveText(
    '이 형식은 텍스트 추출을 지원하지 않습니다.',
  )
})
