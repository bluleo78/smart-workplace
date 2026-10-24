// 프로젝트 설정 「상태」 섹션(WP-809) — 범주별 목록·추가·편집·끌기/위아래 이동·삭제 창의 배선.
// 권한·비활성 판정의 경우의 수는 StatusManagement.test.tsx(vitest), 여기서는 화면 → API 요청·응답 → 화면 반영을 본다.
import type { Page } from '@playwright/test'

import type { ProjectStatus } from '../../../src/types/projectStatus'
import { createMember, createProject } from '../../factories/project.factory'
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

async function openMenu(page: Page, id: number) {
  await page.getByTestId(`status-menu-${id}`).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

test.describe('설정 — 상태 섹션', () => {
  test('범주별 목록·기본 표시·이슈 수를 보인다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
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

  test('+ 추가로 이름과 색을 골라 범주 끝에 만든다', async ({ authenticatedPage: page }) => {
    const mock = await setup(page)
    await page.getByTestId('status-add-IN_PROGRESS').click()
    const input = page.getByRole('textbox', { name: '새 상태 이름' })
    await expect(input).toBeFocused()
    // 중복 이름은 요청 없이 인라인 오류.
    await input.fill('코드 리뷰 중')
    await input.press('Enter')
    await expect(page.getByTestId('status-add-error')).toHaveText('이미 존재하는 상태 이름입니다')
    expect(mock.creates.count()).toBe(0)
    await input.fill('QA 대기')
    await page.getByTestId('status-add-color-PURPLE').click()
    await input.press('Enter')
    await mock.creates.waitFor()
    expect(mock.creates.lastBody()).toEqual({ name: 'QA 대기', category: 'IN_PROGRESS', color: 'PURPLE' })
    // 범주 끝에 붙고 입력 줄은 닫힌다.
    await expect.poll(() => rowIds(page, 'IN_PROGRESS')).toEqual([2, 12, 13, 500])
    await expect(input).toHaveCount(0)
  })

  test('서버가 추가를 거절하면 입력 줄에 문구를 보인다', async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.route('**/api/v1/projects/WP/statuses', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, json: { status: 409, message: '상태는 프로젝트당 20개까지 만들 수 있어요' } })
        : route.fallback(),
    )
    await page.getByTestId('status-add-TODO').click()
    const input = page.getByRole('textbox', { name: '새 상태 이름' })
    await input.fill('보류')
    await input.press('Enter')
    await expect(page.getByTestId('status-add-error')).toHaveText('상태는 프로젝트당 20개까지 만들 수 있어요')
    await expect(input).toHaveValue('보류')
  })

  test('그새 같은 이름이 생겨 409 면 보드 편집기와 같은 중복 문구를 보인다', async ({ authenticatedPage: page }) => {
    await setup(page)
    // 다른 사람이 방금 같은 이름을 만든 경우 — 화면 목록엔 없어 서버가 409 로 거절한다.
    await page.route('**/api/v1/projects/WP/statuses', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 409, json: { status: 409, message: '이미 존재하는 상태 이름입니다: 보류' } })
        : route.fallback(),
    )
    await page.getByTestId('status-add-TODO').click()
    const input = page.getByRole('textbox', { name: '새 상태 이름' })
    await input.fill('보류')
    await input.press('Enter')
    // 이름은 바로 위 입력에 있으니 서버 문구의 「: 이름」을 되풀이하지 않는다(WP-937).
    await expect(page.getByTestId('status-add-error')).toHaveText('이미 존재하는 상태 이름입니다')
    await expect(input).toHaveValue('보류')
    await expect(input).toBeFocused()
  })

  test('편집 창으로 이름과 색을 바꾼다', async ({ authenticatedPage: page }) => {
    const mock = await setup(page)
    await openMenu(page, 12)
    await page.getByRole('menuitem', { name: '편집' }).click()
    const dialog = page.getByTestId('meta-edit-dialog')
    await expect(dialog.getByRole('heading', { name: '상태 편집' })).toBeVisible()
    const name = dialog.getByLabel('이름')
    await expect(name).toHaveAttribute('maxlength', '30')
    await name.fill('작업 중')
    await dialog.getByTestId('meta-edit-color-RED').click()
    await dialog.getByRole('button', { name: '저장' }).click()
    await mock.patches.waitFor()
    expect(mock.patches.lastBody()).toEqual({ name: '작업 중', color: 'RED' })
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('status-row-12')).toContainText('작업 중')
  })

  test('손잡이를 끌어 같은 범주 안 순서를 바꾼다', async ({ authenticatedPage: page }) => {
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

  test('손잡이를 키보드로 집어 같은 범주 안에서 옮긴다', async ({ authenticatedPage: page }) => {
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

  test('⋯ 아래로 이동은 키보드로도 순서를 바꾼다', async ({ authenticatedPage: page }) => {
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

  test('순서 변경 실패면 되돌리고 토스트', async ({ authenticatedPage: page }) => {
    const mock = await setup(page, { orderStatus: 500 })
    await openMenu(page, 12)
    await page.getByRole('menuitem', { name: '위로 이동' }).click()
    await mock.orders.waitFor()
    await expect(page.getByText('순서를 바꾸지 못했어요')).toBeVisible()
    await expect.poll(() => rowIds(page, 'IN_PROGRESS')).toEqual([2, 12, 13])
  })

  test('범주의 마지막 상태는 삭제가 비활성이고 이유가 보인다', async ({ authenticatedPage: page }) => {
    await setup(page)
    await openMenu(page, 3)
    await expect(page.getByRole('menuitem', { name: '삭제' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('menu')).toContainText('범주의 마지막 상태는 지울 수 없어요')
  })

  test('멤버는 손잡이·⋯·추가 없는 읽기 전용 목록을 본다', async ({ authenticatedPage: page }) => {
    await setup(page, {}, 'MEMBER')
    await expect(page.getByTestId('status-row-12')).toContainText('코드 리뷰 중')
    const section = page.getByTestId('settings-statuses')
    await expect(section.locator('[data-testid^="status-drag-"]')).toHaveCount(0)
    await expect(section.locator('[data-testid^="status-menu-"]')).toHaveCount(0)
    await expect(section.locator('[data-testid^="status-add-"]')).toHaveCount(0)
  })

  test('이슈 있는 상태 삭제는 옮길 상태를 골라 moveTo 로 지운다', async ({ authenticatedPage: page }) => {
    const mock = await setup(page, { impact: (id) => (id === 12 ? { savedViewCount: 1 } : {}) })
    await openMenu(page, 12)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    // 데스크톱은 가운데 확인창(모바일은 바텀시트 — mobile/settings-statuses.spec).
    await expect(dialog).toHaveAttribute('data-layout', 'dialog')
    await expect(dialog).toContainText('「코드 리뷰 중」 상태를 삭제할까요?')
    // 기본 옮길 상태 = 같은 범주의 기본 상태(진행 중).
    await expect(dialog.getByTestId('status-move-target')).toContainText('진행 중')
    await expect(dialog).toContainText("저장된 뷰 1개의 필터도 '진행 중'으로 바뀌어요")
    const confirm = dialog.getByTestId('status-delete-confirm')
    await expect(confirm).toHaveText('이슈 3개 옮기고 삭제')
    await confirm.click()
    await mock.deletes.waitFor()
    expect(mock.deletes.lastUrl()?.pathname).toBe('/api/v1/projects/WP/statuses/12')
    expect(mock.deletes.lastUrl()?.searchParams.get('moveTo')).toBe('2')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('status-row-12')).toHaveCount(0)
  })

  test('다른 범주를 고르면 경고가 뜬다', async ({ authenticatedPage: page }) => {
    await setup(page, { impact: (id) => (id === 12 ? { savedViewCount: 2 } : {}) })
    await openMenu(page, 12)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    await expect(dialog.getByTestId('status-delete-warning')).toHaveCount(0)
    await dialog.getByTestId('status-move-target').click()
    await page.getByRole('option', { name: /^완료/ }).click()
    await expect(dialog.getByTestId('status-delete-warning')).toHaveText(
      '범주가 진행 중 → 완료로 바뀌어요. 이슈 3개가 완료로 처리되고 종료 시각이 기록돼요. 담당자에게 알림은 가지 않아요.',
    )
    // 저장된 뷰 안내는 고른 상태 이름을 따라간다.
    await expect(dialog).toContainText("저장된 뷰 2개의 필터도 '완료'로 바뀌어요")
    await expect(dialog.getByTestId('status-delete-confirm')).toBeEnabled()
  })

  test('에픽 차단이면 버튼이 비활성이다', async ({ authenticatedPage: page }) => {
    const mock = await setup(page, { impact: (id) => (id === 12 ? { blockedEpicCount: 2 } : {}) })
    await openMenu(page, 12)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    // 같은 범주 대상이면 차단이 아니다.
    await expect(dialog.getByTestId('status-delete-confirm')).toBeEnabled()
    await dialog.getByTestId('status-move-target').click()
    await page.getByRole('option', { name: /^완료/ }).click()
    await expect(dialog).toContainText('미완료 하위가 있는 에픽 2개 때문에 완료 범주로 옮길 수 없어요')
    await expect(dialog.getByTestId('status-delete-confirm')).toBeDisabled()
    expect(mock.deletes.count()).toBe(0)
  })

  test('이슈 0개 상태는 간단 확인으로 지운다', async ({ authenticatedPage: page }) => {
    const mock = await setup(page, { impact: (id) => (id === 11 ? { emptiedFilterViewCount: 1 } : {}) })
    await openMenu(page, 11)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    await expect(dialog).toContainText('이 상태에 이슈가 없어요.')
    await expect(dialog).toContainText('저장된 뷰 1개에서 이 상태 필터가 빠져요')
    await expect(dialog.getByTestId('status-move-target')).toHaveCount(0)
    const confirm = dialog.getByTestId('status-delete-confirm')
    await expect(confirm).toHaveText('삭제')
    await confirm.click()
    await mock.deletes.waitFor()
    expect(mock.deletes.lastUrl()?.searchParams.has('moveTo')).toBe(false)
    await expect(page.getByTestId('status-row-11')).toHaveCount(0)
  })

  test('삭제가 거절되면 창 안에 문구를 보이고 닫지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.route('**/api/v1/projects/WP/statuses/11', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 409, json: { status: 409, message: '범주의 마지막 상태는 지울 수 없어요' } })
        : route.fallback(),
    )
    await openMenu(page, 11)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    await dialog.getByTestId('status-delete-confirm').click()
    await expect(dialog.getByRole('alert')).toHaveText('범주의 마지막 상태는 지울 수 없어요')
    await expect(dialog).toBeVisible()
  })

  test('이슈 0개로 열었는데 그새 이슈가 생겨 400 이면 영향을 다시 받아 옮길 상태를 고르게 한다', async ({ authenticatedPage: page }) => {
    // 첫 영향은 이슈 0개, 거절 뒤 다시 받은 영향은 이슈 4개 — 다른 사람이 그 사이 이슈를 이 상태로 옮긴 경우.
    let impactCalls = 0
    const mock = await setup(page, { impact: (id) => (id === 11 ? { issueCount: impactCalls++ === 0 ? 0 : 4 } : {}) })
    await page.route('**/api/v1/projects/WP/statuses/11', (route) =>
      route.request().method() === 'DELETE' && !new URL(route.request().url()).searchParams.has('moveTo')
        ? route.fulfill({ status: 400, json: { status: 400, message: '옮길 상태를 골라 주세요' } })
        : route.fallback(),
    )
    await openMenu(page, 11)
    await page.getByRole('menuitem', { name: '삭제' }).click()
    const dialog = page.getByTestId('status-delete-dialog')
    await expect(dialog.getByTestId('status-move-target')).toHaveCount(0)
    await dialog.getByTestId('status-delete-confirm').click()
    // 창은 열린 채로 서버 문구를 보이고, 다시 받은 영향으로 옮길 상태 선택과 「이슈 4개 옮기고 삭제」가 나타난다.
    await expect(dialog.getByRole('alert')).toHaveText('옮길 상태를 골라 주세요')
    await expect(dialog.getByTestId('status-move-target')).toBeVisible()
    await expect(dialog.getByTestId('status-move-target')).toContainText('할 일')
    const confirm = dialog.getByTestId('status-delete-confirm')
    await expect(confirm).toHaveText('이슈 4개 옮기고 삭제')
    expect(impactCalls).toBe(2)
    await confirm.click()
    await expect.poll(() => mock.deletes.lastUrl()?.searchParams.get('moveTo')).toBe('1')
    await expect(dialog).toHaveCount(0)
  })

  test('상태 목록을 못 받으면 다시 시도를 보이고 「+ 추가」를 내밀지 않는다', async ({ authenticatedPage: page }) => {
    await mockProjectSettings(page, [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })])
    await mockStatusManagement(page, { statuses: statuses(), counts: COUNTS })
    // 500 — 전역 재시도 정책이 한 번 더 부르므로 다시 시도를 누르기 전까지 계속 실패시킨다.
    let fail = true
    await page.route('**/api/v1/projects/WP/statuses', (route) =>
      route.request().method() === 'GET' && fail
        ? route.fulfill({ status: 500, json: { status: 500, message: '서버 오류' } })
        : route.fallback(),
    )
    await page.goto('/projects/WP/settings')
    const section = page.getByTestId('settings-statuses')
    const error = section.getByTestId('settings-statuses-error')
    await expect(error).toContainText('상태 목록을 불러오지 못했습니다')
    await expect(section.locator('[data-testid^="status-add-"]')).toHaveCount(0)
    await expect(section.locator('[data-testid^="status-category-"]')).toHaveCount(0)
    fail = false
    await error.getByRole('button', { name: '다시 시도' }).click()
    await expect(page.getByTestId('status-row-12')).toBeVisible()
    await expect(page.getByTestId('status-add-IN_PROGRESS')).toBeEnabled()
    await expect(error).toHaveCount(0)
  })

  test('#statuses 로 들어오면 섹션으로 스크롤된다', async ({ authenticatedPage: page }) => {
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

  test('개인 프로젝트는 상태 섹션이 없다', async ({ authenticatedPage: page }) => {
    await mockProjectSettings(page, undefined, createProject({ type: 'PERSONAL' }))
    await page.goto('/projects/WP/settings')
    await expect(page.getByRole('heading', { name: '라벨' })).toBeVisible()
    await expect(page.getByTestId('settings-statuses')).toHaveCount(0)
  })
})
