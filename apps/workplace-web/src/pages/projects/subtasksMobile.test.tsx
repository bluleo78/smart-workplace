// 하위 태스크 행 AI 배지(WP-374) — 모바일 폭(375~390px) 페이지 테스트(WP-980).
// 행당 배지 하나(열린 AI 행은 AI 배지, 그 외는 상태배지) 판정이 모바일 행에서도 같은지 본다 — e2e/pages/projects/subtasks.spec.ts 의
// 모바일 375px 변형에서 옮겼다. 뷰포트는 파일 하나에 하나라 데스크톱(subtasks.test.tsx)과 나눈다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { test } from 'vitest'

import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { expectSubtaskBadges, subtaskBadgeChildren, TASK_SUMMARY } from '@/test/kits/projects/subtasks'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember } from '../../../e2e/factories/project.factory'

mockViewport()

test('하위 태스크 행 — AI 관여 열린 행은 AI 배지, 그 외는 상태배지 (모바일)', async () => {
  renderPage('/projects/WP/issues/1', {
    handlers: [
      http.get('/api/v1/projects/WP/types', () => HttpResponse.json(systemTypes())),
      http.get('/api/v1/projects/WP/issues', ({ request }) =>
        HttpResponse.json(createIssueSearchResponse(new URL(request.url).searchParams.get('parent') === '1' ? subtaskBadgeChildren() : [], null)),
      ),
      ...issueDetailHandlers({
        members: [createMember({ userId: 1, role: 'OWNER' })],
        detail: createIssueDetail({ summary: { ...createIssue({ id: 1, number: 1, title: '부모 TASK' }), type: TASK_SUMMARY, childCount: 5, childDoneCount: 1 } }),
      }),
    ],
  })
  await screen.findByTestId('issue-children-section', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await expectSubtaskBadges()
})
