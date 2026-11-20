// 알림 창 「알림 | 보관함」 전환·보관함 목록·줄 되돌리기(WP-1690), 빈 상태 CTA·조회 실패 표시(WP-1848) — 화면 컴포넌트 테스트.
// InboxList 만 renderScreen 으로 띄우고(Popover 없이), MSW 로 알림·보관함·되돌리기 API 를 모킹한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { InboxList, type InboxView, InboxViewTabs } from '@/components/layout/InboxList'
import { renderScreen } from '@/test/renderScreen'
import type { NotificationResponse } from '@/types/notification'

/** 알림 1건 — appRail.test.tsx 와 같은 기본값. */
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

/** InboxList 는 보기 상태를 바깥이 들고 있어야 해서(제어 전용), 테스트에서는 상태만 쥐는 얇은 래퍼로 띄운다. */
function InboxHarness({
  screenEmpty = false,
  onNavigate,
  hideHeader = false,
}: {
  screenEmpty?: boolean
  onNavigate?: () => void
  /** true 면 실제 모바일 NotificationsPage 처럼 탭을 InboxList 밖에 그리고 InboxList 는 hideHeader 로 띄운다. */
  hideHeader?: boolean
}) {
  const [view, setView] = useState<InboxView>('inbox')
  return (
    <>
      {hideHeader && <InboxViewTabs view={view} onChange={setView} />}
      <InboxList enabled view={view} onViewChange={setView} screenEmpty={screenEmpty} onNavigate={onNavigate} hideHeader={hideHeader} />
    </>
  )
}

/**
 * InboxList 를 띄운다. archived 는 보관함 응답(되돌리기 성공 뒤에는 restored 로 비운다), unarchived 는 되돌리기 요청 바디 ids.
 */
function renderInbox(opts: { inbox?: NotificationResponse[]; archived?: NotificationResponse[]; screenEmpty?: boolean; onNavigate?: () => void; hideHeader?: boolean; inboxStatus?: number } = {}) {
  const { inbox = [notif({ id: 1 })], archived = [], screenEmpty = false, onNavigate, hideHeader = false, inboxStatus = 200 } = opts
  const inboxCalls = { count: 0 }
  const unarchived: number[][] = []
  let archiveRows = archived
  const view = renderScreen(<InboxHarness screenEmpty={screenEmpty} onNavigate={onNavigate} hideHeader={hideHeader} />, {
    path: '/',
    handlers: [
      http.get('/api/v1/notifications', () => {
        inboxCalls.count += 1
        return inboxStatus === 200 ? HttpResponse.json(inbox) : new HttpResponse(null, { status: inboxStatus })
      }),
      http.get('/api/v1/notifications/archived', () => HttpResponse.json(archiveRows)),
      http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
      http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
      http.post('/api/v1/notifications/unarchive', async ({ request }) => {
        const body = (await request.json()) as { ids: number[] }
        unarchived.push(body.ids)
        archiveRows = [] // 성공 뒤 보관함은 비었다
        return HttpResponse.json({ restoredIds: body.ids })
      }),
    ],
  })
  return { ...view, unarchived, inboxCalls }
}

