// 「AI 현황 › 처리 이력」 화면(WP-1825) — 주소의 조건이 요청으로 나가고, 응답이 행 셀로 그려지며, 필터·검색·구간 칩·탭이 주소로 이어지는지 MSW 로 본다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { formatDurationMs } from '@/lib/formatters'
import { renderScreen } from '@/test/renderScreen'
import { mockResizableViewport } from '@/test/viewport'

import { createAiRunDetail, createAiRunItem, createAiRunPage } from '../../../../e2e/factories/aiStatus.factory'
import AiStatusHistoryPage from './AiStatusHistoryPage'

afterEach(() => vi.unstubAllGlobals())

/** 데스크톱 폭에서 시작하는 뷰포트 — 「모바일」 테스트가 390 으로 좁혔다가 되돌린다(파일당 한 뷰포트). */
const viewport = mockResizableViewport({ width: 1024, height: 768, pointer: 'fine' })

const RUNS = '/api/v1/admin/ai-status/runs'

/** 받은 요청의 검색 파라미터를 모으고 pages 를 차례로 돌려주는 핸들러. */
function runsHandler(pages: ReturnType<typeof createAiRunPage>[] | (() => Response)) {
  const seen: URLSearchParams[] = []
  const handler = http.get(RUNS, ({ request }) => {
    seen.push(new URL(request.url).searchParams)
    if (typeof pages === 'function') return pages()
    return HttpResponse.json(pages[Math.min(seen.length - 1, pages.length - 1)])
  })
  return { seen, handler }
}

function renderHistory(path: string, h: ReturnType<typeof runsHandler>) {
  return renderScreen(<AiStatusHistoryPage />, { path, handlers: [h.handler], auth: { isAdmin: true } })
}

test('주소의 조건이 요청으로 나간다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  renderHistory('/settings/ai-status/history?period=7d&kind=MAIL_CLASSIFY_BATCH&status=FAILED', h)
  await screen.findByTestId('ai-run-row')
  const q = h.seen[0]
  expect(q.getAll('kind')).toEqual(['MAIL_CLASSIFY_BATCH'])
  expect(q.get('status')).toBe('FAILED')
  expect(Math.abs(Date.parse(q.get('from') as string) - (Date.now() - 7 * 86_400_000))).toBeLessThan(60_000)
  expect(q.get('size')).toBe('50')
  expect(q.get('cursor')).toBeNull()
  // 칩 자체를 겨냥 — 표 머리의 같은 글자에 맞지 않도록 「필터 제거」 단추로 확인한다
  expect(screen.getByRole('button', { name: '종류 필터 제거' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '상태 필터 제거' })).toBeInTheDocument()
})

test('구간 주소는 구간으로 조회하고 칩을 지우면 기간으로 돌아간다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user, location } = renderHistory(
    '/settings/ai-status/history?from=2026-11-20T05:00:00.000Z&to=2026-11-20T06:00:00.000Z',
    h,
  )
  await screen.findByTestId('ai-run-row')
  expect(h.seen[0].get('from')).toBe('2026-11-20T05:00:00.000Z')
  expect(h.seen[0].get('to')).toBe('2026-11-20T06:00:00.000Z')
  expect(screen.getByTestId('ai-run-range-chip')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '구간 지우기' }))
  await waitFor(() => expect(h.seen.length).toBeGreaterThan(1))
  const last = h.seen[h.seen.length - 1]
  expect(last.get('to')).toBeNull()
  expect(last.get('from')).not.toBe('2026-11-20T05:00:00.000Z')
  expect(location()).not.toContain('from=')
  expect(screen.queryByTestId('ai-run-range-chip')).not.toBeInTheDocument()
})

test('구간이 걸려 있으면 어떤 기간도 선택된 것으로 보이지 않고, 기간을 누르면 기간 조회로 돌아간다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user, location } = renderHistory('/settings/ai-status/history?from=2026-11-20T05:00:00.000Z', h)
  await screen.findByTestId('ai-run-row')
  const group = screen.getByRole('group', { name: '기간' })
  expect(within(group).queryAllByRole('button', { pressed: true })).toHaveLength(0)
  await user.click(within(group).getByRole('button', { name: '7일' }))
  await waitFor(() => expect(location()).toContain('period=7d'))
  expect(location()).not.toContain('from=')
})

test('목록에 없는 종류 코드가 주소에 있어도 종류 칩이 보인다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  renderHistory('/settings/ai-status/history?kind=SOME_NEW_KIND', h)
  await screen.findByTestId('ai-run-row')
  expect(screen.getByRole('button', { name: '종류 필터 제거' })).toBeInTheDocument()
  expect(screen.getByText('SOME_NEW_KIND')).toBeInTheDocument()
})

