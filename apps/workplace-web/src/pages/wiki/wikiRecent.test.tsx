// 노트 「최근」(WP-1764) — 화면 컴포넌트 테스트(renderScreen + MSW). driveRecent.test.tsx 를 본뜸.
// 날짜 묶음·공간 경로·마지막 활동 문구, 빈·오류(다시 시도)·다음 쪽 상태, 제목 링크 주소, ⋯ 링크 복사를 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { controlIntersection } from '@/test/kits/layout'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'
import type { WikiRecentItem, WikiRecentPage } from '@/types/wiki'

import { WikiRecentView } from './WikiRecentView'

// 지금 시각을 KST 낮 15시로 고정한다(자정 직후에 돌아도 「오늘」 묶음이 깨지지 않게 — driveRecent.test 와 같은 이유). Date 만 가짜.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 5, 10, 15, 0, 0))
})
afterEach(() => {
  vi.useRealTimers()
})

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function item(id: number, patch: Partial<WikiRecentItem> = {}): WikiRecentItem {
  return {
    pageId: id, title: `노트${id}`, spaceId: 7, spaceName: '제품팀', ancestorTitles: ['회의록'],
    lastAction: 'OPEN', lastAt: ago(5_000), url: `http://localhost/wiki/spaces/7/pages/${id}`, ...patch,
  }
}

const recentHandler = (page: WikiRecentPage) => http.get('/api/v1/wiki/recent', () => HttpResponse.json(page))

describe('노트 최근 화면', () => {
  test('groupsTodayAndShowsSpacePath — 오늘 묶음에 두 줄, 「제품팀 › 회의록」과 마지막 활동', async () => {
    renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [recentHandler({ items: [item(1, { lastAction: 'EDIT' }), item(2, { lastAt: ago(3_600_000) })], nextCursor: null })],
    })
    expect(await screen.findByTestId('wiki-recent-group-today')).toHaveTextContent('오늘')
    expect(screen.getByTestId('wiki-recent-path-1')).toHaveTextContent('제품팀 › 회의록')
    expect(screen.getByTestId('wiki-recent-activity-1')).toHaveTextContent('방금 내가 고침')
    expect(screen.getByTestId('wiki-recent-activity-2')).toHaveTextContent('1시간 전 내가 열었음')
  })

  test('루트 직속 노트는 경로에 공간 이름만 나온다', async () => {
    renderScreen(<WikiRecentView />, { path: '/wiki/recent', handlers: [recentHandler({ items: [item(1, { ancestorTitles: [] })], nextCursor: null })] })
    expect(await screen.findByTestId('wiki-recent-path-1')).toHaveTextContent(/^제품팀$/)
  })

  test('emptyState — 「최근 노트 없음」', async () => {
    renderScreen(<WikiRecentView />, { path: '/wiki/recent', handlers: [recentHandler({ items: [], nextCursor: null })] })
    const empty = await screen.findByTestId('wiki-recent-empty')
    expect(empty).toHaveTextContent('최근 노트 없음')
    // WP-1924: 드라이브 「최근」과 같은 빈 상태 규격(제목 14px 500, 600 아님).
    const title = within(empty).getByText('최근 노트 없음')
    expect(title).toHaveClass('text-sm', 'font-medium')
    expect(title).not.toHaveClass('font-semibold')
  })

  test('errorStateRetries — 실패 안내의 다시 시도로 재요청한다', async () => {
    let calls = 0
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', () => {
          calls += 1
          return calls === 1 ? HttpResponse.json({ message: 'x' }, { status: 500 }) : HttpResponse.json({ items: [item(1)], nextCursor: null })
        }),
      ],
    })
    const error = await screen.findByTestId('wiki-recent-error')
    await user.click(within(error).getByRole('button', { name: /다시 시도/ }))
    expect(await screen.findByTestId('wiki-recent-row-1')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  test('titleLinksToPage — 제목 링크는 노트 화면 주소', async () => {
    renderScreen(<WikiRecentView />, { path: '/wiki/recent', handlers: [recentHandler({ items: [item(5, { spaceId: 3 })], nextCursor: null })] })
    const row = await screen.findByTestId('wiki-recent-row-5')
    expect(within(row).getByRole('link', { name: '노트5' })).toHaveAttribute('href', '/wiki/spaces/3/pages/5')
  })

  test('copyLinkCopiesUrl — ⋯ 「링크 복사」가 응답 url 을 클립보드에 넣는다', async () => {
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [recentHandler({ items: [item(5, { url: 'https://app.example/wiki/spaces/7/pages/5' })], nextCursor: null })],
    })
    await user.click(await screen.findByTestId('wiki-recent-menu-5'))
    await user.click(await screen.findByTestId('wiki-recent-action-copy-link'))
    expect(await navigator.clipboard.readText()).toBe('https://app.example/wiki/spaces/7/pages/5')
  })

  test('openInNewTab — ⋯ 「새 탭에서 열기」가 앱 안 노트 주소를 새 탭으로 연다', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [recentHandler({ items: [item(5, { spaceId: 3 })], nextCursor: null })],
    })
    await user.click(await screen.findByTestId('wiki-recent-menu-5'))
    await user.click(await screen.findByTestId('wiki-recent-action-open-tab'))
    expect(openSpy).toHaveBeenCalledWith('/wiki/spaces/3/pages/5', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })

  test('nextCursor 가 있으면 줄이 비어 있어도 센티널이 보일 때 다음 쪽을 받는다', async () => {
    const io = controlIntersection()
    const cursors: (string | null)[] = []
    renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', ({ request }) => {
          const cursor = new URL(request.url).searchParams.get('cursor')
          cursors.push(cursor)
          return HttpResponse.json(cursor ? { items: [item(2)], nextCursor: null } : { items: [item(1)], nextCursor: 'c1' })
        }),
      ],
    })
    await screen.findByTestId('wiki-recent-row-1')
    io.set(() => true)
    expect(await screen.findByTestId('wiki-recent-row-2')).toBeInTheDocument()
    expect(cursors).toEqual([null, 'c1'])
  })
})

