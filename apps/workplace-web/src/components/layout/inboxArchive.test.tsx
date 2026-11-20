// 알림 창 「알림 | 보관함」 전환·보관함 목록·줄 되돌리기(WP-1690), 빈 상태 CTA·조회 실패 표시(WP-1848) — 화면 컴포넌트 테스트.
// InboxList 만 renderScreen 으로 띄우고(Popover 없이), MSW 로 알림·보관함·되돌리기 API 를 모킹한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { InboxList, type InboxView, InboxViewTabs } from '@/components/layout/InboxList'
import { controlIntersection } from '@/test/kits/layout'
import { InboxHarness, inboxSupportHandlers, notif, renderInbox } from '@/test/kits/notifications/inboxTestKit'
import { renderScreen } from '@/test/renderScreen'

/**
 * 데스크톱 팝오버 모양(자체 제목 행)과 모바일 전체 화면 모양(hideHeader + 바깥 탭)을 한 문서에 함께 띄운다(WP-1848).
 * 두 모양이 동시에 있어도 포커스 이동이 id 조회에 기대지 않고 포커스가 각자 인스턴스의 탭으로 가는지 본다.
 */
function BothHarness() {
  const [popView, setPopView] = useState<InboxView>('inbox')
  const [pageView, setPageView] = useState<InboxView>('inbox')
  return (
    <>
      <div data-testid="pop">
        <InboxList enabled view={popView} onViewChange={setPopView} />
      </div>
      <div data-testid="page">
        <InboxViewTabs view={pageView} onChange={setPageView} />
        <InboxList enabled view={pageView} onViewChange={setPageView} hideHeader screenEmpty />
      </div>
    </>
  )
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

  // WP-1843: 목록 영역은 선택 탭에 이어진 tabpanel 이다(APG Tabs). 모바일은 탭이 화면 머리에 따로 있어 id 로 잇는다.
  test('목록 영역은 선택 탭에 이어진 tabpanel', async () => {
    const { user } = renderInbox({ archived: [notif({ id: 5, issueTitle: '보관된 이슈' })] })
    await screen.findAllByTestId('inbox-item')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('id', 'inbox-view-panel')
    expect(panel).toHaveAttribute('aria-labelledby', 'inbox-view-tab-inbox')
    expect(panel).toHaveAttribute('data-testid', 'inbox-scroll-area')
    // 행이 있으면 패널은 Tab 정지점이 아니다(첫 행 단추가 Tab 정지점). -1 은 스크립트 초점만 받는다(로딩 중 둔 초점 유지).
    expect(panel).toHaveAttribute('tabindex', '-1')
    await user.click(screen.getByTestId('inbox-tab-archive'))
    await screen.findByText(/보관된 이슈/)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'inbox-view-tab-archive')
  })

  // WP-1843: 로딩 중에는 패널이 Tab 정지점(0)이고, 로딩 중에 둔 초점은 행이 도착해도 남는다(-1 로 내려가도 초점 유지).
  test('불러오는 중 패널은 Tab 정지점이고, 초점을 둔 채 행이 도착해도 남는다', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    renderScreen(<InboxHarness />, {
      path: '/',
      handlers: [
        http.get('/api/v1/notifications', async () => {
          // 풀어 줄 때까지 응답을 보류해 로딩 상태를 붙잡는다.
          await gate
          return HttpResponse.json([notif({ id: 1 })])
        }),
        http.get('/api/v1/notifications/archived', () => HttpResponse.json([])),
        ...inboxSupportHandlers(),
      ],
    })
    const panel = await screen.findByRole('tabpanel')
    expect(await screen.findByText(/불러오는 중/)).toBeInTheDocument()
    expect(panel).toHaveAttribute('tabindex', '0')
    panel.focus()
    expect(panel).toHaveFocus()
    release()
    await screen.findAllByTestId('inbox-item')
    expect(panel).toHaveAttribute('tabindex', '-1')
    expect(panel).toHaveFocus()
  })

  // WP-1843 리뷰 후속: 빈 상태(CTA)·조회 실패(다시 시도)에는 안에 초점 받을 단추가 있어 패널을 Tab 정지점으로 더하지 않는다.
  // 패널이 빠진 만큼 그 단추가 켜진 채 Tab 순서에 있어야 한다(꺼지거나 -1 이면 그 상태에 정지점이 없어진다).
  test.each([
    { state: '빈 목록', opts: { inbox: [] }, control: 'inbox-empty-action' },
    { state: '조회 실패', opts: { inboxStatus: 500 }, control: 'inbox-error-retry' },
  ])('$state 패널은 Tab 정지점이 아니고 안의 단추가 정지점이다', async ({ opts, control }) => {
    renderInbox(opts)
    const button = await screen.findByTestId(control)
    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '-1')
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('tabindex', '-1')
  })

  test('탭의 aria-controls 값이 패널 id 와 같다', async () => {
    renderInbox()
    await screen.findAllByTestId('inbox-item')
    const panel = screen.getByRole('tabpanel')
    expect(screen.getByTestId('inbox-tab-inbox')).toHaveAttribute('aria-controls', panel.id)
    expect(screen.getByTestId('inbox-tab-archive')).toHaveAttribute('aria-controls', panel.id)
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
        ...inboxSupportHandlers(),
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

  // 받은 알림도 비어 있으면 두 보기의 빈 상태가 같은 자리에 같은 버튼을 그린다 — 버튼이 재사용되면 포커스가 그 버튼에 남는다(WP-1848 라이브 회귀).
  // (위 테스트는 받은 알림이 있어 버튼이 사라지므로 이 경우를 잡지 못했다.)
  test.each([
    { name: '팝오버', screenEmpty: false, hideHeader: false },
    { name: '실제 모바일 구성(hideHeader)', screenEmpty: true, hideHeader: true },
  ])('$name: 받은 알림도 비어 있어도 보관함 CTA 뒤 포커스는 CTA 버튼이 아니라 받은 탭에 간다', async ({ screenEmpty, hideHeader }) => {
    const { user } = renderInbox({ inbox: [], archived: [], screenEmpty, hideHeader })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    const cta = await screen.findByTestId('inbox-empty-action')
    expect(cta).toHaveTextContent('받은 알림 보기')
    await user.click(cta)
    await waitFor(() => expect(screen.getByTestId('inbox-tab-inbox')).toHaveFocus())
    expect(screen.getByTestId('inbox-empty-action')).toHaveTextContent('알림 설정')
    expect(screen.getByTestId('inbox-empty-action')).not.toHaveFocus()
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

  test('팝오버와 전체 화면이 함께 있어도 CTA 뒤 포커스가 그 인스턴스의 받은 탭에 간다(WP-1848)', async () => {
    const { user, container } = renderScreen(<BothHarness />, {
      path: '/',
      handlers: [
        http.get('/api/v1/notifications', () => HttpResponse.json([notif({ id: 1 })])),
        http.get('/api/v1/notifications/archived', () => HttpResponse.json([])),
        ...inboxSupportHandlers(),
      ],
    })
    const pop = await screen.findByTestId('pop')
    const page = screen.getByTestId('page')
    // 문서 안에 같은 id 가 둘 이상 없다
    const ids = Array.from(container.ownerDocument.querySelectorAll('[id]')).map((e) => e.id)
    expect(ids.filter((id) => id.startsWith('inbox-tab-'))).toEqual([])
    // 탭·패널 aria 연결용 고정 id(WP-1843)는 두 인스턴스가 같은 값을 쓴다 — 포커스는 id 가 아니라 ref 로 찾으므로 영향이 없다(아래 단언).
    // 전체 화면 쪽 보관함 → CTA → 그 쪽 받은 탭에 포커스(팝오버 탭이 아니다)
    await user.click(within(page).getByTestId('inbox-tab-archive'))
    await user.click(await within(page).findByTestId('inbox-empty-action'))
    await waitFor(() => expect(within(page).getByTestId('inbox-tab-inbox')).toHaveFocus())
    expect(within(pop).getByTestId('inbox-tab-inbox')).not.toHaveFocus()
    // 팝오버 쪽도 자기 탭으로
    await user.click(within(pop).getByTestId('inbox-tab-archive'))
    await user.click(await within(pop).findByTestId('inbox-empty-action'))
    await waitFor(() => expect(within(pop).getByTestId('inbox-tab-inbox')).toHaveFocus())
  })

  test('다음 페이지 조회가 실패하면 목록은 남고 다시 시도가 보이며 누르면 한 번 더 요청한다(WP-1848)', async () => {
    const io = controlIntersection()
    const calls: number[] = []
    const first = Array.from({ length: 20 }, (_, i) => notif({ id: i + 1 }))
    const { user } = renderScreen(<InboxHarness />, {
      path: '/',
      handlers: [
        http.get('/api/v1/notifications', ({ request }) => {
          const offset = Number(new URL(request.url).searchParams.get('offset') ?? 0)
          if (offset === 0) return HttpResponse.json(first)
          calls.push(offset)
          return new HttpResponse(null, { status: 500 })
        }),
        ...inboxSupportHandlers(),
      ],
    })
    expect(await screen.findAllByTestId('inbox-item')).toHaveLength(20)
    // 목록 끝 푸터가 화면에 들어왔다고 알린다 → 다음 페이지 요청(실패)
    io.set(() => true)
    const footer = await screen.findByTestId('inbox-next-page')
    const retry = await within(footer).findByRole('button', { name: /더 불러오지 못했습니다/ })
    expect(screen.getAllByTestId('inbox-item')).toHaveLength(20)
    expect(calls).toEqual([20])
    // 다시 시도 → 같은 offset 으로 한 번 더(실패 중 자동 로드는 공용 훅이 멈춘다 — useLoadMoreSentinel 이 소유한 동작이라 여기선 재검증하지 않는다)
    await user.click(retry)
    await waitFor(() => expect(calls).toEqual([20, 20]))
  })
})

describe('읽음 처리 실패 안내(WP-1842)', () => {
  // 읽음 처리가 실패해도 조용하면 사용자가 성공으로 오인한다 — 보관 실패와 같은 오류 토스트가 떠야 한다.
  // 요청 수를 세어 무효화(재조회)·재시도 여부를 검증한다.
  function renderFailing() {
    const calls = { unreadCount: 0, readAll: 0 }
    const view = renderScreen(<InboxHarness />, {
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
    return { ...view, calls }
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
    const { user, calls } = renderFailing()
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
    const { user, calls } = renderFailing()
    await screen.findAllByTestId('inbox-item')
    const btn = screen.getByTestId('inbox-mark-all')
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    await screen.findByText('읽음 처리하지 못했습니다')
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    await waitFor(() => expect(calls.readAll).toBe(2))
    // 요청 수는 요청이 닿을 때 늘어나 onError 보다 먼저다 — 두 번째 실패 처리가 끝나(단추가 다시 켜져) 토스트를 그린 뒤에 센다.
    await waitFor(() => expect(btn).toBeEnabled())
    expect(screen.getAllByText('읽음 처리하지 못했습니다')).toHaveLength(1)
  })
})
