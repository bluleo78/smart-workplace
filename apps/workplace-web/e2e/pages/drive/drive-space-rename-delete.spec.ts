// 드라이브 TEAM 공간 이름 변경/삭제 E2E — 사이드바 kebab 메뉴 (백엔드 없이 page.route 모킹).
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import type { DriveSpace } from '../../../src/types/drive'

// 개인 공간 + 팀 공간(OWNER) — DriveSidebar 가 마운트 시 페치한다.
const spaces: DriveSpace[] = [
  {
    id: 1,
    type: 'PERSONAL',
    name: '내 드라이브',
    ownerId: 1,
    role: 'OWNER',
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 2,
    type: 'TEAM',
    name: '기획팀',
    ownerId: 1,
    role: 'OWNER',
    archived: false,
    createdAt: '2026-06-01T00:00:00Z',
  },
]

// 사이드바 + DrivePage 가 요구하는 공통 경로 모킹(목록·쿼터·항목).
async function mockBaseRoutes(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 } }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: spaces }) : r.fallback()),
  )
  // DrivePage 가 진입 시 호출하는 항목 목록 — 빈 목록으로 안정화.
  await page.route(
    (url) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(url.pathname),
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { folders: [], files: [] } }) : r.fallback()),
  )
}

test.describe('드라이브 TEAM 공간 이름 변경/삭제', () => {
  test('TEAM(OWNER) 행에만 메뉴 노출, PERSONAL 에는 없음', async ({ authenticatedPage: page }) => {
    await mockBaseRoutes(page)
    await page.goto('/drive')
    await expect(page.getByTestId('drive-space-menu-2')).toBeAttached()
    await expect(page.getByTestId('drive-space-menu-1')).toHaveCount(0)
  })

  test('이름 변경 → PATCH payload 검증 → 목록 반영', async ({ authenticatedPage: page }) => {
    await mockBaseRoutes(page)
    const patches = trackRequests(page, 'PATCH', '/api/v1/drive/spaces/2')
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/2',
      async (r) => {
        if (r.request().method() === 'PATCH') {
          await r.fulfill({ json: { ...spaces[1], name: '제품팀' } })
        } else {
          await r.fallback()
        }
      },
    )
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-rename-2').click()
    const input = page.getByTestId('rename-dialog-input')
    await input.fill('제품팀')
    await page.getByTestId('rename-dialog-confirm').click()
    await expect.poll(() => patches.lastBody()).toEqual({ name: '제품팀' })
  })

  // #696 — 다른 TEAM 공간과 이름이 겹치면 409 → 다이얼로그 유지 + 인라인 에러(컨테이너류 이름 하드 차단 정책).
  test('이름 변경 시 중복 이름이면 409 인라인 에러가 뜨고 다이얼로그가 유지된다', async ({ authenticatedPage: page }) => {
    await mockBaseRoutes(page)
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/2',
      async (r) => {
        if (r.request().method() === 'PATCH') {
          await r.fulfill({
            status: 409,
            json: { message: '이미 존재하는 공간 이름입니다: 다른팀공간' },
          })
        } else {
          await r.fallback()
        }
      },
    )
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-rename-2').click()
    const input = page.getByTestId('rename-dialog-input')
    await input.fill('다른팀공간')
    await page.getByTestId('rename-dialog-confirm').click()

    await expect(page.getByTestId('rename-dialog-error')).toHaveText('이미 존재하는 공간 이름입니다: 다른팀공간')
    // 다이얼로그가 닫히지 않는다(입력 유지).
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('다른팀공간')
  })

  test('삭제 → 경고 다이얼로그 → DELETE 호출', async ({ authenticatedPage: page }) => {
    await mockBaseRoutes(page)
    const deletes = trackRequests(page, 'DELETE', '/api/v1/drive/spaces/2')
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/2',
      async (r) => {
        if (r.request().method() === 'DELETE') {
          await r.fulfill({ status: 204, body: '' })
        } else {
          await r.fallback()
        }
      },
    )
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-delete-2').click()
    // 경고 다이얼로그에 공간명 표시
    await expect(page.getByTestId('drive-space-delete-dialog')).toContainText('기획팀')
    await page.getByTestId('drive-space-delete-confirm').click()
    await deletes.waitFor()
  })
})

// WP-237: 터치 태블릿(≥1024px, pointer: coarse)은 hover 가 없어 ⋯ 에 닿지 못했다 → 상시 노출 + 44px, 링크 오른쪽 여백 확보.
test.describe('드라이브 TEAM 공간 ⋯ — 터치 태블릿(≥1024px)', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true })

  test('⋯ 가 상시 보이고(44px, 이름과 안 겹침) 탭으로 이름 변경 PATCH 한다', async ({ authenticatedPage: page }) => {
    await mockBaseRoutes(page)
    const patches = trackRequests(page, 'PATCH', '/api/v1/drive/spaces/2')
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/2',
      async (r) => {
        if (r.request().method() === 'PATCH') {
          await r.fulfill({ json: { ...spaces[1], name: '제품팀' } })
        } else {
          await r.fallback()
        }
      },
    )
    await page.goto('/drive')
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    const menu = page.getByTestId('drive-space-menu-2')
    await expect(menu).toHaveCSS('opacity', '1')
    const m = (await menu.boundingBox())!
    expect(m.width).toBeGreaterThanOrEqual(44)
    expect(m.height).toBeGreaterThanOrEqual(44)
    const name = (await page.getByTestId('drive-space-list').getByText('기획팀', { exact: true }).boundingBox())!
    expect(name.x + name.width).toBeLessThanOrEqual(m.x)

    await menu.tap()
    await page.getByTestId('drive-space-rename-2').click()
    await page.getByTestId('rename-dialog-input').fill('제품팀')
    await page.getByTestId('rename-dialog-confirm').click()
    await expect.poll(() => patches.lastBody()).toEqual({ name: '제품팀' })
  })
})
