// 팀 채팅 실시간(SSE) 반영 — 화면 테스트(WP-966, WP-995).
// 통합 SSE(/api/v1/events)는 fetch 스트림이라 MSW 로 열린 스트림을 두고 프레임을 밀어 넣는다(testkit-b5 chatEvents).
// 실제 서버 없이 프레임 → 캐시 → 화면만 보므로 e2e/pages/chat/{chat,channel-realtime,messaging-progress,messaging-progress-dm,
// messaging-progress-keep,messaging-progress-stale,messaging-phase4,messaging-phase5}.spec.ts 에서 옮겼다.
// 채널 전환 1건만 App 라우트(KeyedByParam)가 지키는 동작이라 renderPage 로 띄운다.
// 끊김 배너는 연결 상태 → 유예 타이머 판정이라 연결 실패(503)·유예 안 연결을 MSW·상태 주입으로 본다.
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test } from 'vitest'

import { ChatModuleLayout } from '@/components/chat/ChatModuleLayout'
import { MessagingConnectionContext } from '@/hooks/MessagingConnectionContext'
import { API, chatBaseHandlers, chatEvents, renderChat } from '@/test/kits/chat/testkit-b5'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'

import { createChannel, createChannelMember, createDm, createMessage } from '../../../e2e/factories/messaging.factory'

const AGENT_ID = 99
const agentHandlers = [
  // 멘션 후보 에이전트(useMentionAgents) — 진행 버블 판정과 무관해 빈 목록.
  http.get(`${API}/members`, () => HttpResponse.json({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 100 })),
]

/** 진행 이벤트(messaging.message.progress) 데이터. */
const progress = (channelId: number, streamId: string, phase: string, steps: { label: string; status: string }[] = []) => ({
  channelId,
  streamId,
  agentName: 'AI',
  phase,
  steps,
})

describe('메시지 실시간 반영', () => {
  // 다른 사람이 보낸 메시지는 전송 POST 없이 SSE 프레임만으로 목록에 나타난다.
  test('SSE 로 도착한 메시지가 전송 요청 없이 그려진다', async () => {
    const events = chatEvents()
    renderChat('/chat/channels/1', {
      channels: [createChannel({ id: 1, member: true })],
      events: events.handler,
      handlers: [http.post(`${API}/messaging/channels/1/messages`, () => new HttpResponse(null, { status: 404 }))],
    })
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument()
    await events.push('messaging.message.created', createMessage({ id: 999, channelId: 1, authorId: 2, body: 'SSE 실시간' }))
    expect(await screen.findByText('SSE 실시간')).toBeInTheDocument()
  })

  // 본인 읽음 이벤트 → 채널 목록 재조회 → 사이드바 미읽음 배지가 사라진다.
  test('본인 read 이벤트가 오면 사이드바 미읽음 배지가 사라진다', async () => {
    const events = chatEvents()
    let calls = 0
    renderChat('/chat', {
      events: events.handler,
      handlers: [
        http.get(`${API}/messaging/channels`, () => {
          calls += 1
          return HttpResponse.json([createChannel({ id: 202, name: '안읽음채널', member: true, unreadCount: calls === 1 ? 3 : 0 })])
        }),
      ],
    })
    expect(await screen.findByTestId('channel-unread-202')).toHaveTextContent('3')
    await events.push('messaging.message.read', { channelId: 202, userId: 1, lastReadMessageId: 999 })
    await waitFor(() => expect(screen.queryByTestId('channel-unread-202')).not.toBeInTheDocument())
  })

  // 다른 사람(userId 2)의 반응은 self-echo 가드를 지나 칩으로 붙는다.
  test('SSE reaction.added 를 받으면 반응 칩이 생긴다', async () => {
    const events = chatEvents()
    renderChat('/chat/channels/503', {
      channels: [createChannel({ id: 503, name: 'SSE채널' })],
      messages: { 503: [createMessage({ id: 9400, channelId: 503, body: '실시간' })] },
      events: events.handler,
    })
    expect(await screen.findByText('실시간')).toBeInTheDocument()
    await events.push('messaging.reaction.added', { channelId: 503, messageId: 9400, emoji: '🔥', userId: 2 })
    expect(await screen.findByTestId('reaction-count-9400-🔥')).toHaveTextContent('1')
  })
})

