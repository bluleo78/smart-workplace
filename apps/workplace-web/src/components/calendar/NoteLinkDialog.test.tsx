// @vitest-environment jsdom
// 「노트 연결」 창(WP-1701) — 검색어 채움·전체 선택, 300ms 디바운스, 고르기·두 번 누르기·Enter, 결과 없음·지움, 잇기 실패.
// 창 하나만 renderScreen 으로 띄우고 위키 검색은 MSW 로 모킹한다. 디바운스는 setTimeout 만 가짜로 돌려 299/300ms 경계를 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { NoteLinkDialog } from '@/components/calendar/NoteLinkDialog'
import { renderScreen } from '@/test/renderScreen'
import type { WikiSearchResult } from '@/types/wiki'

import { noteSearchResult } from '../../../e2e/factories/calendar.factory'

afterEach(() => vi.useRealTimers())

/** 위키 검색 목 — 받은 쿼리를 모으고 results(q) 로 답한다. */
function searchMock(results: (q: string) => WikiSearchResult[] = () => [noteSearchResult()]) {
  const queries: URLSearchParams[] = []
  const handler = http.get('/api/v1/wiki/search', ({ request }) => {
    const params = new URL(request.url).searchParams
    queries.push(params)
    return HttpResponse.json(results(params.get('q') ?? ''))
  })
  return { handler, queries }
}

function renderDialog(handlers: ReturnType<typeof searchMock>['handler'][], onLink = vi.fn(async () => {}), emptyAction?: React.ReactNode) {
  const onOpenChange = vi.fn()
  const view = renderScreen(
    createElement(NoteLinkDialog, { open: true, onOpenChange, initialQuery: '주간 회의', onLink, emptyAction }),
    { handlers },
  )
  return { ...view, onLink, onOpenChange }
}

describe('노트 연결 창', () => {
  test('열면 검색 칸에 일정 제목이 채워져 전체 선택되고 그 제목으로 size=20 검색한다', async () => {
    const { handler, queries } = searchMock()
    renderDialog([handler])
    const input = (await screen.findByTestId('note-link-search')) as HTMLInputElement
    expect(input).toHaveValue('주간 회의')
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('주간 회의'.length)
    await waitFor(() => expect(queries).toHaveLength(1))
    expect(queries[0].get('q')).toBe('주간 회의')
    expect(queries[0].get('size')).toBe('20')
  })

  test('입력이 300ms 멈춘 뒤에만 다시 찾는다', async () => {
    const { handler, queries } = searchMock()
    renderDialog([handler])
    await waitFor(() => expect(queries).toHaveLength(1))
    await screen.findByTestId('note-link-result')
    // setTimeout 만 가짜로 — Date·마이크로태스크는 그대로라 MSW 응답은 진짜 시계로 돈다
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(screen.getByTestId('note-link-search'), { target: { value: '킥오프' } })
    await vi.advanceTimersByTimeAsync(299)
    expect(queries).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await waitFor(() => expect(queries).toHaveLength(2))
    expect(queries[1].get('q')).toBe('킥오프')
  })

  test('결과 행에 제목과 공간 · 고친 사람 · 고친 때가 보인다', async () => {
    const { handler } = searchMock()
    renderDialog([handler])
    const row = await screen.findByTestId('note-link-result')
    expect(within(row).getByText('주간 회의록')).toBeInTheDocument()
    expect(row).toHaveTextContent(/기획팀 공간 · 양동희 · .+ 수정/)
  })

  test('고친 사람이 없는 결과는 공간 · 고친 때만 보인다', async () => {
    const { handler } = searchMock(() => [noteSearchResult({ updatedByName: null })])
    renderDialog([handler])
    const row = await screen.findByTestId('note-link-result')
    expect(row).toHaveTextContent(/기획팀 공간 · .+ 수정/)
    expect(row.textContent).not.toMatch(/ ·\s*·/)
  })

  test('행을 누르면 고른 표시와 함께 「연결」이 켜지고, 누르면 onLink 에 그 노트가 간다', async () => {
    const { handler } = searchMock()
    const { user, onLink, onOpenChange } = renderDialog([handler])
    const row = await screen.findByTestId('note-link-result')
    expect(screen.getByTestId('note-link-submit')).toBeDisabled()
    await user.click(row)
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('note-link-submit')).toBeEnabled()
    await user.click(screen.getByTestId('note-link-submit'))
    await waitFor(() => expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ id: 11 })))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  test('행을 두 번 누르면 바로 연결한다', async () => {
    const { handler } = searchMock()
    const { user, onLink } = renderDialog([handler])
    await user.dblClick(await screen.findByTestId('note-link-result'))
    await waitFor(() => expect(onLink).toHaveBeenCalledWith(expect.objectContaining({ id: 11 })))
  })

  test('고른 행에서 Enter 면 바로 연결한다', async () => {
    const { handler } = searchMock()
    const { user, onLink } = renderDialog([handler])
    const row = await screen.findByTestId('note-link-result')
    await user.click(row)
    row.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onLink).toHaveBeenCalledTimes(1))
  })

  test('결과가 없으면 「검색 결과 없음」과 emptyAction 이 보인다', async () => {
    const { handler } = searchMock(() => [])
    renderDialog([handler], undefined, createElement('button', { type: 'button' }, '회의록 만들기'))
    expect(await screen.findByText('검색 결과 없음')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회의록 만들기' })).toBeInTheDocument()
  })

  test('검색어를 다 지우면 결과를 비우고 「노트 제목 검색」만 보인다 — 요청도 없다', async () => {
    const { handler, queries } = searchMock()
    renderDialog([handler])
    await screen.findByTestId('note-link-result')
    const before = queries.length
    fireEvent.change(screen.getByTestId('note-link-search'), { target: { value: '' } })
    await waitFor(() => expect(screen.queryByTestId('note-link-result')).not.toBeInTheDocument())
    expect(screen.getByTestId('note-link-results')).toHaveTextContent('노트 제목 검색')
    // 디바운스가 지난 뒤에도 요청이 늘지 않는다
    await new Promise((r) => setTimeout(r, 400))
    expect(queries).toHaveLength(before)
  })

  test('onLink 가 실패하면 창 안에 오류가 보이고 창은 열린 채다', async () => {
    const { handler } = searchMock()
    const onLink = vi.fn(async () => {
      throw new Error('boom')
    })
    const { user, onOpenChange } = renderDialog([handler], onLink)
    await user.click(await screen.findByTestId('note-link-result'))
    await user.click(screen.getByTestId('note-link-submit'))
    expect(await screen.findByTestId('note-link-error')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('note-link-dialog')).toBeInTheDocument()
  })
})
