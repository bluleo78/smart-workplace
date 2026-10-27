// 프로젝트 목록 소정리(WP-919) — 화면 테스트(WP-971, WP-1002 에서 목록 표 IssueListView 만 띄우게 바꿈).
// 체크박스로 고른 데스크톱 행의 다중 선택 배경(bg-primary/10)과 빈 값 —·마감 날짜 표기(올해 「M월 D일」·다른 해 「YYYY. M. D」)는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-list-row-polish.spec.ts 에서 옮겼다.
// ID 헤더와 키 글자의 x 정렬·1024px 에서 칸이 보이는지(@layout)는 E2E 에 남는다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { parseFilters } from '@/lib/issueFilters'
import { IssueListView } from '@/pages/projects/components/IssueListView'
import { ProjectStatusesGate } from '@/pages/projects/components/ProjectStatusesGate'
import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'

const ISSUES = [
  createIssue({ id: 1, number: 11, title: '올해 마감 이슈', dueDate: '2026-10-25' }),
  createIssue({ id: 2, number: 12, title: '다른 해 마감 이슈', dueDate: '2027-01-05' }),
  createIssue({ id: 3, number: 13, title: '마감·담당자 없는 이슈', dueDate: null, assignees: [] }),
]

// 「올해」 판정이 실제 시계에 기대지 않도록 Date 만 2026-10-01 로 고정한다(타이머는 진짜 — MSW·React Query 가 쓴다).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

/** 사이클 없는 평면 목록을 열고 첫 행이 뜰 때까지 기다린다. */
async function openList() {
  // 목록 표(IssueListView)만 띄운다 — 필터 없음·그룹 없음·기본 열, 멤버(편집 가능)인 데스크톱 화면과 같은 props.
  const view = renderScreen(
    <ProjectStatusesGate projectKey={KEY}>
      <IssueListView projectKey={KEY} filters={parseFilters(new URLSearchParams())} groupBy={null} canDrag canEdit />
    </ProjectStatusesGate>,
    {
      path: `/projects/${KEY}`,
      handlers: [
        http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse(ISSUES, null))),
        // 행 메뉴(담당자·유형)가 미리 받는 목록 — 이 테스트에선 비어 있어도 된다.
        http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([])),
        http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json([])),
        http.get(`/api/v1/projects/${KEY}/statuses`, () => HttpResponse.json(seedStatuses())),
      ],
    },
  )
  await screen.findByTestId('issue-row-11')
  return view
}

test('체크박스로 고른 데스크톱 행에 다중 선택 배경(bg-primary/10)이 붙고, 풀면 사라진다', async () => {
  const { user } = await openList()
  const row = screen.getByTestId('issue-row-11')
  expect(row).not.toHaveClass('bg-primary/10')
  await user.click(screen.getByTestId('select-issue-11'))
  expect(row).toHaveClass('bg-primary/10')
  await user.click(screen.getByTestId('select-issue-11'))
  expect(row).not.toHaveClass('bg-primary/10')
})

test('마감 없는 행의 마감·담당자 칸은 —, 올해 마감은 「10월 25일」·다른 해는 「2027. 1. 5」', async () => {
  await openList()
  expect(screen.getByTestId('issue-row-13-due')).toHaveTextContent(/^—$/)
  expect(screen.getByTestId('issue-row-13-assignee')).toHaveTextContent(/^—$/)
  expect(screen.getByTestId('issue-row-11-due')).toHaveTextContent(/^10월 25일$/)
  expect(screen.getByTestId('issue-row-12-due')).toHaveTextContent(/^2027\. 1\. 5$/)
})
