// 팀 리스트 뷰 일괄 작업(#606) — 페이지 테스트(WP-980).
// 체크박스 다중 선택 + 일괄 툴바(상태 변경·담당자 지정·삭제)의 선택 개수·요청 payload·부분 실패·토스트는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-list-bulk.spec.ts 에서 모두 옮겼다(그 spec 은 지웠다).
// 화면 테스트(WP-1002) — 필터 바·목록/보드·툴바가 한 화면의 URL 상태를 나눠 써 프로젝트 상세 화면만 renderProjectScreen 으로 띄운다(App·앱 셸 없이).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, bodyOf, type Call, ISSUES, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { createMember } from '../../../e2e/factories/project.factory'
import { inServerOrder, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'

type Issue = ReturnType<typeof createIssue>

/** 목록 + 멤버(김개발) + 이슈 쓰기 요청 기록. write 가 응답을 정한다(기본 200 빈 이슈). */
function setup(issues: Issue[], write: (call: Call, num: number) => Response | undefined = () => undefined) {
  const calls: Call[] = []
  const handlers = [
    ...projectMeta([createMember({ userId: 2, name: '김개발', username: 'kim' })]),
    http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])),
    issueSearch(() => issues).handler,
    http.all(`${ISSUES}/:num/:sub?`, async ({ request, params }) => {
      if (request.method === 'GET') return undefined
      const call = { method: request.method, path: new URL(request.url).pathname, body: await bodyOf(request) }
      calls.push(call)
      const num = Number(params.num)
      return write(call, num) ?? (request.method === 'DELETE' ? new HttpResponse(null, { status: 204 }) : HttpResponse.json(createIssue({ number: num })))
    }),
  ]
  return { handlers, calls }
}

async function open(issues: Issue[], write?: Parameters<typeof setup>[1], extra: RequestHandler[] = []) {
  const api = setup(issues, write)
  const page = renderProjectScreen(`/projects/${KEY}`, { handlers: [...extra, ...api.handlers] })
  await screen.findByTestId(`issue-row-${issues[0].number}`, {}, { timeout: SCREEN_LOAD_TIMEOUT })
  return { ...page, api }
}

const AB = () => [createIssue({ id: 1, number: 7, title: '이슈A', status: 'TODO' }), createIssue({ id: 2, number: 8, title: '이슈B', status: 'TODO' })]
const toolbar = () => screen.getByTestId('issue-bulk-toolbar')
/** 이슈 번호 → 본문 — 순서와 무관하게 비교한다. */
const byNumber = (calls: Call[]) =>
  calls.map((c) => ({ number: Number(c.path.match(/issues\/(\d+)/)?.[1]), body: c.body })).sort((a, b) => a.number - b.number)

async function selectBoth(user: ReturnType<typeof renderProjectScreen>['user']) {
  await user.click(screen.getByTestId('select-issue-7'))
  await user.click(screen.getByTestId('select-issue-8'))
}

