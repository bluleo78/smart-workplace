// 메일 목록 검색 draft(WP-1003) — 페이지 테스트(WP-971).
// debounce 로 URL ?q 를 쓴 순간과 다시 렌더되는 사이에 더 친 글자가, 되돌아온 옛 q 로 덮여 지워지지 않는다(연락처 WP-999 와 같은 경합).
// URL 상태·입력값이라 브라우저 없이 판정된다.
import { act, fireEvent, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { mailAccount, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.useRealTimers()
})

const handlers = [
  http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount()])),
  http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary()])),
  http.get('/api/v1/mail/accounts/1/unread-counts', () =>
    HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
  ),
]

test('debounce 로 q 를 쓰는 사이에 더 친 글자가 남는다', async () => {
  const { location } = renderPage('/mail/1', { handlers })
  const input = await screen.findByTestId('mail-search', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 페이지가 뜬 뒤에만 setTimeout 을 가짜로 바꿔 debounce 가 끝나는 순간을 정확히 잡는다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.change(input, { target: { value: '점' } })
  // 300ms 가 지나 URL 에 「점」을 쓰는 바로 그 사이에 「심」을 더 친다 — 한 act 로 묶어 그 순서를 재현한다.
  act(() => {
    vi.advanceTimersByTime(300)
    fireEvent.change(input, { target: { value: '점심' } })
  })
  expect(location()).toBe('/mail/1?q=%EC%A0%90')
  expect(input).toHaveValue('점심')

  // 다음 debounce 가 끝나면 마지막 입력이 URL 에 들어간다.
  act(() => {
    vi.advanceTimersByTime(300)
  })
  expect(location()).toBe('/mail/1?q=%EC%A0%90%EC%8B%AC')
  expect(input).toHaveValue('점심')
})