test('잘못된 주소 값은 버린다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  renderHistory('/settings/ai-status/history?status=foo&period=2h', h)
  await screen.findByTestId('ai-run-row')
  expect(h.seen[0].get('status')).toBeNull()
  expect(screen.queryByTestId('ai-run-load-error')).not.toBeInTheDocument()
})

test('응답이 행 셀로 그려진다', async () => {
  const second = createAiRunItem({
    id: 'W-9',
    kind: 'DELEGATED_WORK',
    target: { type: 'ISSUE', id: 'WP-1812', label: 'WP-1812 메일 분류 개선' },
    actor: { type: 'AGENT', id: 7, name: '개발자1' },
    status: 'RUNNING',
    waitMs: null,
    durationMs: null,
    model: null,
    errorReason: null,
  })
  const h = runsHandler([createAiRunPage([createAiRunItem(), second])])
  renderHistory('/settings/ai-status/history', h)
  const rows = await screen.findAllByTestId('ai-run-row')
  const c1 = within(rows[0]).getAllByRole('cell')
  expect(c1[1]).toHaveTextContent('메일 분류')
  expect(c1[2]).toHaveTextContent('메일 20통 · 김민수')
  expect(within(c1[2]).queryByRole('link')).not.toBeInTheDocument()
  expect(c1[3]).toHaveTextContent('자동')
  expect(c1[4]).toHaveTextContent('실패')
  expect(c1[5]).toHaveTextContent(formatDurationMs(400))
  expect(c1[6]).toHaveTextContent(formatDurationMs(30000))
  expect(c1[7]).toHaveTextContent('—')
  expect(c1[8]).toHaveTextContent('claude-haiku-5-5')
  expect(c1[9]).toHaveTextContent('응답 시간 초과')
  const c2 = within(rows[1]).getAllByRole('cell')
  expect(c2[1]).toHaveTextContent('위임 작업')
  expect(within(c2[2]).getByRole('link')).toHaveAttribute('href', '/projects/WP/issues/1812')
  expect(c2[3]).toHaveTextContent('개발자1')
  // AGENT 는 이름 옆 Bot 표식, 자동은 없다
  expect(within(c2[3]).getByTestId('ai-actor-bot')).toBeInTheDocument()
  expect(within(c1[3]).queryByTestId('ai-actor-bot')).not.toBeInTheDocument()
  expect(c2[4]).toHaveTextContent('진행 중')
  expect(c2[7]).toHaveTextContent('—')
  expect(c2[8]).toHaveTextContent('—')
})

test('검색은 300ms 뒤 q 로 나가고 주소에 남는다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { location } = renderHistory('/settings/ai-status/history', h)
  await screen.findByTestId('ai-run-row')
  fireEvent.change(screen.getByPlaceholderText('대상·오류 검색'), { target: { value: '시간 초과' } })
  // 입력 직후에는 아직 나가지 않는다
  expect(h.seen.every((s) => s.get('q') === null)).toBe(true)
  await waitFor(() => expect(h.seen[h.seen.length - 1].get('q')).toBe('시간 초과'))
  expect(new URLSearchParams(location().split('?')[1]).get('q')).toBe('시간 초과')
})

test('검색어 끝 공백은 디바운스가 주소를 바꿔도 지워지지 않는다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user } = renderHistory('/settings/ai-status/history', h)
  await screen.findByTestId('ai-run-row')
  const box = screen.getByPlaceholderText('대상·오류 검색')
  fireEvent.change(box, { target: { value: '시간 ' } })
  // 디바운스가 q=시간 을 주소에 올릴 때까지 기다린다
  await waitFor(() => expect(h.seen.some((s) => s.get('q') === '시간')).toBe(true))
  await user.type(box, '초과')
  expect(box).toHaveValue('시간 초과')
})

test('늦게 도착한 주소 반영이 뒤 입력을 지우지 않는다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const h = runsHandler([createAiRunPage([createAiRunItem()])])
    renderHistory('/settings/ai-status/history', h)
    await screen.findByTestId('ai-run-row')
    const box = screen.getByPlaceholderText('대상·오류 검색')
    // 'tim' 의 디바운스 쓰기가 나가는 같은 틱에 'time' 입력이 이어진다 — 주소는 'tim', 칸은 'time'
    act(() => {
      fireEvent.change(box, { target: { value: 'tim' } })
    })
    act(() => {
      vi.advanceTimersByTime(300)
      fireEvent.change(box, { target: { value: 'time' } })
    })
    expect(box).toHaveValue('time')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(box).toHaveValue('time')
  } finally {
    vi.useRealTimers()
  }
})

