// 이슈 상세 페이지의 「상위 연결 변경」 확인 창 배선(WP-2097) — 실제 IssueDetailPage 가 유형 픽커에 parentLink 를
// 넘기는지 진입점마다 본다. 컴포넌트(IssueTypeSelectPopover) 테스트는 parentLink 를 직접 주입하므로, 상세가 값을 못 넘기면
// (프롭 누락) 그 테스트는 초록인 채 원래 버그가 돌아온다 — 이 페이지 레벨 배선이 그런 회귀를 잡는다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'

const KEY = 'TEST'
const TYPE_PATCH = `/api/v1/projects/${KEY}/issues/1/type`

/** 유형 목록 — 픽커 항목이 이걸로 그려진다(유형 변경 진입점이 로드되는 데 필요). */
const typesHandler = http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes()))

test('하위 태스크의 유형을 비SUBTASK 로 바꾸면 실제 상세 페이지에서 확인 창이 뜬다', async () => {
  const requests = recordRequests()
  // 부모 TASK(그 위 할아버지 에픽) 아래 있는 하위 태스크 — 유형을 TASK 로 바꾸면 상위가 풀린다.
  const detail = createIssueDetail({
    summary: createIssue({
      projectKey: KEY,
      number: 1,
      type: makeSubtaskType(),
      parent: {
        number: 3,
        title: '로그인 개선',
        type: makeTaskType(),
        projectKey: KEY,
        epic: { number: 9, title: '기능 에픽', type: makeEpicType(), projectKey: KEY },
      },
    }),
  })
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      typesHandler,
      http.patch(TYPE_PATCH, () => HttpResponse.json(detail)),
    ],
  })

  await user.click(await screen.findByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))

  // 데스크톱 진입점(제목 옆 속성 줄)의 유형 픽커가 상세의 parentLink 를 받아 확인 창을 만들어야 한다.
  await screen.findByTestId('parent-link-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  // 확인 전에는 서버 요청이 하나도 나가지 않는다.
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(screen.getByTestId('parent-link-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 1, parentKey: `${KEY}-9`, relateToReleasedParent: true },
    ]),
  )
})

test('부모가 없는 이슈는 확인 창 없이 곧바로 유형 PATCH 가 간다(오탐 방지)', async () => {
  const requests = recordRequests()
  // 상위를 풀어 주는 유형(EPIC)으로 바꾸지만 부모가 없다 — 상세가 parentLink 를 안 넘겨야(넘길 값이 없어) 창은 안 뜬다.
  const detail = createIssueDetail({
    summary: createIssue({ projectKey: KEY, number: 1, type: makeTaskType(), parent: null }),
  })
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      typesHandler,
      http.patch(TYPE_PATCH, () => HttpResponse.json(detail)),
    ],
  })

  await user.click(await screen.findByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))

  expect(screen.queryByTestId('parent-link-dialog')).toBeNull()
  await waitFor(() => expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([{ typeId: 6 }]))
})