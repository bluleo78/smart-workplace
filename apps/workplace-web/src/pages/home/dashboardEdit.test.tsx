// 홈 대시보드 편집 모드·위젯 추가 모달 — 화면 컴포넌트 테스트(WP-971, WP-982).
// 이동 버튼·숨김·항목 수·추가·삭제 → 저장 PUT payload, 취소·되돌리기, 빈 초안 저장 막기, 12개 상한 안내, aria-live 공지,
// 표시 이름 40자 상한, 위젯 추가 모달의 선택·카테고리·프리뷰·강조 타이머는 브라우저 없이 판정되므로 e2e/pages/home.spec.ts 에서 옮겼다.
// 드래그(포인터·키보드 센서)·포커스 복원·lg 경계 리사이즈·좁은 폭 스택·선택 탭 배경색은 그 spec 이 @input·@layout 으로 지킨다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { card, cardById, catalog, layout, order, renderDashboard } from '@/test/kits/home/dashboardKit-b1'
import type { DashboardWidgetConfig } from '@/types/dashboard'

afterEach(() => {
  vi.useRealTimers()
})

/** 대시보드를 띄우고 편집 모드에 들어간다. */
async function openEdit(widgets: (string | DashboardWidgetConfig)[]) {
  const view = await renderDashboard(layout(widgets))
  await view.user.click(await screen.findByTestId('dashboard-edit-toggle'))
  await screen.findByTestId('dashboard-edit-banner')
  return view
}

/** 위젯 추가 모달을 연다(편집 모드에서). */
async function openAddModal(view: Awaited<ReturnType<typeof openEdit>>) {
  await view.user.click(screen.getByTestId('dashboard-add-widget-open'))
  return screen.findByTestId('add-widget-modal')
}

const modalCard = (modal: HTMLElement, type: string) => modal.querySelector<HTMLElement>(`[data-testid="add-widget-card"][data-widget-type="${type}"]`)!

/** 저장을 누르고 편집이 끝날 때까지(PUT 응답 → onSuccess) 기다린다. */
async function save(view: Awaited<ReturnType<typeof openEdit>>) {
  await view.user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument())
}

test('아래로 이동 → 저장하면 PUT payload 순서가 바뀌고 일반 뷰도 응답으로 새 순서를 그린다', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  await save(view)
  expect(view.dash.state.puts.at(-1)!.body.widgets.map((w) => w.type)).toEqual(['unread_mail', 'my_tasks'])
  expect(order()).toEqual(['unread_mail', 'my_tasks'])
})

// 이동 버튼은 스크린리더가 식별할 이름을 갖고, 양 끝에서는 비활성, 키보드(Enter)로도 이동한다.
test('이동 버튼 — 접근성 이름, 양 끝 비활성, Enter 로 이동', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  const myTasks = card('my_tasks')
  expect(within(myTasks).getByRole('button', { name: '위로 이동: 내 작업' })).toBeDisabled()
  const down = within(myTasks).getByRole('button', { name: '아래로 이동: 내 작업' })
  expect(down).toBeEnabled()
  down.focus()
  await view.user.keyboard('{Enter}')
  expect(order()).toEqual(['unread_mail', 'my_tasks'])
})

test('숨김 → 저장하면 hidden:true 로 저장되고 일반 뷰에서 빠진다. 토글마다 aria-live 가 상태를 안내한다(I1)', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  const live = screen.getByTestId('dashboard-edit-live')
  const toggle = within(card('my_tasks')).getByTestId('widget-hide-toggle')
  await view.user.click(toggle)
  // 편집 중에는 숨긴 카드도 흐리게 남는다.
  expect(card('my_tasks')).toHaveAttribute('data-hidden', 'true')
  expect(live).toHaveTextContent('내 작업 위젯을 숨김 처리했습니다')
  await view.user.click(within(card('my_tasks')).getByTestId('widget-hide-toggle'))
  expect(card('my_tasks')).toHaveAttribute('data-hidden', 'false')
  expect(live).toHaveTextContent('내 작업 위젯을 표시 처리했습니다')
  await view.user.click(within(card('my_tasks')).getByTestId('widget-hide-toggle'))
  await save(view)
  expect(view.dash.state.puts.at(-1)!.body.widgets.find((w) => w.type === 'my_tasks')?.hidden).toBe(true)
  expect(order()).toEqual(['unread_mail'])
})

