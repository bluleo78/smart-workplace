// 이슈 상세의 「하위 태스크 N개 유형 변경」 확인 창 배선(WP-2098) — 에픽으로 바꿀 때 하위를 전체 조회해
// 하위 태스크가 있으면 창을 띄우고, 확인 시 convertSubtasksToTypeId 를 한 요청에 싣는지 실제 상세 화면 + MSW 로 본다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { childrenResolver } from '@/test/kits/projects/children'
import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'

const KEY = 'TEST'
const TYPE_PATCH = `/api/v1/projects/${KEY}/issues/1/type`
const CHILDREN = `/api/v1/projects/${KEY}/issues/1/children`

const typesHandler = http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes()))

/** 하위 한 건 — 번호 n, 유형·상태는 덮어쓴다. */
const child = (n: number, over: Partial<IssueResponse> = {}) =>
  createIssue({ id: 200 + n, projectKey: KEY, number: n, title: `하위 ${n}`, type: makeSubtaskType(), ...over })

/** 에픽 아래 TASK(번호 1) 상세 — withParent 면 상위 에픽 TEST-9 가 있다. */
function taskDetail(childCount: number, withParent: boolean) {
  return createIssueDetail({
    summary: createIssue({
      projectKey: KEY,
      number: 1,
      type: makeTaskType(),
      childCount,
      parent: withParent
        ? { number: 9, title: '기능 에픽', type: makeEpicType(), projectKey: KEY }
        : null,
    }),
  })
}

async function openAndPickEpic(
  detail: ReturnType<typeof taskDetail>,
  children: () => IssueResponse[],
  status = 200,
  patchStatus = 200,
) {
  const requests = recordRequests()
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      typesHandler,
      status === 200
        ? http.get(CHILDREN, childrenResolver(children))
        : http.get(CHILDREN, () => HttpResponse.json({ message: '실패' }, { status })),
      patchStatus === 200
        ? http.patch(TYPE_PATCH, () => HttpResponse.json(detail))
        : http.patch(TYPE_PATCH, () => HttpResponse.json({ message: '바꿀 수 없습니다' }, { status: patchStatus })),
    ],
  })
  await user.click(await screen.findByTestId('issue-type-trigger', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  return { user, requests }
}

test('상위 있는 태스크를 에픽으로 — 창 하나(완료 하위 포함 3개), 안내, 모두 변경 시 PATCH', async () => {
  const kids = [child(11), child(12), child(13, { status: 'DONE' })]
  const { user, requests } = await openAndPickEpic(taskDetail(3, true), () => kids)

  const dialog = await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(dialog.textContent).toContain('하위 태스크 3개 유형 변경')
  expect(screen.queryByTestId('parent-link-dialog')).toBeNull()
  expect(screen.getByTestId('subtask-convert-parent-notice')).toBeTruthy()
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  // 완료된 하위(closed)까지 전체를 읽었다.
  expect(requests.of('GET', CHILDREN).some((r) => r.search.get('state') === 'closed')).toBe(true)
  await user.click(screen.getByTestId('subtask-convert-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 6, convertSubtasksToTypeId: 1, relateToReleasedParent: true },
    ]),
  )
})

test('상위 없는 태스크 — 창은 뜨고 안내 없음, 본문에 relateToReleasedParent 없음', async () => {
  const { user, requests } = await openAndPickEpic(taskDetail(1, false), () => [child(11)])

  await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(screen.queryByTestId('subtask-convert-parent-notice')).toBeNull()
  await user.click(screen.getByTestId('subtask-convert-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6, convertSubtasksToTypeId: 1 }]),
  )
})

test('하위가 일반 태스크뿐이면 창 없이 곧바로 PATCH', async () => {
  const { requests } = await openAndPickEpic(taskDetail(1, false), () => [child(11, { type: makeTaskType() })])

  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6 }]))
  expect(screen.queryByTestId('subtask-convert-dialog')).toBeNull()
})

test('childCount 0 이면 하위 조회 요청이 없다', async () => {
  const { requests } = await openAndPickEpic(taskDetail(0, false), () => [])

  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6 }]))
  // 상세 하위 섹션은 열린 하위만 받는다(끝난 하위는 펼칠 때만) — 끝난 하위 조회가 있으면 유형 선택이 만든 전체 조회다.
  expect(requests.of('GET', CHILDREN).filter((r) => r.search.get('state') === 'closed')).toHaveLength(0)
})

test('열린 하위가 101건(2페이지)이면 모든 페이지를 합쳐 101개로 보인다', async () => {
  const kids = Array.from({ length: 101 }, (_, i) => child(100 + i))
  await openAndPickEpic(taskDetail(101, false), () => kids)

  const dialog = await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(dialog.textContent).toContain('하위 태스크 101개 유형 변경')
})

test('취소·Esc 는 PATCH 없이 닫는다', async () => {
  const { user, requests } = await openAndPickEpic(taskDetail(1, false), () => [child(11)])

  await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('subtask-convert-dialog')).toBeNull())

  // 다시 열어 Esc 로 닫는다 — onOpenChange(false) 도 취소로 본다.
  await user.click(await screen.findByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  await screen.findByTestId('subtask-convert-dialog')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('subtask-convert-dialog')).toBeNull())
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
})

test('하위 조회가 500 이면 창 없이 오류 알림, PATCH 없음', async () => {
  const { requests } = await openAndPickEpic(taskDetail(2, false), () => [], 500)

  await screen.findByText(/하위 태스크를 불러오지 못했습니다|실패/, {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(screen.queryByTestId('subtask-convert-dialog')).toBeNull()
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
})

test('저장이 실패하면 창을 열어 둔 채 고른 것을 남긴다(다시 누를 수 있다)', async () => {
  const { user, requests } = await openAndPickEpic(taskDetail(1, false), () => [child(11)], 200, 400)

  await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(screen.getByTestId('subtask-convert-confirm'))
  await waitFor(() => expect(requests.count('PATCH', TYPE_PATCH)).toBe(1))
  await screen.findByText('바꿀 수 없습니다')
  expect(screen.getByTestId('subtask-convert-dialog')).toBeTruthy()
  await waitFor(() => expect(screen.getByTestId('subtask-convert-confirm')).not.toBeDisabled())
})

test('하위를 읽는 중 팝오버를 닫으면(취소) 늦게 온 결과로 저장하지 않는다', async () => {
  // 하위 조회 응답을 붙잡아 두었다가 팝오버를 닫은 뒤 푼다 — 하위 태스크가 없는 결과라 예전엔 곧바로 에픽으로 저장했다.
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => {
    release = r
  })
  const requests = recordRequests()
  const detail = taskDetail(1, false)
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      typesHandler,
      http.get(CHILDREN, async (info) => {
        if (new URL(info.request.url).searchParams.get('state') === 'closed') await gate
        return childrenResolver(() => [child(11, { type: makeTaskType() })])(info)
      }),
      http.patch(TYPE_PATCH, () => HttpResponse.json(detail)),
    ],
  })
  await user.click(await screen.findByTestId('issue-type-trigger', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  await user.keyboard('{Escape}')
  release()
  // 조회가 끝날 때까지 기다린 뒤에도 PATCH 가 없다.
  await waitFor(() => expect(requests.of('GET', CHILDREN).some((r) => r.search.get('state') === 'closed')).toBe(true))
  await new Promise((r) => setTimeout(r, 50))
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
})
