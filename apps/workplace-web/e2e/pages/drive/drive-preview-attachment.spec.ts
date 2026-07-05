import { expect, test } from '../../fixtures/auth.fixture'

// 첨부 미리보기: 이미지 첨부를 모달로 열고, downloadUrl 콘텐츠를 요청하며,
// 드라이브 전용 패널(AI 요약)이 노출되지 않는지 확인.
test('첨부 이미지 미리보기 — downloadUrl 콘텐츠 요청 + 드라이브 요약 패널 미노출', async ({ authenticatedPage: page }) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  let contentRequested = false

  await page.route('**/api/v1/drive/spaces', (r) =>
    r.fulfill({ json: [{ id: 1, name: '내 드라이브', type: 'PERSONAL' }] }),
  )
  await page.route('**/api/v1/drive/attachments**', (r) =>
    r.fulfill({
      json: {
        items: [
          {
            fileId: 77,
            name: 'shot.png',
            mimeType: 'image/png',
            sizeBytes: 1234,
            hasThumbnail: true,
            sourceType: 'ISSUE',
            sourceLabel: 'PROJ-1 제목',
            deepLink: '/projects/PROJ/issues/1',
            downloadUrl: '/api/v1/projects/PROJ/issues/1/attachments/77/content',
            attachedAt: '2026-07-01T10:00:00Z',
          },
        ],
        nextCursor: null,
      },
    }),
  )
  // 썸네일 404(없음 처리)
  await page.route('**/api/v1/drive/files/77/thumbnail', (r) => r.fulfill({ status: 404 }))
  // 첨부 콘텐츠(downloadUrl) — 미리보기가 이 경로를 요청해야 한다.
  await page.route('**/api/v1/projects/PROJ/issues/1/attachments/77/content', (r) => {
    contentRequested = true
    r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') })
  })

  await page.goto('/drive/attachments')
  // 파일명 클릭 → 미리보기 모달
  await page.getByRole('button', { name: 'shot.png' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
  // 첨부 콘텐츠 경로가 요청됐는지
  expect(contentRequested).toBe(true)
  // 드라이브 전용 패널 미노출
  await expect(page.getByTestId('drive-summary-card')).toHaveCount(0)
  await expect(page.getByTestId('file-backlinks')).toHaveCount(0)
})