test('항목 수 10개 선택 → 저장 PUT payload 의 count 가 10이다', async () => {
  const view = await openEdit(['my_tasks'])
  await view.user.click(within(within(card('my_tasks')).getByTestId('widget-count-select')).getByRole('button', { name: '10개' }))
  await save(view)
  expect(view.dash.state.puts.at(-1)!.body.widgets.find((w) => w.type === 'my_tasks')?.count).toBe(10)
})

test('취소는 초안을 버리고 PUT 을 보내지 않으며 원래 순서를 그린다', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  await view.user.click(screen.getByTestId('dashboard-edit-cancel'))
  expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument()
  expect(view.dash.state.puts).toHaveLength(0)
  expect(order()).toEqual(['my_tasks', 'unread_mail'])
})

test('되돌리기는 마지막 액션 하나만 취소한다(단일 레벨)', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  const undo = screen.getByTestId('dashboard-edit-undo')
  expect(undo).toBeDisabled()
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  expect(order()).toEqual(['unread_mail', 'my_tasks'])
  expect(undo).toBeEnabled()
  await view.user.click(undo)
  expect(order()).toEqual(['my_tasks', 'unread_mail'])
  expect(undo).toBeDisabled()
})

// WP-520 — 위젯이 하나도 없으면 서버가 거부하므로 저장을 막고, 빈 상태 안내의 버튼이 위젯 추가를 연다.
test('편집에서 위젯을 모두 지우면 저장이 막히고 안내에서 위젯 추가를 연다 (WP-520)', async () => {
  const view = await openEdit(['my_tasks'])
  await view.user.click(within(card('my_tasks')).getByTestId('widget-remove'))
  const empty = screen.getByTestId('dashboard-empty')
  expect(empty).toHaveTextContent('위젯이 하나 이상 있어야 저장할 수 있습니다')
  expect(screen.getByTestId('dashboard-edit-save')).toBeDisabled()
  await view.user.click(within(empty).getByTestId('dashboard-empty-action'))
  expect(await screen.findByTestId('add-widget-modal')).toBeInTheDocument()
  expect(view.dash.state.puts).toHaveLength(0)
})

// WP-521 — 숨긴 위젯도 상한(12)에 든다. 「위젯 추가」가 말없이 회색이 되지 않게 이유를 안내하고, 하나 지우면 풀린다.
test('위젯이 12개(숨김 포함)면 「위젯 추가」가 막힌 이유를 안내하고, 하나 지우면 풀린다 (WP-521)', async () => {
  const widgets = Array.from({ length: 12 }, (_, i) => ({ ...catalog(`w-${i}`, 'issue_list', { assignee: 'me' }, `이슈 ${i + 1}`), hidden: i >= 10 }))
  const view = await openEdit(widgets)
  expect(screen.getByTestId('dashboard-widget-limit')).toHaveTextContent(
    '위젯은 숨긴 위젯을 포함해 최대 12개까지 둘 수 있습니다. 더 추가하려면 위젯을 삭제하세요.',
  )
  expect(screen.getByTestId('dashboard-add-widget-open')).toBeDisabled()
  await view.user.click(within(cardById('w-11')).getByTestId('widget-remove'))
  expect(screen.queryByTestId('dashboard-widget-limit')).not.toBeInTheDocument()
  expect(screen.getByTestId('dashboard-add-widget-open')).toBeEnabled()
})

// WP-519 — 표시 이름은 서버 상한과 같은 40자에서 더 받지 않는다(넘겨 저장하면 400).
test('카탈로그 위젯 설정의 표시 이름 입력은 40자에서 멈춘다 (WP-519)', async () => {
  const view = await openEdit([catalog('w-long', 'issue_list', { assignee: 'me' }, '긴 이름')])
  await view.user.click(within(cardById('w-long')).getByTestId('widget-settings'))
  const input = await screen.findByTestId('widget-settings-label')
  await view.user.clear(input)
  await view.user.paste('가'.repeat(50))
  expect(input).toHaveValue('가'.repeat(40))
})

