import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

// 첨부 미리보기: 이미지 첨부를 모달로 열고, downloadUrl 콘텐츠를 요청하며,
// 드라이브 전용 패널(AI 요약)이 노출되지 않는지 확인.
test('첨부 이미지 미리보기 — downloadUrl 콘텐츠 요청 + 드라이브 요약 패널 미노출', async ({ authenticatedPage: page }) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const contents = trackRequests(page, 'ANY', '/api/v1/projects/PROJ/issues/1/attachments/77/content')

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
  await page.route('**/api/v1/projects/PROJ/issues/1/attachments/77/content', (r) =>
    r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') }),
  )

  await page.goto('/drive/attachments')
  // 파일명 클릭 → 미리보기 모달
  await page.getByRole('button', { name: 'shot.png' }).click()
  await expect(page.getByTestId('preview-body')).toBeVisible()
  await expect(page.getByTestId('preview-body').locator('img')).toBeVisible()
  // 첨부 콘텐츠 경로가 요청됐는지
  expect(contents.count()).toBeGreaterThan(0)
  // 드라이브 전용 패널 미노출
  await expect(page.getByTestId('drive-summary-card')).toHaveCount(0)
  await expect(page.getByTestId('file-backlinks')).toHaveCount(0)
})

// WP-277: 묶음 = 클릭한 첨부가 속한 출처 그룹(같은 이슈·같은 메시지). ‹ › 는 그 그룹 안에서만 움직이고
// 순번(n / m)도 그 그룹의 개수를 센다 — 다른 출처 첨부로 넘어가지 않는다.
test('첨부 모아보기 — ‹ › 는 같은 출처 그룹 안에서만 이동하고 순번은 그룹 개수', async ({ authenticatedPage: page }) => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const att = (fileId: number, name: string, sourceType: 'ISSUE' | 'MESSAGE', label: string, link: string, url: string) => ({
    fileId, name, mimeType: 'image/png', sizeBytes: 100, hasThumbnail: false,
    sourceType, sourceLabel: label, deepLink: link, downloadUrl: url, attachedAt: '2026-07-01T10:00:00Z',
  })
  await page.route('**/api/v1/drive/spaces', (r) => r.fulfill({ json: [{ id: 1, name: '내 드라이브', type: 'PERSONAL' }] }))
  await page.route('**/api/v1/drive/attachments**', (r) =>
    r.fulfill({
      json: {
        items: [
          att(1, 'a1.png', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/1/content'),
          att(2, 'a2.png', 'ISSUE', 'PROJ-1 제목', '/projects/PROJ/issues/1', '/api/v1/projects/PROJ/issues/1/attachments/2/content'),
          att(3, 'm1.png', 'MESSAGE', '#general', '/chat/channels/5', '/api/v1/messaging/channels/5/messages/9/attachments/3/content'),
        ],
        nextCursor: null,
      },
    }),
  )
  await page.route('**/api/v1/drive/files/*/thumbnail', (r) => r.fulfill({ status: 404 }))
  await page.route(/\/attachments\/\d+\/content$/, (r) =>
    r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') }),
  )

  await page.goto('/drive/attachments')
  await page.getByRole('button', { name: 'a1.png' }).click()
  const viewer = page.getByTestId('attachment-viewer')
  await expect(viewer).toBeVisible()
  await expect(page.getByTestId('preview-meta')).toContainText('1 / 2')
  await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
  await page.getByRole('button', { name: '다음 파일' }).click()
  await expect(page.getByTestId('preview-meta')).toContainText('2 / 2')
  // 그룹의 끝 — 다음 그룹(메시지 첨부)으로 넘어가지 않는다.
  await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(viewer).toHaveCount(0)

  // 메시지 그룹은 1건 — ‹ › 없음
  await page.getByRole('button', { name: 'm1.png' }).click()
  await expect(viewer).toBeVisible()
  await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0)
})
