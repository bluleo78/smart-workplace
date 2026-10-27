// 채널 메시지 목록(메시지 행·반응·반응자·스레드·링크 미리보기·삭제 되돌리기·첨부 뷰어) — 화면 테스트(WP-966, WP-995).
// 서식/마크다운/멘션 칩 렌더·그룹 시작·미읽음 구분선 순서·반응 추가/취소/연타·반응자 다이얼로그 닫힘·스레드 미읽음 점과 읽음 처리·
// 빈 스레드 문구·링크 자동 변환/미리보기 지우기 실패 복원/SSE 미리보기·삭제 실행 취소·첨부 뷰어의 ✨ 숨김/삭제된 링크/낡은 열림 표식은
// 브라우저 없이 판정되므로 e2e/pages/chat/{chat,chat-formatting,messaging-message-body,messaging-link-preview,messaging-phase4,
// messaging-phase5,messaging-reactors,messaging-thread-unread,chat-attachment-viewer}.spec.ts 에서 옮겼다.
// 그 spec 들에는 호버로만 보이는 툴바·카드(@input), 말풍선 배치·넘침(@layout), 에디터에 글자를 치는 흐름(@input),
// PDF 렌더·다운로드·새로고침(@platform)이 남는다.
// 채팅 라우트만 renderScreen 으로 띄운다(testkit-b5).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, chatEvents, renderChat } from '@/test/kits/chat/testkit-b5'
import type { DriveLink } from '@/types/drive'
import type { ChannelResponse, MessageAttachment, MessageResponse } from '@/types/messaging'

import { createChannel, createChannelMember, createLinkPreview, createMessage, createReaction } from '../../../e2e/factories/messaging.factory'

/** 채널 하나를 연다 — 메시지는 서버처럼 최신이 앞(DESC)으로 준다. */
function openChannel(channel: ChannelResponse, messages: MessageResponse[], opts: Omit<NonNullable<Parameters<typeof renderChat>[1]>, 'channels' | 'messages'> = {}) {
  return renderChat(`/chat/channels/${channel.id}`, { ...opts, channels: [channel], messages: { [channel.id]: messages } })
}

/** 요청 수·본문 기록 핸들러. */
function record(method: 'post' | 'delete' | 'patch', path: string, reply: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const calls: unknown[] = []
  return {
    calls,
    handler: http[method](`${API}${path}`, async ({ request }) => {
      const text = await request.text()
      calls.push(text ? JSON.parse(text) : null)
      return reply()
    }),
  }
}