test('종류 칩으로 고르면 주소가 바뀌고 첫 페이지부터 다시 받는다', async () => {
  // 교차는 레이아웃이라 jsdom 이 재지 못한다 — sentinel 이 보였다고 테스트가 직접 알린다(userList.test 와 같은 방식).
  const observers: Array<{ cb: IntersectionObserverCallback; nodes: Element[] }> = []
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private entry: { cb: IntersectionObserverCallback; nodes: Element[] }
      constructor(cb: IntersectionObserverCallback) {
        this.entry = { cb, nodes: [] }
        observers.push(this.entry)
      }
      observe(node: Element) {
        this.entry.nodes.push(node)
      }
      unobserve() {}
      disconnect() {
        this.entry.nodes = []
      }
      takeRecords() {
        return []
      }
    },
  )
  const intersect = () =>
    act(() => {
      for (const o of observers)
        for (const target of o.nodes)
          o.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  const seen: URLSearchParams[] = []
  const { user, location } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history',
    auth: { isAdmin: true },
    handlers: [
      http.get(RUNS, ({ request }) => {
        const sp = new URL(request.url).searchParams
        seen.push(sp)
        if (sp.get('status') === 'FAILED') return HttpResponse.json(createAiRunPage([createAiRunItem({ id: 'R-new', kind: 'WIKI_SUMMARIZE' })]))
        if (sp.get('cursor') === 'c1') return HttpResponse.json(createAiRunPage([createAiRunItem({ id: 'R-p2', kind: 'ISSUE_CLASSIFY' })]))
        return HttpResponse.json(createAiRunPage([createAiRunItem({ id: 'R-p1' })], 'c1'))
      }),
    ],
  })
  await screen.findByTestId('ai-run-row')
  expect(screen.getByTestId('ai-run-count')).toHaveTextContent('1건 이상')
  intersect()
  await waitFor(() => expect(screen.getAllByTestId('ai-run-row')).toHaveLength(2))
  expect(seen.some((s) => s.get('cursor') === 'c1')).toBe(true)

  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-status'))
  await user.click(await screen.findByTestId('facet-value-status-FAILED'))
  await waitFor(() => expect(screen.getAllByTestId('ai-run-row')).toHaveLength(1))
  expect(within(screen.getByTestId('ai-run-row')).getByText('노트 요약')).toBeInTheDocument()
  expect(seen[seen.length - 1].get('cursor')).toBeNull()
  expect(location()).toContain('status=FAILED')
})

test('데스크톱 필터 줄 순서는 검색 → 필터 → 구간 칩 → 건수', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  renderHistory('/settings/ai-status/history?from=2026-11-20T05:00:00.000Z&status=FAILED', h)
  await screen.findByTestId('ai-run-row')
  const search = screen.getByPlaceholderText('대상·오류 검색')
  const facet = screen.getByRole('button', { name: '상태 필터 제거' })
  const range = screen.getByTestId('ai-run-range-chip')
  const count = screen.getByTestId('ai-run-count')
  const before = (x: Element, y: Element) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  expect(before(search, facet)).toBe(true)
  expect(before(facet, range)).toBe(true)
  expect(before(range, count)).toBe(true)
})

test('건수는 받은 행 수, 다음 페이지가 있으면 「이상」', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem(), createAiRunItem({ id: 'R-2' })], 'c1')])
  renderHistory('/settings/ai-status/history', h)
  await screen.findAllByTestId('ai-run-row')
  expect(screen.getByTestId('ai-run-count')).toHaveTextContent('2건 이상')
})

test('빈 응답이면 「조건에 맞는 처리 없음」, 필터 초기화가 period 만 남긴다', async () => {
  const h = runsHandler([createAiRunPage([])])
  const { user, location } = renderHistory('/settings/ai-status/history?period=7d&status=FAILED', h)
  expect(await screen.findByText('조건에 맞는 처리 없음')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '필터 초기화' }))
  await waitFor(() => expect(location()).toBe('/settings/ai-status/history?period=7d'))
})

test('첫 페이지 실패면 다시 시도 화면', async () => {
  const h = runsHandler(() => HttpResponse.json({}, { status: 500 }) as unknown as Response)
  renderHistory('/settings/ai-status/history', h)
  expect(await screen.findByTestId('ai-run-load-error')).toBeInTheDocument()
})

