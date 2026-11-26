// 저장 보기 전환 보류 중(apply 의 history 갱신이 아직 렌더에 닿지 않은 사이)에 친 검색어가 보기 조건을 덮어쓰지 않는다(WP-2141) — 페이지 테스트(WP-971).
// useSavedViewState.apply/applyAll 은 startTransition 안에서 URL 을 바꾼다 — react-router 는 history 를 즉시 바꾸지만 React 렌더는 뒤로 밀린다.
// 그 사이 300ms debounce 로 쓰는 q 가 렌더 시점의 옛 필터가 아니라 쓰는 순간의 라이브 주소(liveSearchParams, WP-955 와 같은 근거)를 기준으로 조건을 다시 읽는다.
// useIssueFilterControls 를 쓰는 화면(팀 목록·내 작업·모바일 툴바) 공통이라 팀 목록으로 판정한다.
import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { COLS_PARAM } from '@/lib/issueListColumns'
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

/**
 * 페이지를 띄우고 (필수면) 라이브 주소만 바꾼 뒤 검색어를 치고 debounce 300ms 를 경과시킨다.
 * 세 테스트가 반복하던 공통 셋업 — apply() 가 렌더를 깨우지 않고 history 만 바꾼 사이에 q 가 쓰이는 경합을 한 자리에서 재현한다.
 * liveQuery 가 null 이면 라이브 주소를 바꾸지 않는 대조군이다.
 */
async function searchAfterPendingWrite(liveQuery: string | null) {
  const { location } = renderPage(`/projects/${KEY}?view=list`, { handlers })
  const input = await screen.findByLabelText('이슈 필터: 제목·키', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 페이지가 뜬 뒤에만 setTimeout 을 가짜로 바꿔 debounce 가 끝나는 순간을 정확히 잡는다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  // apply() 가 라우터를 깨우지 않고 주소만 바꾸는 순간(렌더는 아직 옛 값)을 흉내 — history.state(key·idx)는 그대로 둔다.
  if (liveQuery !== null) {
    window.history.replaceState(window.history.state, '', liveQuery)
  }
  fireEvent.change(input, { target: { value: '로그인' } })
  // 300ms debounce 가 끝나 q 를 쓰는 바로 그 시점에 검증 — 한 act 안에서 순서를 재현한다.
  act(() => {
    vi.advanceTimersByTime(300)
  })
  const params = new URLSearchParams(location().split('?')[1])
  return { location, params }
}

test('저장 보기 전환이 아직 렌더에 닿지 않은 사이의 검색어가 보기 조건을 지우지 않는다', async () => {
  // 우선순위 조건과 그룹(명시 'none')은 저장 보기 apply 가 늘 싣는 값이라(savedViewQueryToParams) 라이브 주소에도 함께 둔다.
  const { params } = await searchAfterPendingWrite('?priority=HIGH&group=none')
  expect(params.get('priority')).toBe('HIGH')   // 보류 중인 저장 보기 조건이 살아 있다
  expect(params.get('group')).toBe('none')      // 저장 보기의 그룹(그룹 없음 명시)도 라이브 주소에서 이어진다
  expect(params.get('q')).toBe('로그인')        // 그 위에 검색어가 얹혔다
})

test('보류 중인 표시 옵션(보드 탭·열)이 검색어 쓰기로 지워지지 않는다', async () => {
  // 저장 보기 query 는 filtersToParams 산출물이라 boardTab 을 싣지 못한다 — 이 주소는 칩이 아니라 다른 경로
  // (모바일 보드 기본 탭 고정 등)로 이미 라이브 주소에 반영됐을 수 있는 보류 상태를 흉내낸다. 렌더는 아직 리스트다.
  const { params } = await searchAfterPendingWrite('?view=board&boardTab=3&priority=HIGH&cols=title,assignee')
  expect(params.get('boardTab')).toBe('3')                      // 보류 중인 보드 탭이 살아 있다
  expect(params.get(COLS_PARAM)).toBe('title,assignee')         // 목록 열 구성도 라이브 주소에서 이어진다
  expect(params.get('q')).toBe('로그인')                        // 옵션을 지우지 않고 검색어 쓰기 자체도 일어났다
})

test('보류 없을 때의 검색어 쓰기는 결과가 그대로다', async () => {
  // 라이브 주소를 바꾸지 않는 대조군 — 경합 없는 평소 쓰기가 바뀌지 않는지 본다.
  const { params } = await searchAfterPendingWrite(null)
  expect(params.get('q')).toBe('로그인')
  expect(params.get('priority')).toBeNull()
})
