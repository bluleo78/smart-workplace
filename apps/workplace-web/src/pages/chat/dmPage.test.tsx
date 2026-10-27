// DM 화면·새 메시지(받는 사람 고르기)·나에게(self-DM) — 화면 테스트(WP-966, WP-995).
// 정지된 상대 안내·대화 없음/목록 오류 구분·빈 상태 문구·AGENT 배지·받는 사람 7명 상한·kind=ALL 검색·칩 제거·
// 「보관됨」 오표시 금지·첨부만 보내기의 DM 생성 → 업로드 → 전송 순서·self-DM 리다이렉트는 브라우저 없이 판정되므로
// e2e/pages/chat/{chat-dm,messaging-compose-selfdm,messaging-phase-c}.spec.ts 에서 옮겼다.
// 그 spec 들에는 받는 사람 입력의 포커스·키보드 탐색(@input), 에디터에 글자를 쳐서 보내는 흐름(@input·@flow), 헤더 정렬·잘림(@layout)이 남는다.
// 채팅 라우트만 renderScreen 으로 띄운다(testkit-b5).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { testAuthValue } from '@/test/renderWithProviders'
import type { DmResponse } from '@/types/messaging'

import { createChannel, createDm, createDmParticipant, createMessage } from '../../../e2e/factories/messaging.factory'

const MY_NAME = '테스트 사용자'
/** E2E 의 로그인 사용자와 같은 이름 — 셀프 DM 라벨 「테스트 사용자 (나)」를 그대로 단언한다. */
const auth = { user: { ...testAuthValue.user!, name: MY_NAME } }

/** DM 하나를 연다 — DM 목록과 채널 상세(DM 도 채널이다)를 함께 준다. */
function openDm(dm: DmResponse, messages = [] as ReturnType<typeof createMessage>[], handlers = [] as ReturnType<typeof http.get>[]) {
  return renderChat(`/chat/dms/${dm.id}`, {
    auth,
    dms: [dm],
    channels: [],
    handlers: [http.get(`${API}/messaging/channels/${dm.id}`, () => HttpResponse.json(createChannel({ id: dm.id, kind: 'DM', member: true }))), ...handlers],
    messages: { [dm.id]: messages },
  })
}

/** 구성원 디렉터리(/members) — 실제 백엔드처럼 search 로 이름·아이디를 거르고, 요청 주소를 기록한다. */
function membersHandler(content: { userId: number; name: string; username: string; kind: 'HUMAN' | 'AGENT' }[], urls: URL[] = []) {
  return http.get(`${API}/members`, ({ request }) => {
    const url = new URL(request.url)
    urls.push(url)
    const search = url.searchParams.get('search') ?? ''
    const matched = content.filter((m) => m.name.includes(search) || m.username.includes(search))
    return HttpResponse.json({ content: matched, totalElements: matched.length })
  })
}