test('탭: 처리 이력 → 개요로 갈 때 기간만 가져간다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user, location } = renderHistory('/settings/ai-status/history?period=7d&status=FAILED', h)
  await screen.findByTestId('ai-run-row')
  await user.click(screen.getByTestId('ai-status-tab-overview'))
  expect(location()).toBe('/settings/ai-status?period=7d')
})

// 상세 시트 — 행을 누르면 열리고, 처리(R-)만 상세 API 를 R- 뗀 UUID 로 부른다.
const DETAIL_UUID = '0b6f0c1e-0000-4000-8000-000000000001'

test('상세 시트: AI 처리 행을 누르면 상세를 불러 요약·오류 원문을 보인다', async () => {
  const paths: string[] = []
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history',
    auth: { isAdmin: true },
    handlers: [
      h.handler,
      http.get(`${RUNS}/:id`, ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return HttpResponse.json(
          createAiRunDetail({ credentialLabel: '워크스페이스 API 키', attempt: 3, errorDetail: 'upstream: anthropic 529 overloaded_error' }),
        )
      }),
    ],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('워크스페이스 API 키')).toBeInTheDocument()
  expect(within(dialog).getByText('3번째')).toBeInTheDocument()
  expect(within(dialog).getByText(DETAIL_UUID)).toBeInTheDocument()
  expect(within(dialog).getByText('upstream: anthropic 529 overloaded_error')).toBeInTheDocument()
  expect(within(dialog).getByRole('img', { name: '대기 ' + formatDurationMs(400) })).toBeInTheDocument()
  expect(within(dialog).getByTestId('ai-run-bar-duration')).toHaveStyle({ width: '100%' })
  expect(paths).toEqual([`/api/v1/admin/ai-status/runs/${DETAIL_UUID}`])
})

test('상세 시트: 위임 작업 행은 상세 API 를 부르지 않는다', async () => {
  let detailCalls = 0
  const h = runsHandler([createAiRunPage([createAiRunItem({ id: 'W-9', kind: 'DELEGATED_WORK' })])])
  const { user } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history',
    auth: { isAdmin: true },
    handlers: [
      h.handler,
      http.get(`${RUNS}/:id`, () => {
        detailCalls++
        return HttpResponse.json(createAiRunDetail())
      }),
    ],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('위임 작업')).toBeInTheDocument()
  expect(within(dialog).queryByText('계정')).not.toBeInTheDocument()
  expect(within(dialog).queryByText('시도')).not.toBeInTheDocument()
  expect(within(dialog).queryByText('처리 ID')).not.toBeInTheDocument()
  expect(detailCalls).toBe(0)
})

test('상세 시트: 같은 종류 실패만 보기 → 주소가 kind+status=FAILED 로 바뀌고 시트가 닫힌다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user, location } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history?period=7d',
    auth: { isAdmin: true },
    handlers: [h.handler, http.get(`${RUNS}/:id`, () => HttpResponse.json(createAiRunDetail()))],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  await user.click(await screen.findByRole('button', { name: '같은 종류 실패만 보기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const sp = new URLSearchParams(location().split('?')[1])
  expect(sp.getAll('kind')).toEqual(['MAIL_CLASSIFY_BATCH'])
  expect(sp.get('status')).toBe('FAILED')
  expect(sp.get('period')).toBe('7d')
})

test('상세 시트: 같은 종류 실패만 보기는 구간(from·to)도 유지한다', async () => {
  const from = '2026-11-20T05:00:00.000Z'
  const to = '2026-11-20T06:00:00.000Z'
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user, location } = renderScreen(<AiStatusHistoryPage />, {
    path: `/settings/ai-status/history?from=${from}&to=${to}`,
    auth: { isAdmin: true },
    handlers: [h.handler, http.get(`${RUNS}/:id`, () => HttpResponse.json(createAiRunDetail()))],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  await user.click(await screen.findByRole('button', { name: '같은 종류 실패만 보기' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const sp = new URLSearchParams(location().split('?')[1])
  expect(sp.get('from')).toBe(from)
  expect(sp.get('to')).toBe(to)
  expect(sp.get('status')).toBe('FAILED')
})

test('상세 시트: 실패가 아닌 처리에는 「같은 종류 실패만 보기」 가 없다', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem({ status: 'SUCCEEDED', errorReason: null })])])
  const { user } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history',
    auth: { isAdmin: true },
    handlers: [h.handler, http.get(`${RUNS}/:id`, () => HttpResponse.json(createAiRunDetail()))],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).queryByRole('button', { name: '같은 종류 실패만 보기' })).not.toBeInTheDocument()
})