describe('메시지 본문', () => {
  const CHANNEL_ID = 700
  const channel = createChannel({ id: CHANNEL_ID, name: '테스트', memberCount: 2 })
  const members = { [CHANNEL_ID]: [createChannelMember({ userId: 10, name: 'bluleo78' }), createChannelMember({ userId: 99, name: 'My AI', kind: 'AGENT' })] }

  // 작성자가 바뀌면 새 그룹, AGENT 아바타엔 봇 배지 — ai-accent 토큰(#301, raw 보라 팔레트 금지).
  test('AGENT 메시지는 새 그룹을 시작하고 ai-accent 봇 배지를 단다', async () => {
    openChannel(channel, [
      createMessage({ id: 3, channelId: CHANNEL_ID, authorId: 99, authorName: 'My AI', authorKind: 'AGENT', body: '에이전트 응답', createdAt: '2026-06-06T03:03:00' }),
      createMessage({ id: 2, channelId: CHANNEL_ID, authorId: 10, authorName: 'bluleo78', body: '둘째(연속)', createdAt: '2026-06-06T03:02:00' }),
      createMessage({ id: 1, channelId: CHANNEL_ID, authorId: 10, authorName: 'bluleo78', body: '첫째', createdAt: '2026-06-06T03:00:00' }),
    ], { members })
    expect(await screen.findByTestId('message-3')).toHaveAttribute('data-group-start', 'true')
    expect(screen.getByTestId('message-2')).not.toHaveAttribute('data-group-start', 'true')
    const badge = screen.getByTestId('chat-avatar-agent-99')
    expect(badge.className).toMatch(/bg-ai-accent/)
    expect(badge.className).not.toMatch(/bg-purple-600/)
  })

  // #356: AI 메시지만 마크다운으로(제목·목록·굵게), 사람 메시지의 ##·** 는 글자 그대로.
  test('AGENT 메시지는 마크다운으로, 사람 메시지는 원문 그대로 그린다', async () => {
    openChannel(channel, [
      createMessage({ id: 51, channelId: CHANNEL_ID, authorId: 10, authorName: 'bluleo78', body: '## 사람 메시지는 ** 그대로', createdAt: '2026-06-06T03:05:00' }),
      createMessage({ id: 50, channelId: CHANNEL_ID, authorId: 99, authorName: 'My AI', authorKind: 'AGENT', body: '## 보고서 제목\n\n- 항목 하나\n- 항목 둘\n\n**중요** 강조', createdAt: '2026-06-06T03:00:00' }),
    ], { members })
    const ai = await screen.findByTestId('message-body-50')
    expect(within(ai).getByTestId('markdown-content')).toBeInTheDocument()
    expect(within(ai).getByRole('heading', { name: '보고서 제목' })).toBeInTheDocument()
    expect(within(ai).getByText('항목 하나').closest('li')).not.toBeNull()
    expect(within(ai).getByText('중요').tagName).toBe('STRONG')
    expect(ai.textContent).not.toContain('##')
    expect(ai.textContent).not.toContain('**')
    const human = screen.getByTestId('message-body-51')
    expect(within(human).queryByTestId('markdown-content')).not.toBeInTheDocument()
    expect(human).toHaveTextContent('## 사람 메시지는 ** 그대로')
  })

  // #258·#884: 멘션 칩 토큰 — 타인 메시지의 사람 칩은 bg-accent, AGENT 칩은 text-primary(raw 팔레트 금지).
  // 본인 말풍선 안 칩은 배경과 구분되는 bg-background + 끊기지 않게 whitespace-nowrap.
  test('멘션 칩은 시맨틱 토큰을 쓰고, 본인 말풍선 안 칩은 bg-background·whitespace-nowrap', async () => {
    const mentions = [
      { id: 20, username: 'peer', name: '동료', kind: 'HUMAN' as const },
      { id: 99, username: 'myai', name: 'My AI', kind: 'AGENT' as const },
    ]
    openChannel(channel, [
      createMessage({ id: 37, channelId: CHANNEL_ID, authorId: 20, authorName: '동료', body: '<@99> 확인 부탁', mentions, createdAt: '2026-06-06T03:04:00' }),
      createMessage({ id: 36, channelId: CHANNEL_ID, authorId: 1, authorName: 'me', body: '<@99> 요약해줘 <@20>', mentions, createdAt: '2026-06-06T03:03:00' }),
      createMessage({ id: 10, channelId: CHANNEL_ID, authorId: 5, authorName: '다른사람', body: '안녕 <@20> <@99>', mentions, createdAt: '2026-06-06T03:00:00' }),
    ])
    const peer = await screen.findByTestId('message-body-10')
    const human = within(peer).getByTestId('mention-chip-20')
    expect(human.className).toMatch(/bg-accent/)
    expect(human.className).toMatch(/text-accent-foreground/)
    expect(human.className).not.toMatch(/(bg|text)-blue-/)
    const agent = within(peer).getByTestId('mention-chip-99')
    expect(agent.className).toMatch(/text-primary/)
    expect(agent.className).not.toMatch(/(bg|text)-purple-/)
    const own = screen.getByTestId('message-body-36')
    for (const id of [99, 20]) {
      const chip = within(own).getByTestId(`mention-chip-${id}`)
      expect(chip.className).toMatch(/bg-background/)
      expect(chip.className).toMatch(/whitespace-nowrap/)
    }
    const peerChip = within(screen.getByTestId('message-body-37')).getByTestId('mention-chip-99')
    expect(peerChip.className).toMatch(/bg-primary\/15/)
    expect(peerChip.className).not.toMatch(/bg-background/)
  })

  // WP-101: 서식 메시지는 strong·u·del·code·목록·코드 블록으로, 예전 평문은 들여쓰기·밑줄 문자·# 를 글자 그대로(제목·기울임 아님).
  test('서식 메시지는 서식으로, 예전 평문 메시지는 예전처럼 그린다', async () => {
    openChannel(createChannel({ id: 1 }), [
      createMessage({ id: 31, channelId: 1, authorId: 1, authorName: 'me', createdAt: '2026-09-30T03:10:00Z', body: '**배포** 일정은 <u>금요일</u> ~~목요일~~ `v1.2`\n\n- 빌드\n- 검증\n\n```\nkubectl rollout status\n```' }),
      createMessage({ id: 30, channelId: 1, authorId: 20, authorName: '동료', createdAt: '2026-09-30T03:00:00Z', body: '예전 메시지\n    들여쓴 줄 a_b 2*3 #해시\n\n- 이건 목록으로 보인다\nhttps://a.com/x_(y)' }),
    ])
    const fmt = await screen.findByTestId('message-body-31')
    expect(fmt.querySelector('strong')).toHaveTextContent('배포')
    expect(fmt.querySelector('u')).toHaveTextContent('금요일')
    expect(fmt.querySelector('del')).toHaveTextContent('목요일')
    expect(fmt.querySelector('code')).toHaveTextContent('v1.2')
    expect([...fmt.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['빌드', '검증'])
    expect(fmt.querySelector('pre')).toHaveTextContent('kubectl rollout status')
    const legacy = screen.getByTestId('message-body-30')
    expect(legacy.textContent).toContain('예전 메시지\n    들여쓴 줄 a_b 2*3 #해시')
    expect(legacy.querySelectorAll('pre, h1, em, strong')).toHaveLength(0)
    const items = legacy.querySelectorAll('ul > li')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toMatch(/^이건 목록으로 보인다\s+https:\/\/a\.com\/x_\(y\)$/)
    expect(within(legacy).getByTestId('chat-link')).toHaveAttribute('href', 'https://a.com/x_(y)')
  })

  // 미읽음 구분선은 첫 미읽음(남이 보낸, 기준점 뒤) 메시지 바로 앞에 그린다 — 문서 순서로 2 와 3 사이.
  test('미읽음 구분선은 첫 미읽음 메시지 바로 앞에 있다', async () => {
    openChannel(createChannel({ id: 77, lastReadMessageId: 2 }), [
      createMessage({ id: 4, channelId: 77, authorId: 2, createdAt: '2026-06-01T04:00:00Z' }),
      createMessage({ id: 3, channelId: 77, authorId: 2, createdAt: '2026-06-01T03:00:00Z' }),
      createMessage({ id: 2, channelId: 77, createdAt: '2026-06-01T02:00:00Z' }),
      createMessage({ id: 1, channelId: 77, createdAt: '2026-06-01T01:00:00Z' }),
    ])
    const divider = await screen.findByTestId('unread-divider')
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(screen.getByTestId('message-2'), divider)).toBe(true)
    expect(follows(divider, screen.getByTestId('message-3'))).toBe(true)
  })
})