describe('채널 변경 실시간 반영 (WP-62)', () => {
  // resource.changed(channel created) → 채널 목록을 다시 불러 새 채널이 사이드바에 나타난다.
  test('채널 생성 이벤트가 오면 사이드바에 새 채널이 나타난다', async () => {
    const events = chatEvents()
    let store = [createChannel({ id: 1, name: '일반' })]
    renderChat('/chat', { events: events.handler, handlers: [http.get(`${API}/messaging/channels`, () => HttpResponse.json(store))] })
    expect(await screen.findByTestId('channel-link-1')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-link-9')).not.toBeInTheDocument()
    store = [...store, createChannel({ id: 9, name: 'ai-채널' })]
    await events.push('resource.changed', { resource: 'channel', op: 'created', scopeType: 'TENANT', scopeId: 1, channelId: 9, actorId: 99 })
    expect(await screen.findByTestId('channel-link-9')).toHaveTextContent('ai-채널')
  })

  // 제거된 사용자 — 목록·상세 재조회로 사이드바에서 빠지고 상세는 404 → 채널 없음. 로그인으로 튕기지 않는다.
  test('제거되면 사이드바에서 사라지고 상세는 채널 없음, 로그인으로 가지 않는다', async () => {
    const events = chatEvents()
    let store = [createChannel({ id: 1, name: '일반' }), createChannel({ id: 5, name: '비밀', visibility: 'PRIVATE' })]
    const { location } = renderChat('/chat/channels/5', {
      events: events.handler,
      handlers: [
        http.get(`${API}/messaging/channels`, () => HttpResponse.json(store)),
        http.get(`${API}/messaging/channels/:id`, ({ params }) => {
          const found = store.find((c) => c.id === Number(params.id))
          return found ? HttpResponse.json(found) : HttpResponse.json({}, { status: 404 })
        }),
      ],
    })
    expect(await screen.findByTestId('channel-header-name')).toHaveTextContent('비밀')
    expect(screen.getByTestId('channel-link-5')).toBeInTheDocument()
    store = store.filter((c) => c.id !== 5)
    await events.push('resource.changed', { resource: 'channel', op: 'updated', scopeType: 'CHANNEL', scopeId: 5, channelId: 5, actorId: 99 })
    await waitFor(() => expect(screen.queryByTestId('channel-link-5')).not.toBeInTheDocument())
    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()
    expect(screen.getByTestId('channel-link-1')).toBeInTheDocument()
    expect(location()).not.toMatch(/login/)
  })
})

describe('AI 진행 유령 버블', () => {
  const CHANNEL_ID = 42
  const channel = createChannel({ id: CHANNEL_ID, name: '개발', memberCount: 2 })
  const members = { [CHANNEL_ID]: [createChannelMember({ userId: 1, name: '나' }), createChannelMember({ userId: AGENT_ID, name: 'AI', kind: 'AGENT' })] }
  const agentMessage = (id: number, channelId: number, body: string) =>
    createMessage({ id, channelId, authorId: AGENT_ID, authorName: 'AI', authorKind: 'AGENT', body })

  /** 채널(또는 DM)을 열고 빈 상태가 보일 때까지 기다린다 — 진행 구독이 채널 id 로 걸린 뒤 프레임을 민다. */
  async function open(path: string, extra: Partial<Parameters<typeof renderChat>[1]> = {}) {
    const events = chatEvents()
    const view = renderChat(path, { channels: [channel], members, events: events.handler, handlers: agentHandlers, ...extra })
    await screen.findByTestId('chat-empty-state')
    return { ...view, events }
  }

  // 진행 프레임 → 버블(도구 단계 라벨), AGENT 의 완성 메시지가 오면 버블 대신 메시지.
  test('채널 — 진행 중 버블이 보이고 AI 메시지가 오면 메시지로 바뀐다', async () => {
    const { events } = await open(`/chat/channels/${CHANNEL_ID}`)
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-1', 'started'))
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-1', 'tool', [{ label: '이슈 목록 조회', status: 'running' }]))
    expect(await screen.findByTestId('ai-working-bubble')).toHaveTextContent('이슈 목록 조회')
    await events.push('messaging.message.created', agentMessage(9002, CHANNEL_ID, '채널 AI 최종 답변'))
    expect(await screen.findByText('채널 AI 최종 답변')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument())
  })

  // #345: DM 화면도 같은 진행 구독을 한다.
  test('DM — 진행 중 버블이 보이고 AI 메시지가 오면 메시지로 바뀐다', async () => {
    const DM_ID = 77
    const { events } = await open(`/chat/dms/${DM_ID}`, {
      dms: [createDm({ id: DM_ID })],
      channels: [createChannel({ id: DM_ID, kind: 'DM', member: true })],
      members: { [DM_ID]: members[CHANNEL_ID] },
    })
    await events.push('messaging.message.progress', progress(DM_ID, 's-dm', 'started'))
    await events.push('messaging.message.progress', progress(DM_ID, 's-dm', 'tool', [{ label: '메일 검색', status: 'running' }]))
    expect(await screen.findByTestId('ai-working-bubble')).toHaveTextContent('메일 검색')
    await events.push('messaging.message.created', agentMessage(9077, DM_ID, 'DM AI 최종 답변'))
    expect(await screen.findByText('DM AI 최종 답변')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument())
  })

  // #346: 사람 메시지가 끼어들어도(메시지 수 증가) 버블은 남고, 새 AGENT 메시지가 와야 걷힌다.
  test('사람 메시지가 끼어들어도 버블이 남고, AGENT 메시지에만 걷힌다', async () => {
    const { events } = await open(`/chat/channels/${CHANNEL_ID}`)
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-keep', 'started'))
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-keep', 'tool', [{ label: '문서 검색', status: 'running' }]))
    expect(await screen.findByTestId('ai-working-bubble')).toHaveTextContent('문서 검색')
    await events.push('messaging.message.created', createMessage({ id: 9100, channelId: CHANNEL_ID, authorId: 2, authorName: '밥', body: '밥의 끼어든 메시지' }))
    expect(await screen.findByText('밥의 끼어든 메시지')).toBeInTheDocument()
    expect(screen.getByTestId('ai-working-bubble')).toBeInTheDocument()
    await events.push('messaging.message.created', agentMessage(9101, CHANNEL_ID, 'AI 최종 답변'))
    await waitFor(() => expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument())
    expect(screen.getByText('AI 최종 답변')).toBeInTheDocument()
  })

  // 끝난(done) 스트림의 뒤늦은 tool 이벤트는 버블을 되살리지 않는다(순서 보장 없는 fire-and-forget).
  test('done 뒤에 같은 스트림의 늦은 tool 이벤트가 와도 버블이 되살아나지 않는다', async () => {
    const { events } = await open(`/chat/channels/${CHANNEL_ID}`)
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-stale', 'started'))
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-stale', 'tool', [{ label: '답변 작성', status: 'running' }]))
    expect(await screen.findByTestId('ai-working-bubble')).toHaveTextContent('답변 작성')
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-stale', 'done', [{ label: '답변 작성', status: 'done' }]))
    await waitFor(() => expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument())
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-stale', 'tool', [{ label: '답변 작성', status: 'done' }]))
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument()
  })

  // WP-418: 채널마다 화면을 새로 마운트한다(App.tsx 의 KeyedByParam) — A 채널 버블이 B 채널로 따라오지 않는다.
  // 막는 장치가 App 라우트 트리에 있어 이 한 건만 renderPage(실제 App 라우트)로 띄운다.
  test('다른 채널로 옮기면 이전 채널의 버블이 따라오지 않는다', async () => {
    const OTHER = 43
    const events = chatEvents()
    const { user, location } = renderPage(`/chat/channels/${CHANNEL_ID}`, {
      handlers: [
        events.handler,
        ...agentHandlers,
        ...chatBaseHandlers({
          channels: [channel, createChannel({ id: OTHER, name: '다른채널', memberCount: 2 })],
          members: { ...members, [OTHER]: members[CHANNEL_ID] },
        }),
      ],
    })
    await screen.findByTestId('chat-empty-state', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await events.push('messaging.message.progress', progress(CHANNEL_ID, 's-switch', 'tool', [{ label: '문서 검색', status: 'running' }]))
    expect(await screen.findByTestId('ai-working-bubble')).toBeInTheDocument()
    await user.click(screen.getByTestId(`channel-link-${OTHER}`))
    await waitFor(() => expect(location()).toBe(`/chat/channels/${OTHER}`))
    expect(await screen.findByTestId('chat-empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-working-bubble')).not.toBeInTheDocument()
  })
})

describe('끊김 배너', () => {
  // #167: 통합 SSE 연결이 실패(503)한 채 유예(800ms)가 지나면 「실시간 연결 중」 상태 배너.
  test('SSE 연결이 실패하면 재연결 배너(role=status)가 보인다', async () => {
    renderChat('/chat/channels/1', {
      channels: [createChannel({ id: 1, member: true })],
      events: http.get(`${API}/events`, () => new HttpResponse(null, { status: 503 })),
    })
    const banner = await screen.findByTestId('chat-reconnecting-banner', {}, { timeout: 3000 })
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveTextContent('실시간 연결 중')
  })

  // 정상 진입의 깜빡임 방지 — 유예(800ms) 안에 연결되면 배너가 한 번도 뜨지 않는다.
  test('유예 안에 연결되면 배너가 깜빡이지 않는다', async () => {
    let connect!: () => void
    function Host() {
      const [isConnected, setConnected] = useState(false)
      connect = () => setConnected(true)
      return (
        <MessagingConnectionContext.Provider value={{ isConnected }}>
          <ChatModuleLayout />
        </MessagingConnectionContext.Provider>
      )
    }
    renderScreen(<Host />, { path: '/chat', handlers: chatBaseHandlers() })
    expect(await screen.findByTestId('channel-sidebar')).toBeInTheDocument()
    // 연결 전(300ms) — 아직 유예 안이라 배너가 없다(예전엔 마운트~연결 사이 늘 보였다).
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('chat-reconnecting-banner')).not.toBeInTheDocument()
    act(() => connect())
    // 유예가 지나도(1초) 연결됐으므로 배너는 없다.
    await new Promise((r) => setTimeout(r, 1000))
    expect(screen.queryByTestId('chat-reconnecting-banner')).not.toBeInTheDocument()
  })
})
