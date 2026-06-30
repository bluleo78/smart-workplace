import { expect, test } from '../fixtures/auth.fixture'

function page2() {
  return {
    items: [
      {
        fileId: 1, name: 'design.png', mimeType: 'image/png', sizeBytes: 2100, hasThumbnail: true,
        sourceType: 'ISSUE', sourceLabel: 'PROJ-123 제목', deepLink: '/projects/PROJ/issues/123',
        downloadUrl: '/api/v1/projects/PROJ/issues/123/attachments/1/content', attachedAt: '2026-07-01T12:00:00Z',
      },
      {
        fileId: 2, name: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 840, hasThumbnail: false,
        sourceType: 'ISSUE', sourceLabel: 'PROJ-123 제목', deepLink: '/projects/PROJ/issues/123',
        downloadUrl: '/api/v1/projects/PROJ/issues/123/attachments/2/content', attachedAt: '2026-07-01T11:00:00Z',
      },
      {
        fileId: 3, name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1200, hasThumbnail: false, sourceType: 'MESSAGE', sourceLabel: '#general', deepLink: '/chat/channels/5',
        downloadUrl: '/api/v1/messaging/channels/5/messages/9/attachments/3/content', attachedAt: '2026-07-01T10:00:00Z',
      },
    ],
    nextCursor: null,
  }
}

// 주의(브리프 대비 변경): 브리프 원안은 `test.beforeEach(async ({ page }) => ...)` +
// 각 테스트 `async ({ page }) => ...` 였으나, 이 저장소의 인증 fixture(auth.fixture.ts)는
// 기본 `page` 를 미인증 상태로 두고 `authenticatedPage` 에서 로그인 모킹을 수행한다.
// beforeEach 의 `page` 와 테스트의 `authenticatedPage` 는 별도 인스턴스가 아니라 같은 Page 위에
// 라우트가 등록되는 순서(LIFO)만 다르므로, 혼용 대신 각 테스트에서 `authenticatedPage` 를 직접 쓰고
// 공통 라우트는 헬퍼 함수로 추출했다.
async function stubAttachments(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/drive/spaces', (r) =>
    r.fulfill({ json: [{ id: 1, name: '내 드라이브', type: 'PERSONAL' }] }),
  )
  await page.route('**/api/v1/drive/attachments**', (r) => r.fulfill({ json: page2() }))
  await page.route('**/api/v1/drive/files/*/thumbnail', (r) => r.fulfill({ status: 404 }))
}

test('출처 위치별 그룹: 같은 이슈 첨부는 한 그룹, 채널은 별도 그룹', async ({ authenticatedPage: page }) => {
  await stubAttachments(page)
  await page.goto('/drive/attachments')
  const groups = page.getByTestId('drive-attachment-group')
  await expect(groups).toHaveCount(2)
  // 첫 그룹 = 이슈(최신), 라벨 딥링크
  await expect(groups.nth(0).getByRole('link', { name: 'PROJ-123 제목' })).toHaveAttribute('href', '/projects/PROJ/issues/123')
  await expect(groups.nth(0).getByTestId('drive-attachment-row-1')).toBeVisible()
  await expect(groups.nth(0).getByTestId('drive-attachment-row-2')).toBeVisible()
  // 둘째 그룹 = 채널
  await expect(groups.nth(1).getByRole('link', { name: '#general' })).toHaveAttribute('href', '/chat/channels/5')
  await expect(groups.nth(1).getByTestId('drive-attachment-row-3')).toBeVisible()
})

test('셰브론 토글로 그룹 접힘/펼침', async ({ authenticatedPage: page }) => {
  await stubAttachments(page)
  await page.goto('/drive/attachments')
  const firstGroup = page.getByTestId('drive-attachment-group').nth(0)
  await expect(firstGroup.getByTestId('drive-attachment-row-1')).toBeVisible()
  await firstGroup.getByTestId('drive-attachment-group-toggle').click()
  await expect(firstGroup.getByTestId('drive-attachment-row-1')).toHaveCount(0)
  await firstGroup.getByTestId('drive-attachment-group-toggle').click()
  await expect(firstGroup.getByTestId('drive-attachment-row-1')).toBeVisible()
})

test('이슈/채널 불가 액션 미노출 — 공유/버전/이동/복사/삭제/체크박스 없음', async ({ authenticatedPage: page }) => {
  await stubAttachments(page)
  await page.goto('/drive/attachments')
  const row = page.getByTestId('drive-attachment-row-1')
  await expect(row.getByRole('button', { name: '공유 링크' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '버전 이력' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '이동' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '복사' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '삭제' })).toHaveCount(0)
  await expect(row.locator('input[type="checkbox"]')).toHaveCount(0)
  // 노출돼야 하는 것: 저장, (호버) 다운로드
  await expect(row.getByTestId('drive-attachment-save-1')).toBeVisible()
})

test('다운로드 액션은 downloadUrl(첨부 콘텐츠 경로)을 요청', async ({ authenticatedPage: page }) => {
  await stubAttachments(page)
  let downloadReq = false
  await page.route('**/api/v1/projects/PROJ/issues/123/attachments/1/content', (r) => {
    downloadReq = true
    r.fulfill({ contentType: 'image/png', body: Buffer.from('x') })
  })
  await page.goto('/drive/attachments')
  const row = page.getByTestId('drive-attachment-row-1')
  await row.hover()
  await row.getByTestId('drive-attachment-download-1').click({ force: true })
  await expect.poll(() => downloadReq).toBe(true)
})
