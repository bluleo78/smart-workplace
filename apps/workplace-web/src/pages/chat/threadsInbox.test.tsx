// 스레드 모아보기 — 첫 조회 실패·다시 시도·첫 진입 로딩(WP-1820). renderScreen + MSW.
// TanStack Query 는 데이터 없이 실패한 쿼리를 다시 부르면 status 를 pending 으로 돌린다 — 그 동안에도 실패 안내·초점이 남아야 한다.
import { act, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'

import { createThreadInboxItem } from '../../../e2e/factories/messaging.factory'
import ThreadsInboxPage from './ThreadsInboxPage'

/** DM 목록은 카드 표기에만 쓰므로 빈 배열로 둔다. */
const dmsHandler = () => http.get('/api/v1/messaging/dms', () => HttpResponse.json([]))

describe('스레드 모아보기 — 조회 실패(WP-1820)', () => {
  test('WP-1820 첫 조회 실패 — 빈 상태 대신 실패 안내', async () => {
    renderScreen(<ThreadsInboxPage />, {
      path: '/chat/threads/inbox',
      handlers: [dmsHandler(), http.get('/api/v1/messaging/threads/inbox', () => HttpResponse.json({ message: 'x' }, { status: 500 }))],
    })
    expect(await screen.findByTestId('threads-inbox-error')).toBeInTheDocument()
    expect(screen.queryByText('새 스레드 답글이 없어요')).toBeNull()
  })

  test('WP-1820 다시 시도 성공 — 응답 전 안내·초점 유지, 응답 뒤 카드', async () => {
    let calls = 0
    const { promise, release } = gate()
    const { user } = renderScreen(<ThreadsInboxPage />, {
      path: '/chat/threads/inbox',
      handlers: [
        dmsHandler(),
        http.get('/api/v1/messaging/threads/inbox', async () => {
          calls += 1
          if (calls === 1) return HttpResponse.json({ message: 'x' }, { status: 500 })
          await promise
          return HttpResponse.json({ items: [createThreadInboxItem({ rootMessage: { id: 7 } })], nextCursor: null, hasMore: false })
        }),
      ],
    })
    await clickRetryAndExpectErrorKept(user, 'threads-inbox-error', () => calls)
    await act(async () => { release() })
    expect(await screen.findByTestId('thread-inbox-card-7')).toBeInTheDocument()
    expect(screen.queryByTestId('threads-inbox-error')).toBeNull()
  })

  test('WP-1820 첫 진입 로딩 — 빈 상태를 먼저 그리지 않는다', async () => {
    const { promise, release } = gate()
    renderScreen(<ThreadsInboxPage />, {
      path: '/chat/threads/inbox',
      handlers: [
        dmsHandler(),
        http.get('/api/v1/messaging/threads/inbox', async () => {
          await promise
          return HttpResponse.json({ items: [], nextCursor: null, hasMore: false })
        }),
      ],
    })
    expect(await screen.findByTestId('threads-inbox-page')).toBeInTheDocument()
    expect(screen.queryByText('새 스레드 답글이 없어요')).toBeNull()
    expect(screen.queryByTestId('threads-inbox-error')).toBeNull()
    await act(async () => { release() })
    expect(await screen.findByText('새 스레드 답글이 없어요')).toBeInTheDocument()
  })
})