describe('DM 화면', () => {
  // WP-723: 정지된 상대와의 DM — 헤더 「비활성」, 입력창 대신 보낼 수 없다는 안내, 지난 대화는 읽힌다.
  test('정지된 상대 — 비활성 배지와 보낼 수 없다는 안내, 지난 메시지는 보인다', async () => {
    openDm(
      createDm({ id: 105, participants: [createDmParticipant({ userId: 1, name: '나', active: true }), createDmParticipant({ userId: 2, name: '퇴사자', active: false })] }),
      [createMessage({ id: 9, channelId: 105, authorId: 1, body: '퇴사 전 메시지' })],
    )
    expect(await screen.findByTestId('dm-title')).toHaveTextContent('퇴사자')
    expect(screen.getByTestId('dm-inactive-badge')).toHaveTextContent('비활성')
    expect(await screen.findByTestId('composer-blocked-notice')).toHaveTextContent('비활성화된 구성원이라 메시지를 보낼 수 없습니다')
    expect(await screen.findByTestId('message-body-9')).toHaveTextContent('퇴사 전 메시지')
    expect(screen.queryByTestId('message-composer-input')).not.toBeInTheDocument()
  })

  // 내 DM 목록에 없는 id 로 들어오면 「대화 없음」.
  test('참여하지 않은 DM 은 대화 없음', async () => {
    renderChat('/chat/dms/999', { auth })
    expect(await screen.findByTestId('dm-not-found')).toBeInTheDocument()
  })

  // #190: 목록 조회 실패는 「대화를 찾을 수 없음」이 아니라 오류로 보인다.
  test('DM 목록 API 가 500 이면 오류 안내를 보이고 대화 없음으로 오표시하지 않는다', async () => {
    renderChat('/chat/dms/100', { auth, handlers: [http.get(`${API}/messaging/dms`, () => new HttpResponse('Internal Server Error', { status: 500 }))] })
    expect(await screen.findByTestId('dm-load-error')).toHaveTextContent('대화 목록을 불러오지 못했습니다')
    expect(screen.queryByTestId('dm-not-found')).not.toBeInTheDocument()
  })

  // 빈 DM — 1:1 은 상대 이름, 셀프 DM 은 「나에게만 보이는 공간」.
  test('1:1 DM 빈 상태에 상대 이름이 들어간다', async () => {
    openDm(createDm({ id: 900, participants: [createDmParticipant({ userId: 1, name: MY_NAME }), createDmParticipant({ userId: 2, name: '홍길동' })] }))
    expect(await screen.findByTestId('chat-empty-state')).toHaveTextContent('홍길동 님과의 메시지 시작입니다.')
  })

  test('셀프 DM 빈 상태는 「나에게만 보이는 공간입니다.」', async () => {
    openDm(createDm({ id: 901, participants: [createDmParticipant({ userId: 1, name: MY_NAME })] }))
    expect(await screen.findByTestId('chat-empty-state')).toHaveTextContent('나에게만 보이는 공간입니다.')
  })

  // AGENT 와의 DM 은 헤더에 에이전트 배지.
  test('AGENT DM 헤더에 에이전트 배지', async () => {
    openDm(createDm({ id: 902, participants: [createDmParticipant({ userId: 1, name: MY_NAME }), createDmParticipant({ userId: 50, name: 'AI 어시스턴트', kind: 'AGENT' })] }))
    const header = await screen.findByTestId('dm-header')
    expect(within(header).getByTestId('agent-badge')).toBeInTheDocument()
  })
})