// B1 — 모달의 카드 클릭은 선택(aria-pressed)만, 「+ 위젯 추가」를 눌러야 초안에 들어가고 저장 PUT 에 {id,type,count:5,hidden:false} 로 실린다.
test('위젯 추가 모달 — 기본 위젯 7종 중 하나를 골라 추가하면 공지·초안에 반영되고 저장 PUT 에 포함된다', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  await view.user.click(within(modal).getAllByTestId('add-widget-category').find((el) => el.textContent?.includes('기본'))!)
  // 저장본에 없는 시스템 위젯만 「기본」에 나온다(my_tasks 제외 7종).
  expect(modal.querySelectorAll('[data-testid="add-widget-card"][data-widget-type]')).toHaveLength(7)
  await view.user.click(modalCard(modal, 'unread_mail'))
  expect(modalCard(modal, 'unread_mail')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('add-widget-modal')).toBeInTheDocument()
  await view.user.click(within(modal).getByTestId('add-widget-confirm'))
  expect(screen.getByTestId('dashboard-edit-live')).toHaveTextContent('메일 위젯을 추가했습니다')
  await waitFor(() => expect(screen.queryByTestId('add-widget-modal')).not.toBeInTheDocument())
  expect(card('unread_mail')).toBeInTheDocument()
  await save(view)
  const widgets = view.dash.state.puts.at(-1)!.body.widgets
  expect(widgets.map((w) => w.type)).toEqual(['my_tasks', 'unread_mail'])
  expect(widgets.find((w) => w.type === 'unread_mail')).toEqual({ id: 'unread_mail', type: 'unread_mail', count: 5, hidden: false })
})

test('위젯 추가 모달 — 카탈로그 카드는 선택만 하고, 확인해야 추가되어 저장 PUT 에 실린다', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  await view.user.click(modalCard(modal, 'issue_list'))
  expect(modalCard(modal, 'issue_list')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('add-widget-modal')).toBeInTheDocument()
  await view.user.click(within(modal).getByTestId('add-widget-confirm'))
  await waitFor(() => expect(screen.queryByTestId('add-widget-modal')).not.toBeInTheDocument())
  await save(view)
  expect(view.dash.state.puts.at(-1)!.body.widgets.map((w) => w.type)).toContain('issue_list')
})

test('위젯 추가 모달 — 처음엔 첫 카드 프리뷰, 카드를 고르면 그 위젯 목데이터 프리뷰, 카테고리를 바꾸면 첫 카드가 자동 선택된다', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  const preview = within(modal).getByTestId('add-widget-preview')
  expect(preview).toHaveTextContent('미리보기')
  await view.user.click(modalCard(modal, 'mail_list'))
  // widgetPreviewFixtures.mail_list 샘플(실 API 호출 없음).
  expect(await within(preview).findByText(/이번 주 스프린트 리뷰 일정 안내/)).toBeInTheDocument()
  await view.user.click(modal.querySelector<HTMLElement>('[data-testid="add-widget-category"][data-category="캘린더"]')!)
  expect(modalCard(modal, 'calendar')).toHaveAttribute('aria-pressed', 'true')
  expect(preview).toHaveTextContent('캘린더')
})

test('모달로 추가한 위젯도 되돌리기로 취소된다(일관성)', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  await view.user.click(modalCard(modal, 'unread_mail'))
  await view.user.click(within(modal).getByTestId('add-widget-confirm'))
  await waitFor(() => expect(card('unread_mail')).toBeInTheDocument())
  await view.user.click(screen.getByTestId('dashboard-edit-undo'))
  expect(card('unread_mail')).toBeNull()
})

// 새로 추가한 카드는 4초(HIGHLIGHT_DURATION_MS) 동안 강조되고 그 뒤 풀린다.
test('위젯을 추가하면 새 카드가 강조되고 4초 뒤 강조가 풀린다', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  await view.user.click(modalCard(modal, 'unread_mail'))
  // 추가(타이머 예약) 직전에 setTimeout 만 가짜로 바꾼다 — 네트워크·user-event 는 실제 시간으로 둔다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => within(modal).getByTestId('add-widget-confirm').click())
  expect(card('unread_mail')).toHaveAttribute('data-just-added', 'true')
  act(() => vi.advanceTimersByTime(3999))
  expect(card('unread_mail')).toHaveAttribute('data-just-added', 'true')
  act(() => vi.advanceTimersByTime(2))
  expect(card('unread_mail')).not.toHaveAttribute('data-just-added')
})
