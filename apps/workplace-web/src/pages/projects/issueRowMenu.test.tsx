// 이슈 행·카드 「⋯」/우클릭 메뉴(WP-273) — 화면 테스트(WP-971, WP-1002 에서 목록 화면(ProjectDetailPage)만 띄우게 바꿈).
// 메뉴 항목 구성(권한·선택 여부)과 고른 항목의 요청 payload 는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-row-menu.spec.ts 에서 옮겼다. 호버 때만 보이는 ⋯(@input)과 클립보드 복사(@platform)는 E2E 에 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import type { ScreenUser } from '@/test/renderScreen'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createAgentMember, createMember, createProject } from '../../../e2e/factories/project.factory'
import { statusFieldsOf } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`

// 보는 사람(id 1)은 OWNER 가 아닌 MEMBER — 삭제는 보고자일 때만 보여야 한다.
const ME = createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'MEMBER' })
const KIM = createMember({ userId: 2, name: '김개발', username: 'kim', role: 'MEMBER' })
const BOT = createAgentMember({ userId: 99, name: '트리스타나' })
const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 3, childDoneCount: 1 })
const A = createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 세션 만료 처리', type: makeTaskType(), status: 'TODO', priority: 'MID', reporterId: 1, assignees: [{ id: 2, username: 'kim', name: '김개발', kind: 'HUMAN' }] })
const B = createIssue({ id: 2, number: 8, projectKey: KEY, title: '알림 인박스 지연', type: makeTaskType(), status: 'TODO', priority: 'LOW', reporterId: 5 })
const C = createIssue({ id: 3, number: 9, projectKey: KEY, title: '첨부 미리보기 깨짐', type: makeTaskType(), status: 'IN_PROGRESS', priority: 'HIGH', reporterId: 1 })

type Call = { method: string; path: string; body: unknown }

/** 목록·메타·변경 API — 변경은 메모리 db 에 반영해 재조회에도 유지된다. 쓰기 요청은 calls 에 쌓는다. */
function issueApi(members = [ME, KIM, BOT]) {
  const db = new Map([A, B, C].map((i) => [i.number, structuredClone(i)]))
  const calls: Call[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json(members)),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(ISSUES, ({ request }) => {
      const url = new URL(request.url)
      const status = url.searchParams.get('status')
      const all = [...db.values()]
      const list =
        url.searchParams.get('type') === String(makeEpicType().id)
          ? [EPIC]
          : status
            ? all.filter((i) => status.split(',').includes(i.status))
            : all
      return HttpResponse.json(createIssueSearchResponse(list, null))
    }),
    http.all(`${ISSUES}/:num/:sub?`, async ({ request, params }) => {
      if (request.method === 'GET') return undefined
      const num = Number(params.num)
      const sub = params.sub as string | undefined
      const text = await request.text()
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : null
      calls.push({ method: request.method, path: new URL(request.url).pathname, body })
      const it = db.get(num)
      if (request.method === 'DELETE') {
        db.delete(num)
        return new HttpResponse(null, { status: 204 })
      }
      if (it && sub === 'status') Object.assign(it, body?.statusId != null ? statusFieldsOf(body.statusId as number) : { status: body?.status })
      if (it && sub === undefined && body?.priority) it.priority = body.priority as typeof it.priority
      if (it && sub === 'assignees') {
        it.assignees = (body?.userIds as number[]).map((id) => {
          const m = members.find((x) => x.userId === id)!
          return { id, username: m.username, name: m.name, kind: m.kind }
        })
        return HttpResponse.json(it.assignees)
      }
      return HttpResponse.json(it ?? {})
    }),
  ]
  return { handlers, calls }
}

/**
 * 하위 메뉴를 연다 — jsdom 은 레이아웃이 없어 Radix 하위 메뉴의 포인터 유예 영역 계산이 늘 「벗어남」이라
 * 호버로 열면 항목으로 포인터를 옮기는 순간 닫힌다. 키보드(→)로 열면 같은 메뉴 상태를 레이아웃 없이 만든다.
 */
async function openSubmenu(user: ScreenUser, testId: string) {
  ;(await screen.findByTestId(testId)).focus()
  await user.keyboard('{ArrowRight}')
}

/** 목록(또는 보드)을 열고 첫 행이 뜰 때까지 기다린다. */
async function open(view = 'list&group=none', members?: Parameters<typeof issueApi>[0]) {
  const api = issueApi(members)
  const page = renderProjectScreen(`/projects/${KEY}?view=${view}`, { handlers: api.handlers })
  await screen.findByTestId(view.startsWith('board') ? 'issue-card-7' : 'issue-row-7')
  return { ...page, api }
}

describe('이슈 행 메뉴 — 목록', () => {
  test('우클릭 → 상태 › 진행 중 → PATCH statusId, 행 아이콘이 바로 바뀐다', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-8') })
    await openSubmenu(user, 'row-menu-status')
    await user.click(await screen.findByTestId('row-menu-status-2'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PATCH', path: `${ISSUES}/8/status`, body: { statusId: 2 } }]))
    await waitFor(() => expect(screen.queryByTestId('issue-row-menu')).not.toBeInTheDocument())
    expect(await within(screen.getByTestId('issue-row-8')).findByLabelText('상태: 진행 중')).toBeInTheDocument()
  })

  test('우선순위 › 높음 → PATCH issue { priority: HIGH }', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-8') })
    await openSubmenu(user, 'row-menu-priority')
    await user.click(await screen.findByTestId('row-menu-priority-HIGH'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PATCH', path: `${ISSUES}/8`, body: { priority: 'HIGH' } }]))
  })

  test('담당자 › 체크 토글은 기존 담당자를 유지한 채 추가·제거하고, 메뉴는 열려 있다', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    await openSubmenu(user, 'row-menu-assignee')
    expect(await screen.findByTestId('row-menu-assignee-2')).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByTestId('row-menu-assignee-1'))
    await waitFor(() => expect(api.calls[0]).toEqual({ method: 'PUT', path: `${ISSUES}/7/assignees`, body: { userIds: [2, 1] } }))
    await waitFor(() => expect(screen.getByTestId('row-menu-assignee-1')).toHaveAttribute('aria-checked', 'true'))
    await user.click(screen.getByTestId('row-menu-assignee-2'))
    await waitFor(() => expect(api.calls[1]?.body).toEqual({ userIds: [1] }))
  })

  // WP-1160: 후보를 지금 담당자로 다시 계산해, 정지된 담당자를 해제하는 순간 줄이 말없이 사라졌다. 메뉴를 연 동안은 줄이 남아
  // 해제한 것이 보이고, 서버가 정지된 사람을 새로 넣는 것을 거부하므로(WP-487) 다시 체크는 막힌다(담당자 선택기와 같음).
  test('담당자 › 정지된 담당자를 해제해도 메뉴를 연 동안 줄이 남고, 다시 체크는 막힌다', async () => {
    const { user, api } = await open('list&group=none', [ME, { ...KIM, active: false }, BOT])
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    await openSubmenu(user, 'row-menu-assignee')
    const kim = await screen.findByTestId('row-menu-assignee-2')
    expect(kim).toHaveAttribute('aria-checked', 'true')
    expect(kim).not.toHaveAttribute('aria-disabled')
    expect(kim).toHaveTextContent('비활성')
    await user.click(kim)
    await waitFor(() => expect(api.calls[0]).toEqual({ method: 'PUT', path: `${ISSUES}/7/assignees`, body: { userIds: [] } }))
    await waitFor(() => expect(screen.getByTestId('row-menu-assignee-2')).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByTestId('row-menu-assignee-2')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByTestId('row-menu-assignee-2'))
    expect(api.calls).toHaveLength(1)
  })

  test('AI에게 맡기기 → 기존 담당자 + AI 멤버로 PUT, 이미 AI 담당이면 항목이 없다', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    await user.click(await screen.findByTestId('row-menu-ai'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PUT', path: `${ISSUES}/7/assignees`, body: { userIds: [2, 99] } }]))
    expect(await screen.findByText('트리스타나에게 맡겼습니다')).toBeInTheDocument()
    // 낙관적 반영 — 같은 행 메뉴를 다시 열면 위임 상태라 AI 항목이 사라진다.
    await waitFor(() => expect(screen.queryByTestId('issue-row-menu')).not.toBeInTheDocument())
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    expect(await screen.findByTestId('row-menu-status')).toBeInTheDocument()
    expect(screen.queryByTestId('row-menu-ai')).not.toBeInTheDocument()
  })

  test('같은 메뉴에서 담당자를 뺀 뒤 AI에게 맡기면 뺀 사람을 되살리지 않는다', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    await openSubmenu(user, 'row-menu-assignee')
    await user.click(await screen.findByTestId('row-menu-assignee-2'))
    await waitFor(() => expect(api.calls).toHaveLength(1))
    // 하위 메뉴만 닫고(←) 같은 메뉴에서 이어서 위임한다.
    await user.keyboard('{ArrowLeft}')
    await user.click(screen.getByTestId('row-menu-ai'))
    await waitFor(() => expect(api.calls.map((c) => c.body)).toEqual([{ userIds: [] }, { userIds: [99] }]))
  })

  test('에픽 › 결제 안정화 → PUT parent', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-8') })
    await openSubmenu(user, 'row-menu-epic')
    await user.click(await screen.findByTestId('row-menu-epic-10'))
    await waitFor(() => expect(api.calls[0]).toMatchObject({ path: `${ISSUES}/8/parent`, body: { parentNumber: 10 } }))
  })

  test('보고자가 아니면(OWNER 도 아님) 삭제 항목이 없고, 보고자면 확인 뒤 DELETE', async () => {
    const { user, api } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-8') })
    expect(await screen.findByTestId('row-menu-status')).toBeInTheDocument()
    expect(screen.queryByTestId('row-menu-delete')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('issue-row-menu')).not.toBeInTheDocument())

    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-7') })
    await user.click(await screen.findByTestId('row-menu-delete'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('로그인 세션 만료 처리')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'DELETE', path: `${ISSUES}/7`, body: null }]))
  })

  test('「채팅·이슈로 보내기…」는 그 이슈 링크로 대화상자를 연다(WP-1236)', async () => {
    const { closeSendToChat, sendToChatTarget } = await import('@/lib/sendToChat')
    const { user } = await open()
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-9') })
    await user.click(await screen.findByTestId('row-menu-send-to-chat'))
    await waitFor(() =>
      expect(sendToChatTarget()).toMatchObject({ kind: 'issue', url: expect.stringMatching(/\/issues\/9$/), key: expect.stringMatching(/-9$/) }),
    )
    act(() => closeSendToChat())
  })

  test('체크한 줄이 하나면 ⇧⌘,·⌘. 의 대상이 그 이슈다 — 둘이면 대상이 없다(WP-1236)', async () => {
    // 단축키 자체(useShareHotkeys)는 앱 셸이 건다 — 여기선 목록이 등록한 대상(스토어)만 본다.
    const { shareTargetStore } = await import('@/lib/shareTarget')
    const { user } = await open()
    await user.click(screen.getByTestId('select-issue-7'))
    await waitFor(() => expect(shareTargetStore.get()).toMatchObject({ kind: 'issue', url: expect.stringMatching(/\/issues\/7$/) }))
    await user.click(screen.getByTestId('select-issue-8'))
    await waitFor(() => expect(shareTargetStore.get()).toBeNull())
  })

  test('선택된 행에서 열면 선택 전체에 적용, 선택 밖 행이면 그 행만', async () => {
    const { user, api } = await open()
    await user.click(screen.getByTestId('select-issue-7'))
    await user.click(screen.getByTestId('select-issue-8'))

    // 선택 밖 행(9) — 단건 메뉴.
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-9') })
    expect(await screen.findByTestId('row-menu-copy-link')).toBeInTheDocument()
    expect(screen.getByTestId('issue-row-menu')).not.toHaveTextContent('선택한')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('issue-row-menu')).not.toBeInTheDocument())

    // 선택된 행(8) — 「선택한 2개 이슈」, 복사·에픽 없음, 우선순위 일괄.
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-row-8') })
    expect(await screen.findByTestId('issue-row-menu')).toHaveTextContent('선택한 2개 이슈')
    expect(screen.queryByTestId('row-menu-copy-link')).not.toBeInTheDocument()
    expect(screen.queryByTestId('row-menu-epic')).not.toBeInTheDocument()
    expect(screen.getByTestId('row-menu-delete')).toHaveTextContent('2개 삭제')
    await openSubmenu(user, 'row-menu-priority')
    await user.click(await screen.findByTestId('row-menu-priority-LOW'))
    await waitFor(() =>
      expect(api.calls.map((c) => [c.path, c.body]).sort()).toEqual([
        [`${ISSUES}/7`, { priority: 'LOW' }],
        [`${ISSUES}/8`, { priority: 'LOW' }],
      ]),
    )
    // 일괄 작업 성공 → 선택 해제(일괄 바와 같은 동작).
    await waitFor(() => expect(screen.queryByTestId('issue-bulk-toolbar')).not.toBeInTheDocument())
  })
})

describe('이슈 카드 메뉴 — 보드', () => {
  test('카드 ⋯ → 상태 › 완료 → PATCH statusId, 상세로 이동하지 않는다', async () => {
    const { user, api, location } = await open('board')
    await user.click(screen.getByTestId('issue-card-8-menu'))
    expect(await screen.findByTestId('issue-row-menu')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?view=board`)
    await openSubmenu(user, 'row-menu-status')
    await user.click(await screen.findByTestId('row-menu-status-3'))
    await waitFor(() => expect(api.calls).toEqual([{ method: 'PATCH', path: `${ISSUES}/8/status`, body: { statusId: 3 } }]))
  })

  test('카드 우클릭으로도 같은 메뉴가 열린다', async () => {
    const { user } = await open('board')
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('issue-card-7') })
    expect(await screen.findByTestId('row-menu-copy-key')).toHaveTextContent('WP-7')
  })
})