describe('새 메시지 — 받는 사람', () => {
  /** /chat/new 를 열고 받는 사람 입력에 검색어를 붙여 넣는다. */
  async function search(view: ReturnType<typeof renderChat>, q: string) {
    const input = await screen.findByTestId('new-message-recipient-input')
    await view.user.clear(input)
    await view.user.click(input)
    await view.user.paste(q)
    return input
  }

  // 접근성: 받는 사람 입력은 「받는 사람 검색」 이름의 combobox, 후보 목록은 한국어 이름(cmdk 기본 「Suggestions」 아님, WP-731).
  test('받는 사람 입력을 이름으로 찾고, 후보 목록은 「받는 사람 후보」로 읽힌다', async () => {
    const view = renderChat('/chat/new', { auth, handlers: [membersHandler([{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])] })
    expect(await screen.findByRole('combobox', { name: '받는 사람 검색' })).toBeInTheDocument()
    expect(screen.getAllByLabelText('받는 사람 검색')).toHaveLength(1)
    await search(view, '밥')
    expect(await screen.findByTestId('member-search-row-2')).toBeInTheDocument()
    expect(screen.getByRole('listbox', { name: '받는 사람 후보' })).toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: 'Suggestions' })).not.toBeInTheDocument()
  })

  // #691: 받는 사람 검색은 kind=ALL — 에이전트도 후보·칩에 나온다.
  test('검색은 kind=ALL 로 요청해 AGENT 도 후보·칩에 나온다', async () => {
    const urls: URL[] = []
    const view = renderChat('/chat/new', {
      auth,
      handlers: [
        http.get(`${API}/members`, ({ request }) => {
          const url = new URL(request.url)
          urls.push(url)
          const users = url.searchParams.get('kind') === 'ALL' ? [{ userId: 9, name: 'My AI', username: 'myai', kind: 'AGENT' }] : []
          return HttpResponse.json({ content: users, totalElements: users.length })
        }),
      ],
    })
    await search(view, 'My AI')
    const row = await screen.findByTestId('member-search-row-9')
    expect(urls.at(-1)?.searchParams.get('kind')).toBe('ALL')
    expect(row).toHaveTextContent('My AI')
    await view.user.click(row)
    expect(await screen.findByTestId('recipient-chip-9')).toHaveTextContent('My AI')
  })

  // #118: 받는 사람이 없을 땐 시작 안내만(「보관됨」 오표시·입력기 없음), 한 명 고르면 입력기가 뜬다.
  test('받는 사람이 없으면 「보관됨」 없이 안내만, 고르면 입력기가 뜬다', async () => {
    const view = renderChat('/chat/new', { auth, handlers: [membersHandler([{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])] })
    expect(await screen.findByText('받는 사람을 추가하면 대화를 시작할 수 있어요.')).toBeInTheDocument()
    expect(screen.queryByText('이 채널은 보관되었습니다')).not.toBeInTheDocument()
    expect(screen.queryByTestId('message-composer-input')).not.toBeInTheDocument()
    await search(view, '밥')
    await view.user.click(await screen.findByTestId('member-search-row-2'))
    expect(await screen.findByTestId('message-composer-input')).toBeInTheDocument()
    expect(screen.queryByText('이 채널은 보관되었습니다')).not.toBeInTheDocument()
  })

  // #314: 칩의 ✕(「밥 제거」)는 눌리는 버튼이고 누르면 칩이 빠진다.
  test('칩의 제거 버튼을 누르면 칩이 사라진다', async () => {
    const view = renderChat('/chat/new', { auth, handlers: [membersHandler([{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])] })
    await search(view, '밥')
    await view.user.click(await screen.findByTestId('member-search-row-2'))
    const chip = await screen.findByTestId('recipient-chip-2')
    const remove = within(chip).getByRole('button', { name: '밥 제거' })
    expect(remove).toBeEnabled()
    await view.user.click(remove)
    expect(screen.queryByTestId('recipient-chip-2')).not.toBeInTheDocument()
  })

  // 본인 포함 8명 상한 — 7명을 고르면 후보 자리에 안내가 뜨고 더 추가되지 않는다. 입력은 살아 있어 Backspace 로 지우면 다시 고른다(#883).
  test('받는 사람은 7명까지 — 8번째는 안내만 뜨고 추가되지 않는다', async () => {
    const people = ['밥', '캐럴', '데이브', '이브', '프랭크', '그레이스', '하이디'].map((name, i) => ({ userId: i + 2, name, username: `u${i + 2}`, kind: 'HUMAN' as const }))
    const extra = { userId: 9, name: '아이반', username: 'ivan', kind: 'HUMAN' as const }
    const view = renderChat('/chat/new', { auth, handlers: [membersHandler([...people, extra])] })
    for (const p of people) {
      await search(view, p.name)
      await view.user.click(await screen.findByTestId(`member-search-row-${p.userId}`))
      expect(await screen.findByTestId(`recipient-chip-${p.userId}`)).toBeInTheDocument()
    }
    const input = await search(view, extra.name)
    expect(await screen.findByTestId('recipient-limit-notice')).toHaveTextContent('최대 7명까지 선택할 수 있습니다')
    expect(screen.queryByTestId(`member-search-row-${extra.userId}`)).not.toBeInTheDocument()
    await view.user.keyboard('{Enter}')
    const chips = () => within(screen.getByTestId('new-message-recipients')).queryAllByTestId(/^recipient-chip-/)
    expect(chips()).toHaveLength(7)
    expect(input).toBeEnabled()
    await view.user.clear(input)
    await view.user.keyboard('{Backspace}')
    await waitFor(() => expect(chips()).toHaveLength(6))
    expect(screen.queryByTestId('recipient-limit-notice')).not.toBeInTheDocument()
    expect(await screen.findByTestId(`member-search-row-${extra.userId}`)).toBeInTheDocument()
  })

  // WP-99: 새 메시지의 첨부는 고를 때 올리지 않는다(아직 DM 이 없어 channels/0 업로드가 403). 보내면 DM 생성 → 그 DM 으로 업로드 → 실제 fileId 로 전송.
  test('첨부만 보내면 DM 생성 → 업로드 → 전송 순서로 가고 channels/0 업로드는 없다', async () => {
    const DM_ID = 201
    const dm = createDm({ id: DM_ID, participants: [createDmParticipant({ userId: 1, name: MY_NAME }), createDmParticipant({ userId: 2, name: '밥' })] })
    const steps: string[] = []
    const sends: unknown[] = []
    let created = false
    const view = renderChat('/chat/new', {
      auth,
      handlers: [
        membersHandler([{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }]),
        http.post(`${API}/messaging/channels/0/attachments`, () => {
          steps.push('zero')
          return HttpResponse.json({}, { status: 403 })
        }),
        http.get(`${API}/messaging/dms`, () => HttpResponse.json(created ? [dm] : [])),
        http.post(`${API}/messaging/dms`, async ({ request }) => {
          steps.push('dm')
          expect(await request.json()).toEqual({ userIds: [2] })
          created = true
          return HttpResponse.json(dm, { status: 201 })
        }),
        http.get(`${API}/messaging/channels/${DM_ID}`, () => HttpResponse.json(createChannel({ id: DM_ID, kind: 'DM', member: true }))),
        http.post(`${API}/messaging/channels/${DM_ID}/attachments`, () => {
          steps.push('upload')
          return HttpResponse.json([{ fileId: 77, originalName: 'report.txt', mimeType: 'text/plain', sizeBytes: 5 }])
        }),
        http.post(`${API}/messaging/channels/${DM_ID}/messages`, async ({ request }) => {
          steps.push('message')
          sends.push(await request.json())
          return HttpResponse.json(createMessage({ id: 11, channelId: DM_ID, authorId: 1, body: '' }), { status: 201 })
        }),
      ],
    })
    await search(view, '밥')
    await view.user.click(await screen.findByTestId('member-search-row-2'))
    await view.user.upload(await screen.findByTestId('composer-file-input'), new File(['hello'], 'report.txt', { type: 'text/plain' }))
    expect(await screen.findByTestId('composer-attachments')).toHaveTextContent('report.txt')
    expect(steps).toEqual([])
    await view.user.click(screen.getByTestId('message-composer-submit'))
    await waitFor(() => expect(view.location()).toBe(`/chat/dms/${DM_ID}`))
    expect(steps).toEqual(['dm', 'upload', 'message'])
    expect(sends).toEqual([expect.objectContaining({ fileIds: [77] })])
  })
})

