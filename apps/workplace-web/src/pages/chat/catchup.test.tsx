// 채널·DM 캐치업 카드(#491·WP-256) — 화면 테스트(WP-966, WP-995).
// 자동 표시 임계(≥5)·요약 버튼(1~4)·내 메시지/진입 뒤 도착 메시지 제외·실패 폴백·「확인했어요」 읽음 처리·기준점 null(since=0)은
// 브라우저 없이 판정되므로 e2e/pages/chat/channel-catchup.spec.ts·dm-catchup.spec.ts 에서 옮겼다.
// 진입 시 카드 윗변 앵커·바닥 고정(스크롤 위치)은 그 spec 에 @layout 으로 남는다.
// 채팅 라우트(사이드바 레이아웃 + 채널/DM 화면)만 renderScreen 으로 띄운다(testkit-b5).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, chatEvents, renderChat } from '@/test/kits/chat/testkit-b5'
import type { ChannelCatchupResponse, ChannelResponse, MessageResponse } from '@/types/messaging'

import { createChannel, createDm, createMessage } from '../../../e2e/factories/messaging.factory'

const CHANNEL_ID = 1
const DM_ID = 100

const SAMPLE_CATCHUP: ChannelCatchupResponse = {
  unreadCount: 6,
  decisions: [{ text: '출시일 6/30 확정', sourceMessageIds: [101] }],
  yourTurn: [{ messageId: 105, authorName: '이수진', snippet: '검토 부탁해요' }],
  discussion: [{ text: 'QA 환경 이슈 논의', sourceMessageIds: [102] }],
}

/** 읽은 메시지(100) + 남(authorId=2)이 보낸 미읽음 n건(101..) — 서버처럼 DESC. 내 메시지는 미읽음이 아니다(#491). */
function readPlusUnread(convId: number, n: number): MessageResponse[] {
  const read = createMessage({ id: 100, channelId: convId, body: '읽은 메시지' })
  const unread = Array.from({ length: n }, (_, i) => createMessage({ id: 101 + i, channelId: convId, authorId: 2, body: `미읽음 ${i + 1}` }))
  return [...unread, read].sort((a, b) => b.id - a.id)
}

/** 기준점 null(빈 채널 생성자·새 DM) — 남이 보낸 메시지 n건(1..n), DESC. */
function othersFromStart(convId: number, n: number): MessageResponse[] {
  return Array.from({ length: n }, (_, i) => createMessage({ id: 1 + i, channelId: convId, authorId: 2, body: `생성 후 대화 ${i + 1}` })).sort(
    (a, b) => b.id - a.id,
  )
}

/** 캐치업 요약 응답 + 요청 주소 기록. */
function catchupHandler(convId: number, body: ChannelCatchupResponse | { status: number }, urls: URL[] = []) {
  return http.get(`${API}/messaging/channels/${convId}/catchup`, ({ request }) => {
    urls.push(new URL(request.url))
    return 'status' in body ? HttpResponse.json({ message: 'AI 실패' }, { status: body.status }) : HttpResponse.json(body)
  })
}

/** 채널 또는 DM 을 연다 — DM 은 목록(헤더)과 채널 상세(기준점)를 함께 준다. */
function openConv(kind: 'channel' | 'dm', detail: ChannelResponse, messages: MessageResponse[], handlers = [] as ReturnType<typeof http.get>[], events?: ReturnType<typeof chatEvents>) {
  const id = detail.id
  return renderChat(kind === 'channel' ? `/chat/channels/${id}` : `/chat/dms/${id}`, {
    channels: [detail],
    dms: kind === 'dm' ? [createDm({ id })] : [],
    messages: { [id]: messages },
    handlers,
    events: events?.handler,
  })
}

