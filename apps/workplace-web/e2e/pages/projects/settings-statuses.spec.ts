// 프로젝트 설정 「상태」 섹션(WP-809) E2E — 대표 목록 렌더(@wiring), 끌기·키보드 집기·⋯ 메뉴 키보드 탐색(@input),
// #statuses 스크롤(@layout)만 남긴다. 추가·편집·순서 변경 실패·삭제 창·목록 실패·멤버 읽기 전용·개인 프로젝트는
// 페이지 테스트 src/pages/projects/settingsStatuses.test.tsx, 권한·비활성 경우의 수는 StatusManagement.test.tsx 가 지킨다(WP-971, WP-980).
import type { Page } from '@playwright/test'

import type { ProjectStatus } from '../../../src/types/projectStatus'
import { createMember } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockProjectSettings, mockStatusManagement, type StatusManagementMockOptions } from '../../fixtures/project-settings-mocks'
import { dropDnd, expectStays, stableBox, startKeyboardDrag } from '../../fixtures/wait'

/** 30자 이름 — 행 truncate 와 가로 넘침을 실제 길이로 본다. */
const LONG_NAME = '고객사 보안 검토 회신 대기 중(법무팀 확인 필요 건)'.slice(0, 30)

/** 상태 7개 — 할 일 2 · 진행 중 3(30자 이름 포함) · 완료 1 · 취소 1. 서버 position 은 범주 순서대로. */
function statuses(): ProjectStatus[] {
  return [
    { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
    { id: 11, name: '요구사항 정리 대기', category: 'TODO', position: 1, color: 'ORANGE' },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 2, color: 'BLUE' },
    { id: 12, name: '코드 리뷰 중', category: 'IN_PROGRESS', position: 3, color: 'PURPLE' },
    { id: 13, name: LONG_NAME, category: 'IN_PROGRESS', position: 4, color: 'BLUE' },
    { id: 3, name: '완료', category: 'DONE', position: 5, color: 'GREEN' },
    { id: 4, name: '취소', category: 'CANCELED', position: 6, color: 'GRAY' },
  ]
}

const COUNTS = { 1: 128, 11: 0, 2: 1204, 12: 3, 13: 0, 3: 7, 4: 2 }

async function setup(page: Page, opts: StatusManagementMockOptions = {}, role: 'OWNER' | 'MEMBER' = 'OWNER') {
  await mockProjectSettings(page, [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role })])
  const mock = await mockStatusManagement(page, { statuses: statuses(), counts: COUNTS, ...opts })
  await page.goto('/projects/WP/settings')
  await expect(page.getByTestId('status-row-1')).toBeVisible()
  return mock
}

/** 범주 블록 안 행 id 순서. */
async function rowIds(page: Page, category: string): Promise<number[]> {
  const ids = await page
    .getByTestId(`status-category-${category}`)
    .locator('[data-testid^="status-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))
  return ids.map((t) => Number(t.replace('status-row-', '')))
}

/** 손잡이를 잡아 대상 행 위로 끌어 놓는다 — PointerSensor distance:8 을 넘기도록 조금 움직인 뒤 대상 중심으로. */
async function dragHandleTo(page: Page, id: number, targetTestId: string) {
  const box = await stableBox(page.getByTestId(`status-drag-${id}`))
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 10, { steps: 4 })
  const target = await stableBox(page.getByTestId(targetTestId))
  await page.mouse.move(x, target.y + target.height / 2, { steps: 12 })
  await dropDnd(page)
}

