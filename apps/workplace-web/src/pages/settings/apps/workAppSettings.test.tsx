// 설정 › 앱 설정 › 작업 관리(WorkAppSettingsPage, WP-887) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 기본 유형 보호(편집·삭제 없음, 차단은 숨김 불가)·방향 없음 payload·빈 이름 검증·이름 중복(409) 칸 오류·편집 PUT 과 쓰이는 유형 방향 잠금·
// 숨기기/보이기 PUT·삭제 세 경우(미사용·옮기기 moveTo·함께 삭제 deleteLinks)는 브라우저 없이 판정되므로
// e2e/pages/settings/work-app-settings.spec.ts 에서 옮겼다. 유형 추가 배선(@wiring)과 숨긴 유형이 이슈 관계 추가 창에서 사라지는
// 흐름(@flow)은 E2E 에 남고, 사이드바·관리자 가드는 settingsNav.test.tsx 가 지킨다.
// 서버는 상태 있는 모킹 — 변경이 다음 GET 에 반영돼 화면이 서버 응답을 따르는지 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueRelationType, IssueRelationTypeAdmin, SaveIssueRelationTypeRequest } from '@/types/issue'

import { defaultRelationTypes } from '../../../../e2e/factories/issueRelation.factory'
import WorkAppSettingsPage from './WorkAppSettingsPage'

const ADMIN = '/api/v1/admin/issue-relation-types'

/** 유형 id → [이슈 사이 관계 수, 외부 링크 수]. */
type Counts = Record<number, [number, number]>
type Call = { method: string; path: string; body: unknown; search: URLSearchParams }

const customType = (over: Partial<IssueRelationType> = {}): IssueRelationType => ({
  id: 7, code: null, name: '테스트', directed: true, outwardLabel: '테스트 케이스', inwardLabel: '테스트 대상',
  externalOnly: false, hidden: false, sortOrder: 1000, ...over,
})

