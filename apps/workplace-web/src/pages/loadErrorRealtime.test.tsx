// 목록 불러오기 실패·다시 시도(WP-865, #134)와 알림·연락처·메일 실시간 반영(WP-36/WP-64) — 페이지 테스트(WP-971, WP-982).
// 실패 안내가 빈 상태와 구분되고 다시 시도가 실제로 다시 부르는지, resource.changed 프레임이 재조회로 화면을 바꾸는지는
// 브라우저 없이 판정되므로 e2e/pages/load-error-states.spec.ts·retry-on-error.spec.ts·resource-realtime-misc.spec.ts 에서 옮겼다.
// 키보드로 다시 시도할 때 초점이 남는 것(WP-881)만 E2E(@input)에 남는다. 각 화면의 배선은 화면별 spec 의 @wiring 이 지킨다.
// renderPage 를 쓰는 이유: 드라이브·노트 진입은 첫 공간 주소로 이동한 뒤 그 화면을 보고, 인박스 배지(레일)·통합 SSE 구독(useEventStream)은
// 앱 셸(AppLayout)에 있다 — 여러 도메인 화면을 한 파일에 모아 화면 모듈 불러오기 비용을 한 번만 낸다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { describe, expect, test } from 'vitest'

import { controllableEvents, resourceChangedFrame } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { calendarEvent } from '../../e2e/factories/calendar.factory'
import { external, member, page as contactPage } from '../../e2e/factories/contacts.factory'
import { personalSpace } from '../../e2e/factories/drive.factory'
import { mailAccount, summary as mailSummary } from '../../e2e/factories/mail.factory'
import { createChannel } from '../../e2e/factories/messaging.factory'
import { wikiPageSummary, wikiSpace } from '../../e2e/factories/wiki.factory'

/**
 * GET path 를 500 으로 실패시키다가 recover() 뒤로는 body 로 성공한다 — 부른 횟수도 센다(다시 시도가 실제 요청을 보내는지).
 */
function failingThenOk(path: string, body: JsonBodyType) {
  const state = { failing: true, calls: 0, recover: () => void (state.failing = false) }
  const handler = http.get(path, () => {
    state.calls += 1
    return state.failing ? HttpResponse.json({ message: '서버 오류' }, { status: 500 }) : HttpResponse.json(body)
  })
  return { state, handler }
}

const synthesisDashboard = http.get('/api/v1/me/dashboard', () =>
  HttpResponse.json({ widgets: [{ id: 'synthesis', type: 'synthesis', count: 5, hidden: false }] }),
)

