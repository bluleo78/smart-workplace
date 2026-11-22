// 홈 대시보드 편집 모드·위젯 추가 모달 — 화면 컴포넌트 테스트(WP-971, WP-982).
// 이동 버튼·숨김·항목 수·추가·삭제 → 저장 PUT payload, 취소·되돌리기, 빈 초안 저장 막기, 12개 상한 안내, aria-live 공지,
// 표시 이름 40자 상한, 위젯 추가 모달의 선택·카테고리·프리뷰·강조 타이머는 브라우저 없이 판정되므로 e2e/pages/home.spec.ts 에서 옮겼다.
// 드래그(포인터·키보드 센서)·포커스 복원·lg 경계 리사이즈·좁은 폭 스택·선택 탭 배경색은 그 spec 이 @input·@layout 으로 지킨다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { SORTABLE_ROLE_DESCRIPTION } from '@/lib/dnd/useSortableItem'
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
  // 드래그 핸들의 스크린리더 설명은 dnd-kit 기본 영어 「sortable」이 아니라 한국어(WP-1549).
  expect(within(myTasks).getByTestId('widget-drag-handle')).toHaveAttribute('aria-roledescription', SORTABLE_ROLE_DESCRIPTION)
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

test('되돌리기는 누를 때마다 한 단계씩 거슬러 편집 시작 상태까지 되돌린다 (WP-1762)', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail', 'notifications'])
  const undo = screen.getByTestId('dashboard-edit-undo')
  expect(undo).toBeDisabled()
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down')) // 1: unread, my, notif
  await view.user.click(within(card('unread_mail')).getByTestId('widget-hide-toggle')) // 2: unread 숨김
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down')) // 3: unread, notif, my
  expect(order()).toEqual(['unread_mail', 'notifications', 'my_tasks'])
  // 연달아 누른 되돌리기도 스크린리더가 매번 읽도록 공지 문구가 남은 단계 수로 달라진다.
  const live = screen.getByTestId('dashboard-edit-live')
  await view.user.click(undo)
  expect(order()).toEqual(['unread_mail', 'my_tasks', 'notifications'])
  expect(card('unread_mail')).toHaveAttribute('data-hidden', 'true')
  expect(undo).toBeEnabled()
  expect(live).toHaveTextContent('마지막 편집을 되돌렸습니다. 2단계 더 되돌릴 수 있습니다')
  await view.user.click(undo)
  expect(card('unread_mail')).toHaveAttribute('data-hidden', 'false')
  expect(undo).toBeEnabled()
  expect(live).toHaveTextContent('마지막 편집을 되돌렸습니다. 1단계 더 되돌릴 수 있습니다')
  await view.user.click(undo)
  expect(order()).toEqual(['my_tasks', 'unread_mail', 'notifications'])
  expect(undo).toBeDisabled()
  expect(live).toHaveTextContent('편집을 시작한 상태로 모두 되돌렸습니다')
})

test('되돌리기 중간에 새 편집을 하면 그 편집 뒤에 앞선 단계가 남는다', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail', 'notifications'])
  const undo = screen.getByTestId('dashboard-edit-undo')
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down')) // 1: unread, my, notif
  await view.user.click(within(card('unread_mail')).getByTestId('widget-hide-toggle')) // 2: unread 숨김
  await view.user.click(undo) // 숨김 취소
  expect(card('unread_mail')).toHaveAttribute('data-hidden', 'false')
  await view.user.click(within(card('notifications')).getByTestId('widget-hide-toggle')) // 다른 카드 숨김
  expect(card('notifications')).toHaveAttribute('data-hidden', 'true')
  await view.user.click(undo) // notifications 숨김 취소
  expect(card('notifications')).toHaveAttribute('data-hidden', 'false')
  expect(undo).toBeEnabled()
  await view.user.click(undo) // 이동 취소 = 시작 상태
  expect(order()).toEqual(['my_tasks', 'unread_mail', 'notifications'])
  expect(undo).toBeDisabled()
})

