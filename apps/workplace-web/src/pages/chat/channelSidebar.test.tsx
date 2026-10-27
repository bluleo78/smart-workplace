// 대화 사이드바(채널·DM 목록)·채널 만들기/탐색·첫 화면·스레드 인박스 빈 상태 — 화면 테스트(WP-966, WP-995).
// 채널 만들기 payload·409 인라인 에러·탐색 후 참여 반영·자물쇠·DM 아바타/에이전트 배지·표준 LNB 제목·전환 클래스·첫 화면 CTA·
// 인박스 빈 상태는 브라우저 없이 판정되므로 e2e/pages/chat/{chat-channel-crud,chat,chat-dm,chat-members,messaging-phase-c,
// messaging-threads-inbox}.spec.ts 에서 옮겼다. 선택 행의 실제 배경색·배지 잘림·정렬(@layout)은 그 spec 들에 남는다.
// 채팅 라우트만 renderScreen 으로 띄운다(testkit-b5) — 사이드바에서 채널을 만들면 그 채널 화면으로 가는지까지 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { testAuthValue } from '@/test/renderWithProviders'

import { createChannel, createDm, createDmParticipant } from '../../../e2e/factories/messaging.factory'

const auth = { user: { ...testAuthValue.user!, name: '테스트 사용자' } }

describe('채널 만들기', () => {
  /** /chat 에서 만들기 대화상자를 열고 이름을 넣는다. */
  async function openCreate(handlers: ReturnType<typeof http.post>[]) {
    const view = renderChat('/chat', { auth, handlers })
    await view.user.click(await screen.findByTestId('channel-create-btn'))
    await view.user.click(await screen.findByTestId('create-channel-name'))
    return view
  }

  // WP-816·WP-814: 채널을 고르기 전 첫 화면에도 숨은 h1 「대화」, 탭 제목은 화면 이름. 공개 채널을 만들면 새 채널로 가고 탭 제목이 채널 이름이 된다.
  test('공개 채널을 만들면 {name, PUBLIC} 을 보내고 새 채널로 간다', async () => {
    const created = createChannel({ id: 7, name: '신규채널', visibility: 'PUBLIC', role: 'OWNER' })
    const bodies: unknown[] = []
    const view = await openCreate([
      http.post(`${API}/messaging/channels`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(created, { status: 201 })
      }),
      http.get(`${API}/messaging/channels/7`, () => HttpResponse.json(created)),
    ])
    expect(screen.getByRole('heading', { level: 1, name: '대화', hidden: true })).toBeInTheDocument()
    expect(document.title).toBe('대화 · Gen:iA Works')
    await view.user.paste('신규채널')
    await view.user.click(screen.getByTestId('create-channel-submit'))
    await waitFor(() => expect(view.location()).toBe('/chat/channels/7'))
    expect(bodies).toEqual([{ name: '신규채널', visibility: 'PUBLIC' }])
    await waitFor(() => expect(document.title).toBe('# 신규채널 · 대화 · Gen:iA Works'))
  })

  test('비공개를 고르면 visibility=PRIVATE 로 보낸다', async () => {
    const created = createChannel({ id: 8, name: '비밀', visibility: 'PRIVATE', role: 'OWNER' })
    const bodies: unknown[] = []
    const view = await openCreate([
      http.post(`${API}/messaging/channels`, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(created, { status: 201 })
      }),
      http.get(`${API}/messaging/channels/8`, () => HttpResponse.json(created)),
    ])
    await view.user.paste('비밀')
    await view.user.click(screen.getByTestId('create-channel-visibility-private'))
    await view.user.click(screen.getByTestId('create-channel-submit'))
    await waitFor(() => expect(view.location()).toBe('/chat/channels/8'))
    expect(bodies).toEqual([{ name: '비밀', visibility: 'PRIVATE' }])
  })

  // #688: 이름 중복 409 는 대화상자를 유지한 채 인라인 에러, 이름을 고치면 에러가 사라진다.
  test('이름이 중복(409)이면 인라인 에러, 대화상자 유지, 고치면 에러가 사라진다', async () => {
    const view = await openCreate([
      http.post(`${API}/messaging/channels`, () => HttpResponse.json({ message: '이미 존재하는 채널 이름입니다: 중복채널' }, { status: 409 })),
    ])
    await view.user.paste('중복채널')
    await view.user.click(screen.getByTestId('create-channel-submit'))
    expect(await screen.findByTestId('create-channel-name-error')).toHaveTextContent('이미 존재하는 채널 이름입니다: 중복채널')
    expect(screen.getByTestId('create-channel-modal')).toBeInTheDocument()
    expect(view.location()).toBe('/chat')
    await view.user.type(screen.getByTestId('create-channel-name'), '2')
    expect(screen.queryByTestId('create-channel-name-error')).not.toBeInTheDocument()
  })
})

