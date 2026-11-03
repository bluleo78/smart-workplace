// 상단 전체 이슈 검색(WP-1324) — 화면 테스트(WP-995).
// 아이콘·「/」로 펼치면 입력이 프로젝트 횡단 검색(/me/issues?q=, 20건)으로 가고, 결과가 작업 번호·제목(강조)으로 보이며,
// 고르면 이슈 상세로 간다. 빈 결과·실패 문구와 Esc 접기도 본다.
import { fireEvent, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { GlobalIssueSearch } from './GlobalIssueSearch'

/** 받은 검색 요청의 쿼리를 모아 돌려준다. */
function searchHandler(respond: (q: string) => Response, seen: URLSearchParams[] = []) {
  return http.get('/api/v1/me/issues', ({ request }) => {
    const sp = new URL(request.url).searchParams
    seen.push(sp)
    return respond(sp.get('q') ?? '')
  })
}

const hits = [
  createIssue({ id: 525, projectKey: 'CHAT', number: 525, title: '읽음 표시가 늦게 바뀐다' }),
  createIssue({ id: 12, projectKey: 'WP', number: 12, title: '메일 읽음 동기화' }),
]

test('아이콘을 누르면 펼쳐지고, 입력은 /me/issues?q=&size=20 으로 가며 결과를 작업 번호·제목으로 보여 준다', async () => {
  const seen: URLSearchParams[] = []
  const { user, location } = renderScreen(<GlobalIssueSearch />, {
    handlers: [searchHandler(() => HttpResponse.json(createIssueSearchResponse(hits)), seen)],
  })
  await user.click(screen.getByTestId('global-search-toggle'))
  const input = screen.getByTestId('global-search-input')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: '읽음' } })

  const row = await screen.findByTestId('global-search-result-CHAT-525')
  expect(row).toHaveTextContent('CHAT-525')
  expect(row).toHaveTextContent('읽음 표시가 늦게 바뀐다')
  // 제목에서 검색어와 맞은 곳을 강조한다.
  expect(within(row).getByText('읽음', { selector: 'mark' })).toBeInTheDocument()
  expect(screen.getByTestId('global-search-result-WP-12')).toBeInTheDocument()
  expect(seen.at(-1)?.get('q')).toBe('읽음')
  expect(seen.at(-1)?.get('size')).toBe('20')

  // 아래 키 두 번 → 두 번째 줄, Enter 로 그 이슈 상세로 가고 검색은 접힌다.
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(location()).toBe('/projects/WP/issues/12')
  expect(screen.getByTestId('global-search-toggle')).toBeInTheDocument()
})

test('작업 번호로 찾은 결과를 누르면 그 이슈로 간다', async () => {
  const { user, location } = renderScreen(<GlobalIssueSearch />, {
    handlers: [searchHandler(() => HttpResponse.json(createIssueSearchResponse([hits[0]])))],
  })
  await user.click(screen.getByTestId('global-search-toggle'))
  fireEvent.change(screen.getByTestId('global-search-input'), { target: { value: 'CHAT-525' } })
  await user.click(await screen.findByTestId('global-search-result-CHAT-525'))
  expect(location()).toBe('/projects/CHAT/issues/525')
})

test('맞는 이슈가 없으면 안내, 서버 오류면 실패 문구를 보인다', async () => {
  const { user } = renderScreen(<GlobalIssueSearch />, {
    handlers: [
      searchHandler((q) =>
        q === '없음' ? HttpResponse.json(createIssueSearchResponse([])) : HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    ],
  })
  await user.click(screen.getByTestId('global-search-toggle'))
  const input = screen.getByTestId('global-search-input')
  fireEvent.change(input, { target: { value: '없음' } })
  // 찾는 동안은 「찾는 중…」, 응답이 비면 안내로 바뀐다.
  expect(await screen.findByText('일치하는 이슈가 없습니다')).toHaveAttribute('data-testid', 'global-search-empty')
  fireEvent.change(input, { target: { value: '오류' } })
  expect(await screen.findByTestId('global-search-error')).toHaveTextContent('검색하지 못했습니다')
})

test('「/」로 열고 Esc 로 접는다 — 입력칸 안의 「/」는 글자로 남는다', async () => {
  const { user } = renderScreen(<GlobalIssueSearch />, {
    handlers: [searchHandler(() => HttpResponse.json(createIssueSearchResponse([])))],
  })
  await user.keyboard('/')
  const input = screen.getByTestId('global-search-input')
  expect(input).toHaveFocus()
  await user.keyboard('a/b')
  expect(input).toHaveValue('a/b')
  await user.keyboard('{Escape}')
  expect(screen.queryByTestId('global-search-input')).not.toBeInTheDocument()
  expect(screen.getByTestId('global-search-toggle')).toBeInTheDocument()
})

test('입력이 응답보다 앞서 있으면(디바운스·조회 중) Enter 가 이전 검색어의 결과를 열지 않는다', async () => {
  const { user, location } = renderScreen(<GlobalIssueSearch />, {
    handlers: [
      searchHandler((q) => HttpResponse.json(createIssueSearchResponse(q === '읽음' ? [hits[0]] : [hits[1]]))),
    ],
  })
  await user.click(screen.getByTestId('global-search-toggle'))
  const input = screen.getByTestId('global-search-input')
  fireEvent.change(input, { target: { value: '읽음' } })
  await screen.findByTestId('global-search-result-CHAT-525')
  // 검색어를 바꾸자마자 Enter — 아직 보이는 CHAT-525(이전 검색어 결과)로 가지 않는다.
  fireEvent.change(input, { target: { value: '동기화' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/')
  // 새 결과가 오면 Enter 로 그 이슈를 연다.
  await screen.findByTestId('global-search-result-WP-12')
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(location()).toBe('/projects/WP/issues/12')
})
