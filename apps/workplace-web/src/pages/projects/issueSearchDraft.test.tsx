// 이슈 목록 필터 검색 draft(WP-1003) — 페이지 테스트(WP-971).
// debounce 로 URL ?q 를 쓴 순간과 다시 렌더되는 사이에 더 친 글자가, 되돌아온 옛 q 로 덮여 지워지지 않는다(연락처 WP-999 와 같은 경합).
// useIssueFilterControls 를 쓰는 화면(팀 목록·내 작업·모바일 툴바) 공통이라 팀 목록으로 판정한다.
import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

afterEach(() => {
  vi.useRealTimers()
})

const handlers = [
  http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/members`, () =>
    HttpResponse.json([createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'MEMBER' })]),
  ),
  http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
  http.get(`/api/v1/projects/${KEY}/issues`, () =>
    HttpResponse.json(
      createIssueSearchResponse([createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 세션 만료 처리', type: makeTaskType() })], null),
    ),
  ),
]

test('debounce 로 q 를 쓰는 사이에 더 친 글자가 남는다', async () => {
  const { location } = renderPage(`/projects/${KEY}?view=list`, { handlers })
  const input = await screen.findByLabelText('태스크 검색', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 페이지가 뜬 뒤에만 setTimeout 을 가짜로 바꿔 debounce 가 끝나는 순간을 정확히 잡는다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.change(input, { target: { value: '로그' } })
  // 300ms 가 지나 URL 에 「로그」를 쓰는 바로 그 사이에 「인」을 더 친다 — 한 act 로 묶어 그 순서를 재현한다.
  act(() => {
    vi.advanceTimersByTime(300)
    fireEvent.change(input, { target: { value: '로그인' } })
  })
  expect(new URLSearchParams(location().split('?')[1]).get('q')).toBe('로그')
  expect(input).toHaveValue('로그인')

  // 다음 debounce 가 끝나면 마지막 입력이 URL 에 들어간다.
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(new URLSearchParams(location().split('?')[1]).get('q')).toBe('로그인')
  expect(input).toHaveValue('로그인')
})