// 채널과 DM 은 같은 캐치업 게이트를 쓴다 — 두 표면 모두에서 같은 규칙을 지킨다.
describe.each([
  ['channel', CHANNEL_ID],
  ['dm', DM_ID],
] as const)('%s 캐치업', (kind, id) => {
  const detail = (over: Partial<ChannelResponse> = {}) =>
    createChannel({ id, kind: kind === 'dm' ? 'DM' : 'CHANNEL', member: true, lastReadMessageId: 100, ...over })

  // 자동 임계(≥5) — 카드가 바로 뜨고 결정·내 차례·오간 이야기 3묶음이 응답대로 그려진다.
  test('미읽음 5건 이상이면 카드가 자동으로 뜨고 3묶음이 렌더된다', async () => {
    openConv(kind, detail(), readPlusUnread(id, 6), [catchupHandler(id, SAMPLE_CATCHUP)])
    expect(await screen.findByTestId('catchup-card')).toBeInTheDocument()
    expect(await screen.findByText('출시일 6/30 확정')).toBeInTheDocument()
    expect(screen.getByText('결정된 것')).toBeInTheDocument()
    expect(screen.getByText('내 차례')).toBeInTheDocument()
    expect(screen.getByText('오간 이야기')).toBeInTheDocument()
  })

  // 1~4건은 자동으로 띄우지 않고(알림 폭격 방지) ✨요약 버튼만 — 누르면 그때 요약한다.
  test('미읽음 1~4건이면 요약 버튼만, 누르면 카드', async () => {
    const { user } = openConv(kind, detail(), readPlusUnread(id, 2), [
      catchupHandler(id, { unreadCount: 2, decisions: [], yourTurn: [], discussion: [{ text: '짧은 논의', sourceMessageIds: [101] }] }),
    ])
    await user.click(await screen.findByTestId('catchup-summarize-btn'))
    expect(screen.getByTestId('catchup-card')).toBeInTheDocument()
    expect(await screen.findByText('짧은 논의')).toBeInTheDocument()
  })

  // #491: 다 읽은 방에서 내가 보낸 메시지는 미읽음이 아니다 — 유령 구분선·카드·버튼이 생기면 안 된다.
  test('다 읽은 방에서 내가 보낸 메시지는 구분선·카드·버튼을 만들지 않는다', async () => {
    const read = createMessage({ id: 100, channelId: id, body: '읽은 메시지' })
    const mine = createMessage({ id: 101, channelId: id, authorId: 1, body: '내가 방금 보낸 메시지' })
    openConv(kind, detail(), [mine, read])
    expect(await screen.findByText('내가 방금 보낸 메시지')).toBeInTheDocument()
    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('catchup-summarize-btn')).not.toBeInTheDocument()
  })

  // 「확인했어요」 = 최신 미읽음 id 까지 읽음 처리(POST /read) + 카드 닫기.
  test('「확인했어요」를 누르면 최신 미읽음 id 까지 읽음 처리하고 카드가 사라진다', async () => {
    const reads: unknown[] = []
    const { user } = openConv(kind, detail(), readPlusUnread(id, 6), [
      catchupHandler(id, SAMPLE_CATCHUP),
      http.post(`${API}/messaging/channels/${id}/read`, async ({ request }) => {
        reads.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    ])
    await user.click(await screen.findByTestId('catchup-confirm'))
    await waitFor(() => expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument())
    await waitFor(() => expect(reads.at(-1)).toEqual({ uptoMessageId: 106 }))
  })

  // WP-256: 기준점 null(빈 채널 생성자·새 DM)은 0 으로 본다 — 자동 카드 + since=0 요약, 위에 읽은 메시지가 없으니 구분선은 없다.
  test('기준점 null 이고 미읽음 5건 이상이면 카드가 뜨고 since=0 으로 요약한다', async () => {
    const urls: URL[] = []
    openConv(kind, detail({ lastReadMessageId: null }), othersFromStart(id, 6), [catchupHandler(id, SAMPLE_CATCHUP, urls)])
    expect(await screen.findByText('출시일 6/30 확정')).toBeInTheDocument()
    expect(urls.at(-1)?.searchParams.get('since')).toBe('0')
    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
  })

  test('기준점 null 이고 미읽음 1~4건이면 요약 버튼이 뜬다', async () => {
    openConv(kind, detail({ lastReadMessageId: null }), othersFromStart(id, 2))
    expect(await screen.findByTestId('catchup-summarize-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument()
  })

  // #491: 빈 방 진입 스냅샷(0) 이후 SSE 로 도착한 남의 첫 메시지는 「진입 후」 — 기준점 0 과 겹쳐 유령 버튼이 뜨면 안 된다.
  test('빈 방 진입 뒤 남의 첫 메시지가 SSE 로 도착해도 캐치업·구분선이 생기지 않는다', async () => {
    const events = chatEvents()
    openConv(kind, detail({ lastReadMessageId: null }), [], [], events)
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument()
    await events.push('messaging.message.created', createMessage({ id: 1, channelId: id, authorId: 2, authorName: '이수진', body: '첫 메시지 도착' }))
    expect(await screen.findByText('첫 메시지 도착')).toBeInTheDocument()
    // 버튼은 메시지와 다른 커밋에서 나타날 수 있다 — 뒤이은 렌더가 끝날 시간을 준 뒤 부재를 본다.
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('catchup-summarize-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
  })
})

describe('채널 캐치업 — 채널만의 판정', () => {
  const detail = (over: Partial<ChannelResponse> = {}) => createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100, ...over })

  // #491 보고 트리거: 다 읽은 방 진입 뒤 AI 답글이 SSE 로 라이브 도착해도 진입 스냅샷(entryMaxId) 이후라 미읽음이 아니다.
  test('진입 뒤 AI 답글이 SSE 로 도착해도 유령 구분선·캐치업이 생기지 않는다', async () => {
    const events = chatEvents()
    openConv('channel', detail(), [createMessage({ id: 100, channelId: CHANNEL_ID, body: '읽은 메시지' })], [], events)
    expect(await screen.findByText('읽은 메시지')).toBeInTheDocument()
    await events.push(
      'messaging.message.created',
      createMessage({ id: 101, channelId: CHANNEL_ID, authorId: 2, authorName: 'AI 비서', authorKind: 'AGENT', body: 'AI 답글 도착' }),
    )
    expect(await screen.findByText('AI 답글 도착')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('catchup-summarize-btn')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unread-divider')).not.toBeInTheDocument()
    expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument()
  })

  // 요약 API 가 실패해도 카드 안에 폴백만 보이고 메시지 목록은 그대로다.
  test('요약 API 가 실패하면 에러 폴백을 보이고 메시지 목록은 정상', async () => {
    openConv('channel', detail(), readPlusUnread(CHANNEL_ID, 6), [catchupHandler(CHANNEL_ID, { status: 502 })])
    expect(await screen.findByTestId('catchup-error')).toBeInTheDocument()
    expect(screen.getByTestId('message-list')).toBeInTheDocument()
    expect(screen.getByText('미읽음 6')).toBeInTheDocument()
  })

  // 미읽음이 요약 상한을 넘으면(WP-1183) 헤더는 실제 미읽음 수, 푸터는 최근 몇 건으로 요약했는지 밝힌다.
  test('요약 상한을 넘은 미읽음이면 헤더는 실제 수, 푸터는 「근거 최근 N건 기준」', async () => {
    openConv('channel', detail(), readPlusUnread(CHANNEL_ID, 6), [
      catchupHandler(CHANNEL_ID, { ...SAMPLE_CATCHUP, unreadCount: 210, summarizedCount: 200 }),
    ])
    expect(await screen.findByText('· 안 읽은 210건')).toBeInTheDocument()
    expect(screen.getByText('AI 요약 · 근거 최근 200건 기준')).toBeInTheDocument()
  })

  // 내 차례는 3건까지만 — 넘치면 「+N건 더」.
  test('내 차례가 3건을 넘으면 3건만 보이고 「+1건 더」', async () => {
    const yourTurn = Array.from({ length: 4 }, (_, i) => ({ messageId: 101 + i, authorName: `사람${i + 1}`, snippet: `요청 ${i + 1}` }))
    openConv('channel', detail(), readPlusUnread(CHANNEL_ID, 6), [
      catchupHandler(CHANNEL_ID, { unreadCount: 6, decisions: [], yourTurn, discussion: [] }),
    ])
    // 항목 문구는 이름·인용이 여러 요소로 나뉘어 있어 목록 항목 단위로 본다.
    const card = await screen.findByTestId('catchup-card')
    await waitFor(() => expect(within(card).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('요청 1'),
      expect.stringContaining('요청 2'),
      expect.stringContaining('요청 3'),
    ]))
    expect(screen.getByTestId('catchup-yourturn-more')).toHaveTextContent('+1건 더')
  })

  // 비멤버(미리보기)는 읽음 기준이 없다 — 기준점 null 이어도 카드·버튼을 띄우지 않는다.
  test('비멤버(기준점 null)면 카드도 버튼도 없다', async () => {
    openConv('channel', detail({ member: false, role: null, lastReadMessageId: null }), othersFromStart(CHANNEL_ID, 6))
    expect(await screen.findByText('생성 후 대화 6')).toBeInTheDocument()
    expect(screen.queryByTestId('catchup-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('catchup-summarize-btn')).not.toBeInTheDocument()
  })
})