test('상세 시트: 대상이 이슈면 링크다', async () => {
  const h = runsHandler([
    createAiRunPage([createAiRunItem({ id: 'W-9', kind: 'DELEGATED_WORK', target: { type: 'ISSUE', id: 'WP-1812', label: 'WP-1812 메일 분류 개선' } })]),
  ])
  const { user } = renderHistory('/settings/ai-status/history', h)
  await user.click(await screen.findByTestId('ai-run-row'))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('link', { name: 'WP-1812 메일 분류 개선' })).toHaveAttribute('href', '/projects/WP/issues/1812')
})

test('상세 시트: 상세 조회가 실패하면 「상세를 불러오지 못함」, 목록 값은 그대로', async () => {
  const h = runsHandler([createAiRunPage([createAiRunItem()])])
  const { user } = renderScreen(<AiStatusHistoryPage />, {
    path: '/settings/ai-status/history',
    auth: { isAdmin: true },
    handlers: [h.handler, http.get(`${RUNS}/:id`, () => HttpResponse.json({}, { status: 500 }))],
  })
  await user.click(await screen.findByTestId('ai-run-row'))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('상세를 불러오지 못함')).toBeInTheDocument()
  expect(within(dialog).getByText('응답 시간 초과')).toBeInTheDocument()
})

// 모바일 — 표 대신 3줄 카드, 기간은 칩 줄 맨 앞 칩, 상세 시트는 아래에서 올라온다.
describe('모바일', () => {
  beforeEach(() => {
    act(() => viewport.setWidth(390))
  })
  afterEach(() => {
    act(() => viewport.setWidth(1024))
  })

  test('모바일은 표 대신 3줄 카드', async () => {
    const h = runsHandler([createAiRunPage([createAiRunItem()])])
    renderHistory('/settings/ai-status/history', h)
    const card = await screen.findByTestId('ai-run-card')
    expect(screen.queryByTestId('ai-run-row')).not.toBeInTheDocument()
    const lines = card.querySelectorAll('[data-line]')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toHaveTextContent('메일 분류')
    expect(lines[0]).toHaveTextContent('실패')
    expect(lines[1]).toHaveTextContent('메일 20통 · 김민수')
    expect(lines[2]).toHaveTextContent('자동 · 30초 · 응답 시간 초과')
  })

  test('모바일 기간 칩으로 7일을 고르면 주소 period=7d', async () => {
    const h = runsHandler([createAiRunPage([createAiRunItem()])])
    const { user, location } = renderHistory('/settings/ai-status/history?from=2026-11-20T05:00:00.000Z', h)
    await screen.findByTestId('ai-run-card')
    expect(screen.getByTestId('ai-run-chip-row')).toContainElement(screen.getByTestId('ai-run-period-chip'))
    await user.click(screen.getByTestId('ai-run-period-chip'))
    await user.click(await screen.findByRole('button', { name: '7일' }))
    await waitFor(() => expect(location()).toContain('period=7d'))
    expect(location()).not.toContain('from=')
    // 고르면 팝오버가 닫힌다
    await waitFor(() => expect(screen.queryByRole('button', { name: '30일' })).not.toBeInTheDocument())
  })

  test('모바일 칩 줄 순서는 기간 → 구간 → 필터', async () => {
    const h = runsHandler([createAiRunPage([createAiRunItem()])])
    renderHistory('/settings/ai-status/history?from=2026-11-20T05:00:00.000Z&status=FAILED', h)
    await screen.findByTestId('ai-run-card')
    const row = screen.getByTestId('ai-run-chip-row')
    const period = screen.getByTestId('ai-run-period-chip')
    const range = screen.getByTestId('ai-run-range-chip')
    const facet = screen.getByRole('button', { name: '상태 필터 제거' })
    expect(period.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(range.compareDocumentPosition(facet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row).toContainElement(facet)
  })

  test('모바일 시트는 아래에서 열린다', async () => {
    const h = runsHandler([createAiRunPage([createAiRunItem()])])
    const { user } = renderScreen(<AiStatusHistoryPage />, {
      path: '/settings/ai-status/history',
      auth: { isAdmin: true },
      handlers: [h.handler, http.get(`${RUNS}/:id`, () => HttpResponse.json(createAiRunDetail()))],
    })
    await user.click(await screen.findByTestId('ai-run-card'))
    expect(await screen.findByRole('dialog')).toHaveAttribute('data-side', 'bottom')
  })
})
