// 드라이브 업로드 → 다른 메뉴로 이동 → 완료 → 드라이브로 복귀 E2E (WP-1534).
// 여러 화면(드라이브 ↔ 프로젝트)을 오가는 흐름이라 E2E 로 둔다(@flow) — 업로드 큐·패널이 앱 전역(Provider·AppLayout)에 있어
// 라우트가 바뀌어도 진행 중인 업로드와 패널이 이어지는지는 실제 라우터·셸이 함께 있어야 판정된다.
// 큐 상태 전이·패널 표시·페이지 구독 자체는 src/components/drive/upload/driveUploadProvider.test.tsx 와
// src/pages/drive/drivePage.test.tsx 가 vitest 로 지킨다.
import type { Page, Route } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록(개인 + 팀) — drive.spec.ts 의 stubSpaces 와 같은 모양. 개인 공간을 SPACE_ID 로 두어 드라이브 메뉴 복귀 착지(개인 공간)가 같은 공간이 되게 한다.
async function stubSpaces(page: Page) {
  const fulfillGet = (body: unknown) => (route: Route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fallback()
  await page.route((url) => url.pathname === '/api/v1/drive/spaces', fulfillGet([personalSpace({ id: SPACE_ID }), createSpace({ id: 2 })]))
}

// 항목 목록 — 가변 상태를 클로저로 흉내(업로드 완료 뒤 파일 추가).
function stubItems(page: Page, getState: () => { folders: unknown[]; files: unknown[] }) {
  return page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getState()) })
        : route.fallback(),
  )
}

test('업로드 중 다른 메뉴로 가도 패널이 이어지고, 끝난 뒤 드라이브에서 파일이 보인다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
  // 업로드 XHR(FormData)에 42% 진행 이벤트를 흘린다 — 라우트 가로채기에선 실제 진행 이벤트가 안 나온다(drive.spec.ts 와 같은 방식).
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
  const state = { folders: [] as unknown[], files: [] as unknown[] }
  await stubSpaces(page)
  await stubItems(page, () => state)
  // 업로드 응답은 테스트가 풀 때까지 붙잡는다 — 다른 메뉴에 가 있는 동안 업로드가 진행 중이어야 한다.
  let resolveUpload!: () => void
  const held = new Promise<void>((r) => (resolveUpload = r))
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/files`,
    async (route) => {
      await held
      const file = createFile({ id: 90, name: 'big.pdf' })
      state.files = [file]
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(file) })
    },
  )
  // 프로젝트 화면이 부르는 목록 — 모킹 누락은 503 토스트로 흐름을 흐리므로 빈 성공으로 막는다.
  await page.route(
    (url) => url.pathname === '/api/v1/projects',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible()
  await page.getByTestId('file-input').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(1024) })
  const panel = page.getByTestId('drive-upload-panel')
  const row = panel.getByTestId('drive-upload-row')
  await expect(row).toHaveAttribute('data-status', 'uploading')

  // 다른 메뉴로 이동 — 드라이브 화면이 사라져도 패널과 진행률이 남아야 한다.
  await page.getByTestId('rail-link-/projects').click()
  await expect(page).toHaveURL(/\/projects/)
  await expect(page.getByTestId('drive-page')).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(row).toHaveAttribute('data-status', 'uploading')
  await expect(row).toContainText('42%')

  // 다른 메뉴에 있는 채로 업로드가 끝난다.
  resolveUpload()
  await expect(panel).toContainText('1개 업로드 완료')

  // 드라이브로 돌아오면(개인 공간으로 착지) 새 파일이 목록에 있고 업로드 단추가 활성이다.
  await page.getByTestId('rail-link-/drive').click()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}`))
  await expect(page.getByRole('button', { name: 'big.pdf' })).toBeVisible()
  const btn = page.getByTestId('drive-upload')
  await expect(btn).toHaveText('업로드')
  await expect(btn).toBeEnabled()
})