describe('나에게(self-DM)', () => {
  // 사이드바 「테스트 사용자 (나)」 → /chat/dms/self 가 POST {userIds:[나]} 로 찾거나 만들고 그 DM 으로 간다.
  test('셀프 DM 링크를 누르면 POST {userIds:[1]} 후 그 DM 으로 가고 제목은 「이름 (나)」', async () => {
    const SELF_DM_ID = 300
    const selfDm = createDm({ id: SELF_DM_ID, participants: [createDmParticipant({ userId: 1, name: MY_NAME })] })
    const posts: unknown[] = []
    let created = false
    const view = renderChat('/chat', {
      auth,
      handlers: [
        http.get(`${API}/messaging/dms`, () => HttpResponse.json(created ? [selfDm] : [])),
        http.post(`${API}/messaging/dms`, async ({ request }) => {
          posts.push(await request.json())
          created = true
          return HttpResponse.json(selfDm, { status: 201 })
        }),
        http.get(`${API}/messaging/channels/${SELF_DM_ID}`, () => HttpResponse.json(createChannel({ id: SELF_DM_ID, kind: 'DM', member: true }))),
      ],
    })
    const selfLink = await screen.findByTestId('dm-self-link')
    expect(selfLink).toHaveTextContent(`${MY_NAME} (나)`)
    await view.user.click(selfLink)
    await waitFor(() => expect(view.location()).toBe(`/chat/dms/${SELF_DM_ID}`))
    expect(posts).toEqual([{ userIds: [1] }])
    expect(await screen.findByTestId('dm-title')).toHaveTextContent(`${MY_NAME} (나)`)
  })
})
