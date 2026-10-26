// 프로젝트 설정 「상태」 섹션(WP-809) — 페이지 테스트(WP-971, WP-980).
// 추가·편집·순서 변경 실패·삭제 창(옮길 상태·경고·차단·간단 확인·거절·영향 재조회)·목록 실패·멤버 읽기 전용·개인 프로젝트는
// 브라우저 없이 판정되므로 e2e/pages/projects/settings-statuses.spec.ts 에서 옮겼다(요청 payload·쿼리는 MSW 로 본다).
// 끌기·키보드 집기·⋯ 메뉴 키보드 탐색(@input), #statuses 스크롤(@layout), 대표 목록 렌더(@wiring)는 E2E 에 남는다.
// 범주 마지막 상태의 삭제 비활성은 StatusManagement.test.tsx 가 이미 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { ProjectResponse } from '@/types/project'
import type { ProjectStatus, StatusDeletionImpact } from '@/types/projectStatus'

import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { inServerOrder } from '../../../e2e/factories/projectStatus.factory'

const API = '/api/v1/projects/WP'

/** 상태 6개 — 할 일 2 · 진행 중 2 · 완료 1 · 취소 1. 서버 position 은 범주 순서대로. */
function statuses(): ProjectStatus[] {
  return [
    { id: 1, name: '할 일', category: 'TODO', position: 0, color: 'GRAY' },
    { id: 11, name: '요구사항 정리 대기', category: 'TODO', position: 1, color: 'ORANGE' },
    { id: 2, name: '진행 중', category: 'IN_PROGRESS', position: 2, color: 'BLUE' },
    { id: 12, name: '코드 리뷰 중', category: 'IN_PROGRESS', position: 3, color: 'PURPLE' },
    { id: 13, name: '배포 대기', category: 'IN_PROGRESS', position: 4, color: 'BLUE' },
    { id: 3, name: '완료', category: 'DONE', position: 5, color: 'GREEN' },
    { id: 4, name: '취소', category: 'CANCELED', position: 6, color: 'GRAY' },
  ]
}
const COUNTS: Record<number, number> = { 1: 128, 11: 0, 2: 1204, 12: 3, 13: 0, 3: 7, 4: 2 }

type Call = { method: string; url: URL; body: unknown }
type Opts = {
  role?: 'OWNER' | 'MEMBER'
  project?: ProjectResponse
  impact?: (id: number) => Partial<StatusDeletionImpact>
  orderStatus?: number
  /** 이 테스트만의 응답 — 기본 목보다 먼저 받는다. */
  extra?: RequestHandler[]
}

/**
 * 설정 화면 + 상태 섹션 목(e2e/fixtures/project-settings-mocks 의 mockStatusManagement 와 같은 동작) —
 * 서버처럼 목록을 들고 있어 추가·수정·순서 변경·삭제 뒤 재조회가 바뀐 목록을 받는다. 쓰기 요청은 calls 에 쌓는다.
 */
