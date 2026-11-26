// 유형 선택 픽커(WP-2097) — 상위가 풀리는 변경은 「상위 연결 변경」 확인 창을 먼저 띄우고 확인해야 PATCH 가 간다.
// 상위가 없는 이슈(parentLink 없음)·상위를 풀지 않는 변경은 지금처럼 곧바로 저장한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { childrenResolver } from '@/test/kits/projects/children'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { renderScreen } from '@/test/renderScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import type { ParentLink } from './IssueTypeSelectPopover'
import { IssueTypeSelectPopover } from './IssueTypeSelectPopover'

const TYPE_PATCH = '/api/v1/projects/WP/issues/7/type'

/** 이 테스트의 네트워크 — 유형 목록과 유형 변경 PATCH 만. 응답 본문은 런타임에 쓰지 않아 비어 있어도 된다. */
function pickerHandlers() {
  return [
    http.get('/api/v1/projects/WP/types', () => HttpResponse.json(systemTypes())),
    http.patch(TYPE_PATCH, () => HttpResponse.json({})),
  ]
}

/** 하위 태스크(부모 TASK, 그 위 에픽) — 유형을 바꾸면 상위가 풀리는 대표 경우. */
const parentLink: ParentLink = {
  parentKey: 'WP-3',
  parentTypeName: 'TASK',
  parentTitle: '로그인 개선',
  grandparent: { key: 'WP-9', title: '기능 에픽' },
}

// Review Focus 4 — 상위가 없는 이슈는 창이 아예 뜨지 않고 곧바로 PATCH 가 간다(하위 회귀 없음).
test('상위가 없는 이슈는 확인 창 없이 곧바로 PATCH 가 간다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  expect(screen.queryByTestId('parent-link-dialog')).toBeNull()
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 1 }]))
})

test('상위가 풀리는 변경은 확인 창을 먼저 띄우고, 확인해야 에픽 키로 PATCH 가 간다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={parentLink} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  await screen.findByTestId('parent-link-dialog')
  // 확인 전에는 서버 요청이 하나도 나가지 않는다.
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(screen.getByTestId('parent-link-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 1, parentKey: 'WP-9', relateToReleasedParent: true },
    ]),
  )
})

test('「상위 없이 변경」으로 확인하면 parentKey 없이 관계 유지 옵션만 보낸다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={parentLink} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  const dialog = await screen.findByTestId('parent-link-dialog')
  await user.click(within(dialog).getByRole('radio', { name: /상위 없이 변경/ }))
  await user.click(screen.getByTestId('parent-link-confirm'))
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 1, relateToReleasedParent: true }]))
})

// 완료 기준 9 — 상위를 풀지 않는 변경(일반 유형 → 일반 유형)은 지금처럼 바로 저장된다.
test('상위를 풀지 않는 변경은 확인 창 없이 바로 저장된다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover
      projectKey="WP"
      issueNumber={7}
      current={makeTaskType()}
      parentLink={{ parentKey: 'WP-9', parentTypeName: 'EPIC', parentTitle: '기능 에픽', grandparent: null }}
    />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-2'))
  expect(screen.queryByTestId('parent-link-dialog')).toBeNull()
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 2 }]))
})

// 검토 반영(라운드 2) — 창을 열 때마다 선택 상태가 초기화돼야 한다.
// 지난 열림에서 「상위 없이 변경」+체크 해제로 바꿨어도, 취소 후 다시 열면 「상위의 에픽 아래로 이동」·관련 관계 유지 켬 이어야 한다.
test('취소 후 다시 열면 선택이 기본값(에픽 아래 이동·관련 관계 유지 켬)으로 초기화된다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={parentLink} />,
    { handlers: pickerHandlers() },
  )
  // 첫 열림 — 선택을 전부 바꾼 뒤 취소한다(저장 없음).
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  const first = await screen.findByTestId('parent-link-dialog')
  await user.click(within(first).getByRole('radio', { name: /상위 없이 변경/ }))
  await user.click(within(first).getByRole('checkbox', { name: '관련 관계 유지' }))
  await user.click(within(first).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('parent-link-dialog')).toBeNull())
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  // 다시 연다 — 지난 열림의 선택이 남아 있지 않아야 한다.
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  const second = await screen.findByTestId('parent-link-dialog')
  expect(within(second).getByRole('radio', { name: /상위의 에픽 아래로 이동/ })).toBeChecked()
  expect(within(second).getByRole('radio', { name: /상위 없이 변경/ })).not.toBeChecked()
  expect(within(second).getByRole('checkbox', { name: '관련 관계 유지' })).toBeChecked()
  // 확인하면 초기화된 기본값 그대로(에픽 이동 + 관계 유지)가 payload 로 나간다.
  await user.click(within(second).getByTestId('parent-link-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 1, parentKey: 'WP-9', relateToReleasedParent: true },
    ]),
  )
})

