// 하위 태스크 행 AI 배지(WP-374) — 모바일 폭(375~390px) 화면 테스트(WP-980, WP-1002).
// 행당 배지 하나(열린 AI 행은 AI 배지, 그 외는 상태배지) 판정이 모바일 행에서도 같은지 본다 — e2e/pages/projects/subtasks.spec.ts 의
// 모바일 375px 변형에서 옮겼다. 뷰포트는 파일 하나에 하나라 데스크톱(subtasks.test.tsx)과 나눈다.
// 배지는 하위 목록 섹션(IssueChildrenSection)이 그리므로 그 섹션만 renderScreen 으로 띄운다 — 이슈 상세 화면·앱 셸은 건너뛴다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { test } from 'vitest'

import { IssueChildrenSection } from '@/pages/projects/components/IssueChildrenSection'
import { expectSubtaskBadges, subtaskBadgeChildren } from '@/test/kits/projects/subtasks'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'

mockViewport()

test('하위 태스크 행 — AI 관여 열린 행은 AI 배지, 그 외는 상태배지 (모바일)', async () => {
  // 부모 TASK(1번, 하위 5개 중 1개 완료) 상세의 하위 섹션 — 하위 검색은 parent=1 일 때만 다섯 줄을 준다.
  renderScreen(
    <IssueChildrenSection projectKey="WP" parentNumber={1} parentTypeName="TASK" parentStatus="TODO" childCount={5} childDoneCount={1} />,
    {
      path: '/projects/WP/issues/1',
      handlers: [
        http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject({ key: 'WP' }))),
        http.get('/api/v1/projects/WP/types', () => HttpResponse.json(systemTypes())),
        http.get('/api/v1/projects/WP/issues', ({ request }) =>
          HttpResponse.json(createIssueSearchResponse(new URL(request.url).searchParams.get('parent') === '1' ? subtaskBadgeChildren() : [], null)),
        ),
      ],
    },
  )
  await screen.findByTestId('issue-children-section')
  await expectSubtaskBadges()
})
