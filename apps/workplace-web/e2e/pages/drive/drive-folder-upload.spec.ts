// 드라이브 폴더 드래그앤드롭 업로드 E2E — webkitGetAsEntry 트리를 dispatchEvent 로 주입.
import type { Page } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

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

test.describe('드라이브 폴더 업로드', { tag: '@input' }, () => {
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

    const resolves = trackRequests(page, 'ANY', /^\/api\/v1\/drive\/spaces\/[^/]+\/folders\/resolve$/)
    const uploads = trackRequests(page, 'POST', `/api/v1/drive/spaces/${SPACE_ID}/files`)
    await page.route('**/api/v1/drive/spaces/*/folders/resolve', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 99, parentId: null, name: 'docs', createdAt: '2026-06-21T00:00:00Z' }),
      })
    })
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/files`, async (route) => {
      if (route.request().method() === 'POST') {
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
    await resolves.waitFor(1, { timeout: 10000 })
    await uploads.waitFor(1, { timeout: 10000 })
  })
})

// 중첩 폴더 트리(디자인/녹화/a.mp4, 디자인/시안/b.png)를 놓은 것처럼 드롭 이벤트를 주입한다.
async function dropNestedTree(page: Page) {
  await page.getByTestId('drive-dropzone').evaluate((el) => {
    const file = (name: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (cb: (f: File) => void) => cb(new File(['x'], name)),
    })
    // 한 번만 자식을 돌려주고 이후엔 빈 배열 — readAll 이 빈 배열이 올 때까지 반복하므로.
    const dir = (name: string, children: unknown[]) => {
      let served = false
      return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
          readEntries: (cb: (e: unknown[]) => void) => {
            const batch = served ? [] : children
            served = true
            cb(batch)
          },
        }),
      }
    }
    const root = dir('디자인', [dir('녹화', [file('a.mp4')]), dir('시안', [file('b.png')])])
    const dt = new DataTransfer()
    dt.items.add(new File(['x'], 'a.mp4'))
    const itemProto = Object.getPrototypeOf(dt.items[0]) as { webkitGetAsEntry?: () => unknown }
    const orig = itemProto.webkitGetAsEntry
    itemProto.webkitGetAsEntry = () => root
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    itemProto.webkitGetAsEntry = orig
  })
}

// 폴더 드롭 업로드 화면 공통 준비 — 목록·resolve 는 즉시, 파일 업로드는 호출마다 풀어 줄 때까지 붙잡는다.
async function setupHeldUploads(page: Page) {
  await stubSpaces(page)
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files: [] }) })
        : route.fallback(),
  )
  await page.route('**/api/v1/drive/spaces/*/folders/resolve', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 99, parentId: null, name: 'x', createdAt: '2026-06-21T00:00:00Z' }),
    }),
  )
  const releases: Array<() => void> = []
  await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/files`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await new Promise<void>((resolve) => releases.push(resolve))
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
  })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await expect(page.getByTestId('drive-page')).toBeVisible({ timeout: 15000 })
  return releases
}

test.describe('드라이브 업로드 패널 — 폴더 드롭', { tag: '@input' }, () => {
  test('하위 폴더의 파일마다 경로가 달린 행이 보이고 끝나면 2개 업로드 완료', async ({ authenticatedPage: page }) => {
    const releases = await setupHeldUploads(page)
    await dropNestedTree(page)

    const rows = page.getByTestId('drive-upload-row')
    // 순차 업로드 — 첫 파일이 올라가는 중일 때 행 하나와 그 하위 폴더 경로.
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('a.mp4')
    await expect(rows.first()).toContainText('디자인 / 녹화')
    await expect.poll(() => releases.length).toBe(1)
    releases[0]()

    // 첫 파일 완료 + 둘째 파일 진행 — 행마다 자기 경로를 보인다.
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('디자인 / 녹화')
    await expect(rows.nth(1)).toContainText('b.png')
    await expect(rows.nth(1)).toContainText('디자인 / 시안')
    await expect.poll(() => releases.length).toBe(2)
    releases[1]()

    await expect(page.getByTestId('drive-upload-panel')).toContainText('2개 업로드 완료')
  })
})

test.describe('드라이브 업로드 패널 — 데스크톱 배치', { tag: '@layout' }, () => {
  test('오른쪽·아래 여백 16px 안팎, 폭 320px', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const releases = await setupHeldUploads(page)
    await dropNestedTree(page)

    const panel = page.getByTestId('drive-upload-panel')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    const vp = page.viewportSize()!
    expect(Math.abs(box!.width - 320)).toBeLessThanOrEqual(8)
    expect(Math.abs(vp.width - (box!.x + box!.width) - 16)).toBeLessThanOrEqual(2)
    expect(Math.abs(vp.height - (box!.y + box!.height) - 16)).toBeLessThanOrEqual(2)

    // 붙잡힌 업로드를 풀어 정리한다.
    await expect.poll(() => releases.length).toBe(1)
    releases[0]()
    await expect.poll(() => releases.length).toBe(2)
    releases[1]()
  })
})

// WP-1531: 패널이 남아 있는 동안(실패·취소 뒤엔 ✕ 전까지) 목록을 맨 아래까지 내리면 마지막 행이 패널에 가려지지 않는다
// — 목록 아래에 패널 높이 + 여백만큼 공간을 둔다. 실제 겹침은 jsdom 이 재지 못해 E2E 로 본다.
test.describe('드라이브 업로드 패널 — 목록 마지막 행', { tag: '@layout' }, () => {
  test('실패로 남은 패널이 맨 아래로 내린 목록의 마지막 행을 가리지 않는다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await stubSpaces(page)
    const files = Array.from({ length: 40 }, (_, i) => createFile({ id: 100 + i, name: `보고서_${String(i + 1).padStart(2, '0')}.pdf` }))
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ folders: [], files }) })
          : route.fallback(),
    )
    await page.route(`**/api/v1/drive/spaces/${SPACE_ID}/files`, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ status: 500, message: '저장하지 못했습니다' }) })
        : route.fallback(),
    )
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    const lastRow = page.getByTestId('drive-row-file-139')
    await expect(lastRow).toBeAttached({ timeout: 15000 })

    await page.getByTestId('file-input').setInputFiles([
      { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
      { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('b') },
      { name: 'c.txt', mimeType: 'text/plain', buffer: Buffer.from('c') },
    ])
    const panel = page.getByTestId('drive-upload-panel')
    await expect(panel).toContainText('0개 완료 · 3개 실패')

    // 목록을 맨 아래로 — 공간이 패널 높이를 따라 붙은 뒤에도 끝까지 내리도록 재며 다시 내린다.
    const dropzone = page.getByTestId('drive-dropzone')
    await expect(async () => {
      await dropzone.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      const [rowBox, panelBox] = await Promise.all([lastRow.boundingBox(), panel.boundingBox()])
      expect(rowBox).not.toBeNull()
      expect(panelBox).not.toBeNull()
      // 마지막 행의 아래 끝이 패널 위 끝보다 위 — 세로로 겹치지 않는다.
      expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(panelBox!.y)
    }).toPass()
  })
})
