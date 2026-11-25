// 모바일 「속성」 시트 진입점의 「상위 연결 변경」 확인 창 배선(WP-2097) — 데스크톱 진입점(제목 옆 속성 줄)과 같은
// parentLink 배선을 모바일 시트에서도 본다. 뷰포트는 파일 하나에 하나라 데스크톱(issueParentLinkDialog.test.tsx)과 나눈다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'

mockViewport()

const KEY = 'TEST'
const TYPE_PATCH = `/api/v1/projects/${KEY}/issues/1/type`

test('모바일 「속성」 시트의 유형 픽커도 확인 창을 띄우고 확인해야 PATCH 가 간다', async () => {
  const requests = recordRequests()
  // 데스크톱 진입점 테스트와 같은 하위 태스크 — 부모 TASK(그 위 할아버지 에픽) 아래 있다.
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
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.patch(TYPE_PATCH, () => HttpResponse.json(detail)),
    ],
  })

  // 모바일 칩 줄 → 「속성」 시트 → 시트 안 유형 픽커(모바일 진입점).
  await user.click(await screen.findByTestId('mobile-prop-more', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  const sheet = await screen.findByTestId('issue-more-props-sheet')
  await user.click(within(sheet).getByTestId('issue-type-trigger'))
  await user.click(await screen.findByTestId('issue-type-option-1'))

  await screen.findByTestId('parent-link-dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  expect(requests.count('PATCH', TYPE_PATCH)).toBe(0)
  await user.click(screen.getByTestId('parent-link-confirm'))
  await waitFor(() =>
    expect(requests.bodies('PATCH', TYPE_PATCH)).toEqual([
      { typeId: 1, parentKey: `${KEY}-9`, relateToReleasedParent: true },
    ]),
  )
})