describe('목록 불러오기 실패 상태 (WP-865)', () => {
  // 공간 목록이 실패하면 사이드바·본문 모두 실패 안내, 다시 시도하면 첫(개인) 공간으로 들어가고 사이드바 목록이 돌아온다.
  test('드라이브 — 공간 목록 500 이면 실패 안내, 다시 시도하면 개인 공간으로 들어간다', async () => {
    const spaces = failingThenOk('/api/v1/drive/spaces', [personalSpace({ id: 7 })])
    const { user, location } = renderPage('/drive', {
      handlers: [
        spaces.handler,
        http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 })),
        http.get('/api/v1/drive/spaces/7', () => HttpResponse.json(personalSpace({ id: 7 }))),
        http.get('/api/v1/drive/spaces/7/items', () => HttpResponse.json({ folders: [], files: [] })),
      ],
    })
    expect(await screen.findByTestId('drive-index-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('드라이브를 불러오지 못했습니다')
    expect(await screen.findByTestId('drive-spaces-error')).toHaveTextContent('공간 목록을 불러오지 못했습니다')
    spaces.state.recover()
    const before = spaces.state.calls
    await user.click(screen.getByTestId('drive-index-error-retry'))
    // 공간 화면은 지연 로드 라우트라 부하가 있으면 첫 진입이 1초를 넘는다 — 이동·첫 화면만 긴 timeout 으로 기다린다.
    await waitFor(() => expect(location()).toBe('/drive/spaces/7'), { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(screen.queryByTestId('drive-spaces-error')).not.toBeInTheDocument())
    expect(await screen.findByTestId('drive-space-list', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('내 드라이브')
    expect(spaces.state.calls).toBeGreaterThan(before)
  })

  // 채널 목록 실패를 「대화를 시작해 보세요」 빈 상태로 보이지 않는다. 다시 시도하면 채널과 빈 상태가 돌아온다.
  test('대화 — 채널 목록 500 이면 빈 상태 대신 실패 안내, 다시 시도하면 채널과 빈 상태가 돌아온다', async () => {
    const channels = failingThenOk('/api/v1/messaging/channels', [createChannel({ id: 3, name: '공지' })])
    const { user } = renderPage('/chat', { handlers: [channels.handler] })
    expect(await screen.findByTestId('channel-load-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('대화 목록을 불러오지 못했습니다')
    expect(screen.queryByText('대화를 시작해 보세요')).not.toBeInTheDocument()
    expect(await screen.findByTestId('channel-list-error')).toHaveTextContent('채널 목록을 불러오지 못했습니다')
    channels.state.recover()
    await user.click(screen.getByTestId('channel-list-error-retry'))
    expect(await screen.findByTestId('channel-link-3')).toHaveTextContent('공지')
    expect(await screen.findByText('대화를 시작해 보세요')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-load-error')).not.toBeInTheDocument()
  })

  // 노트 진입에서 공간 목록이 실패하면 「준비 중…」에 멈추지 않고 실패 안내, 다시 시도하면 첫 공간으로 간다.
  test('노트 — 공간 목록 500 이면 실패 안내, 다시 시도하면 첫 공간으로 간다', async () => {
    const spaces = failingThenOk('/api/v1/wiki/spaces', [wikiSpace({ id: 4, name: '개인 노트' })])
    const { user, location } = renderPage('/wiki', {
      handlers: [spaces.handler, http.get('/api/v1/wiki/spaces/4/pages', () => HttpResponse.json([]))],
    })
    expect(await screen.findByTestId('wiki-spaces-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('노트 공간을 불러오지 못했습니다')
    expect(screen.queryByText('노트 공간을 준비 중…')).not.toBeInTheDocument()
    expect(await screen.findByTestId('wiki-sidebar-spaces-error')).toBeInTheDocument()
    spaces.state.recover()
    await user.click(screen.getByTestId('wiki-spaces-error-retry'))
    // 공간 화면은 지연 로딩 라우트라 처음 불러오는 동안 이동이 늦게 반영된다 — 첫 화면 기다리기와 같은 한도로 기다린다.
    await waitFor(() => expect(location()).toMatch(/^\/wiki\/spaces\/4/), { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(screen.queryByTestId('wiki-spaces-error')).not.toBeInTheDocument())
  })

  // 공간 안에서 공간 목록만 실패하면 선택 상자 자리에 안내하고, 페이지 트리는 그대로 쓴다.
  test('노트 — 공간 안에서 공간 목록만 실패하면 선택 상자 자리에 안내하고 페이지 트리는 그대로다', async () => {
    renderPage('/wiki/spaces/4', {
      handlers: [
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json({ message: '서버 오류' }, { status: 500 })),
        http.get('/api/v1/wiki/spaces/4/pages', () => HttpResponse.json([wikiPageSummary({ id: 21, title: '회의록' })])),
      ],
    })
    expect(await screen.findByTestId('wiki-sidebar-spaces-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('노트 공간을 불러오지 못했습니다')
    expect(await screen.findByTestId('wiki-tree-row-21')).toHaveTextContent('회의록')
  })

  // 일정 조회가 실패해도 달력(보기 전환)은 그대로 쓰고, 그 위에 실패 안내. 다시 시도하면 일정이 그려진다.
  test('캘린더 — 일정 500 이면 달력 위에 실패 안내, 다시 시도하면 일정이 그려진다', async () => {
    const today = new Date()
    const at = (h: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h).toISOString()
    const events = failingThenOk('/api/v1/calendar/events', [calendarEvent({ id: 11, title: '주간 회의', startsAt: at(10), endsAt: at(11) })])
    const { user } = renderPage('/calendar', { handlers: [events.handler] })
    expect(await screen.findByTestId('calendar-events-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('일정을 불러오지 못했습니다')
    expect(screen.getByTestId('calendar-view-month-btn')).toBeInTheDocument()
    events.state.recover()
    await user.click(screen.getByTestId('calendar-events-error-retry'))
    await waitFor(() => expect(screen.queryByTestId('calendar-events-error')).not.toBeInTheDocument())
    expect((await screen.findAllByText('주간 회의')).length).toBeGreaterThan(0)
  })

  // 홈 「지금 신경 쓸 일」 — 소스가 실패한 채 0건이면 「다 확인했습니다」 대신 실패 안내, 다시 시도해 성공하면 빈 상태.
  test('홈 — 지금 신경 쓸 일 소스가 실패한 채 0건이면 실패 안내, 다시 시도하면 빈 상태', async () => {
    const messaging = failingThenOk('/api/v1/me/messaging-summary', {
      unreadConversationCount: 0, needsReplyCount: 0, aiAttentionCount: 0, attentionCount: 0, recent: [],
    })
    const { user } = renderPage('/', { handlers: [synthesisDashboard, messaging.handler] })
    expect(await screen.findByTestId('dashboard-attention-error', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('지금 신경 쓸 일을 불러오지 못했습니다')
    expect(screen.queryByTestId('dashboard-attention-empty')).not.toBeInTheDocument()
    messaging.state.recover()
    await user.click(screen.getByTestId('dashboard-attention-error-retry'))
    expect(await screen.findByTestId('dashboard-attention-empty')).toHaveTextContent('다 확인했습니다')
    expect(screen.queryByTestId('dashboard-attention-error')).not.toBeInTheDocument()
  })

  // 다른 소스의 행이 있어도 실패한 소스가 있으면 「일부 항목을 불러오지 못했습니다」를 함께 보인다.
  test('홈 — 다른 소스 행이 있어도 실패한 소스가 있으면 일부 실패 안내를 함께 보인다', async () => {
    renderPage('/', {
      handlers: [
        synthesisDashboard,
        http.get('/api/v1/me/mail-summary', () => HttpResponse.json({ message: '서버 오류' }, { status: 500 })),
        http.get('/api/v1/me/messaging-summary', () =>
          HttpResponse.json({
            unreadConversationCount: 1, needsReplyCount: 0, aiAttentionCount: 1, attentionCount: 1,
            recent: [{
              kind: 'CHANNEL', conversationId: 5, label: '#dev', lastAuthorName: '박서연', lastMessagePreview: '배포 확인 부탁',
              lastMessageAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(), unreadCount: 1, mentioned: false,
              needsReply: false, newThreadReplyCount: 0, aiReason: '배포 여부 질문',
            }],
          }),
        ),
      ],
    })
    expect(await screen.findByTestId('dashboard-attention-focus', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('#dev')
    expect(await screen.findByTestId('dashboard-attention-partial-error')).toHaveTextContent('일부 항목을 불러오지 못했습니다')
  })

  // AI 우선순위는 정렬 점수만 주므로, 그것만 실패하면 빈 상태는 그대로 「다 확인했습니다」(실패 안내 없음).
  test('홈 — AI 우선순위만 실패하면 빈 상태는 그대로 「다 확인했습니다」', async () => {
    let answered = false
    renderPage('/', {
      handlers: [
        synthesisDashboard,
        http.get('/api/v1/me/priority-items', () => {
          answered = true
          return HttpResponse.json({ message: '서버 오류' }, { status: 500 })
        }),
      ],
    })
    expect(await screen.findByTestId('dashboard-attention-empty', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('다 확인했습니다')
    // 우선순위 실패 응답이 화면에 반영된 뒤에 본다 — 응답 전에 보면 실패를 안내로 바꾸는 결함도 통과해 버린다.
    await waitFor(() => expect(answered).toBe(true))
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(screen.getByTestId('dashboard-attention-empty')).toHaveTextContent('다 확인했습니다')
    expect(screen.queryByTestId('dashboard-attention-error')).not.toBeInTheDocument()
  })
})

describe('에러 상태 다시 시도 (#134)', () => {
  // 연락처 목록 500 → 실패 문구 + 다시 시도, 다시 시도가 성공하면 실패 문구가 사라진다.
  test('연락처 목록 실패 — 다시 시도 버튼으로 재조회한다', async () => {
    const contacts = failingThenOk('/api/v1/contacts', contactPage([]))
    const { user } = renderPage('/contacts', {
      handlers: [contacts.handler, http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] }))],
    })
    expect(await screen.findByText('목록을 불러오지 못했습니다', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
    contacts.state.recover()
    const before = contacts.state.calls
    await user.click(screen.getAllByRole('button', { name: '다시 시도' })[0])
    await waitFor(() => expect(screen.queryByText('목록을 불러오지 못했습니다')).not.toBeInTheDocument())
    expect(contacts.state.calls).toBeGreaterThan(before)
  })

  // 채널 상세 500 → 「채널을 찾을 수 없습니다.」 + 다시 시도, 다시 시도가 성공하면 채널로 들어간다.
  test('채널 상세 실패 — 다시 시도 버튼으로 채널에 들어간다', async () => {
    const channel = createChannel({ id: 1, name: '테스트채널' })
    const detail = failingThenOk('/api/v1/messaging/channels/1', channel)
    const { user } = renderPage('/chat/channels/1', {
      handlers: [
        detail.handler,
        http.get('/api/v1/messaging/channels', () => HttpResponse.json([channel])),
        http.get('/api/v1/messaging/channels/1/messages', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
        http.get('/api/v1/messaging/channels/1/members', () => HttpResponse.json([])),
      ],
    })
    const notFound = await screen.findByTestId('channel-not-found', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(notFound).toHaveTextContent('채널을 찾을 수 없습니다.')
    detail.state.recover()
    await user.click(within(notFound).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByTestId('channel-not-found')).not.toBeInTheDocument())
  })
})

describe('알림·연락처·메일 실시간 반영 (WP-64)', () => {
  // 서버 ResourceSseDispatcher 가 보내는 resource.changed 프레임(사용자 범위).
  const frame = (data: Record<string, unknown>) =>
    resourceChangedFrame({ scopeType: 'USER', scopeId: 1, ids: [], actorId: 99, ...data })

  test('알림 읽음 이벤트 — 안읽음 배지가 사라진다', async () => {
    const events = controllableEvents()
    let count = 3
    renderPage('/', { handlers: [events.handler, http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count }))] })
    expect(await screen.findByTestId('inbox-badge', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('3')
    count = 0
    await events.push(frame({ resource: 'notification', op: 'updated' }))
    await waitFor(() => expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument())
  })

  // WP-83 — 초대 일정이 지워지면 알림 행이 cascade 로 사라지지만 notification 이벤트는 오지 않는다. 일정 삭제 프레임만으로 배지를 다시 조회한다.
  test('일정 삭제 이벤트 — cascade 로 지워진 알림의 배지가 사라진다', async () => {
    const events = controllableEvents()
    let count = 1
    renderPage('/', { handlers: [events.handler, http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count }))] })
    expect(await screen.findByTestId('inbox-badge', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('1')
    count = 0
    await events.push(frame({ resource: 'calendar-event', op: 'deleted', ids: [77] }))
    await waitFor(() => expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument())
  })

  test('연락처 생성 이벤트 — 새 연락처 행이 나타난다', async () => {
    const events = controllableEvents()
    let items = [member()]
    renderPage('/contacts', {
      handlers: [
        events.handler,
        http.get('/api/v1/contacts', () => HttpResponse.json(contactPage(items))),
        http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] })),
      ],
    })
    await screen.findByTestId('contact-row-MEMBER-1', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(screen.queryByTestId('contact-row-EXTERNAL-100')).not.toBeInTheDocument()
    items = [member(), external()]
    await events.push(frame({ resource: 'contact', op: 'created', ids: [100] }))
    expect(await screen.findByTestId('contact-row-EXTERNAL-100')).toBeInTheDocument()
  })

  test('메일 회신필요 처리 이벤트 — 회신필요 목록에서 행이 사라진다', async () => {
    const events = controllableEvents()
    let rows = [mailSummary({ id: 10, subject: '검토 요청', aiCategory: '업무', aiNeedsReply: true })]
    renderPage('/mail/1?needsReply=true', {
      handlers: [
        events.handler,
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ aiEnabled: true })])),
        http.get('/api/v1/mail/accounts/1/sync-status', () => HttpResponse.json({ running: false })),
        http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json(rows)),
        http.get('/api/v1/mail/accounts/1/unread-counts', () =>
          HttpResponse.json({ classificationActive: true, inbox: 0, byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 }, needsReply: 1 }),
        ),
      ],
    })
    await screen.findByTestId('mail-row-10', {}, { timeout: PAGE_LOAD_TIMEOUT })
    rows = []
    await events.push(frame({ resource: 'mail', op: 'updated', ids: [10], accountId: 1, messageId: 10 }))
    await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  })
})
