import type { DriveFile, DriveSpace } from '../../../src/types/drive'
import { expect, test } from '../../fixtures/auth.fixture'

/**
 * #735 요약 카드 사유 표시. /summary 응답의 reason 필드를 라우트 모킹으로 제어해
 * SKIPPED(사유 표시) / PENDING(스켈레톤) / DONE(요약 본문) / PENDING 폴링 상한 초과(지연 안내)
 * 4 상태를 검증한다.
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
test('SKIPPED(사유 있음) → 클릭 없이 카드가 기본 펼침, 사유 평문 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({
      json: { summary: null, status: 'SKIPPED', reason: '이 형식은 텍스트 추출을 지원하지 않습니다.' },
    }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await expect(card).toHaveJSProperty('open', true)
  await expect(page.getByTestId('drive-summary-reason')).toHaveText(
    '이 형식은 텍스트 추출을 지원하지 않습니다.',
  )
})

test('PENDING → 스켈레톤 표시(폴링 상한 이전)', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'PENDING', reason: null } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await card.locator('summary').click()
  await expect(page.getByTestId('drive-summary-loading')).toBeVisible()
})

// #735: 워커 미가동 등으로 status 가 영원히 PENDING 이면(V124 백필 재개방 행 포함),
// IN_PROGRESS_POLLS(40회 = 3초×40 ≈ 2분) 를 넘긴 뒤 스켈레톤 대신 지연 안내로 전환해야 한다.
// 실시간 2분 대기 대신 page.clock 으로 react-query refetchInterval 타이머를 가상 시간에서 진행시킨다.
// (검증됨: clock.fastForward(3000) 1회당 /summary 요청이 정확히 1회씩 발생 — Date.now() 도
// 함께 가상화되어 tanstack-query 의 refetchInterval 스케줄링과 어긋나지 않는다.)
test('PENDING 무한 지속 → 폴링 상한 초과 시 지연 안내로 전환', async ({ authenticatedPage: page }) => {
  await page.clock.install()
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: null, status: 'PENDING', reason: null } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await card.locator('summary').click()
  await expect(page.getByTestId('drive-summary-loading')).toBeVisible()

  // IN_PROGRESS_POLLS(40) 회에 도달할 때까지 3초씩 40회 전진 — 매 tick 마다 실제 fetch 가
  // 완료될 시간(waitForTimeout)을 real time 으로 짧게 준다(클록은 setTimeout/Date 만 가상화하고
  // 네트워크 응답의 마이크로태스크 처리는 실제 이벤트 루프 틱이 필요하기 때문).
  for (let i = 0; i < 40; i++) {
    await page.clock.fastForward(3000)
    await page.waitForTimeout(30)
  }

  await expect(page.getByTestId('drive-summary-reason')).toHaveText(
    '요약 생성이 지연되고 있습니다. 잠시 후 다시 열어 주세요.',
  )
  await expect(page.getByTestId('drive-summary-loading')).toHaveCount(0)
})

test('DONE → 요약 본문 표시', async ({ authenticatedPage: page }) => {
  await setupDrive(page)
  await page.route('**/api/v1/drive/files/*/summary', (route) =>
    route.fulfill({ json: { summary: '요약 본문', status: 'DONE', reason: null } }),
  )
  await openPreview(page)
  const card = page.getByTestId('drive-summary-card')
  await expect(card).toBeVisible()
  await card.locator('summary').click()
  await expect(card).toContainText('요약 본문')
  await expect(page.getByTestId('drive-summary-reason')).toHaveCount(0)
})
