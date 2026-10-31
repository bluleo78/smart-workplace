// 「채팅·이슈로 보내기」 대화상자(WP-1235) — 검색 → 받는 곳 고르기 → 미리보기·함께 보낼 말 → 보내기의 요청 모양과 결과.
// 앱 셸 대신 호스트(SendToChatHost)만 띄우고 openSendToChat 으로 연다 — 들어가는 길(토스트·⋯·⬆︎)은 각 화면 테스트가 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test } from 'vitest'

import { closeSendToChat, openSendToChat, readRecentDestinations } from '@/lib/sendToChat'
import type { ShareTarget } from '@/lib/shareTarget'
import { renderScreen } from '@/test/renderScreen'

import { createMember } from '../../../e2e/factories/auth.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createChannel } from '../../../e2e/factories/messaging.factory'
import { SendToChatHost } from './SendToChatHost'

const API = '/api/v1'
const ORIGIN = window.location.origin
const issueTarget: ShareTarget = { kind: 'issue', url: `${ORIGIN}/projects/WP/issues/7`, title: '결제 버그', key: 'WP-7' }
const eventTarget: ShareTarget = { kind: 'event', url: `${ORIGIN}/calendar?eventId=5`, title: '주간 회의' }
// renderScreen 의 고정 로그인 사용자(id 1)·워크스페이스(testAuthValue 의 activeTenant).
const owner = () => ({ userId: 1, tenantId: 1 })

type Posted = { url: string; body: unknown }
/** failMessage — 채널 글쓰기를 403 으로 막는다. holdMessage — 채널 글쓰기 응답을 이 약속이 풀릴 때까지 붙든다. */
type HandlerOpts = { failMessage?: boolean; holdMessage?: Promise<void> }

/** 대화상자가 부르는 조회 + 쓰기 요청을 모은다. */
function handlers(posted: Posted[], opts: HandlerOpts = {}) {
  return [
    http.get(`${API}/messaging/channels`, () =>
      HttpResponse.json([
        createChannel({ id: 10, name: '일반' }),
        createChannel({ id: 11, name: '개발' }),
        createChannel({ id: 12, name: '옛날', archived: true }),
      ]),
    ),
    http.get(`${API}/members`, ({ request }) => {
      const search = new URL(request.url).searchParams.get('search') ?? ''
      const all = [createMember({ userId: 2, name: '밥', username: 'bob' }), createMember({ userId: 3, name: '캐럴', username: 'carol' })]
      const content = all.filter((m) => m.name.includes(search) || m.username.includes(search))
      return HttpResponse.json({ content, page: 0, size: 5, totalElements: content.length, totalPages: 1 })
    }),
    http.get(`${API}/me/issues`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? ''
      const items = q.includes('로그인') ? [createIssue({ id: 900, projectKey: 'WP', number: 12, title: '로그인 오류' })] : []
      return HttpResponse.json(createIssueSearchResponse(items))
    }),
    http.get(`${API}/projects/WP/issues/12`, () =>
      HttpResponse.json({ summary: createIssue({ id: 900, projectKey: 'WP', number: 12, title: '로그인 오류' }) }),
    ),
    // 보낼 것(이슈 WP-7)의 카드 — 받는 쪽이 볼 카드와 같은 내용.
    http.get(`${API}/app-links/issues/WP/7`, () => HttpResponse.json({ kind: 'ISSUE', title: '결제 버그', issueKey: 'WP-7' })),
    http.post(`${API}/messaging/channels/:id/messages`, async ({ request, params }) => {
      posted.push({ url: `channels/${params.id}/messages`, body: await request.json() })
      if (opts.holdMessage) await opts.holdMessage
      if (opts.failMessage) return HttpResponse.json({ message: '채널에 글을 쓸 권한이 없습니다' }, { status: 403 })
      return HttpResponse.json({ id: 1 })
    }),
    http.post(`${API}/messaging/dms`, async ({ request }) => {
      posted.push({ url: 'dms', body: await request.json() })
      return HttpResponse.json({ id: 55, participants: [], lastMessageAt: null, unreadCount: 0, createdAt: '2026-10-01T00:00:00Z' })
    }),
    http.post(`${API}/issues/:id/comments`, async ({ request, params }) => {
      posted.push({ url: `issues/${params.id}/comments`, body: await request.json() })
      return HttpResponse.json({ id: 1 })
    }),
  ]
}

function open(target: ShareTarget, opts: HandlerOpts = {}) {
  const posted: Posted[] = []
  const view = renderScreen(<SendToChatHost />, { handlers: handlers(posted, opts) })
  act(() => openSendToChat(target))
  return { ...view, posted }
}

afterEach(() => {
  act(() => closeSendToChat())
  localStorage.clear()
})

