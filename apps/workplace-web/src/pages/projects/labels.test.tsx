// 라벨 — 페이지 테스트(WP-971, WP-980).
// 설정 화면의 라벨 권한(WP-394)·편집(#160, WP-660)·삭제와 영향 안내(#148, WP-488)·행 hover 클래스(#308)·헤더 복귀(#667),
// 목록 화면의 라벨 필터 칩(AND 표기 #626, 삭제된 라벨 #609)은 브라우저 없이 판정되므로 e2e/pages/projects/labels.spec.ts 에서 옮겼다.
// 설정에서 만든 라벨을 목록 필터에 적용하는 여러 화면 흐름(@flow)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { ColorToken, LabelResponse } from '@/types/label'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createLabel } from '../../../e2e/factories/label.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const API = '/api/v1/projects/WP'
type Call = { method: string; path: string; body: unknown }

/** 설정 화면 목 — 라벨 목록은 labels 배열을 그대로 준다(POST 는 쌓는다). 쓰기 요청은 calls 에. */
function settingsApi(labels: LabelResponse[], role: 'OWNER' | 'MEMBER' = 'OWNER', extra: RequestHandler[] = []) {
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    const call = { method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null }
    calls.push(call)
    return call
  }
  const handlers = [
    ...extra,
    http.get(API, () => HttpResponse.json(createProject())),
    http.get(`${API}/members`, () =>
      HttpResponse.json([
        createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role }),
        createMember({ userId: 2, username: 'owner', name: '오너', role: 'OWNER' }),
      ]),
    ),
    http.get(`${API}/fields`, () => HttpResponse.json([])),
    http.get(`${API}/issues/group-counts`, () => HttpResponse.json({ groupBy: 'statusId', groups: [] })),
    http.get(`${API}/labels`, () => HttpResponse.json(labels)),
    http.post(`${API}/labels`, async ({ request }) => {
      const { body } = await record(request)
      const created = createLabel({ id: 3, ...(body as { name: string; colorToken: ColorToken }), viewerCanManage: true })
      labels.push(created)
      return HttpResponse.json(created)
    }),
  ]
  return { handlers, calls, record }
}

/** 목록 화면 목 — 이슈 1건, 라벨 목록은 labels. */
function listApi(labels: LabelResponse[]) {
  return [
    http.get(API, () => HttpResponse.json(createProject())),
    http.get(`${API}/labels`, () => HttpResponse.json(labels)),
    http.get(`${API}/views`, () => HttpResponse.json([])),
    http.get(`${API}/issues`, () => HttpResponse.json(createIssueSearchResponse([createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })], null))),
  ]
}