test.describe('설정 — 상태 섹션', () => {
  test('범주별 목록·기본 표시·이슈 수를 보인다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    await setup(page)
    const section = page.getByTestId('settings-statuses')
    await expect(section.getByRole('heading', { name: '상태', exact: true })).toBeVisible()
    await expect(section).toContainText('순서는 같은 범주 안에서만 바꿀 수 있어요.')
    // 범주 순서 고정 + 범주 안은 서버 순서 그대로.
    expect(await rowIds(page, 'TODO')).toEqual([1, 11])
    expect(await rowIds(page, 'IN_PROGRESS')).toEqual([2, 12, 13])
    expect(await rowIds(page, 'DONE')).toEqual([3])
    expect(await rowIds(page, 'CANCELED')).toEqual([4])
    await expect(page.getByTestId('status-category-IN_PROGRESS')).toContainText('3')
    // 「기본」은 범주의 첫 상태에만.
    for (const id of [1, 2, 3, 4]) await expect(page.getByTestId(`status-default-badge-${id}`)).toBeVisible()
    await expect(page.getByTestId('status-default-badge-11')).toHaveCount(0)
    // 이슈 수(group-counts) — 천 단위 구분.
    await expect(page.getByTestId('status-row-2')).toContainText('1,204개')
    await expect(page.getByTestId('status-row-11')).toContainText('0개')
    // 30자 이름은 한 줄로 잘리고 전체 이름은 title 로.
    await expect(page.getByTestId('status-row-13').getByText(LONG_NAME)).toHaveAttribute('title', LONG_NAME)
  })

  test('손잡이를 끌어 같은 범주 안 순서를 바꾼다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // 마우스 좌표로 끌므로 진행 중·완료 행이 모두 첫 화면 안에 있게 창을 키운다.
    await page.setViewportSize({ width: 1280, height: 1600 })
    const mock = await setup(page)
    await page.getByTestId('status-category-DONE').scrollIntoViewIfNeeded()
    // 다른 범주(완료) 위에 놓으면 요청이 없다.
    await dragHandleTo(page, 12, 'status-row-3')
    await expectStays(page, mock.orders.count, 0)
    expect(await rowIds(page, 'IN_PROGRESS')).toEqual([2, 12, 13])
    // 같은 범주 첫 자리로.
    await dragHandleTo(page, 13, 'status-row-2')
    await mock.orders.waitFor()
    expect(mock.orders.lastBody()).toEqual({ category: 'IN_PROGRESS', statusIds: [13, 2, 12] })
    await expect.poll(() => rowIds(page, 'IN_PROGRESS')).toEqual([13, 2, 12])
    // 첫 상태가 바뀌었으니 「기본」도 옮겨 간다.
    await expect(page.getByTestId('status-default-badge-13')).toBeVisible()
    await expect(page.getByTestId('status-default-badge-2')).toHaveCount(0)
  })

  test('손잡이를 키보드로 집어 같은 범주 안에서 옮긴다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const mock = await setup(page)
    const liveRegion = page.locator('[id^="DndLiveRegion"]')
    // 집은 뒤 센서가 방향키 리스너를 붙일 때까지 기다린다(부하에서 바로 누른 방향키가 버려지지 않게).
    await startKeyboardDrag(page.getByTestId('status-drag-12'), () => expect(liveRegion).toContainText('집었습니다'))
    await page.keyboard.press('ArrowDown')
    // 키보드엔 포인터 좌표가 없다 — 같은 범주 행(13)이 놓을 자리로 잡혀야 한다.
    await expect(liveRegion).toContainText('3번째 자리 위에')
    await page.keyboard.press('Space')
    await mock.orders.waitFor()
    expect(mock.orders.lastBody()).toEqual({ category: 'IN_PROGRESS', statusIds: [2, 13, 12] })
    await expect.poll(() => rowIds(page, 'IN_PROGRESS')).toEqual([2, 13, 12])
  })

  test('⋯ 아래로 이동은 키보드로도 순서를 바꾼다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const mock = await setup(page)
    const trigger = page.getByTestId('status-menu-12')
    await trigger.focus()
    await page.keyboard.press('Enter')
    // 키보드로 연 메뉴는 Radix 가 렌더 뒤 다음 틱에 첫 항목으로 초점을 옮긴다 — 메뉴가 보이기만 하고 초점이 아직 트리거에 있을 때
    // 누른 방향키는 트리거가 받아 버려진다(부하에서 「아래로 이동」에 닿지 못하던 원인). 항목마다 초점이 실제로 옮겨진 것을 보고 다음 키를 누른다.
    await expect(page.getByRole('menuitem', { name: '편집' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '위로 이동' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '아래로 이동' })).toBeFocused()
    await page.keyboard.press('Enter')
    await mock.orders.waitFor()
    expect(mock.orders.lastBody()).toEqual({ category: 'IN_PROGRESS', statusIds: [2, 13, 12] })
    await expect.poll(() => rowIds(page, 'IN_PROGRESS')).toEqual([2, 13, 12])
  })

  test('#statuses 로 들어오면 섹션으로 스크롤된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    // 낮은 창 — 섹션이 첫 화면 밖이라 스크롤하지 않으면 보이지 않는다.
    await page.setViewportSize({ width: 1280, height: 480 })
    await mockProjectSettings(page)
    await mockStatusManagement(page, { statuses: statuses(), counts: COUNTS })
    await page.goto('/projects/WP/settings#statuses')
    const section = page.getByTestId('settings-statuses')
    await expect(page.getByTestId('status-row-1')).toBeVisible()
    await expect(section).toBeInViewport()
    await expect.poll(async () => (await section.boundingBox())!.y).toBeLessThan(240)
  })

})