test('취소·저장 뒤 다시 편집에 들어가면 되돌리기가 꺼져 있다', async () => {
  const view = await openEdit(['my_tasks', 'unread_mail'])
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  expect(screen.getByTestId('dashboard-edit-undo')).toBeEnabled()
  await view.user.click(screen.getByTestId('dashboard-edit-cancel'))
  await view.user.click(await screen.findByTestId('dashboard-edit-toggle'))
  await screen.findByTestId('dashboard-edit-banner')
  expect(screen.getByTestId('dashboard-edit-undo')).toBeDisabled()
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  expect(screen.getByTestId('dashboard-edit-undo')).toBeEnabled()
  await save(view)
  await view.user.click(await screen.findByTestId('dashboard-edit-toggle'))
  await screen.findByTestId('dashboard-edit-banner')
  expect(screen.getByTestId('dashboard-edit-undo')).toBeDisabled()
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

test('위젯 추가 모달 — 「요약」 미리보기에 멘션 수와 「지금 신경 쓸 일」 멘션 줄이 보인다(WP-1141)', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  const preview = within(modal).getByTestId('add-widget-preview')
  await view.user.click(modalCard(modal, 'synthesis'))
  // 샘플의 코멘트 멘션(ISSUE_COMMENT_MENTION) 1건 — 일반 댓글(COMMENTED)은 멘션이 아니라 세지 않는다(WP-1092).
  expect(await within(preview).findByRole('button', { name: '멘션 1건' })).toBeInTheDocument()
  expect(within(preview).getByRole('link', { name: /API 응답 스키마 검토/ })).toHaveTextContent('멘션')
  expect(within(preview).queryByRole('link', { name: /대시보드 위젯 프리뷰 추가/ })).not.toBeInTheDocument()
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

// 이미 고른 항목 수를 다시 눌러도 바뀐 게 없으므로 되돌리기 단계가 생기면 안 된다(키트 기본 count 는 5).
test('이미 고른 항목 수를 다시 눌러도 되돌리기 단계가 생기지 않는다', async () => {
  const view = await openEdit(['my_tasks'])
  await view.user.click(within(within(card('my_tasks')).getByTestId('widget-count-select')).getByRole('button', { name: '5개' }))
  expect(screen.getByTestId('dashboard-edit-undo')).toBeDisabled()
})

// WP-1762 — 바뀐 것 없이 설정 「적용」만 눌러도 되돌리기 단계가 생기지 않는다(눌러도 아무 일 없는 단계 방지).
test('카탈로그 위젯 설정을 바꾸지 않고 적용하면 되돌리기 단계를 남기지 않는다 (WP-1762)', async () => {
  const view = await openEdit([catalog('w-same', 'issue_list', { assignee: 'me' }, '내 이슈')])
  await view.user.click(within(cardById('w-same')).getByTestId('widget-settings'))
  await view.user.click(await screen.findByTestId('widget-settings-apply'))
  expect(screen.getByTestId('dashboard-edit-undo')).toBeDisabled()
})

// WP-1762 — 저장본의 빈 이름은 없음(undefined)·빈 문자열 둘 다 올 수 있고 적용은 빈 이름을 null 로 보낸다 — 어느 쪽이든
// 바뀐 것 없이 적용하면 되돌리기 단계를 남기지 않는다.
test.each([
  ['undefined', undefined],
  ['빈 문자열', ''],
])('이름 없는(%s) 카탈로그 위젯의 설정을 바꾸지 않고 적용하면 되돌리기 단계를 남기지 않는다 (WP-1762)', async (_, label) => {
  const unlabeled = { ...catalog('w-bare', 'issue_list', { assignee: 'me' }), label }
  const view = await openEdit([unlabeled])
  await view.user.click(within(cardById('w-bare')).getByTestId('widget-settings'))
  await view.user.click(await screen.findByTestId('widget-settings-apply'))
  expect(screen.getByTestId('dashboard-edit-undo')).toBeDisabled()
})

test('편집 모드에서도 위젯 제목은 h2 이고 드래그 핸들은 헤딩 밖이다(WP-1885)', async () => {
  await openEdit(['my_tasks', 'unread_mail'])
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings.map((h) => h.textContent)).toEqual(expect.arrayContaining(['내 작업', '메일']))
  for (const h of headings) {
    expect(within(h).queryByTestId('widget-drag-handle')).toBeNull()
    // 위·아래 이동·숨김·테두리 토글 등 어떤 단추도 헤딩 이름에 섞이지 않는다.
    expect(within(h).queryAllByRole('button')).toHaveLength(0)
  }
})

// WP-1941 — 편집 모드 제목(14px/500)도 일반 모드와 같은 섹션 제목 토큰(14px/600)으로 맞춘다.
test('편집 모드 위젯 제목도 일반 모드와 같은 섹션 제목 토큰을 쓴다(WP-1941)', async () => {
  await openEdit(['my_tasks', 'unread_mail'])
  // 위젯 카드 안의 h2 만 본다 — 편집 화면의 다른 h2(대화상자 등)와 묶이지 않게.
  for (const type of ['my_tasks', 'unread_mail']) {
    const h = within(card(type)).getByRole('heading', { level: 2 })
    expect(h).toHaveClass('text-sm', 'leading-5', 'font-semibold')
    expect(h).not.toHaveClass('font-medium')
  }
})

// WP-1888 — 미리보기 안 카탈로그 위젯 제목은 대화상자 제목(h2 「위젯 추가」) 아래라 h3.
test('위젯 추가 미리보기의 카탈로그 위젯 제목은 대화상자 제목(h2) 아래 h3 (WP-1888)', async () => {
  const view = await openEdit(['my_tasks'])
  const modal = await openAddModal(view)
  await view.user.click(modalCard(modal, 'projects'))
  const preview = within(modal).getByTestId('add-widget-preview')
  expect(await within(preview).findByRole('heading', { level: 3, name: '프로젝트' })).toBeInTheDocument()
  expect([...modal.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['위젯 추가'])
})

// WP-1957 — 같은 틱 두 클릭은 re-render 전이라 단추 disabled 로는 막히지 않는다.
// 응답을 붙잡아 두어 두 번째 요청도 기록될 시간을 준다(cycles.test.tsx 와 같은 방식).
test('저장을 같은 틱에 두 번 눌러도 PUT 은 한 번만 나간다 (WP-1957)', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const puts: DashboardWidgetConfig[][] = []
  const view = await renderDashboard(layout(['my_tasks', 'unread_mail']), {
    handlers: [
      http.put('/api/v1/me/dashboard', async ({ request }) => {
        const body = (await request.json()) as { widgets: DashboardWidgetConfig[] }
        puts.push(body.widgets)
        await gate
        return HttpResponse.json(body)
      }),
    ],
  })
  await view.user.click(await screen.findByTestId('dashboard-edit-toggle'))
  await screen.findByTestId('dashboard-edit-banner')
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  const save = screen.getByTestId('dashboard-edit-save')
  // fireEvent 는 매번 다시 그려 두 번째 클릭이 disabled 에 막힌다 — 같은 틱 두 번 클릭은 act 안에서 dispatch 한다.
  act(() => {
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // 응답을 푸는 것도 act 안에서 — 바깥에서 풀면 뮤테이션 상태 갱신이 act 밖에서 일어나 경고·순서 흔들림을 낸다.
  await act(async () => {
    release()
  })
  await waitFor(() => expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument())
  expect(puts).toHaveLength(1)
  expect(puts[0]!.map((w) => w.type)).toEqual(['unread_mail', 'my_tasks'])
})

// WP-1957 — 가드를 성공에서만 풀면 실패 뒤 「저장」 이 조용히 무시된다.
test('저장이 5xx 로 끝나도 다시 눌러 재시도할 수 있다 (WP-1957)', async () => {
  let failNext = true
  const attempts: unknown[] = []
  const view = await renderDashboard(layout(['my_tasks', 'unread_mail']), {
    handlers: [
      http.put('/api/v1/me/dashboard', async ({ request }) => {
        const body = await request.json()
        attempts.push(body)
        if (failNext) {
          failNext = false
          return HttpResponse.json({ message: '저장 실패' }, { status: 500 })
        }
        return HttpResponse.json(body)
      }),
    ],
  })
  await view.user.click(await screen.findByTestId('dashboard-edit-toggle'))
  await screen.findByTestId('dashboard-edit-banner')
  await view.user.click(within(card('my_tasks')).getByTestId('widget-move-down'))
  await view.user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(attempts).toHaveLength(1))
  // 요청이 기록된 시점은 5xx 응답이 아직 클라이언트에 처리되지 않은 순간일 수 있다 — 오류 토스트가 뜨고
  // 「저장」 단추가 다시 활성화된 뒤에 눌러야 재시도가 먹힌다(그 전의 두 번째 클릭은 진행 중 가드에 무시된다).
  await waitFor(() => expect(screen.getByText('저장 실패', { selector: '[data-sonner-toast] *' })).toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('dashboard-edit-save')).toBeEnabled())
  // 편집 모드는 그대로 남아 있어야 재시도할 수 있다.
  expect(screen.getByTestId('dashboard-edit-banner')).toBeInTheDocument()
  await view.user.click(screen.getByTestId('dashboard-edit-save'))
  await waitFor(() => expect(attempts).toHaveLength(2))
  await waitFor(() => expect(screen.queryByTestId('dashboard-edit-banner')).not.toBeInTheDocument())
  // 재시도는 정확히 2회로 끝난다 — 뒤늦게 3번째 PUT 이 잡히지 않는지 끝에서 한 번 더 본다.
  expect(attempts).toHaveLength(2)
})