describe('알림 창 보관함 전환', () => {
  test('알림 탭이 기본이고 aria-selected 가 맞다', async () => {
    renderInbox()
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(1)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-tab-inbox')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('inbox-tab-archive')).toHaveAttribute('aria-selected', 'false')
  })

  test('탭 전환: 보관함을 누르면 GET /notifications/archived 결과가 보이고 모두 읽음·읽은 알림 보관이 숨는다', async () => {
    const { user } = renderInbox({ archived: [notif({ id: 5, issueTitle: '보관된 이슈' })] })
    await screen.findAllByTestId('inbox-item')
    expect(screen.getByTestId('inbox-mark-all')).toBeInTheDocument()
    await user.click(screen.getByTestId('inbox-tab-archive'))
    const item = await screen.findByText(/보관된 이슈/)
    expect(item).toBeInTheDocument()
    expect(screen.queryByText(/리팩터링/)).not.toBeInTheDocument()
    expect(screen.getByTestId('inbox-tab-archive')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('inbox-mark-all')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inbox-archive-read')).not.toBeInTheDocument()
  })

  test('되돌리기: POST /notifications/unarchive 본문 { ids: [<id>] } 를 보내고 그 줄이 보관함에서 사라진다', async () => {
    const { user, unarchived } = renderInbox({ archived: [notif({ id: 5, issueTitle: '보관된 이슈' })] })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    await screen.findByText(/보관된 이슈/)
    await user.click(screen.getByTestId('inbox-unarchive'))
    await waitFor(() => expect(unarchived).toEqual([[5]]))
    await waitFor(() => expect(screen.queryByText(/보관된 이슈/)).not.toBeInTheDocument())
    expect(await screen.findByTestId('inbox-empty')).toHaveTextContent('보관한 알림이 없습니다')
  })

  test('archive view: 되돌리기는 이동하지 않는다', async () => {
    const { user, location } = renderInbox({ archived: [notif({ id: 5 })] })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    const btn = await screen.findByTestId('inbox-unarchive')
    const before = location()
    await user.click(btn)
    expect(location()).toEqual(before)
  })

  test('보관함 줄을 누르면 알림 대상으로 이동한다', async () => {
    const { user, location } = renderInbox({ archived: [notif({ id: 5 })] })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    const row = await screen.findByTestId('inbox-item')
    await user.click(within(row).getByText(/리팩터링/))
    await waitFor(() => expect(location()).not.toEqual('/'))
  })

  test('빈 보관함이면 「보관한 알림이 없습니다」', async () => {
    const { user } = renderInbox({ archived: [] })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    expect(await screen.findByTestId('inbox-empty')).toHaveTextContent('보관한 알림이 없습니다')
  })

  test('screenEmpty 면 빈 보관함도 전체 화면 빈 상태 규격으로 보인다', async () => {
    const { user } = renderInbox({ archived: [], screenEmpty: true })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    expect(await screen.findByTestId('inbox-empty')).toHaveTextContent('보관한 알림이 없습니다')
  })
})

describe('보관함 줄 되돌리기 — 처리 중 비활성은 그 줄만', () => {
  // 한 줄 되돌리기 요청이 걸려 있는 동안에도 다른 줄의 「되돌리기」는 눌리고 요청이 나간다(전체 비활성이면 클릭이 소리 없이 무시됨).
  test('한 줄이 처리 중이어도 다른 줄 단추는 눌린다', async () => {
    const requested: number[][] = []
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderScreen(<InboxHarness />, {
      path: '/',
      handlers: [
        http.get('/api/v1/notifications', () => HttpResponse.json([])),
        http.get('/api/v1/notifications/archived', () =>
          HttpResponse.json([
            notif({ id: 5, issueTitle: '첫째' }),
            notif({ id: 6, issueTitle: '둘째' }),
          ]),
        ),
        http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
        http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
        http.post('/api/v1/notifications/unarchive', async ({ request }) => {
          const body = (await request.json()) as { ids: number[] }
          requested.push(body.ids)
          // 첫 요청(5)은 풀어 줄 때까지 걸어 둔다 — 그동안 다른 줄 단추가 살아 있는지 본다.
          if (body.ids[0] === 5) await gate
          return HttpResponse.json({ restoredIds: body.ids })
        }),
      ],
    })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    await screen.findByText(/둘째/)
    const [first, second] = screen.getAllByTestId('inbox-unarchive')
    await user.click(first)
    await waitFor(() => expect(requested).toEqual([[5]]))
    // 처리 중인 그 줄만 비활성, 다른 줄은 눌린다.
    await waitFor(() => expect(first).toBeDisabled())
    expect(second).toBeEnabled()
    await user.click(second)
    await waitFor(() => expect(requested).toEqual([[5], [6]]))
    release()
  })
})

describe('알림 빈 상태 CTA (WP-1848)', () => {
  test('받은 탭 빈 상태에 「알림 설정」 CTA 가 있고 누르면 팝오버를 닫고 설정으로 간다', async () => {
    // onNavigate 가 불리는 시점의 주소를 기록해 「닫고 → 이동」 순서를 확인한다.
    let locationAtClose: string | undefined
    const spy = vi.fn(() => {
      locationAtClose = holder.location?.()
    })
    const holder: { location?: () => string } = {}
    const { user, location } = renderInbox({ inbox: [], onNavigate: spy })
    holder.location = location
    const cta = await screen.findByTestId('inbox-empty-action')
    expect(cta).toHaveTextContent('알림 설정')
    await user.click(cta)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(locationAtClose).toBe('/')
    await waitFor(() => expect(location()).toBe('/settings/notifications'))
  })

  test('screenEmpty 받은 탭 CTA 는 설정으로 이동한다', async () => {
    const { user, location } = renderInbox({ inbox: [], screenEmpty: true })
    await user.click(await screen.findByTestId('inbox-empty-action'))
    await waitFor(() => expect(location()).toBe('/settings/notifications'))
  })

  // 팝오버 · 모바일 전체 화면 · 실제 모바일 구성(hideHeader — 탭이 InboxList 밖) 세 모양 모두 같은 동작이다.
  test.each([
    { name: '팝오버', screenEmpty: false, hideHeader: false },
    { name: '전체 화면', screenEmpty: true, hideHeader: false },
    { name: '실제 모바일 구성(hideHeader)', screenEmpty: true, hideHeader: true },
  ])('$name: 보관함 CTA 는 이동하지 않고 받은 탭으로 바꾸고 그 탭에 포커스를 둔다', async ({ screenEmpty, hideHeader }) => {
    const { user, location } = renderInbox({ inbox: [notif({ id: 1 })], archived: [], screenEmpty, hideHeader })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    const cta = await screen.findByTestId('inbox-empty-action')
    expect(cta).toHaveTextContent('받은 알림 보기')
    const before = location()
    await user.click(cta)
    const tab = screen.getByTestId('inbox-tab-inbox')
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(location()).toBe(before)
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(1)
    await waitFor(() => expect(tab).toHaveFocus())
  })

  test('알림이 있으면 빈 상태 CTA 가 없다', async () => {
    renderInbox()
    await screen.findAllByTestId('inbox-item')
    expect(screen.queryByTestId('inbox-empty-action')).toBeNull()
  })

  test('알림 조회가 실패하면 빈 상태 대신 오류와 다시 시도가 보인다', async () => {
    const { user, inboxCalls } = renderInbox({ inboxStatus: 500 })
    expect(await screen.findByTestId('inbox-error')).toHaveTextContent('알림을 불러오지 못했습니다')
    expect(screen.queryByTestId('inbox-empty')).toBeNull()
    expect(screen.queryByTestId('inbox-empty-action')).toBeNull()
    expect(inboxCalls.count).toBe(1)
    await user.click(screen.getByTestId('inbox-error-retry'))
    await waitFor(() => expect(inboxCalls.count).toBe(2))
    // 다시 불러도 실패하면 안내가 그대로 남는다(다시 부르는 동안 「불러오는 중」·빈 상태로 바뀌지 않는다)
    expect(await screen.findByTestId('inbox-error')).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-empty')).toBeNull()
  })
})

describe('읽음 처리 실패 안내(WP-1842)', () => {
  // 읽음 처리가 실패해도 조용하면 사용자가 성공으로 오인한다 — 보관 실패와 같은 오류 토스트가 떠야 한다.
  // 요청 수를 세어 무효화(재조회)·재시도 여부를 검증한다.
  const calls = { unreadCount: 0, readAll: 0 }

  function renderFailing() {
    calls.unreadCount = 0
    calls.readAll = 0
    return renderScreen(<InboxHarness />, {
      path: '/',
      handlers: [
        http.get('/api/v1/notifications', () => HttpResponse.json([notif({ id: 1, read: false })])),
        http.get('/api/v1/notifications/unread-count', () => {
          calls.unreadCount += 1
          return HttpResponse.json({ count: 1 })
        }),
        http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null })),
        http.post('/api/v1/notifications/read-all', () => {
          calls.readAll += 1
          return HttpResponse.json({ message: '실패' }, { status: 500 })
        }),
        http.post('/api/v1/notifications/1/read', () => HttpResponse.json({ message: '실패' }, { status: 500 })),
      ],
    })
  }

  test('「모두 읽음」 이 실패하면 「읽음 처리하지 못했습니다」 토스트가 보인다', async () => {
    const { user } = renderFailing()
    await screen.findAllByTestId('inbox-item')
    const btn = screen.getByTestId('inbox-mark-all')
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    expect(await screen.findByText('읽음 처리하지 못했습니다')).toBeInTheDocument()
  })

  test('안 읽은 줄을 눌러 읽음 처리가 실패해도 같은 토스트가 보인다', async () => {
    const { user } = renderFailing()
    const row = (await screen.findAllByTestId('inbox-item'))[0]
    await user.click(within(row).getByText(/리팩터링/))
    expect(await screen.findByText('읽음 처리하지 못했습니다')).toBeInTheDocument()
  })

  test('「모두 읽음」 이 실패해도 안 읽은 수를 다시 받는다(onSettled)', async () => {
    // 실패·응답 유실 때도 배지를 서버 값으로 되돌려야 한다 — 실패 뒤 unread-count 요청 수가 클릭 전보다 늘어난다.
    const { user } = renderFailing()
    await screen.findAllByTestId('inbox-item')
    const btn = screen.getByTestId('inbox-mark-all')
    await waitFor(() => expect(btn).toBeEnabled())
    const countBefore = calls.unreadCount
    await user.click(btn)
    await screen.findByText('읽음 처리하지 못했습니다')
    await waitFor(() => expect(calls.unreadCount).toBeGreaterThan(countBefore))
  })

  test('「모두 읽음」 이 두 번 실패해도 토스트는 한 장이다(고정 id)', async () => {
    // 같은 id 로 갱신되어 겹쳐 쌓이지 않아야 한다.
    const { user } = renderFailing()
    await screen.findAllByTestId('inbox-item')
    const btn = screen.getByTestId('inbox-mark-all')
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    await screen.findByText('읽음 처리하지 못했습니다')
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    await waitFor(() => expect(calls.readAll).toBe(2))
    expect(screen.getAllByText('읽음 처리하지 못했습니다')).toHaveLength(1)
  })
})