/** 관리용 API 상태 모킹(e2e work-app-settings.spec 의 installAdmin 과 같은 규칙) — 쓰기 요청은 calls 에 쌓인다. */
function relationTypeApi(extra: IssueRelationType[] = [], counts: Counts = {}) {
  const types = [...defaultRelationTypes(), ...extra]
  const calls: Call[] = []
  let nextId = 50
  const admin = (): IssueRelationTypeAdmin[] =>
    types.map((t) => ({ ...t, relationCount: counts[t.id]?.[0] ?? 0, externalLinkCount: counts[t.id]?.[1] ?? 0 }))
  const nameTaken = (name: string, selfId?: number) => types.some((t) => t.id !== selfId && t.name.toLowerCase() === name.trim().toLowerCase())
  const taken = (name: string) =>
    HttpResponse.json({ message: `이미 있는 관계 유형 이름입니다: ${name}`, errors: { code: 'RELATION_TYPE_NAME_TAKEN' } }, { status: 409 })
  const record = async (request: Request) => {
    const text = await request.text()
    const url = new URL(request.url)
    const call = { method: request.method, path: url.pathname, body: text ? JSON.parse(text) : null, search: url.searchParams }
    calls.push(call)
    return call
  }
  const byId = (id: string | readonly string[] | undefined) => types.find((t) => t.id === Number(id))!
  const handlers = [
    http.get(ADMIN, () => HttpResponse.json(admin())),
    http.post(ADMIN, async ({ request }) => {
      const b = (await record(request)).body as SaveIssueRelationTypeRequest
      if (nameTaken(b.name)) return taken(b.name)
      const t: IssueRelationType = { id: nextId++, code: null, ...b, externalOnly: false, hidden: false, sortOrder: 1000 }
      types.push(t)
      return HttpResponse.json(t)
    }),
    http.put(`${ADMIN}/:id/hidden`, async ({ request, params }) => {
      const t = byId(params.id)
      t.hidden = ((await record(request)).body as { hidden: boolean }).hidden
      return HttpResponse.json(t)
    }),
    http.put(`${ADMIN}/:id`, async ({ request, params }) => {
      const t = byId(params.id)
      const b = (await record(request)).body as SaveIssueRelationTypeRequest
      if (nameTaken(b.name, t.id)) return taken(b.name)
      Object.assign(t, b)
      return HttpResponse.json(t)
    }),
    http.delete(`${ADMIN}/:id`, async ({ request, params }) => {
      await record(request)
      types.splice(types.indexOf(byId(params.id)), 1)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, calls }
}

/** 작업 관리 화면을 띄우고 기본 유형 표가 그려질 때까지 기다린다. */
async function openWorkApp(extra: IssueRelationType[] = [], counts: Counts = {}) {
  const api = relationTypeApi(extra, counts)
  const view = renderScreen(<WorkAppSettingsPage />, { path: '/settings/apps/work', handlers: api.handlers })
  await screen.findByTestId('relation-type-row-1')
  return { ...view, calls: api.calls }
}

const byTestId = (id: string) => screen.getByTestId(id)
const fill = async (user: ReturnType<typeof renderScreen>['user'], el: HTMLElement, value: string) => {
  await user.clear(el)
  if (value) await user.paste(value)
}

test('기본 유형은 편집·삭제가 없고 차단은 「고정」이라 숨길 수 없다', async () => {
  await openWorkApp()
  expect(byTestId('relation-type-row-1')).toHaveTextContent('차단')
  expect(byTestId('relation-type-row-1')).toHaveTextContent('고정')
  expect(screen.queryByTestId('relation-type-toggle-hidden-1')).not.toBeInTheDocument()
  expect(byTestId('relation-type-row-5')).toHaveTextContent('원인임')
  expect(byTestId('relation-type-row-5')).toHaveTextContent('결과임')
  expect(byTestId('relation-type-row-6')).toHaveTextContent('외부 링크만')
  for (const id of [1, 2, 3, 4, 5, 6]) {
    expect(screen.queryByTestId(`relation-type-edit-${id}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`relation-type-delete-${id}`)).not.toBeInTheDocument()
  }
  expect(byTestId('relation-type-toggle-hidden-2')).toBeInTheDocument()
})

test('방향 없음으로 만들면 말이 하나고 payload 의 inwardLabel 은 null', async () => {
  const { user, calls } = await openWorkApp()
  await user.click(byTestId('relation-type-add'))
  const dialog = within(await screen.findByTestId('relation-type-dialog'))
  await user.click(dialog.getByTestId('relation-type-directed-false'))
  expect(dialog.queryByTestId('relation-type-inward')).not.toBeInTheDocument()
  await fill(user, dialog.getByTestId('relation-type-name'), '참고')
  await fill(user, dialog.getByTestId('relation-type-outward'), '참고 자료')
  expect(dialog.getByTestId('relation-type-preview')).toHaveTextContent('#12 에서: 참고 자료 · #31')
  await user.click(dialog.getByTestId('relation-type-submit'))
  await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ name: '참고', directed: false, outwardLabel: '참고 자료', inwardLabel: null }]))
})

test('비어 있으면 보내지 않고 검증 문구, 이름이 이미 있으면(409) 이름 칸 아래 오류 — 고치면 사라지고 저장된다', async () => {
  const { user, calls } = await openWorkApp()
  await user.click(byTestId('relation-type-add'))
  const dialogEl = await screen.findByTestId('relation-type-dialog')
  const dialog = within(dialogEl)
  await user.click(dialog.getByTestId('relation-type-submit'))
  expect(await dialog.findByText('이름을 입력해 주세요')).toBeInTheDocument()
  expect(calls).toHaveLength(0)

  // 기본 유형 이름과 같은 이름 — 서버가 409.
  await fill(user, dialog.getByTestId('relation-type-name'), '관련')
  await fill(user, dialog.getByTestId('relation-type-outward'), '연관됨')
  await fill(user, dialog.getByTestId('relation-type-inward'), '연관함')
  await user.click(dialog.getByTestId('relation-type-submit'))
  expect(await dialog.findByText('이미 있는 관계 유형 이름입니다: 관련')).toBeInTheDocument()
  expect(calls).toHaveLength(1)
  expect(dialogEl).toBeInTheDocument()

  await fill(user, dialog.getByTestId('relation-type-name'), '연관')
  expect(dialog.queryByText('이미 있는 관계 유형 이름입니다: 관련')).not.toBeInTheDocument()
  await user.click(dialog.getByTestId('relation-type-submit'))
  await waitFor(() => expect(screen.queryByTestId('relation-type-dialog')).not.toBeInTheDocument())
  expect(calls[1].body).toMatchObject({ name: '연관' })
})

// WP-1106 — 제로폭 공백·점자 빈칸만 넣은 칸은 빈 칸과 같다. 앞뒤에 붙은 보이지 않는 글자는 지우고 보낸다.
test('보이지 않는 글자만 넣으면 보내지 않고 검증 문구, 앞뒤의 보이지 않는 글자는 지우고 보낸다', async () => {
  const { user, calls } = await openWorkApp()
  await user.click(byTestId('relation-type-add'))
  const dialog = within(await screen.findByTestId('relation-type-dialog'))
  await fill(user, dialog.getByTestId('relation-type-name'), '\u200B\u200B')
  await fill(user, dialog.getByTestId('relation-type-outward'), '\u200B')
  await fill(user, dialog.getByTestId('relation-type-inward'), '\u2800')
  await user.click(dialog.getByTestId('relation-type-submit'))
  expect(await dialog.findByText('이름을 입력해 주세요')).toBeInTheDocument()
  expect(dialog.getAllByText('말을 입력해 주세요')).toHaveLength(2)
  expect(calls).toHaveLength(0)

  await fill(user, dialog.getByTestId('relation-type-name'), '\u200B점검\u2800')
  await fill(user, dialog.getByTestId('relation-type-outward'), '확인한다\u200B')
  await fill(user, dialog.getByTestId('relation-type-inward'), '\u200B확인받는다')
  await user.click(dialog.getByTestId('relation-type-submit'))
  await waitFor(() => expect(screen.queryByTestId('relation-type-dialog')).not.toBeInTheDocument())
  expect(calls[0].body).toEqual({ name: '점검', directed: true, outwardLabel: '확인한다', inwardLabel: '확인받는다' })
})

test('편집 — PUT payload·표 반영, 쓰이는 유형은 방향 선택이 잠긴다', async () => {
  const { user, calls } = await openWorkApp(
    [customType({ id: 7 }), customType({ id: 8, name: '검토', outwardLabel: '검토함', inwardLabel: '검토받음' })],
    { 8: [2, 0] },
  )
  await user.click(byTestId('relation-type-edit-7'))
  let dialog = within(await screen.findByTestId('relation-type-dialog'))
  expect(dialog.getByTestId('relation-type-name')).toHaveValue('테스트')
  expect(dialog.getByTestId('relation-type-directed-true')).toBeEnabled()
  await fill(user, dialog.getByTestId('relation-type-name'), '시험')
  await fill(user, dialog.getByTestId('relation-type-outward'), '시험 항목')
  await user.click(dialog.getByTestId('relation-type-submit'))
  await waitFor(() =>
    expect(calls).toEqual([
      expect.objectContaining({ method: 'PUT', path: `${ADMIN}/7`, body: { name: '시험', directed: true, outwardLabel: '시험 항목', inwardLabel: '테스트 대상' } }),
    ]),
  )
  expect(await screen.findByText('관계 유형을 고쳤습니다')).toBeInTheDocument()
  await waitFor(() => expect(byTestId('relation-type-row-7')).toHaveTextContent('시험 항목'))

  // 쓰이는 유형 — 방향 잠금과 이유.
  await waitFor(() => expect(screen.queryByTestId('relation-type-dialog')).not.toBeInTheDocument())
  await user.click(byTestId('relation-type-edit-8'))
  dialog = within(await screen.findByTestId('relation-type-dialog'))
  expect(dialog.getByTestId('relation-type-directed-true')).toBeDisabled()
  expect(dialog.getByTestId('relation-type-directed-false')).toBeDisabled()
  expect(dialog.getByTestId('relation-type-direction-locked')).toHaveTextContent('방향은 바꿀 수 없어요')
})

test('숨기기 → PUT hidden, 「숨김」 표시·보이기 버튼, 다시 보이기로 돌아온다', async () => {
  const { user, calls } = await openWorkApp()
  await user.click(byTestId('relation-type-toggle-hidden-3'))
  await waitFor(() => expect(calls.map((c) => [c.path, c.body])).toEqual([[`${ADMIN}/3/hidden`, { hidden: true }]]))
  expect(await screen.findByText('관계 유형을 숨겼습니다')).toBeInTheDocument()
  expect(await screen.findByTestId('relation-type-hidden-3')).toBeInTheDocument()
  expect(byTestId('relation-type-toggle-hidden-3')).toHaveTextContent('보이기')

  await user.click(byTestId('relation-type-toggle-hidden-3'))
  await waitFor(() => expect(calls[1]?.body).toEqual({ hidden: false }))
  await waitFor(() => expect(screen.queryByTestId('relation-type-hidden-3')).not.toBeInTheDocument())
})

test('삭제 — 쓰는 관계가 없으면 확인만, DELETE 에 옵션 없음', async () => {
  const { user, calls } = await openWorkApp([customType({ id: 7 })])
  await user.click(byTestId('relation-type-delete-7'))
  const dialog = within(await screen.findByTestId('relation-type-delete-dialog'))
  expect(dialog.getByTestId('relation-type-delete-summary')).toHaveTextContent('걸린 관계가 없어요')
  expect(dialog.queryByTestId('relation-type-move-target')).not.toBeInTheDocument()
  await user.click(dialog.getByTestId('relation-type-delete-confirm'))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0]).toMatchObject({ method: 'DELETE', path: `${ADMIN}/7` })
  expect([...calls[0].search.keys()]).toEqual([])
  expect(await screen.findByText('관계 유형을 삭제했습니다')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('relation-type-row-7')).not.toBeInTheDocument())
})

test('사용 중 삭제 — 기본은 다른 유형(「관련」)으로 옮긴다(moveTo)', async () => {
  const { user, calls } = await openWorkApp([customType({ id: 7 })], { 7: [3, 1] })
  expect(byTestId('relation-type-usage-7')).toHaveTextContent('4건')
  await user.click(byTestId('relation-type-delete-7'))
  const dialog = within(await screen.findByTestId('relation-type-delete-dialog'))
  expect(dialog.getByTestId('relation-type-delete-summary')).toHaveTextContent('4건 있어요(외부 링크 1건 포함)')
  // 차단(id 1)·외부 전용(id 6)은 옮길 곳 후보가 아니다 — 처음 값은 「관련」.
  expect(dialog.getByTestId('relation-type-move-target')).toHaveTextContent('관련')
  await user.click(dialog.getByTestId('relation-type-delete-confirm'))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].search.get('moveTo')).toBe('2')
  expect(calls[0].search.has('deleteLinks')).toBe(false)
  await waitFor(() => expect(screen.queryByTestId('relation-type-row-7')).not.toBeInTheDocument())
})

test('사용 중 삭제 — 관계도 함께 삭제(deleteLinks=true)', async () => {
  const { user, calls } = await openWorkApp([customType({ id: 7 })], { 7: [3, 0] })
  await user.click(byTestId('relation-type-delete-7'))
  const dialog = within(await screen.findByTestId('relation-type-delete-dialog'))
  await user.click(dialog.getByTestId('relation-type-delete-links'))
  expect(dialog.getByText('3건이 이슈에서 사라져요. 되돌릴 수 없어요.')).toBeInTheDocument()
  await user.click(dialog.getByTestId('relation-type-delete-confirm'))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].search.get('deleteLinks')).toBe('true')
  expect(calls[0].search.has('moveTo')).toBe(false)
  await waitFor(() => expect(screen.queryByTestId('relation-type-row-7')).not.toBeInTheDocument())
})