describe('SendToChatDialog', () => {
  test('검색어가 없으면 최근 대상과 내 채널(보관 제외)을 보이고, 채널을 골라 함께 보낼 말과 링크를 보낸다', async () => {
    localStorage.setItem('send-to-chat.recent:1:1', JSON.stringify([{ kind: 'person', userId: 3, name: '캐럴' }]))
    const { user, posted, location } = open(issueTarget)
    const dialog = await screen.findByTestId('send-to-chat-dialog')
    expect(within(dialog).getByRole('heading', { name: '채팅·이슈로 보내기' })).toBeInTheDocument()
    expect(within(screen.getByTestId('send-to-chat-recent')).getByText('캐럴')).toBeInTheDocument()
    const channels = await screen.findByTestId('send-to-chat-channels')
    expect(within(channels).getAllByRole('button').map((b) => b.textContent)).toEqual(['일반', '개발'])
    // 고르기 전에는 보낼 수 없다.
    expect(screen.getByTestId('send-to-chat-submit')).toBeDisabled()

    await user.click(within(channels).getByText('일반'))
    expect(screen.getByTestId('send-to-chat-destination')).toHaveTextContent('#일반')
    // 보낼 것의 미리보기 — 받는 쪽이 볼 앱 링크 카드.
    expect(await screen.findByTestId('send-to-chat-preview-title')).toHaveTextContent('결제 버그')
    await user.type(screen.getByTestId('send-to-chat-note'), '이거 봐 주세요')
    await user.click(screen.getByTestId('send-to-chat-submit'))

    await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
    expect(posted).toEqual([{ url: 'channels/10/messages', body: { body: `이거 봐 주세요\n${issueTarget.url}` } }])
    expect(await screen.findByText('#일반 채널에 보냈어요')).toBeInTheDocument()
    // 보낸 곳이 최근 대상 맨 앞에 온다.
    expect(readRecentDestinations(owner())[0]).toEqual({ kind: 'channel', channelId: 10, name: '일반' })
    // 토스트 「보기」는 그 채널로 간다.
    await user.click(screen.getByRole('button', { name: '보기' }))
    expect(location()).toBe('/chat/channels/10')
  })

  test('사람을 검색해 고르면 DM 을 찾거나 만든 뒤 그 DM 에 링크만 보낸다', async () => {
    const { user, posted } = open(issueTarget)
    await user.type(await screen.findByTestId('send-to-chat-search'), '밥')
    const people = await screen.findByTestId('send-to-chat-people')
    expect(within(people).queryByText('캐럴')).not.toBeInTheDocument()
    await user.click(within(people).getByText('밥'))
    await user.click(screen.getByTestId('send-to-chat-submit'))
    await waitFor(() =>
      expect(posted).toEqual([
        { url: 'dms', body: { userIds: [2] } },
        { url: 'channels/55/messages', body: { body: issueTarget.url } },
      ]),
    )
    expect(await screen.findByText('밥 님에게 보냈어요')).toBeInTheDocument()
  })

  test('이슈는 제목으로도, 키(WP-12)로도 찾고 그 이슈 댓글로 보낸다', async () => {
    const { user, posted } = open(issueTarget)
    const search = await screen.findByTestId('send-to-chat-search')
    await user.type(search, '로그인')
    expect(await within(await screen.findByTestId('send-to-chat-issues')).findByText('로그인 오류')).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'wp-12')
    const issues = await screen.findByTestId('send-to-chat-issues')
    expect(within(issues).getByText('WP-12')).toBeInTheDocument()
    // Enter 는 맨 위 후보(키로 연 이슈)를 고른다 — 앞 검색어(로그인)의 결과가 남아 있으면 지금 검색어 결과가 올 때까지 기다렸다 고른다.
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('send-to-chat-destination')).toHaveTextContent('WP-12 로그인 오류')
    await user.click(screen.getByTestId('send-to-chat-submit'))
    await waitFor(() => expect(posted).toEqual([{ url: 'issues/900/comments', body: { body: issueTarget.url } }]))
    expect(await screen.findByText('WP-12 댓글로 보냈어요')).toBeInTheDocument()
  })

  test('찾는 것이 없으면 빈 안내를 보인다', async () => {
    const { user } = open(issueTarget)
    await user.type(await screen.findByTestId('send-to-chat-search'), '없는말')
    expect(await screen.findByTestId('send-to-chat-empty')).toHaveTextContent('찾는 채널·사람·이슈가 없어요')
  })

  test('「바꾸기」는 받는 곳 고르기로 돌아간다', async () => {
    const { user } = open(issueTarget)
    await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('개발'))
    await user.click(screen.getByTestId('send-to-chat-change'))
    expect(await screen.findByTestId('send-to-chat-search')).toBeInTheDocument()
    expect(screen.getByTestId('send-to-chat-submit')).toBeDisabled()
  })

  test('보내기에 실패하면 서버 오류를 알리고 창과 쓴 말을 그대로 둔다', async () => {
    const { user, posted } = open(issueTarget, { failMessage: true })
    await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
    await user.type(screen.getByTestId('send-to-chat-note'), '메모')
    await user.click(screen.getByTestId('send-to-chat-submit'))
    expect(await screen.findByText('채널에 글을 쓸 권한이 없습니다')).toBeInTheDocument()
    expect(posted).toHaveLength(1)
    expect(screen.getByTestId('send-to-chat-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('send-to-chat-note')).toHaveValue('메모')
    expect(screen.getByTestId('send-to-chat-submit')).toBeEnabled()
    expect(readRecentDestinations(owner())).toEqual([])
  })

  test('카드 종류가 아닌 대상(일정)은 대상 이름으로 미리보고 링크를 그대로 보낸다', async () => {
    const { user, posted } = open(eventTarget)
    await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
    const preview = screen.getByTestId('send-to-chat-preview')
    expect(preview).toHaveAttribute('data-state', 'fallback')
    expect(preview).toHaveTextContent('일정')
    expect(preview).toHaveTextContent('주간 회의')
    await user.click(screen.getByTestId('send-to-chat-submit'))
    await waitFor(() => expect(posted).toEqual([{ url: 'channels/10/messages', body: { body: eventTarget.url } }]))
  })

  test('검색 결과가 입력을 따라오기 전에 누른 Enter 는 앞 결과를 고르지 않고, 결과가 맞춰지면 맨 위 후보를 고른다', async () => {
    const { user } = open(issueTarget)
    await screen.findByTestId('send-to-chat-channels')
    // 디바운스(250ms) 전에 Enter — 빈 검색어의 맨 위 후보(#일반)를 고르면 안 된다.
    await user.type(screen.getByTestId('send-to-chat-search'), '밥{Enter}')
    expect(screen.queryByTestId('send-to-chat-destination')).not.toBeInTheDocument()
    // 사람 검색이 오면 그 Enter 로 「밥」을 고른다.
    expect(await screen.findByTestId('send-to-chat-destination')).toHaveTextContent('밥')
  })

  test('최근 대상의 나갔거나 보관된 채널은 숨긴다', async () => {
    localStorage.setItem(
      'send-to-chat.recent:1:1',
      JSON.stringify([
        { kind: 'channel', channelId: 12, name: '옛날' },
        { kind: 'channel', channelId: 99, name: '나간 곳' },
        { kind: 'channel', channelId: 11, name: '개발' },
      ]),
    )
    open(issueTarget)
    const recent = await screen.findByTestId('send-to-chat-recent')
    expect(within(recent).getAllByRole('button').map((b) => b.textContent)).toEqual(['개발'])
  })

  test('권한 없음(403)으로 실패한 곳은 최근 대상에서 뺀다', async () => {
    localStorage.setItem('send-to-chat.recent:1:1', JSON.stringify([{ kind: 'channel', channelId: 10, name: '일반' }]))
    const { user } = open(issueTarget, { failMessage: true })
    await user.click(within(await screen.findByTestId('send-to-chat-recent')).getByText('일반'))
    await user.click(screen.getByTestId('send-to-chat-submit'))
    expect(await screen.findByText('채널에 글을 쓸 권한이 없습니다')).toBeInTheDocument()
    expect(readRecentDestinations(owner())).toEqual([])
    await user.click(screen.getByTestId('send-to-chat-change'))
    await screen.findByTestId('send-to-chat-channels')
    expect(screen.queryByTestId('send-to-chat-recent')).not.toBeInTheDocument()
  })

  test('보내는 사이 다른 대상으로 다시 열면, 앞 보내기가 끝나도 새 창은 닫히지 않는다', async () => {
    let release!: () => void
    const hold = new Promise<void>((r) => (release = r))
    const { user, posted } = open(issueTarget, { holdMessage: hold })
    await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
    await user.click(screen.getByTestId('send-to-chat-submit'))
    await waitFor(() => expect(posted).toHaveLength(1))
    // 응답을 붙든 사이 다른 대상(일정)으로 다시 연다 — 새 창은 받는 곳 고르기부터.
    act(() => openSendToChat(eventTarget))
    expect(await screen.findByTestId('send-to-chat-search')).toBeInTheDocument()
    release()
    expect(await screen.findByText('#일반 채널에 보냈어요')).toBeInTheDocument()
    expect(screen.getByTestId('send-to-chat-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('send-to-chat-search')).toBeInTheDocument()
  })

  test('보내기를 같은 틱에 두 번 눌러도 한 번만 보낸다', async () => {
    const { user, posted } = open(issueTarget)
    await user.click(within(await screen.findByTestId('send-to-chat-channels')).getByText('일반'))
    const submit = screen.getByTestId('send-to-chat-submit')
    act(() => {
      submit.click()
      submit.click()
    })
    await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
    expect(posted).toHaveLength(1)
  })

  test('취소하면 아무것도 보내지 않고 닫힌다', async () => {
    const { user, posted } = open(issueTarget)
    await user.click(await screen.findByTestId('send-to-chat-cancel'))
    await waitFor(() => expect(screen.queryByTestId('send-to-chat-dialog')).not.toBeInTheDocument())
    expect(posted).toEqual([])
  })
})