// 완료 기준 7 — 하위 태스크(할아버지 에픽 있음)를 EPIC 으로 바꾸면 같은 창에 「상위 없이 변경」만 보이고,
// 기본 선택도 그쪽이다. 확인해도 parentKey 없는 payload 가 나가야 서버가 상위만 풀고 400 이 나지 않는다.
test('하위 태스크를 EPIC 으로 바꾸면 「상위 없이 변경」만 보이고 parentKey 없는 PATCH 가 간다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={parentLink} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  const dialog = await screen.findByTestId('parent-link-dialog')
  expect(within(dialog).getAllByRole('radio')).toHaveLength(1)
  expect(within(dialog).getByRole('radio', { name: /상위 없이 변경/ })).toBeChecked()
  expect(within(dialog).queryByRole('radio', { name: /상위의 에픽 아래로 이동/ })).toBeNull()
  // 확인 전에는 서버 요청이 하나도 나가지 않는다.
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(within(dialog).getByTestId('parent-link-confirm'))
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6, relateToReleasedParent: true }]))
})

// (WP-2131) 읽을 수 없는 상위 — 가린 모드 창을 띄우고, 확인 시 { typeId } 만 보낸다.

test('가린 상위: 확인 창이 뜨고 확인하면 { typeId } 만 PATCH 된다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={{ hidden: true }} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  await screen.findByTestId('parent-link-dialog')
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(screen.getByTestId('parent-link-confirm'))
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 1 }]))
})

test('가린 상위: 취소하면 PATCH 없이 창이 닫힌다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={{ hidden: true }} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))
  const dialog = await screen.findByTestId('parent-link-dialog')
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('parent-link-dialog')).toBeNull())
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
})

test('가린 상위: EPIC 으로 바꿔도 라디오 없는 가린 모드 창이 뜬다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeSubtaskType()} parentLink={{ hidden: true }} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  const dialog = await screen.findByTestId('parent-link-dialog')
  expect(within(dialog).getByTestId('parent-link-hidden-notice')).toBeInTheDocument()
  expect(within(dialog).queryByRole('radio')).toBeNull()
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
})

test('가린 상위여도 상위를 풀지 않는 변경은 창 없이 바로 { typeId } 로 저장된다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover projectKey="WP" issueNumber={7} current={makeTaskType()} parentLink={{ hidden: true }} />,
    { handlers: pickerHandlers() },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-2'))
  expect(screen.queryByTestId('parent-link-dialog')).toBeNull()
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 2 }]))
})

// 리뷰 후속(PR #1874) — 가린 상위(WP-2131)가 있는 이슈를 에픽으로 바꿀 때 하위 태스크 변환 창은 키 없이 「상위 연결이 풀립니다」를 보이고(관계 체크 없음),
// 확인하면 관계 옵션 없이 { typeId, convertSubtasksToTypeId } 만 보낸다(가린 상위는 { typeId } 만과 같은 규칙).
test('가린 상위: 에픽 전환의 하위 태스크 변환 창은 키 없는 상위 안내를 보이고, 관계 옵션 없는 PATCH 를 보낸다', async () => {
  const requests = recordRequests()
  const { user } = renderScreen(
    <IssueTypeSelectPopover
      projectKey="WP"
      issueNumber={7}
      current={makeTaskType()}
      parentLink={{ hidden: true }}
      childCount={1}
    />,
    {
      handlers: [
        ...pickerHandlers(),
        http.get(
          '/api/v1/projects/WP/issues/7/children',
          childrenResolver(() => [createIssue({ id: 211, projectKey: 'WP', number: 11, title: '하위 11', type: makeSubtaskType() })]),
        ),
      ],
    },
  )
  await user.click(screen.getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))
  const dialog = await screen.findByTestId('subtask-convert-dialog')
  expect(within(dialog).getByTestId('subtask-convert-hidden-parent-notice').textContent).toContain('상위 연결이 풀립니다')
  expect(within(dialog).queryByTestId('subtask-convert-parent-notice')).toBeNull()
  expect(within(dialog).queryByRole('checkbox', { name: '관련 관계 유지' })).toBeNull()
  await user.click(within(dialog).getByTestId('subtask-convert-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6, convertSubtasksToTypeId: 1 }]),
  )
})