describe('채널 탐색·목록', () => {
  // 탐색에서 참여하면 내 채널 목록을 다시 불러 사이드바에 나타난다.
  test('탐색 → 참여하면 사이드바에 그 채널이 나타난다', async () => {
    let joined = false
    const target = createChannel({ id: 30, name: '공개방', visibility: 'PUBLIC', member: false, role: null })
    const view = renderChat('/chat', {
      auth,
      handlers: [
        http.get(`${API}/messaging/channels`, () => HttpResponse.json(joined ? [{ ...target, member: true, role: 'MEMBER' }] : [])),
        http.get(`${API}/messaging/channels/discover`, () => HttpResponse.json([target])),
        http.post(`${API}/messaging/channels/30/join`, () => {
          joined = true
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    await view.user.click(await screen.findByTestId('channel-browse-btn'))
    expect(await screen.findByTestId('channel-browser')).toBeInTheDocument()
    await view.user.click(await screen.findByTestId('channel-browser-join-30'))
    expect(await screen.findByTestId('channel-link-30')).toBeInTheDocument()
  })

  // 비공개 채널(초대받아 들어온 채널 포함)은 자물쇠로 표시한다.
  test('비공개 채널은 사이드바에 자물쇠로 표시', async () => {
    renderChat('/chat', { auth, channels: [createChannel({ id: 9, name: '비공개방', visibility: 'PRIVATE', member: true })] })
    expect(await screen.findByTestId('channel-lock-9')).toBeInTheDocument()
    expect(screen.getByTestId('channel-link-9')).toHaveTextContent('비공개방')
  })

  // #98: 표준 LNB — 레일과 같은 「대화」 제목 헤더. #297: 채널·셀프 DM 링크는 hover 전환(transition-colors). WP-135: 미리보기 행은 모바일 전용.
  test('표준 「대화」 제목 헤더, 링크 전환 클래스, 데스크톱엔 미리보기 행이 없다', async () => {
    renderChat('/chat', { auth, channels: [createChannel({ id: 1, member: true })] })
    const sidebar = await screen.findByTestId('channel-sidebar')
    expect(within(sidebar).getByText('대화', { exact: true })).toBeInTheDocument()
    expect(await screen.findByTestId('channel-link-1')).toHaveClass('transition-colors')
    expect(screen.queryByTestId('conv-preview-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('dm-self-link')).toHaveClass('transition-colors')
  })

  // 첫 화면(채널·DM 미선택)의 「새 메시지」 CTA 는 /chat/new 링크.
  test('첫 화면의 「새 메시지」 CTA 는 /chat/new 로 간다', async () => {
    renderChat('/chat', { auth })
    expect(await screen.findByTestId('channel-empty-new-message')).toHaveAttribute('href', '/chat/new')
  })
})

describe('DM 목록', () => {
  // #298: DM 마다 상대를 알아볼 아바타 — 셀프는 본인 이니셜, 1:1 은 상대, AI 는 상대 아바타 + 에이전트 배지, 그룹은 첫 상대. 같은 말풍선 아이콘은 없다.
  test('DM 항목은 상대 아바타로 구분되고 AI DM 엔 에이전트 배지', async () => {
    const me = createDmParticipant({ userId: 1, name: '테스트 사용자' })
    renderChat('/chat', {
      auth,
      dms: [
        createDm({ id: 2, participants: [me, createDmParticipant({ userId: 2, name: '밥' })] }),
        createDm({ id: 3, participants: [me, createDmParticipant({ userId: 10, name: 'My AI', kind: 'AGENT' })] }),
        createDm({ id: 4, participants: [me, createDmParticipant({ userId: 2, name: '밥' }), createDmParticipant({ userId: 3, name: '캐럴' })] }),
      ],
    })
    expect(within(await screen.findByTestId('dm-self-link')).getByTestId('user-avatar-1')).toHaveTextContent('테')
    expect(within(await screen.findByTestId('dm-link-2')).getByTestId('user-avatar-2')).toHaveTextContent('밥')
    const ai = screen.getByTestId('dm-link-3')
    expect(within(ai).getByTestId('user-avatar-10')).toBeInTheDocument()
    expect(within(ai).getByTestId('agent-badge')).toBeInTheDocument()
    expect(within(screen.getByTestId('dm-link-4')).getByTestId('user-avatar-2')).toBeInTheDocument()
    expect(screen.getByTestId('dm-list').querySelector('svg.lucide-message-square')).toBeNull()
  })
})

describe('스레드 인박스', () => {
  // 미읽음 스레드가 없으면 빈 상태, 사이드바 스레드 배지도 없다.
  test('미읽음 스레드가 없으면 빈 상태가 보이고 배지가 없다', async () => {
    renderChat('/chat/threads/inbox', {
      auth,
      channels: [createChannel({ id: 901, name: '빈채널' })],
      handlers: [http.get(`${API}/messaging/threads/inbox`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false }))],
    })
    expect(await screen.findByTestId('threads-inbox-page')).toBeInTheDocument()
    expect(await screen.findByText('새 스레드 답글이 없어요')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar-threads-badge')).not.toBeInTheDocument()
  })
})
