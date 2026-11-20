// 알림 창 목록 조회 실패(WP-1847) — 실패를 빈 상태(「새 알림이 없습니다」)로 오인시키지 않고 오류 안내 + 다시 시도를 보인다.
// inboxArchive.test.tsx 의 하네스·핸들러 모양을 따르되, 알림/보관함 API 가 호출 수에 따라 실패하도록 둔다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import { InboxList, type InboxView } from '@/components/layout/InboxList'
import { clickRetryAndExpectErrorKept, gate } from '@/test/loadErrorRetry'
import { renderScreen } from '@/test/renderScreen'
import type { NotificationResponse } from '@/types/notification'

/** 알림 1건 — inboxArchive.test.tsx 와 같은 기본값. */
function notif(over: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    id: 1,
    type: 'COMMENTED',
    actorId: 9,
    actorName: '업무 비서',
    actorKind: 'AGENT',
    issueId: 7,
    projectKey: 'WP',
    issueNumber: 3,
    issueTitle: '리팩터링',
    commentId: 55,
    eventId: null,
    eventTitle: null,
    eventStartsAt: null,
    read: true,
    createdAt: new Date().toISOString(),
    ...over,
  }
}

/** 보기 상태만 쥐는 얇은 래퍼(InboxList 는 제어 전용). */
function InboxHarness({ screenEmpty }: { screenEmpty: boolean }) {
  const [view, setView] = useState<InboxView>('inbox')
  return <InboxList enabled view={view} onViewChange={setView} screenEmpty={screenEmpty} />
}

/** 한 API 의 호출 n 번째 응답 — 'error' 는 500, 'network' 는 연결 오류, 배열은 성공 목록, { held, rows } 는 held 가 풀릴 때까지 붙든 뒤 rows. */
type Step = 'error' | 'network' | NotificationResponse[] | { held: Promise<void>; rows: NotificationResponse[] }

async function respond(steps: Step[], counter: { n: number }) {
  const step = steps[Math.min(counter.n, steps.length - 1)]
  counter.n += 1
  if (!Array.isArray(step) && typeof step === 'object') {
    await step.held
    return HttpResponse.json(step.rows)
  }
  if (step === 'error') return HttpResponse.json({ message: 'boom' }, { status: 500 })
  if (step === 'network') return HttpResponse.error()
  return HttpResponse.json(step)
}

function renderInbox(opts: { inbox: Step[]; archived?: Step[]; screenEmpty?: boolean }) {
  const { inbox, archived = [[]], screenEmpty = false } = opts
  const inboxCalls = { n: 0 }
  const archiveCalls = { n: 0 }
  const view = renderScreen(<InboxHarness screenEmpty={screenEmpty} />, {
    path: '/',
    handlers: [
      http.get('/api/v1/notifications', () => respond(inbox, inboxCalls)),
      http.get('/api/v1/notifications/archived', () => respond(archived, archiveCalls)),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
    ],
  })
  return { ...view, inboxCalls: () => inboxCalls.n }
}

describe('알림 창 조회 실패', () => {
  // 500·연결 오류, 팝오버·모바일 전체 화면(screenEmpty) 모두 빈 상태 대신 같은 실패 안내를 보인다.
  test.each([
    { name: '500', step: 'error' as const, screenEmpty: false },
    { name: '네트워크 오류', step: 'network' as const, screenEmpty: false },
    { name: '모바일 전체 화면에서 500', step: 'error' as const, screenEmpty: true },
  ])('받은 알림 첫 조회가 $name 이면 빈 상태 대신 「알림을 불러오지 못했습니다」와 다시 시도를 보인다', async ({ step, screenEmpty }) => {
    renderInbox({ inbox: [step], screenEmpty })
    expect(await screen.findByTestId('inbox-error')).toHaveTextContent('알림을 불러오지 못했습니다')
    expect(screen.queryByTestId('inbox-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('inbox-error-retry')).toBeInTheDocument()
  })

  test('다시 시도로 성공하면 목록이 보인다', async () => {
    const { user } = renderInbox({ inbox: ['error', [notif({ id: 1 })]] })
    await screen.findByTestId('inbox-error')
    await user.click(screen.getByTestId('inbox-error-retry'))
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(1)
    expect(screen.queryByTestId('inbox-error')).not.toBeInTheDocument()
  })

  test('다시 시도 응답을 기다리는 동안에도 안내·busy·초점이 남는다 — 「불러오는 중…」으로 바뀌지 않는다', async () => {
    // isError·isLoading 으로 그리면 재조회 pending 동안 안내가 사라져 초점이 body 로 빠진다(WP-881) — failedWithoutData 를 쓰는 이유.
    const { promise, release } = gate()
    const { user, inboxCalls } = renderInbox({ inbox: ['error', { held: promise, rows: [notif({ id: 1 })] }] })
    await clickRetryAndExpectErrorKept(user, 'inbox-error', inboxCalls)
    release()
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(1)
  })

  test('이미 받은 목록이 있으면 재조회가 실패해도 목록을 덮지 않는다', async () => {
    const { queryClient } = renderInbox({ inbox: [[notif({ id: 1 })], 'error'] })
    await screen.findAllByTestId('inbox-item')
    await queryClient.refetchQueries()
    // 재조회 실패가 쿼리 상태에 들어간 뒤(그려진 뒤)에 본다 — 바로 보면 실패 반영 전이라 검사가 헛돈다.
    await waitFor(() => expect(queryClient.getQueryCache().getAll().some((q) => q.state.status === 'error')).toBe(true))
    expect(screen.getAllByTestId('inbox-item')).toHaveLength(1)
    expect(screen.queryByTestId('inbox-error')).not.toBeInTheDocument()
  })

  test('받은 알림이 실패해도 보관함 탭은 보관함 목록을 보인다', async () => {
    const { user } = renderInbox({ inbox: ['error'], archived: [[notif({ id: 5, issueTitle: '보관된 이슈' })]] })
    await screen.findByTestId('inbox-error')
    await user.click(screen.getByTestId('inbox-tab-archive'))
    expect(await screen.findByText(/보관된 이슈/)).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-error')).not.toBeInTheDocument()
  })

  test('보관함 조회가 실패하면 「보관한 알림을 불러오지 못했습니다」', async () => {
    const { user } = renderInbox({ inbox: [[notif({ id: 1 })]], archived: ['error'] })
    await screen.findAllByTestId('inbox-item')
    await user.click(screen.getByTestId('inbox-tab-archive'))
    expect(await screen.findByTestId('inbox-error')).toHaveTextContent('보관한 알림을 불러오지 못했습니다')
    expect(screen.queryByTestId('inbox-empty')).not.toBeInTheDocument()
  })

})