function settingsApi({ role = 'OWNER', project = createProject(), impact, orderStatus }: Opts = {}) {
  let list = inServerOrder(statuses())
  let nextId = 500
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.clone().text()
    calls.push({ method: request.method, url: new URL(request.url), body: text ? JSON.parse(text) : null })
  }
  const base = `/api/v1/projects/${project.key}`
  const handlers = [
    http.get(base, () => HttpResponse.json(project)),
    http.get(`${base}/members`, () => HttpResponse.json([createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role })])),
    http.get(`${base}/fields`, () => HttpResponse.json([])),
    http.get(`${base}/issues/group-counts`, () =>
      HttpResponse.json({ groupBy: 'statusId', groups: Object.entries(COUNTS).map(([key, count]) => ({ key, count })) }),
    ),
    http.get(`${base}/statuses`, () => HttpResponse.json(list)),
    http.post(`${base}/statuses`, async ({ request }) => {
      await record(request)
      const body = calls.at(-1)!.body as Pick<ProjectStatus, 'name' | 'category' | 'color'>
      const created: ProjectStatus = { id: nextId++, ...body, position: Math.max(...list.map((s) => s.position)) + 1 }
      list = inServerOrder([...list, created])
      return HttpResponse.json(created, { status: 201 })
    }),
    http.put(`${base}/statuses/order`, async ({ request }) => {
      await record(request)
      if (orderStatus) return HttpResponse.json({ status: orderStatus, message: '서버 오류' }, { status: orderStatus })
      const { category, statusIds } = calls.at(-1)!.body as { category: string; statusIds: number[] }
      const positions = list.filter((s) => s.category === category).map((s) => s.position).sort((a, b) => a - b)
      list = inServerOrder(list.map((s) => (s.category === category ? { ...s, position: positions[statusIds.indexOf(s.id)] } : s)))
      return HttpResponse.json(list)
    }),
    http.get(`${base}/statuses/:id/deletion-impact`, ({ params }) => {
      const id = Number(params.id)
      return HttpResponse.json({ issueCount: COUNTS[id] ?? 0, savedViewCount: 0, blockedEpicCount: 0, emptiedFilterViewCount: 0, ...impact?.(id) })
    }),
    http.patch(`${base}/statuses/:id`, async ({ request, params }) => {
      await record(request)
      list = list.map((s) => (s.id === Number(params.id) ? { ...s, ...(calls.at(-1)!.body as object) } : s))
      return HttpResponse.json(list.find((s) => s.id === Number(params.id)))
    }),
    http.delete(`${base}/statuses/:id`, async ({ request, params }) => {
      await record(request)
      list = list.filter((s) => s.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, calls }
}

/** 설정 화면을 열고 상태 행이 뜰 때까지 기다린다. */
async function open(opts: Opts = {}) {
  const api = settingsApi(opts)
  const view = renderPage('/projects/WP/settings', { handlers: [...(opts.extra ?? []), ...api.handlers] })
  await screen.findByTestId('status-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, calls: api.calls }
}

const rowIds = (category: string) =>
  [...screen.getByTestId(`status-category-${category}`).querySelectorAll('[data-testid^="status-row-"]')].map((el) =>
    Number(el.getAttribute('data-testid')!.replace('status-row-', '')),
  )

async function openMenu(user: ReturnType<typeof renderPage>['user'], id: number) {
  await user.click(screen.getByTestId(`status-menu-${id}`))
  return screen.findByRole('menu')
}

describe('설정 상태 — 추가·편집·순서', () => {
  // 중복 이름은 요청 없이 인라인 오류, 새 이름은 고른 색과 함께 POST 하고 범주 끝에 붙는다.
  test('+ 추가 — 중복은 막고, 이름·색을 골라 범주 끝에 만든다', async () => {
    const { user, calls } = await open()
    await user.click(screen.getByTestId('status-add-IN_PROGRESS'))
    const input = screen.getByRole('textbox', { name: '새 상태 이름' })
    expect(input).toHaveFocus()
    await user.paste('코드 리뷰 중')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('status-add-error')).toHaveTextContent('이미 존재하는 상태 이름입니다')
    expect(calls).toHaveLength(0)
    await user.clear(input)
    await user.paste('QA 대기')
    await user.click(screen.getByTestId('status-add-color-PURPLE'))
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ name: 'QA 대기', category: 'IN_PROGRESS', color: 'PURPLE' }]))
    await waitFor(() => expect(rowIds('IN_PROGRESS')).toEqual([2, 12, 13, 500]))
    expect(screen.queryByRole('textbox', { name: '새 상태 이름' })).not.toBeInTheDocument()
  })

  // 서버 거절(409) — 서버 문구를 입력 줄에 보이고 입력값은 남는다.
  test('추가 거절이면 서버 문구를 입력 줄에 보인다', async () => {
    const { user } = await open({
      extra: [http.post(`${API}/statuses`, () => HttpResponse.json({ status: 409, message: '상태는 프로젝트당 20개까지 만들 수 있어요' }, { status: 409 }))],
    })
    await user.click(screen.getByTestId('status-add-TODO'))
    const input = screen.getByRole('textbox', { name: '새 상태 이름' })
    await user.paste('보류')
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('status-add-error')).toHaveTextContent('상태는 프로젝트당 20개까지 만들 수 있어요')
    expect(input).toHaveValue('보류')
  })

  // WP-937 — 그새 같은 이름이 생겨 409 면 서버 문구의 「: 이름」 없이 보드 편집기와 같은 중복 문구, 입력 칸에 초점 유지.
  test('경합 중복 409 는 「: 이름」 없는 중복 문구', async () => {
    const { user } = await open({
      extra: [http.post(`${API}/statuses`, () => HttpResponse.json({ status: 409, message: '이미 존재하는 상태 이름입니다: 보류' }, { status: 409 }))],
    })
    await user.click(screen.getByTestId('status-add-TODO'))
    const input = screen.getByRole('textbox', { name: '새 상태 이름' })
    await user.paste('보류')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByTestId('status-add-error').textContent).toBe('이미 존재하는 상태 이름입니다'))
    expect(input).toHaveValue('보류')
    expect(input).toHaveFocus()
  })

  // 편집 창 — 이름(30자 상한)·색을 바꿔 PATCH, 닫히고 행에 반영.
  test('편집 창으로 이름과 색을 바꾼다', async () => {
    const { user, calls } = await open()
    await openMenu(user, 12)
    await user.click(screen.getByRole('menuitem', { name: '편집' }))
    const dialog = await screen.findByTestId('meta-edit-dialog')
    expect(within(dialog).getByRole('heading', { name: '상태 편집' })).toBeInTheDocument()
    const name = within(dialog).getByLabelText('이름')
    expect(name).toHaveAttribute('maxlength', '30')
    await user.clear(name)
    await user.paste('작업 중')
    await user.click(within(dialog).getByTestId('meta-edit-color-RED'))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([['PATCH', `${API}/statuses/12`, { name: '작업 중', color: 'RED' }]]))
    await waitFor(() => expect(screen.queryByTestId('meta-edit-dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('작업 중')).toBeInTheDocument()
  })

  // ⋯ 위로 이동 → PUT order 가 실패하면 원래 순서로 되돌리고 토스트.
  test('순서 변경 실패면 되돌리고 토스트', async () => {
    const { user, calls } = await open({ orderStatus: 500 })
    await openMenu(user, 12)
    await user.click(screen.getByRole('menuitem', { name: '위로 이동' }))
    await waitFor(() => expect(calls[0]?.body).toEqual({ category: 'IN_PROGRESS', statusIds: [12, 2, 13] }))
    expect(await screen.findByText('순서를 바꾸지 못했어요')).toBeInTheDocument()
    await waitFor(() => expect(rowIds('IN_PROGRESS')).toEqual([2, 12, 13]))
  })
})