describe('팀 리스트 뷰 — 일괄 작업 (#606)', () => {
  test('체크박스 선택 시 일괄 툴바에 선택 개수가 보이고, 행 이동을 일으키지 않으며, 해제하면 사라진다', async () => {
    const { user, location } = await open(AB())
    expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('select-issue-7'))
    expect(toolbar()).toHaveTextContent('선택 1개')
    await user.click(screen.getByTestId('select-issue-8'))
    expect(toolbar()).toHaveTextContent('선택 2개')
    // 체크박스 클릭이 상세 이동을 일으키지 않는다.
    expect(location()).toBe(`/projects/${KEY}`)

    await user.click(screen.getByTestId('bulk-clear'))
    expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument()
  })

  test('전체선택 — 체크하면 모든 행이 선택되고, 해제하면 모두 풀린다', async () => {
    const { user } = await open(AB())
    await user.click(screen.getByTestId('issue-select-all'))
    expect(toolbar()).toHaveTextContent('선택 2개')
    expect(screen.getByTestId('select-issue-7')).toBeChecked()
    expect(screen.getByTestId('select-issue-8')).toBeChecked()

    await user.click(screen.getByTestId('issue-select-all'))
    expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument()
  })

  // WP-1071 — 일부만 고르면 머리 체크박스가 빈칸이 아니라 「일부 선택」이고, 누르면 전체를 고른다.
  test('일부만 고르면 전체선택이 「일부 선택」으로 보이고, 누르면 모두 고른다', async () => {
    const { user } = await open(AB())
    const selectAll = screen.getByTestId('issue-select-all')
    expect(selectAll).not.toBePartiallyChecked()
    await user.click(screen.getByTestId('select-issue-7'))
    expect(selectAll).toBePartiallyChecked()
    expect(selectAll).not.toBeChecked()

    await user.click(selectAll)
    expect(toolbar()).toHaveTextContent('선택 2개')
    expect(selectAll).toBeChecked()
    expect(selectAll).not.toBePartiallyChecked()

    // 고른 것을 모두 풀면 다시 빈칸
    await user.click(screen.getByTestId('select-issue-7'))
    expect(selectAll).toBePartiallyChecked()
    await user.click(screen.getByTestId('select-issue-8'))
    expect(selectAll).not.toBePartiallyChecked()
    expect(selectAll).not.toBeChecked()
  })

  test('일괄 상태 변경 — 선택 항목마다 PATCH .../status { statusId }, 끝나면 선택 해제 + 결과 토스트', async () => {
    const { user, api } = await open(AB())
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-status-trigger'))
    // 옵션은 프로젝트 상태(기본 4상태) — 「완료」(id 3)를 고르면 statusId 로 보낸다(WP-869).
    await user.click(await screen.findByTestId('bulk-status-option-3'))

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls.every((c) => c.method === 'PATCH' && c.path.endsWith('/status'))).toBe(true)
    expect(byNumber(api.calls)).toEqual([
      { number: 7, body: { statusId: 3 } },
      { number: 8, body: { statusId: 3 } },
    ])
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
    expect(await screen.findByText(/2개 상태를 변경했습니다/)).toBeInTheDocument()
  })

  // WP-869 — 일괄 바가 범주 4개만 보여 사용자 정의 상태(「검토 중」)로는 일괄 변경할 수 없었다.
  test('일괄 상태 변경은 프로젝트 상태 목록을 범주별로 보이고 statusId 로 보낸다', async () => {
    const statuses = http.get(`${API}/projects/${KEY}/statuses`, () => HttpResponse.json(inServerOrder(withCustomStatuses('설계', '검토 중'))))
    const { user, api } = await open(AB(), () => HttpResponse.json(createIssue({ status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중' })), [statuses])
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-status-trigger'))

    // 범주 제목 아래 그 범주 상태가 표시 순서대로 — 진행 중 묶음은 진행 중·설계·검토 중.
    const group = await screen.findByTestId('bulk-status-group-IN_PROGRESS')
    expect(group).toHaveTextContent('진행 중')
    expect(within(group).getAllByRole('menuitem').map((el) => el.textContent?.trim())).toEqual(['진행 중', '설계', '검토 중'])
    expect(within(screen.getByTestId('bulk-status-group-DONE')).getAllByRole('menuitem').map((el) => el.textContent?.trim())).toEqual(['완료'])
    await user.click(screen.getByTestId('bulk-status-option-12'))

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(byNumber(api.calls)).toEqual([
      { number: 7, body: { statusId: 12 } },
      { number: 8, body: { statusId: 12 } },
    ])
  })

  // WP-851 — 부분 실패여도 선택이 모두 풀려 어느 이슈가 실패했는지 알 수 없었다.
  test('일괄 상태 변경 부분 실패 — 실패한 이슈만 선택에 남고 토스트에 그 키가 나온다', async () => {
    const { user } = await open(AB(), (_c, num) =>
      num === 8 ? HttpResponse.json({ status: 409, message: '다른 사람이 먼저 바꿨습니다' }, { status: 409 }) : undefined,
    )
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-status-trigger'))
    await user.click(await screen.findByTestId('bulk-status-option-2'))

    expect(
      await screen.findByText('1개 상태를 변경했습니다. 1건(WP-8)은 상태를 변경하지 못했습니다: 다른 사람이 먼저 바꿨습니다'),
    ).toBeInTheDocument()
    // 실패한 WP-8 만 선택된 채 일괄 바가 남아 바로 다시 시도할 수 있다.
    await waitFor(() => expect(toolbar()).toHaveTextContent('선택 1개'))
    expect(screen.getByTestId('select-issue-8')).toBeChecked()
    expect(screen.getByTestId('select-issue-7')).not.toBeChecked()
  })

  // WP-606 — 기본 목록은 활성 사이클 밖 종료 이슈를 숨겨, 일괄 완료한 행이 이유 없이 사라졌다.
  test('일괄 완료로 숨겨지는 이슈가 있으면 토스트에 이유와 「모두 보기」를 붙인다', async () => {
    const cycleLookups: string[] = []
    const cycles = http.get(`${ISSUES}/:num/cycles`, ({ params }) => {
      cycleLookups.push(String(params.num))
      return HttpResponse.json([])
    })
    const { user, location } = await open(AB(), () => HttpResponse.json(createIssue({ status: 'DONE' })), [cycles])
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-status-trigger'))
    await user.click(await screen.findByTestId('bulk-status-option-3'))

    const message = await screen.findByText('2개 상태를 변경했습니다 — 활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다')
    await waitFor(() => expect(cycleLookups.sort()).toEqual(['7', '8']))
    const toast = message.closest('[data-sonner-toast]') as HTMLElement
    // 토스트는 pointerdown 에 setPointerCapture(jsdom 미구현)를 불러 click 만 보낸다.
    fireEvent.click(within(toast).getByRole('button', { name: '모두 보기' }))
    await waitFor(() => expect(location()).toMatch(/closed=all/))
  })

  test('일괄 담당자 지정 — 선택 항목마다 PUT .../assignees { userIds }', async () => {
    const { user, api } = await open(AB(), () => HttpResponse.json([]))
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-assignee-trigger'))
    await user.click(await screen.findByTestId('bulk-assignee-option-2'))

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls.every((c) => c.method === 'PUT' && c.path.endsWith('/assignees'))).toBe(true)
    expect(byNumber(api.calls)).toEqual([
      { number: 7, body: { userIds: [2] } },
      { number: 8, body: { userIds: [2] } },
    ])
  })

  test('일괄 삭제 — 확인창(하위 태스크 수 안내) 뒤 선택 항목마다 DELETE', async () => {
    // WP-482: 하위 태스크가 있는 부모 — 확인창이 함께 지워질 하위 수를 알려야 한다.
    const { user, api } = await open([
      createIssue({ id: 1, number: 7, title: '이슈A', childCount: 2 }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ])
    await selectBoth(user)
    await user.click(screen.getByTestId('bulk-delete'))
    expect(await screen.findByTestId('issue-bulk-delete-dialog')).toHaveTextContent(
      '선택한 2개 태스크를 삭제할까요? 하위 태스크 2개도 함께 삭제됩니다.',
    )
    expect(api.calls).toHaveLength(0)
    await user.click(screen.getByTestId('issue-bulk-delete-confirm'))

    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls.every((c) => c.method === 'DELETE')).toBe(true)
    expect(byNumber(api.calls).map((c) => c.number)).toEqual([7, 8])
  })

  // #716 — 체크박스 토글 1회에 클릭 대상 외 행까지 다시 그려지던(React.memo 부재) 회귀 방지.
  test('체크박스 토글 시 클릭 대상 외 행의 체크박스는 DOM 변경이 없다 (#716)', async () => {
    const { user } = await open([
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
      createIssue({ id: 3, number: 9, title: '이슈C' }),
    ])
    let mutations = 0
    const observer = new MutationObserver((list) => {
      mutations += list.length
    })
    observer.observe(screen.getByTestId('select-issue-8'), { attributes: true })

    await user.click(screen.getByTestId('select-issue-7'))
    expect(toolbar()).toHaveTextContent('선택 1개')
    observer.disconnect()
    expect(mutations).toBe(0)
  })
})
