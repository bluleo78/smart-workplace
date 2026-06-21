// 드라이브 폴더 드래그앤드롭 업로드 E2E — webkitGetAsEntry 트리를 dispatchEvent 로 주입.
import type { Page } from '@playwright/test'

import { createSpace, personalSpace } from '../factories/drive.factory'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1

// 공간 목록(개인 + 팀) — DriveSidebar 가 마운트 시 페치한다.
async function stubSpaces(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace(), createSpace()]),
          })
        : route.fallback(),
  )
}

test.describe('드라이브 폴더 업로드', () => {
  test('폴더 드롭 시 resolveFolder + uploadFile 을 호출한다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page)
    // 항목 목록 — 드롭 후 reload 시 재조회된다.
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [] }),
            })
          : route.fallback(),
    )

    const calls: string[] = []
    await page.route('**/api/v1/drive/spaces/*/folders/resolve', async (route) => {
      calls.push('resolve')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 99, parentId: null, name: 'docs', createdAt: '2026-06-21T00:00:00Z' }),
      })
    })
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/files`, async (route) => {
      if (route.request().method() === 'POST') {
        calls.push('upload')
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
      } else {
        await route.fallback()
      }
    })

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    // drive-page 가 보여야 dropzone 에 접근 가능하다.
    await expect(page.getByTestId('drive-page')).toBeVisible({ timeout: 15000 })

    // Playwright 는 실제 OS 폴더 드롭 불가. DataTransfer 에 실제 파일을 추가하고
    // DataTransferItem.prototype.webkitGetAsEntry 를 잠시 패치해 가짜 디렉터리 엔트리 반환.
    // DataTransfer.items 는 read-only 이지만 dt.items.add() 는 쓰기 가능 → 실제 아이템 존재.
    await page.getByTestId('drive-dropzone').evaluate((el) => {
      let served = false
      const fileEnt = {
        isFile: true,
        isDirectory: false,
        name: 'a.txt',
        file: (cb: (f: File) => void) => cb(new File(['x'], 'a.txt')),
      }
      const dirEnt = {
        isFile: false,
        isDirectory: true,
        name: 'docs',
        createReader: () => ({
          readEntries: (cb: (e: unknown[]) => void) => {
            // served 플래그를 cb 호출 전에 먼저 세팅해야 한다.
            // cb 내부에서 next() → readEntries 를 동기 재진입하면 served 가 false 로 남아 무한 루프 발생.
            const batch = served ? [] : [fileEnt]
            served = true
            cb(batch)
          },
        }),
      }

      // 실제 DataTransfer 에 파일을 추가 → items.length === 1 (real, not read-only issue).
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'a.txt'))

      // DataTransferItem 인스턴스 프로토타입의 webkitGetAsEntry 를 가짜 디렉터리를 반환하도록 교체.
      const item0 = dt.items[0]
      const itemProto = Object.getPrototypeOf(item0) as { webkitGetAsEntry?: () => unknown }
      const origGetEntry = itemProto.webkitGetAsEntry
      itemProto.webkitGetAsEntry = () => dirEnt

      el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))

      // readDroppedTree 는 onDrop(async) 의 첫 동기 구간에서 webkitGetAsEntry 를 호출한다.
      // React 19 의 이벤트 위임은 dispatchEvent 와 같은 콜스택에서 핸들러를 실행하므로
      // getEntry 참조는 여기서 이미 캡처된다. 패치는 즉시 복구해도 안전.
      itemProto.webkitGetAsEntry = origGetEntry
    })

    // resolveFolder(docs) + uploadFile(docs/a.txt) 가 호출되어야 한다.
    await expect.poll(() => calls, { timeout: 10000 }).toContain('resolve')
    await expect.poll(() => calls, { timeout: 10000 }).toContain('upload')
  })
})