describe('설정 상태 — 권한·상태', () => {
  // 화면의 역할 판정 — MEMBER 는 손잡이·⋯·추가가 없는 읽기 전용 목록.
  test('멤버는 읽기 전용 목록을 본다', async () => {
    await open({ role: 'MEMBER' })
    expect(screen.getByTestId('status-row-12')).toHaveTextContent('코드 리뷰 중')
    const section = screen.getByTestId('settings-statuses')
    expect(section.querySelector('[data-testid^="status-drag-"]')).toBeNull()
    expect(section.querySelector('[data-testid^="status-menu-"]')).toBeNull()
    expect(section.querySelector('[data-testid^="status-add-"]')).toBeNull()
  })

  // 목록 실패 — 다시 시도를 보이고 「+ 추가」·범주를 내밀지 않는다. 다시 시도 성공 뒤 목록.
  test('목록을 못 받으면 다시 시도를 보이고 추가를 내밀지 않는다', async () => {
    let fail = true
    const api = settingsApi()
    const { user } = renderPage('/projects/WP/settings', {
      handlers: [
        http.get(`${API}/statuses`, () => (fail ? HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }) : undefined)),
        ...api.handlers,
      ],
    })
    const error = await screen.findByTestId('settings-statuses-error', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(error).toHaveTextContent('상태 목록을 불러오지 못했습니다')
    const section = screen.getByTestId('settings-statuses')
    expect(section.querySelector('[data-testid^="status-add-"]')).toBeNull()
    expect(section.querySelector('[data-testid^="status-category-"]')).toBeNull()
    fail = false
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('status-row-12')).toBeInTheDocument()
    expect(screen.getByTestId('status-add-IN_PROGRESS')).toBeEnabled()
    expect(screen.queryByTestId('settings-statuses-error')).not.toBeInTheDocument()
  })

  // 개인 프로젝트에는 상태 섹션이 없다.
  test('개인 프로젝트는 상태 섹션이 없다', async () => {
    const api = settingsApi({ project: createProject({ type: 'PERSONAL' }) })
    renderPage('/projects/WP/settings', { handlers: api.handlers })
    expect(await screen.findByRole('heading', { name: '라벨' }, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    expect(screen.queryByTestId('settings-statuses')).not.toBeInTheDocument()
  })
})

