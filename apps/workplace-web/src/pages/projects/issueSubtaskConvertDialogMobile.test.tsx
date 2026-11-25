// 모바일 「속성」 시트 진입점의 「하위 태스크 N개 유형 변경」 창 배선(WP-2098) — 데스크톱과 같은 childCount 배선을 본다.
// 뷰포트는 파일 하나에 하나라 데스크톱(issueSubtaskConvertDialog.test.tsx)과 나눈다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { childrenResolver } from '@/test/kits/projects/children'
import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'

mockViewport()

const KEY = 'TEST'
const TYPE_PATCH = `/api/v1/projects/${KEY}/issues/1/type`

test('모바일 속성 시트에서 에픽을 고르면 같은 창이 뜨고 같은 PATCH 가 간다', async () => {
  const requests = recordRequests()
  const detail = createIssueDetail({
    summary: createIssue({
      projectKey: KEY,
      number: 1,
      type: makeTaskType(),
      childCount: 1,
      parent: { number: 9, title: '기능 에픽', type: makeEpicType(), projectKey: KEY },
    }),
  })
  const kids = [createIssue({ id: 211, projectKey: KEY, number: 11, title: '하위 11', type: makeSubtaskType() })]
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/issues/1/children`, childrenResolver(() => kids)),
      http.patch(TYPE_PATCH, () => HttpResponse.json(detail)),
    ],
  })

  await user.click(await screen.findByTestId('mobile-prop-more', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  const sheet = await screen.findByTestId('issue-more-props-sheet')
  await user.click(within(sheet).getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-6'))

  await screen.findByTestId('subtask-convert-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(screen.getByTestId('subtask-convert-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 6, convertSubtasksToTypeId: 1, relateToReleasedParent: true },
    ]),
  )
})
