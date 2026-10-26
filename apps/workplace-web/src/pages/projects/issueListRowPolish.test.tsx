// 프로젝트 목록 소정리(WP-919) — 페이지 테스트(WP-971).
// 체크박스로 고른 데스크톱 행의 다중 선택 배경(bg-primary/10)과 빈 값 —·마감 날짜 표기(올해 「M월 D일」·다른 해 「YYYY. M. D」)는
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-list-row-polish.spec.ts 에서 옮겼다.
// ID 헤더와 키 글자의 x 정렬·1024px 에서 칸이 보이는지(@layout)는 E2E 에 남는다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

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
  const view = renderPage(`/projects/${KEY}`, {
    handlers: [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
      http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse(ISSUES, null))),
    ],
  })
  await screen.findByTestId('issue-row-11', {}, { timeout: PAGE_LOAD_TIMEOUT })
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