// WP-1788: 실패 뒤 다시 시도하면 TanStack Query 가 status 를 pending 으로 되돌린다 — 그 동안에도 오류 안내·초점이 남아야 한다.
describe('노트 최근 화면 — 실패 뒤 다시 시도하는 동안 안내와 초점이 남는다(WP-1788)', () => {
  test('WP-1788 다시 시도 성공 — 응답 전에도 안내·초점 유지, 응답 뒤 목록', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ message: 'x' }, { status: 500 })
          await promise
          return HttpResponse.json({ items: [item(1)], nextCursor: null })
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'wiki-recent-error', () => calls)
    await act(async () => { release() })
    expect(await screen.findByTestId('wiki-recent-row-1')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-recent-error')).toBeNull()
  })

  test('WP-1788 다시 시도도 실패 — 안내가 사라졌다 다시 그려지지 않고 남는다', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [
        http.get('/api/v1/wiki/recent', async () => {
          calls += 1
          if (calls > 1) await promise
          return HttpResponse.json({ message: 'x' }, { status: 500 })
        }),
      ],
    })
    const retry = await clickRetryAndExpectErrorKept(user, 'wiki-recent-error', () => calls)
    await act(async () => { release() })
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'))
    expect(screen.getByTestId('wiki-recent-error')).toBeInTheDocument()
    expect(screen.queryByText('불러오는 중…')).toBeNull()
    // 안내가 새로 그려지지 않고 같은 노드·초점이 남는다.
    expect(retry.isConnected).toBe(true)
    expect(document.activeElement).toBe(retry)
  })

  test('WP-1788 첫 진입 로딩 — 실패 전 첫 조회 중에는 「불러오는 중…」', async () => {
    const { promise, release } = gate()
    renderScreen(<WikiRecentView />, {
      path: '/wiki/recent',
      handlers: [http.get('/api/v1/wiki/recent', async () => { await promise; return HttpResponse.json({ items: [], nextCursor: null }) })],
    })
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument()
    await act(async () => { release() })
    expect(await screen.findByTestId('wiki-recent-empty')).toBeInTheDocument()
  })
})