describe('설정 상태 — 삭제 창', () => {
  /** ⋯ → 삭제로 삭제 창을 연다. */
  async function openDelete(user: ReturnType<typeof renderPage>['user'], id: number) {
    await openMenu(user, id)
    await user.click(screen.getByRole('menuitem', { name: '삭제' }))
    return screen.findByTestId('status-delete-dialog')
  }
  /** 옮길 상태 Select 에서 이름이 name 으로 시작하는 항목을 고른다. */
  async function pickTarget(user: ReturnType<typeof renderPage>['user'], dialog: HTMLElement, name: RegExp) {
    await user.click(within(dialog).getByTestId('status-move-target'))
    await user.click(await screen.findByRole('option', { name }))
  }

  // 이슈 있는 상태 — 기본 옮길 상태는 같은 범주의 기본 상태, 저장된 뷰 안내, 확인 → DELETE ?moveTo=2, 행이 사라진다.
  test('이슈 있는 상태는 옮길 상태를 골라 moveTo 로 지운다', async () => {
    const { user, calls } = await open({ impact: (id) => (id === 12 ? { savedViewCount: 1 } : {}) })
    const dialog = await openDelete(user, 12)
    expect(dialog).toHaveAttribute('data-layout', 'dialog')
    expect(dialog).toHaveTextContent('「코드 리뷰 중」 상태를 삭제할까요?')
    expect(await within(dialog).findByText("저장된 뷰 1개의 필터도 '진행 중'으로 바뀌어요")).toBeInTheDocument()
    expect(within(dialog).getByTestId('status-move-target')).toHaveTextContent('진행 중')
    const confirm = within(dialog).getByTestId('status-delete-confirm')
    expect(confirm).toHaveTextContent('이슈 3개 옮기고 삭제')
    await user.click(confirm)
    await waitFor(() => expect(calls.map((c) => [c.method, c.url.pathname, c.url.searchParams.get('moveTo')])).toEqual([['DELETE', `${API}/statuses/12`, '2']]))
    await waitFor(() => expect(screen.queryByTestId('status-delete-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('status-row-12')).not.toBeInTheDocument())
  })

  // 다른 범주를 고르면 범주 전환 경고가 뜨고, 저장된 뷰 안내가 고른 상태 이름을 따라간다.
  test('다른 범주를 고르면 경고가 뜬다', async () => {
    const { user } = await open({ impact: (id) => (id === 12 ? { savedViewCount: 2 } : {}) })
    const dialog = await openDelete(user, 12)
    await within(dialog).findByText(/저장된 뷰 2개/)
    expect(within(dialog).queryByTestId('status-delete-warning')).not.toBeInTheDocument()
    await pickTarget(user, dialog, /^완료/)
    expect(await within(dialog).findByTestId('status-delete-warning')).toHaveTextContent(
      '범주가 진행 중 → 완료로 바뀌어요. 이슈 3개가 완료로 처리되고 종료 시각이 기록돼요. 담당자에게 알림은 가지 않아요.',
    )
    expect(dialog).toHaveTextContent("저장된 뷰 2개의 필터도 '완료'로 바뀌어요")
    expect(within(dialog).getByTestId('status-delete-confirm')).toBeEnabled()
  })

  // 에픽 차단 — 같은 범주 대상이면 괜찮고, 완료 범주로 옮기려 하면 이유를 보이고 확인이 비활성.
  test('에픽 차단이면 완료로 옮기는 확인이 비활성이다', async () => {
    const { user, calls } = await open({ impact: (id) => (id === 12 ? { blockedEpicCount: 2 } : {}) })
    const dialog = await openDelete(user, 12)
    await waitFor(() => expect(within(dialog).getByTestId('status-delete-confirm')).toBeEnabled())
    await pickTarget(user, dialog, /^완료/)
    expect(await within(dialog).findByText('미완료 하위가 있는 에픽 2개 때문에 완료 범주로 옮길 수 없어요')).toBeInTheDocument()
    expect(within(dialog).getByTestId('status-delete-confirm')).toBeDisabled()
    expect(calls).toHaveLength(0)
  })

  // 이슈 0개 — 옮길 상태 없이 간단 확인, 비워질 뷰 안내, moveTo 없이 DELETE.
  test('이슈 0개 상태는 간단 확인으로 지운다', async () => {
    const { user, calls } = await open({ impact: (id) => (id === 11 ? { emptiedFilterViewCount: 1 } : {}) })
    const dialog = await openDelete(user, 11)
    expect(await within(dialog).findByText(/저장된 뷰 1개에서 이 상태 필터가 빠져요/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('이 상태에 이슈가 없어요.')
    expect(within(dialog).queryByTestId('status-move-target')).not.toBeInTheDocument()
    const confirm = within(dialog).getByTestId('status-delete-confirm')
    expect(confirm).toHaveTextContent('삭제')
    await user.click(confirm)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].url.searchParams.has('moveTo')).toBe(false)
    await waitFor(() => expect(screen.queryByTestId('status-row-11')).not.toBeInTheDocument())
  })

  // 삭제 거절(409) — 창 안에 서버 문구(role=alert), 창은 열린 채.
  test('삭제가 거절되면 창 안에 문구를 보이고 닫지 않는다', async () => {
    const { user } = await open({
      extra: [http.delete(`${API}/statuses/11`, () => HttpResponse.json({ status: 409, message: '범주의 마지막 상태는 지울 수 없어요' }, { status: 409 }))],
    })
    const dialog = await openDelete(user, 11)
    await waitFor(() => expect(within(dialog).getByTestId('status-delete-confirm')).toBeEnabled())
    await user.click(within(dialog).getByTestId('status-delete-confirm'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('범주의 마지막 상태는 지울 수 없어요')
    expect(screen.getByTestId('status-delete-dialog')).toBeInTheDocument()
  })

  // 0개로 열었는데 그새 이슈가 생겨 400 — 영향을 다시 받아 옮길 상태 선택과 「이슈 4개 옮기고 삭제」를 내밀고, 확인하면 moveTo 로.
  test('그새 이슈가 생겨 400 이면 영향을 다시 받아 옮길 상태를 고르게 한다', async () => {
    let impactCalls = 0
    const { user, calls } = await open({
      impact: (id) => (id === 11 ? { issueCount: impactCalls++ === 0 ? 0 : 4 } : {}),
      extra: [
        http.delete(`${API}/statuses/11`, ({ request }) =>
          new URL(request.url).searchParams.has('moveTo') ? undefined : HttpResponse.json({ status: 400, message: '옮길 상태를 골라 주세요' }, { status: 400 }),
        ),
      ],
    })
    const dialog = await openDelete(user, 11)
    await waitFor(() => expect(within(dialog).getByTestId('status-delete-confirm')).toHaveTextContent('삭제'))
    expect(within(dialog).queryByTestId('status-move-target')).not.toBeInTheDocument()
    await user.click(within(dialog).getByTestId('status-delete-confirm'))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('옮길 상태를 골라 주세요')
    expect(await within(dialog).findByTestId('status-move-target')).toHaveTextContent('할 일')
    const confirm = within(dialog).getByTestId('status-delete-confirm')
    expect(confirm).toHaveTextContent('이슈 4개 옮기고 삭제')
    expect(impactCalls).toBe(2)
    await user.click(confirm)
    await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('moveTo')).toBe('1'))
    await waitFor(() => expect(screen.queryByTestId('status-delete-dialog')).not.toBeInTheDocument())
  })
})
