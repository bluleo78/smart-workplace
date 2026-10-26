// 프로젝트 설정 「상태」 섹션 — 모바일(WP-809). 손잡이 대신 ⋯ 시트의 위로/아래로 이동, 삭제 창·긴 이름의 가로 넘침.
// 여기엔 삭제 창·긴 이름 행의 기하(@layout)만 남긴다 — ⋯ 시트 이동 payload·순서 반영과 범주 경계 비활성은
// src/pages/mobile/settingsStatuses.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import type { ProjectStatus } from '../../../src/types/projectStatus'
import { expect, expectBodyNoHorizontalOverflow, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockProjectSettings, mockStatusManagement } from '../../fixtures/project-settings-mocks'

/** 30자 이름(공백 포함 실데이터) — 행이 가로로 넘치지 않고 한 줄로 잘려야 한다. */
const LONG_NAME = '고객사 보안 검토 회신 대기 중(법무팀 확인 필요 건)'
/** 공백 없는 30자 — 낱말 끊김이 없어 truncate 가 빠지면 바로 넘친다. */
const LONG_SOLID = '가'.repeat(30)

function statuses(): ProjectStatus[] {
  return [
    { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 1, color: 'BLUE' },
    { id: 12, name: LONG_NAME, category: 'IN_PROGRESS', position: 2, color: 'PURPLE' },
    { id: 13, name: LONG_SOLID, category: 'IN_PROGRESS', position: 3, color: 'TEAL' },
    { id: 3, name: '완료', category: 'DONE', position: 4, color: 'GREEN' },
    { id: 4, name: '취소', category: 'CANCELED', position: 5, color: 'GRAY' },
  ]
}

async function setup(page: Page) {
  await mockProjectSettings(page)
  const mock = await mockStatusManagement(page, {
    statuses: statuses(),
    counts: { 1: 4, 2: 1204, 12: 3, 13: 0, 3: 9, 4: 1 },
    impact: (id) => (id === 12 ? { savedViewCount: 2 } : {}),
  })
  await page.goto('/projects/WP/settings')
  await expect(page.getByTestId('status-row-1')).toBeVisible()
  return mock
}

test('삭제 창이 모바일 폭에서 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  await page.getByTestId('status-menu-12').click()
  await page.getByTestId('status-row-sheet').getByTestId('mobile-action-status-delete').click()
  const dialog = page.getByTestId('status-delete-dialog')
  // 모바일은 가운데 창이 아니라 화면 아래에 붙은 바텀시트.
  await expect(dialog).toHaveAttribute('data-layout', 'sheet')
  await expect(dialog.getByTestId('status-delete-confirm')).toHaveText('이슈 3개 옮기고 삭제')
  const viewport = page.viewportSize()!
  await expect.poll(async () => {
    const b = (await dialog.boundingBox())!
    return Math.round(b.y + b.height)
  }).toBe(viewport.height)
  expect((await dialog.boundingBox())!.width).toBe(viewport.width)
  // 다른 범주를 골라 경고 블록까지 띄운 가장 긴 상태로 잰다.
  await dialog.getByTestId('status-move-target').click()
  await page.getByRole('option', { name: /^완료/ }).click()
  await expect(dialog.getByTestId('status-delete-warning')).toBeVisible()
  await expect(dialog).toContainText("저장된 뷰 2개의 필터도 '완료'로 바뀌어요")
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)
  const inner = await dialog.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  expect(inner.sw).toBeLessThanOrEqual(inner.cw + 1)
  await expectNoHorizontalOverflow(page)
})

test('30자 이름 행이 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setup(page)
  for (const id of [12, 13]) {
    const row = page.getByTestId(`status-row-${id}`)
    await row.scrollIntoViewIfNeeded()
    const box = (await row.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    // 행 오른쪽의 이슈 수·⋯ 가 밀려나지 않고 행 안에 온전히 보인다.
    const menu = row.getByTestId(`status-menu-${id}`)
    await expect(menu).toBeInViewport({ ratio: 1 })
    const m = (await menu.boundingBox())!
    expect(m.x + m.width).toBeLessThanOrEqual(box.x + box.width)
    await expect(row).toContainText(id === 12 ? '3개' : '0개')
    const name = row.getByText(id === 12 ? LONG_NAME : LONG_SOLID)
    await expect(name).toHaveAttribute('title', id === 12 ? LONG_NAME : LONG_SOLID)
    // 한 줄(높이가 줄 하나 수준)로 잘린다.
    expect((await name.boundingBox())!.height).toBeLessThan(28)
  }
  await expectBodyNoHorizontalOverflow(page)
  await expectNoHorizontalOverflow(page)
})