describe('라벨 — 설정 화면', () => {
  // WP-394 — 일반 멤버도 라벨을 추가하고(GRAY 기본), 수정·삭제 버튼은 viewerCanManage 라벨에만 보인다.
  test('멤버도 추가하고, 수정·삭제는 손댈 수 있는 라벨에만 보인다', async () => {
    const labels = [
      createLabel({ id: 1, name: '남의라벨', colorToken: 'RED', viewerCanManage: false }),
      createLabel({ id: 2, name: '내라벨', colorToken: 'BLUE', viewerCanManage: true }),
    ]
    const api = settingsApi(labels, 'MEMBER')
    const { user } = renderPage('/projects/WP/settings', { handlers: api.handlers })
    const form = await screen.findByTestId('label-create-form', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(await screen.findByTestId('label-row-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '남의라벨 편집' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '남의라벨 삭제' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '내라벨 편집' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '내라벨 삭제' })).toBeInTheDocument()

    await user.click(within(form).getByLabelText('이름'))
    await user.paste('새라벨')
    await user.click(within(form).getByRole('button', { name: '추가' }))
    await waitFor(() => expect(api.calls.map((c) => c.body)).toEqual([{ name: '새라벨', colorToken: 'GRAY' }]))
    expect(await screen.findByRole('button', { name: '새라벨 삭제' })).toBeInTheDocument()
  })

  // #160, WP-660 — 편집 창은 현재 이름·색으로 열리고, 겹치는 이름(409)이면 창 안 오류로 남고, 고친 이름+고른 색을 함께 보낸다.
  test('편집 — 이름·색 함께 수정, 이름이 겹치면 창 안 오류', async () => {
    const label = createLabel({ name: '원래이름', colorToken: 'GRAY' })
    const updates: unknown[] = []
    const api = settingsApi([label], 'OWNER', [
      http.all(`${API}/labels/${label.id}`, async ({ request }) => {
        if (request.method !== 'PUT' && request.method !== 'PATCH') return undefined
        const body = (await request.json()) as { name: string; colorToken: ColorToken }
        updates.push(body)
        if (body.name === '다른라벨') return HttpResponse.json({ status: 409, message: '이미 존재하는 라벨 이름입니다: 다른라벨' }, { status: 409 })
        Object.assign(label, body)
        return HttpResponse.json(label)
      }),
    ])
    const { user } = renderPage('/projects/WP/settings', { handlers: api.handlers })
    const row = await screen.findByTestId(`label-row-${label.id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(row).getByRole('button', { name: '원래이름 편집' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('라벨 편집')
    const input = within(dialog).getByLabelText('이름')
    expect(input).toHaveValue('원래이름')
    await waitFor(() => expect(input).toHaveFocus())
    expect(within(dialog).getByTestId('meta-edit-color-GRAY')).toHaveAttribute('aria-pressed', 'true')

    await user.clear(input)
    await user.paste('다른라벨')
    await user.click(within(dialog).getByTestId('meta-edit-color-BLUE'))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('이미 존재하는 라벨 이름입니다: 다른라벨')
    expect(input).toHaveValue('다른라벨')

    await user.clear(input)
    await user.paste('새이름')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(updates.at(-1)).toEqual({ name: '새이름', colorToken: 'BLUE' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  // #148, WP-488 — 삭제는 붙은 이슈 수를 알리는 확인창을 거쳐 DELETE, 행이 사라진다.
  test('삭제 — 영향 안내 확인창 뒤 DELETE', async () => {
    const label = createLabel({ name: '삭제대상', colorToken: 'RED' })
    const labels = [label]
    const deletes: string[] = []
    const api = settingsApi(labels, 'OWNER', [
      http.get(`${API}/labels/${label.id}/issue-count`, () => HttpResponse.json({ count: 3 })),
      http.delete(`${API}/labels/${label.id}`, ({ request }) => {
        deletes.push(new URL(request.url).pathname)
        labels.splice(0)
        return new HttpResponse(null, { status: 204 })
      }),
    ])
    const { user } = renderPage('/projects/WP/settings', { handlers: api.handlers })
    const row = await screen.findByTestId(`label-row-${label.id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(row).getByRole('button', { name: '삭제대상 삭제' }))
    const alert = await screen.findByRole('alertdialog')
    expect(await within(alert).findByTestId('delete-impact')).toHaveTextContent('이 라벨이 붙은 이슈 3개에서 라벨이 빠집니다.')
    const buttons = within(alert).getAllByRole('button', { name: '삭제' })
    await user.click(buttons[buttons.length - 1])
    await waitFor(() => expect(deletes).toEqual([`${API}/labels/${label.id}`]))
    await waitFor(() => expect(screen.queryByTestId(`label-row-${label.id}`)).not.toBeInTheDocument())
  })

  // WP-488 — 붙은 이슈가 0건이면 영향 안내를 그리지 않는다.
  test('삭제 확인창 — 붙은 이슈가 없으면 영향 안내가 없다', async () => {
    const label = createLabel({ name: '빈라벨', colorToken: 'GRAY' })
    let counted = 0
    const api = settingsApi([label], 'OWNER', [
      http.get(`${API}/labels/${label.id}/issue-count`, () => {
        counted++
        return HttpResponse.json({ count: 0 })
      }),
    ])
    const { user } = renderPage('/projects/WP/settings', { handlers: api.handlers })
    const row = await screen.findByTestId(`label-row-${label.id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(row).getByRole('button', { name: '빈라벨 삭제' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    await waitFor(() => expect(counted).toBeGreaterThan(0))
    expect(screen.queryByTestId('delete-impact')).not.toBeInTheDocument()
  })

  // #308 — 라벨 행은 클릭 가능 행의 hover 피드백 클래스를 갖는다.
  test('라벨 행에 hover 스타일 클래스가 붙는다', async () => {
    const label = createLabel({ name: 'hover-test', colorToken: 'BLUE' })
    renderPage('/projects/WP/settings', { handlers: settingsApi([label]).handlers })
    const row = await screen.findByTestId(`label-row-${label.id}`, {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(row).toHaveClass('hover:bg-accent/50', 'transition-colors')
  })

  // #667 — 설정 화면 헤더에 프로젝트 키와 「프로젝트로 돌아가기」, 누르면 프로젝트 홈.
  test('헤더의 프로젝트 복귀 버튼', async () => {
    const { user, location } = renderPage('/projects/WP/settings', { handlers: [...settingsApi([]).handlers, ...listApi([])] })
    const header = await screen.findByTestId('page-header', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(header).toHaveTextContent('WP'))
    await user.click(within(header).getByRole('button', { name: '프로젝트로 돌아가기' }))
    // 이동은 전환(startTransition)이라 프로젝트 화면 모듈을 처음 불러올 때까지 주소가 바뀌지 않는다 — 첫 화면 대기 시간을 준다.
    await waitFor(() => expect(location()).toBe('/projects/WP'), { timeout: PAGE_LOAD_TIMEOUT })
  })
})

describe('라벨 — 목록 필터 칩', () => {
  // #626 — 라벨 facet 은 고르기 전부터 AND 안내, 1개면 표기 없음, 2개면 「외 1 (모두 포함)」과 title, URL 은 두 id.
  test('라벨 2개 이상이면 AND(모두 포함) 표기', async () => {
    const a = createLabel({ name: '라벨A', colorToken: 'RED' })
    const b = createLabel({ name: '라벨B', colorToken: 'BLUE' })
    const { user, location } = renderPage('/projects/WP', { handlers: listApi([a, b]) })
    await screen.findByTestId('issue-row-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(screen.getByTestId('add-filter-trigger'))
    await user.click(await screen.findByTestId('add-filter-facet-label'))
    expect(await screen.findByTestId('facet-value-label-and-hint')).toHaveTextContent('모두 가진')

    await user.click(screen.getByTestId(`facet-value-label-${a.id}`))
    const chip = await screen.findByTestId('filter-chip-label')
    expect(chip).not.toHaveTextContent('모두 포함')

    await user.click(screen.getByTestId(`facet-value-label-${b.id}`))
    await waitFor(() => expect(screen.getByTestId('filter-chip-label')).toHaveTextContent('외 1'))
    const chip2 = screen.getByTestId('filter-chip-label')
    expect(chip2).toHaveTextContent('모두 포함')
    expect(screen.getByTestId('filter-chip-label-and')).toBeInTheDocument()
    expect(chip2.getAttribute('title')).toMatch(/모두 가진/)
    const label = new URLSearchParams(location().split('?')[1]).get('label')
    expect(label?.split(',').map(Number).sort()).toEqual([a.id, b.id].sort())
  })

  // #609 — 지워진 라벨 id 를 가리키는 URL 필터는 원시 id 대신 「알 수 없음」.
  test('삭제된 라벨을 가리키는 필터는 플레이스홀더를 보인다', async () => {
    renderPage('/projects/WP?label=99999', { handlers: listApi([]) })
    const chip = await screen.findByTestId('filter-chip-label', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(chip).toHaveTextContent('알 수 없음')
    expect(chip).not.toHaveTextContent('99999')
  })
})
