// 노트 팀 스페이스 삭제 E2E(WP-580) — 스페이스 선택 옆 ⋯(멤버 메뉴와 같은 자리, WP-582) → 확인 창(페이지 수 안내) → DELETE → 남은 스페이스로 이동.
// 노출 조건(TEAM + OWNER)의 경우의 수는 lib/wikiSpaces.test.ts 가 지키고, 여기서는 실제 배선과 실패 안내만 본다.
import type { Page } from '@playwright/test'

import type { WikiSpace } from '../../../src/types/wiki'
import { wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })
const TEAM = wikiSpace({ id: 2, name: '제품기획팀', role: 'OWNER' })

/** 스페이스 목록은 DELETE 이후 팀 스페이스가 빠진다. deleteStatus 로 DELETE 응답을 정한다. */
async function mockSpaces(page: Page, deleteStatus = 204) {
  let spaces: WikiSpace[] = [PERSONAL, TEAM]
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: spaces }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/2', (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    if (deleteStatus !== 204) {
      return r.fulfill({ status: deleteStatus, json: { status: deleteStatus, message: '서버 오류' } })
    }
    spaces = [PERSONAL]
    return r.fulfill({ status: 204 })
  })
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/2/pages', (r) =>
    r.fulfill({
      json: [
        wikiPageSummary({ id: 11, title: '제품 로드맵', position: 0 }),
        wikiPageSummary({ id: 12, parentId: 11, title: '2026 하반기', position: 0 }),
        wikiPageSummary({ id: 13, title: '회의록', position: 1 }),
      ],
    }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) => r.fulfill({ json: [] }))
}

test('OWNER 가 ⋯ 메뉴에서 팀 스페이스를 지우면 DELETE 후 남은 스페이스로 이동한다', { tag: '@smoke' }, async ({
  authenticatedPage: page,
}) => {
  await mockSpaces(page)
  const deletes = trackRequests(page, 'DELETE', '/api/v1/wiki/spaces/2')
  await page.goto('/wiki/spaces/2')
  await expect(page.getByText('회의록')).toBeVisible()

  await page.getByTestId('wiki-space-menu').click()
  await page.getByTestId('wiki-space-delete').click()
  const dialog = page.getByTestId('wiki-space-delete-dialog')
  // 함께 지워지는 규모 — 하위 페이지까지 센 페이지 수와 스페이스 이름.
  await expect(dialog).toContainText('"제품기획팀" 스페이스와 페이지 3개가 함께 영구 삭제됩니다')

  await dialog.getByTestId('wiki-space-delete-confirm').click()
  await expect.poll(() => deletes.count()).toBe(1)
  await expect(page.getByText('스페이스를 삭제했습니다')).toBeVisible()
  // 지운 스페이스는 목록에서 빠지고, /wiki 리다이렉트가 남은 개인 스페이스를 연다.
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
  await expect(dialog).toHaveCount(0)
})

test('삭제가 실패하면 오류를 안내하고 그 스페이스에 머문다', async ({ authenticatedPage: page }) => {
  await mockSpaces(page, 500)
  await page.goto('/wiki/spaces/2')
  await page.getByTestId('wiki-space-menu').click()
  await page.getByTestId('wiki-space-delete').click()
  await page.getByTestId('wiki-space-delete-confirm').click()
  await expect(page.getByText('서버 오류')).toBeVisible()
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  // 확인 창은 닫히지 않고 남아 바로 다시 시도할 수 있다.
  await expect(page.getByTestId('wiki-space-delete-confirm')).toBeEnabled()
})

test('팀 스페이스 OWNER 가 아니면 ⋯ 메뉴에 멤버만 있고 삭제는 없다', async ({ authenticatedPage: page }) => {
  await mockSpaces(page)
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.fulfill({ json: [PERSONAL, { ...TEAM, role: 'EDITOR' }] }))
  await page.goto('/wiki/spaces/2')
  await expect(page.getByText('회의록')).toBeVisible()
  // ⋯ 메뉴는 멤버 보기(WP-582) 때문에 TEAM 멤버 모두에게 있다 — 삭제 항목만 소유자 전용.
  await page.getByTestId('wiki-space-menu').click()
  await expect(page.getByTestId('wiki-space-members')).toBeVisible()
  await expect(page.getByTestId('wiki-space-delete')).toHaveCount(0)
})
