// 드라이브 「최근」(WP-1699) 휴대폰 폭 레이아웃 — 이름·경로가 아주 긴 줄이 가로로 넘치지 않고, ⋯ 메뉴가 화면 안에 열린다.
// 폭·넘침·잘림은 jsdom 이 잴 수 없는 기하라 E2E(@layout)로 본다. 문구·묶음·이동 판정은 vitest(driveRecent.test.tsx).
import type { Page } from '@playwright/test'

import type { DriveRecentPage } from '../src/types/drive'
import { personalSpace } from './factories/drive.factory'
import { expect, test } from './fixtures/auth.fixture'

test.use({ viewport: { width: 390, height: 844 } })

const LONG_NAME = '2026년_하반기_사업계획서_최종_수정본_대표이사_보고용_검토의견_반영_버전_v12.pptx'

const recent: DriveRecentPage = {
  items: [
    {
      driveFileId: 101,
      name: LONG_NAME,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 4_404_019,
      spaceId: 2,
      spaceName: '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀',
      folderId: 42,
      folderPath: [
        { id: 40, name: '2026년 사업계획 및 예산 편성 자료 모음' },
        { id: 42, name: '경영진 보고용 최종본 보관 폴더' },
      ],
      lastAction: 'NEW_VERSION',
      lastAt: new Date(Date.now() - 600_000).toISOString(),
      // 별표 단추(WP-1698)가 켜진 줄 — 별표·⋯ 두 단추가 함께 있어도 넘치지 않아야 한다.
      starred: true,
    },
    {
      driveFileId: 102,
      name: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      spaceId: 1,
      spaceName: '내 드라이브',
      folderId: null,
      folderPath: [],
      lastAction: 'OPEN',
      lastAt: new Date(Date.now() - 5_000).toISOString(),
    },
  ],
  nextCursor: null,
}

/** 드라이브 사이드바 조회와 「최근」 응답 모킹. */
async function mockRecent(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 ** 3 } }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill({ json: [personalSpace({ id: 1 })] }))
  await page.route((u) => u.pathname === '/api/v1/drive/shared-with-me', (r) => r.fulfill({ json: [] }))
  await page.route((u) => u.pathname === '/api/v1/drive/recent', (r) => r.fulfill({ json: recent }))
}

test.describe('드라이브 최근 — 휴대폰 폭 @layout', () => {
  test('긴 이름·긴 경로 행이 가로로 넘치지 않고 ⋯ 메뉴가 열린다', async ({ authenticatedPage: page }) => {
    await mockRecent(page)
    await page.goto('/drive/recent')
    const row = page.getByTestId('drive-recent-row-101')
    await expect(row).toBeVisible()

    // 페이지·표·행 어디에도 가로 스크롤이 생기지 않는다.
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      list: (() => {
        const list = document.querySelector('[data-testid="drive-recent-list"]') as HTMLElement
        return list.scrollWidth <= list.clientWidth
      })(),
      row: (() => {
        const r = document.querySelector('[data-testid="drive-recent-row-101"]') as HTMLElement
        return r.scrollWidth <= r.clientWidth
      })(),
    }))
    expect(overflow).toEqual({ page: true, list: true, row: true })

    // ⋯ 단추가 화면 안(오른쪽 끝 안)에 있고, 눌러 열린 메뉴도 화면 안에 있다.
    const menu = page.getByTestId('drive-recent-menu-101')
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    // 별표 단추도 화면 안에 있고 ⋯ 단추 왼쪽에 겹치지 않게 놓인다.
    const starBox = await page.getByTestId('drive-recent-star-101').boundingBox()
    expect(starBox).not.toBeNull()
    expect(starBox!.x).toBeGreaterThanOrEqual(0)
    expect(starBox!.x + starBox!.width).toBeLessThanOrEqual(box!.x)
    await menu.click()
    const action = page.getByTestId('drive-recent-action-locate')
    await expect(action).toBeVisible()
    const menuBox = await action.boundingBox()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390)
  })
})