describe('반응', () => {
  const CHANNEL_ID = 501
  const MSG_ID = 9200
  const channel = createChannel({ id: CHANNEL_ID, name: '리액션채널' })

  // 퀵셋 이모지 → POST {emoji} + 낙관적 칩(카운트 1).
  test('퀵셋 이모지를 누르면 {emoji} 를 보내고 칩이 생긴다', async () => {
    const post = record('post', `/messaging/messages/${MSG_ID}/reactions`)
    const { user } = openChannel(channel, [createMessage({ id: MSG_ID, channelId: CHANNEL_ID, body: '반응해줘' })], { handlers: [post.handler] })
    await user.click(await screen.findByTestId(`message-${MSG_ID}-react`))
    await user.click(await screen.findByTestId(`message-${MSG_ID}-quick-👍`))
    await waitFor(() => expect(post.calls).toEqual([{ emoji: '👍' }]))
    expect(screen.getByTestId(`reaction-count-${MSG_ID}-👍`)).toHaveTextContent('1')
  })

  // WP-665: 삭제된 메시지엔 반응 추가가 없고 남은 칩도 눌리지 않는다(살아 있는 메시지엔 있다).
  test('삭제된 메시지엔 이모지 피커가 없고 남은 칩은 비활성', async () => {
    openChannel(createChannel({ id: 509 }), [
      createMessage({ id: 9251, channelId: 509, authorId: 2, body: '살아있는 메시지', createdAt: '2026-10-21T01:05:00Z' }),
      createMessage({ id: 9250, channelId: 509, authorId: 2, body: '(삭제됨)', deleted: true, reactions: [createReaction({ emoji: '👍', count: 1, reacted: false })], createdAt: '2026-10-21T01:00:00Z' }),
    ])
    expect(await screen.findByTestId('message-9251-react')).toBeInTheDocument()
    expect(screen.getByTestId('message-toolbar-9250')).toBeInTheDocument()
    expect(screen.queryByTestId('message-9250-react')).not.toBeInTheDocument()
    expect(screen.getByTestId('reaction-pill-9250-👍')).toBeDisabled()
  })

  // 내가 누른 반응을 다시 누르면 DELETE 후 칩이 사라진다. 눌린 칩은 aria-pressed + 시맨틱 토큰(#281, raw 파랑 금지).
  test('누른 반응 칩은 aria-pressed·토큰 클래스, 다시 누르면 DELETE 후 사라진다', async () => {
    const del = record('delete', `/messaging/messages/9300/reactions`)
    const { user } = openChannel(createChannel({ id: 502 }), [
      createMessage({ id: 9300, channelId: 502, body: '눌림', reactions: [createReaction({ emoji: '🎉', count: 1, reacted: true })] }),
    ], { handlers: [del.handler] })
    const pill = await screen.findByTestId('reaction-pill-9300-🎉')
    expect(pill).toHaveAttribute('aria-pressed', 'true')
    expect(pill.className).toMatch(/bg-primary\/10/)
    expect(pill.className).toMatch(/text-primary/)
    expect(pill.className).toMatch(/border-primary/)
    expect(pill.className).not.toMatch(/bg-blue-100|text-blue-700|border-blue-400/)
    await user.click(pill)
    await waitFor(() => expect(screen.queryByTestId('reaction-pill-9300-🎉')).not.toBeInTheDocument())
    expect(del.calls).toHaveLength(1)
  })

  // #702: 같은 틱에 세 번 눌러도 매번 최신 상태로 판정 — add → remove → add, 최종 카운트 1(누적 3 아님).
  test('같은 틱에 세 번 눌러도 카운트가 누적되지 않는다 — POST 2·DELETE 1', async () => {
    const post = record('post', `/messaging/messages/9500/reactions`)
    const del = record('delete', `/messaging/messages/9500/reactions`)
    const { user } = openChannel(createChannel({ id: 505 }), [createMessage({ id: 9500, channelId: 505, body: '연속클릭 테스트' })], {
      handlers: [post.handler, del.handler],
    })
    await user.click(await screen.findByTestId('message-9500-react'))
    const quick = await screen.findByTestId('message-9500-quick-🎉')
    act(() => {
      quick.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      quick.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      quick.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(await screen.findByTestId('reaction-count-9500-🎉')).toHaveTextContent('1')
    await waitFor(() => expect(post.calls).toHaveLength(2))
    expect(del.calls).toHaveLength(1)
  })
})

describe('반응자 (WP-106)', () => {
  const CHANNEL_ID = 610
  const MSG_ID = 9610
  const channel = createChannel({ id: CHANNEL_ID, name: '반응자채널' })
  const msg = (reactions: ReturnType<typeof createReaction>[]) =>
    createMessage({ id: MSG_ID, channelId: CHANNEL_ID, authorId: 2, authorName: '김민수', body: '배포 끝났습니다', reactions })
  const reactors = (byEmoji: Record<string, { userId: number; name: string }[]>) =>
    http.get(`${API}/messaging/messages/${MSG_ID}/reactions/users`, ({ request }) => {
      const emoji = new URL(request.url).searchParams.get('emoji') ?? ''
      return HttpResponse.json({ items: (byEmoji[emoji] ?? []).map((r) => ({ kind: 'HUMAN', ...r })), nextCursor: null, hasMore: false })
    })

  // 반응이 없으면 「반응한 사람 보기」 버튼도 없다.
  test('반응이 없는 메시지의 툴바엔 반응한 사람 보기 버튼이 없다', async () => {
    openChannel(channel, [msg([])])
    expect(await screen.findByTestId(`message-toolbar-${MSG_ID}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`message-reactors-${MSG_ID}`)).not.toBeInTheDocument()
  })

  // 호버 카드가 있어도 칩 클릭은 토글 — 내 반응(👍 5) 취소 → DELETE, 카운트 4.
  test('칩 클릭은 여전히 토글이다', async () => {
    const del = record('delete', `/messaging/messages/${MSG_ID}/reactions`)
    const { user } = openChannel(channel, [msg([createReaction({ emoji: '👍', count: 5, reacted: true }), createReaction({ emoji: '🎉', count: 2 })])], {
      handlers: [del.handler, reactors({})],
    })
    await user.click(await screen.findByTestId(`reaction-pill-${MSG_ID}-👍`))
    await waitFor(() => expect(screen.getByTestId(`reaction-count-${MSG_ID}-👍`)).toHaveTextContent('4'))
    expect(del.calls).toHaveLength(1)
  })

  // 열린 다이얼로그는 마지막 반응이 사라지면 닫히고, 나중에 반응이 다시 달려도 저절로 다시 열리지 않는다.
  test('마지막 반응이 사라져 닫힌 다이얼로그는 반응이 다시 달려도 저절로 열리지 않는다', async () => {
    const events = chatEvents()
    const post = record('post', `/messaging/messages/${MSG_ID}/reactions`)
    const { user } = openChannel(channel, [msg([createReaction({ emoji: '🎉', count: 1, reacted: false })])], {
      events: events.handler,
      handlers: [post.handler, reactors({ '🎉': [{ userId: 3, name: '이영희' }] })],
    })
    await user.click(await screen.findByTestId(`message-reactors-${MSG_ID}`))
    expect(await screen.findByTestId('reactors-dialog')).toBeInTheDocument()
    await events.push('messaging.reaction.removed', { channelId: CHANNEL_ID, messageId: MSG_ID, emoji: '🎉', userId: 3 })
    await waitFor(() => expect(screen.queryByTestId(`reaction-pill-${MSG_ID}-🎉`)).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('reactors-dialog')).not.toBeInTheDocument())
    await user.click(screen.getByTestId(`message-${MSG_ID}-react`))
    await user.click(await screen.findByTestId(`message-${MSG_ID}-quick-👍`))
    await waitFor(() => expect(post.calls).toHaveLength(1))
    expect(await screen.findByTestId(`reaction-pill-${MSG_ID}-👍`)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByTestId('reactors-dialog')).not.toBeInTheDocument()
  })
})

describe('스레드', () => {
  const replies = (parentId: number, items: MessageResponse[]) =>
    http.get(`${API}/messaging/messages/${parentId}/replies`, () => HttpResponse.json({ items, nextCursor: null, hasMore: false }))

  // #65: 팔로우 중인 스레드에 미읽음이 있으면 답글 링크에 점, 패널을 열면 thread/read.
  test('미읽음 스레드는 점이 뜨고, 패널을 열면 읽음 처리된다', async () => {
    const read = record('post', '/messaging/messages/8001/thread/read')
    const { user } = openChannel(createChannel({ id: 700 }), [
      createMessage({ id: 8001, channelId: 700, body: '부모글', replyCount: 1, unreadReplyCount: 1, followed: true }),
    ], { handlers: [read.handler, replies(8001, [createMessage({ id: 8100, channelId: 700, parentMessageId: 8001, body: '새 답글' })])] })
    expect(await screen.findByTestId('message-unread-thread-8001')).toBeInTheDocument()
    await user.click(screen.getByTestId('message-thread-link-8001'))
    expect(await screen.findByTestId('thread-panel')).toBeInTheDocument()
    await waitFor(() => expect(read.calls).toHaveLength(1))
  })

  test('미읽음이 0 이면 점이 없다', async () => {
    openChannel(createChannel({ id: 701 }), [createMessage({ id: 8201, channelId: 701, body: '부모글', replyCount: 2, unreadReplyCount: 0, followed: true })])
    expect(await screen.findByTestId('message-thread-link-8201')).toBeInTheDocument()
    expect(screen.queryByTestId('message-unread-thread-8201')).not.toBeInTheDocument()
  })

  // #291: 답글이 없으면 빈 상태 안내. WP-843: 보관 채널은 답글을 쓸 수 없으니 권하지 않는다.
  test('빈 스레드는 「아직 답글이 없어요」와 첫 답글 권유', async () => {
    const { user } = openChannel(createChannel({ id: 511 }), [createMessage({ id: 9800, channelId: 511, body: '부모글' })], {
      handlers: [replies(9800, []), record('post', '/messaging/messages/9800/thread/read').handler],
    })
    await user.click(await screen.findByTestId('message-reply-9800'))
    const panel = await screen.findByTestId('thread-panel')
    expect(await within(panel).findByText('아직 답글이 없어요.')).toBeInTheDocument()
    expect(within(panel).getByText('첫 번째 답글을 남겨보세요.')).toBeInTheDocument()
  })

  test('보관 채널의 빈 스레드는 「답글이 없습니다」만, 답글을 권하지 않는다', async () => {
    const { user } = openChannel(createChannel({ id: 512, archived: true }), [createMessage({ id: 9801, channelId: 512, body: '보관 전 부모글' })], {
      handlers: [replies(9801, []), record('post', '/messaging/messages/9801/thread/read').handler],
    })
    await user.click(await screen.findByTestId('message-reply-9801'))
    const panel = await screen.findByTestId('thread-panel')
    expect(await within(panel).findByText('답글이 없습니다.')).toBeInTheDocument()
    expect(within(panel).getByText('이 채널은 보관되었습니다')).toBeInTheDocument()
    expect(within(panel).queryByText('첫 번째 답글을 남겨보세요.')).not.toBeInTheDocument()
  })
})

describe('메시지 삭제 실행 취소', () => {
  // 삭제는 지연(토스트) 뒤에 나간다 — 그 안에 「실행 취소」를 누르면 DELETE 가 없고 메시지가 남는다.
  test('삭제 후 실행 취소를 누르면 DELETE 가 나가지 않는다', async () => {
    const del = record('delete', '/messaging/messages/851')
    const { user } = openChannel(createChannel({ id: 210, name: 'Undo채널', member: true }), [
      createMessage({ id: 851, channelId: 210, authorId: 1, authorName: '나', body: '살아남을 메시지' }),
    ], { handlers: [del.handler] })
    await user.click(await screen.findByTestId('message-delete-851'))
    expect(await screen.findByText('메시지를 삭제했습니다')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '실행 취소' }))
    await waitFor(() => expect(screen.queryByText('메시지를 삭제했습니다')).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 200))
    expect(del.calls).toHaveLength(0)
    expect(screen.getByTestId('message-body-851')).toHaveTextContent('살아남을 메시지')
  })
})

describe('링크·미리보기 (WP-874)', () => {
  const LONG_URL = 'https://github.com/CopilotKit/OpenIntelligentUI/blob/main/packages/react-core/src/components/chat/IntelligentMessageRenderer.tsx?plain=1#L120-L188'
  /** 10: 동료 — 긴 URL + 썸네일 카드, 11: 본인 — www. 링크 + 글만 카드, 12: 동료 — 미리보기 아직 없음(e2e/fixtures/link-preview-mock 과 같은 구성). */
  const linkMessages = () => [
    createMessage({ id: 12, channelId: 1, authorId: 20, authorName: '이진우', createdAt: '2026-10-23T04:50:00Z', body: '문서 공유 https://docs.example.com/a' }),
    createMessage({
      id: 11, channelId: 1, authorId: 1, authorName: 'me', createdAt: '2026-10-23T04:45:00Z', body: '회의록은 www.example.com/notes 에 있어요.',
      linkPreviews: [createLinkPreview({ url: 'https://www.example.com/notes', title: 'Example Notes', siteName: null, description: 'og:image 가 없는 페이지' })],
    }),
    createMessage({
      id: 10, channelId: 1, authorId: 20, authorName: '이진우', createdAt: '2026-10-23T04:42:00Z', body: `이거 참고해 보세요 ${LONG_URL} UI 구성 괜찮네요`,
      linkPreviews: [createLinkPreview({ url: LONG_URL, hasImage: true })],
    }),
  ]
  /** 썸네일 프록시(못 받으면 이미지 자리 없이 글만)·미리보기 지우기. */
  const previewHandlers = ({ dismissStatus = 204, imageStatus = 404 } = {}) => [
    http.get(`${API}/messaging/messages/:id/link-previews/:pos/image`, () => new HttpResponse(null, { status: imageStatus })),
    http.delete(`${API}/messaging/messages/:id/link-previews`, () =>
      dismissStatus === 204 ? new HttpResponse(null, { status: 204 }) : HttpResponse.json({ message: '미리보기를 지우지 못했습니다' }, { status: dismissStatus }),
    ),
  ]
  const open = (opts: Parameters<typeof previewHandlers>[0] = {}, events?: ReturnType<typeof chatEvents>) =>
    openChannel(createChannel({ id: 1, member: true }), linkMessages(), { handlers: previewHandlers(opts), events: events?.handler })

  // 사람 메시지의 URL·www. 는 새 탭 링크(rel noopener), 앞뒤 글은 링크 밖에 남는다.
  test('사람 메시지의 URL·www. 는 새 탭 링크가 된다', async () => {
    open()
    const body = await screen.findByTestId('message-body-10')
    const link = within(body).getByTestId('chat-link')
    expect(link).toHaveTextContent(LONG_URL)
    expect(link).toHaveAttribute('href', LONG_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(body).toHaveTextContent('이거 참고해 보세요')
    expect(body).toHaveTextContent('UI 구성 괜찮네요')
    const www = within(screen.getByTestId('message-body-11')).getByTestId('chat-link')
    expect(www).toHaveTextContent('www.example.com/notes')
    expect(www).toHaveAttribute('href', 'https://www.example.com/notes')
  })

  // 수정 중엔 미리보기 카드·✕ 를 숨기고 취소하면 다시 보인다.
  test('수정 중엔 미리보기를 숨기고, 취소하면 다시 보인다', async () => {
    const { user } = open()
    expect(await screen.findByTestId('link-preview-11-0')).toBeInTheDocument()
    await user.click(screen.getByTestId('message-edit-11'))
    expect(await screen.findByTestId('message-editor-11')).toBeInTheDocument()
    expect(screen.queryByTestId('link-previews-11')).not.toBeInTheDocument()
    expect(screen.queryByTestId('link-preview-dismiss-11')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('message-editor-cancel-11'))
    expect(await screen.findByTestId('link-preview-11-0')).toBeInTheDocument()
  })

  // 작성자만 ✕ 가 있고(타인 메시지엔 없다), 지우기가 실패하면 카드를 되돌리고 오류 토스트.
  test('지우기에 실패하면 카드를 되돌리고 오류를 알린다 — 타인 메시지엔 ✕ 가 없다', async () => {
    const { user } = open({ dismissStatus: 500 })
    expect(await screen.findByTestId('link-preview-11-0')).toBeInTheDocument()
    expect(screen.queryByTestId('link-preview-dismiss-10')).not.toBeInTheDocument()
    expect(screen.getByTestId('link-preview-dismiss-11')).toHaveAccessibleName('미리보기 지우기')
    await user.click(screen.getByTestId('link-preview-dismiss-11'))
    expect(await screen.findByText(/미리보기를 지우지 못했습니다|실패/)).toBeInTheDocument()
    expect(await screen.findByTestId('link-preview-11-0')).toBeInTheDocument()
  })

  // 서버가 비동기로 가져온 미리보기가 SSE 로 오면 카드가 붙고(썸네일 실패면 글만), 빈 배열이 오면 걷힌다.
  test('SSE 로 미리보기가 오면 카드가 붙고, 빈 배열이면 걷힌다', async () => {
    const events = chatEvents()
    open({ imageStatus: 404 }, events)
    expect(await screen.findByTestId('message-body-12')).toBeInTheDocument()
    expect(screen.queryByTestId('link-previews-12')).not.toBeInTheDocument()
    await events.push('messaging.message.link-previews', {
      channelId: 1,
      id: 12,
      linkPreviews: [createLinkPreview({ url: 'https://docs.example.com/a', title: '설계 문서', siteName: 'docs.example.com', description: null, hasImage: true })],
    })
    expect(await screen.findByTestId('link-preview-title-12-0')).toHaveTextContent('설계 문서')
    await waitFor(() => expect(screen.queryByTestId('link-preview-image-12-0')).not.toBeInTheDocument())
    await events.push('messaging.message.link-previews', { channelId: 1, id: 12, linkPreviews: [] })
    await waitFor(() => expect(screen.queryByTestId('link-previews-12')).not.toBeInTheDocument())
  })
})

describe('첨부 뷰어 (WP-279)', () => {
  const LINK_TEXT = '링크로 공유한 회의록입니다'
  const att = (fileId: number, messageId: number, originalName: string, mimeType: string): MessageAttachment => ({
    fileId, messageId, originalName, mimeType, sizeBytes: 10, attachedById: 20, attachedByName: '동료', attachedAt: '2026-10-08T00:00:00Z',
  })
  const link = (driveFileId: number, name: string, availability: DriveLink['availability']): DriveLink => ({
    driveFileId, fileId: 900 + driveFileId, name, mimeType: 'text/plain', sizeBytes: 64, hasThumbnail: false,
    spaceId: 1, spaceName: '팀 공간', availability, createdById: 20, createdAt: '2026-10-08T00:00:00Z',
  })
  /** 메시지 10 의 묶음 4개(이미지·PDF·활성 링크 70·삭제된 링크 71) — e2e/fixtures/chat-viewer-mock 과 같은 구성. */
  const bundleMessage = createMessage({
    id: 10, channelId: 1, authorId: 20, authorName: '동료', body: '자료 공유합니다', createdAt: '2026-10-08T03:00:00Z',
    attachments: [att(801, 10, 'shot.png', 'image/png'), att(802, 10, '보고서.pdf', 'application/octet-stream')],
    driveLinks: [link(70, '회의록.txt', 'ACTIVE'), link(71, '지난자료.pdf', 'DELETED')],
  })
  const viewerHandlers = (summary: 'ok' | 'forbidden') => [
    http.get(`${API}/messaging/channels/1/messages/:mid/attachments/:fid/content`, () => new HttpResponse(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })),
    http.get(`${API}/messaging/channels/1/messages/:mid/drive-links/:id/content`, () => new HttpResponse(LINK_TEXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })),
    http.get(`${API}/drive/files/70/summary`, () =>
      summary === 'ok' ? HttpResponse.json({ summary: '링크 파일 요약', status: 'DONE' }) : HttpResponse.json({ message: 'forbidden' }, { status: 403 }),
    ),
    http.get(`${API}/drive/files/70/backlinks`, () => HttpResponse.json([])),
  ]
  const open = (summary: 'ok' | 'forbidden' = 'ok') =>
    openChannel(createChannel({ id: 1, member: true }), [bundleMessage], { handlers: viewerHandlers(summary) })

  // 원본이 삭제된 링크는 data-availability=DELETED·「원본 삭제됨」, 열면 받지 않고 안내만.
  test('원본이 삭제된 드라이브 링크는 「원본 삭제됨」으로 보이고 열면 안내만 나온다', async () => {
    const { user } = open()
    const gone = await screen.findByTestId('message-drive-link-71')
    expect(gone).toHaveAttribute('data-availability', 'DELETED')
    expect(within(gone).getByTestId('message-drive-link-gone-71')).toHaveTextContent('원본 삭제됨')
    expect(screen.getByTestId('message-drive-link-70')).not.toHaveTextContent('원본 삭제됨')
    await user.click(gone)
    expect(await screen.findByTestId('preview-unavailable')).toBeInTheDocument()
  })

  // ✨(AI 요약)는 활성 드라이브 링크만 — 링크 열람자에게 드라이브 권한이 없어 요약이 403 이면 숨긴다.
  test('드라이브 링크 요약이 403 이면 AI 요약 버튼을 숨긴다', async () => {
    const { user } = open('forbidden')
    await user.click(await screen.findByTestId('message-drive-link-70'))
    // 본문 칸은 뷰어와 함께 바로 생기고 텍스트는 콘텐츠 응답으로 채워진다 — 요소가 아니라 내용을 기다린다(WP-1032).
    await waitFor(() => expect(screen.getByTestId('preview-body')).toHaveTextContent(LINK_TEXT))
    expect(screen.getByTestId('preview-meta')).toHaveTextContent('3 / 4')
    await new Promise((r) => setTimeout(r, 200))
    expect(within(screen.getByTestId('attachment-viewer')).queryByRole('button', { name: 'AI 요약' })).not.toBeInTheDocument()
  })

  // 대조군 — 요약이 있으면 ✨ 가 보인다(위 숨김이 늘 숨김이 아님을 확인).
  test('요약이 있으면 AI 요약 버튼이 보인다', async () => {
    const { user } = open('ok')
    await user.click(await screen.findByTestId('message-drive-link-70'))
    expect(await within(await screen.findByTestId('attachment-viewer')).findByRole('button', { name: 'AI 요약' })).toBeInTheDocument()
  })

  // 그릴 메시지가 없는 낡은 열림 표식(history.state)은 지운다 — 보이지 않는 열림 항목이 뒤로가기를 헛돌게 하지 않게.
  test('목록에 없는 메시지의 열림 표식이 오면 지우고 뷰어를 열지 않는다', async () => {
    open()
    expect(await screen.findByTestId('message-drive-link-70')).toBeInTheDocument()
    act(() => {
      const st = window.history.state
      window.history.pushState({ ...st, usr: { ...(st?.usr ?? {}), teamChatPreview: 'msg:999:file:1' } }, '')
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    await waitFor(() => expect(window.history.state?.usr?.teamChatPreview ?? null).toBeNull())
    expect(screen.queryByTestId('attachment-viewer')).not.toBeInTheDocument()
  })
})
