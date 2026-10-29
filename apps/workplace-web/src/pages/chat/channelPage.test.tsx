// 채널 화면(헤더·설정·멤버 패널·파일 드로워·제안 카드·빈 상태·입력창 첨부) — 화면 테스트(WP-966, WP-995).
// 권한별 설정 노출·보관 채널 읽기 전용·이름 변경/삭제 payload 와 409·404·멤버 초대/역할/제거/나가기·드로워 폴더 주소·
// 제안 카드 승인/거부 payload·일정 제안 KST 표시와 범위 검사·빈 상태 문구·업로드 중 전송 차단·25MB 거름은 브라우저 없이 판정되므로
// e2e/pages/chat/{chat-channel-crud,chat-members,channel-drive-space,channel-proposal,channel-calendar-proposal,
// messaging-phase-c,messaging-composer-upload,messaging-phase6}.spec.ts 에서 옮겼다.
// 그 spec 들에는 긴 이름 잘림·칸 배치(@layout)와 에디터에 글자를 치는 흐름(@input)만 남는다. 채널 화면 배선(@wiring)은 chat.spec.ts.
// 채팅 라우트만 renderScreen 으로 띄운다(testkit-b5) — 다른 화면(드라이브)으로의 이동은 도착 주소만 본다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { DrivePage } from '@/pages/drive/DrivePage'
import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { renderScreen } from '@/test/renderScreen'
import type { ChannelResponse, MessageProposal, MessageResponse } from '@/types/messaging'

import { createChannel, createChannelMember, createMessage, createReaction } from '../../../e2e/factories/messaging.factory'

/** 채널 하나를 연다 — 목록·상세가 같은 채널, 메시지는 messages. */
function openChannel(channel: ChannelResponse, opts: Omit<NonNullable<Parameters<typeof renderChat>[1]>, 'channels'> = {}) {
  return renderChat(`/chat/channels/${channel.id}`, { ...opts, channels: [channel] })
}

/** 요청 본문을 모으는 쓰기 핸들러. */
function capture<T = unknown>(method: 'post' | 'patch' | 'delete', path: string, reply: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const bodies: T[] = []
  const handler = http[method](`${API}${path}`, async ({ request }) => {
    const text = await request.text()
    bodies.push((text ? JSON.parse(text) : null) as T)
    return reply()
  })
  return { bodies, handler }
}

describe('채널 헤더·설정', () => {
  // WP-814: 채널을 열면 탭 제목이 「# 채널 · 대화」, 채널명은 h1(refs #121), 헤더는 h-14.
  test('채널 이름이 h1·탭 제목으로 보이고 OWNER 설정에 이름 변경이 있다', async () => {
    const { user } = openChannel(createChannel({ id: 45, name: '헤더테스트', role: 'OWNER', member: true }))
    const header = await screen.findByTestId('channel-header')
    expect(within(header).getByRole('heading', { level: 1, name: '헤더테스트' })).toBeInTheDocument()
    expect(header).toHaveClass('h-14')
    await waitFor(() => expect(document.title).toBe('# 헤더테스트 · 대화 · Gen:iA Works'))
    await user.click(screen.getByTestId('channel-settings-btn'))
    expect(await screen.findByTestId('channel-rename-action')).toBeInTheDocument()
  })

  // 채널 관리 권한이 없는 MEMBER 에게는 설정 드롭다운이 없다.
  test('MEMBER 에게는 설정 버튼이 없다', async () => {
    openChannel(createChannel({ id: 42, name: '일반방', role: 'MEMBER', member: true }))
    expect(await screen.findByTestId('channel-header')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-settings-btn')).not.toBeInTheDocument()
  })

  // WP-1132: 메뉴는 서버 권한과 같다 — 채널 ADMIN 은 이름 변경만(보관·보관 해제는 OWNER·시스템 ADMIN 만 서버가 받는다).
  test('채널 ADMIN 설정에는 이름 변경만 있고 보관은 없다', async () => {
    const { user } = openChannel(createChannel({ id: 49, name: '관리방', role: 'ADMIN', member: true }))
    await user.click(await screen.findByTestId('channel-settings-btn'))
    expect(await screen.findByTestId('channel-rename-action')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-archive-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('channel-delete-action')).not.toBeInTheDocument()
  })

  // 보관된 채널의 ADMIN 은 이름 변경도 보관 해제도 할 수 없다 — 빈 드롭다운 대신 설정 버튼을 두지 않는다.
  test('보관된 채널의 채널 ADMIN 에게는 설정 버튼이 없다', async () => {
    openChannel(createChannel({ id: 50, name: '보관관리방', archived: true, role: 'ADMIN', member: true }))
    expect(await screen.findByTestId('channel-header')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-settings-btn')).not.toBeInTheDocument()
  })

  // 시스템 ADMIN 은 채널 역할과 무관하게 보관·삭제를 할 수 있다(requireOwner 의 시스템 ADMIN 오버라이드).
  test('시스템 ADMIN 은 채널 MEMBER 여도 보관과 삭제가 보인다', async () => {
    const { user } = openChannel(createChannel({ id: 51, name: '전체방', role: 'MEMBER', member: true }), {
      auth: { isAdmin: true },
    })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    expect(await screen.findByTestId('channel-archive-action')).toBeInTheDocument()
    expect(screen.getByTestId('channel-delete-action')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-rename-action')).not.toBeInTheDocument()
  })

  // OWNER 이름 변경 — PATCH payload 와 성공 뒤 헤더 갱신(상세 재조회).
  test('OWNER 가 이름을 바꾸면 PATCH {name} 을 보내고 헤더가 새 이름이 된다', async () => {
    let renamed = false
    const ch = createChannel({ id: 41, name: '구이름', role: 'OWNER', member: true })
    const patch = capture('patch', '/messaging/channels/41', () => {
      renamed = true
      return HttpResponse.json({ ...ch, name: '새이름' })
    })
    const { user } = openChannel(ch, {
      handlers: [patch.handler, http.get(`${API}/messaging/channels/41`, () => HttpResponse.json(renamed ? { ...ch, name: '새이름' } : ch))],
    })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-rename-action'))
    const input = await screen.findByTestId('rename-channel-name')
    await user.clear(input)
    await user.paste('새이름')
    await user.click(screen.getByTestId('rename-channel-submit'))
    await waitFor(() => expect(screen.getByTestId('channel-header-name')).toHaveTextContent('새이름'))
    expect(patch.bodies).toEqual([{ name: '새이름' }])
  })

  // #688: 이름 중복 409 는 대화상자를 유지한 채 인라인 에러, 헤더는 그대로.
  test('이름 변경이 409 면 인라인 에러를 보이고 대화상자·헤더가 그대로다', async () => {
    const { user } = openChannel(createChannel({ id: 47, name: '구이름', role: 'OWNER', member: true }), {
      handlers: [
        http.patch(`${API}/messaging/channels/47`, () =>
          HttpResponse.json({ message: '이미 존재하는 채널 이름입니다: 다른채널' }, { status: 409 }),
        ),
      ],
    })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-rename-action'))
    const input = await screen.findByTestId('rename-channel-name')
    await user.clear(input)
    await user.paste('다른채널')
    await user.click(screen.getByTestId('rename-channel-submit'))
    expect(await screen.findByTestId('rename-channel-name-error')).toHaveTextContent('이미 존재하는 채널 이름입니다: 다른채널')
    expect(screen.getByTestId('rename-channel-modal')).toBeInTheDocument()
    expect(screen.getByTestId('channel-header-name')).toHaveTextContent('구이름')
  })

  // #142·WP-525: 삭제 확인은 destructive 버튼이고, 연동 드라이브 파일도 지워진다고 알린다. 시스템 ADMIN 은 MEMBER 여도 삭제할 수 있다.
  test('시스템 ADMIN — 삭제 확인(destructive·드라이브 안내) 후 DELETE 하고 /chat 으로 간다', async () => {
    const del = capture('delete', '/messaging/channels/44')
    const { user, location } = openChannel(createChannel({ id: 44, name: '삭제대상', role: 'MEMBER', member: true }), {
      auth: { isAdmin: true },
      handlers: [del.handler],
    })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-delete-action'))
    const confirm = await screen.findByTestId('channel-delete-confirm')
    expect(confirm.className).toMatch(/bg-destructive/)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('채널 드라이브의 파일도 함께 삭제됩니다')
    await user.click(confirm)
    await waitFor(() => expect(location()).toBe('/chat'))
    expect(del.bodies).toHaveLength(1)
  })

  // 비공개 비멤버(404)·숫자가 아닌 번호(WP-925)는 채널 없음 안내 — 「불러오는 중…」·「다시 시도」에 멈추지 않는다.
  test('404 면 채널 없음 안내', async () => {
    renderChat('/chat/channels/43', { channels: [] })
    expect(await screen.findByTestId('channel-not-found')).toBeInTheDocument()
  })

  test('채널 번호가 숫자가 아니면 채널 없음 안내만 있고 「다시 시도」는 없다', async () => {
    renderChat('/chat/channels/abc')
    const notFound = await screen.findByTestId('channel-not-found')
    expect(screen.queryByText('불러오는 중…')).not.toBeInTheDocument()
    expect(within(notFound).queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })
})

describe('보관 채널', () => {
  // Phase 4: 보관 채널은 입력기 대신 안내만.
  test('보관 배지와 안내가 보이고 입력기는 없다', async () => {
    openChannel(createChannel({ id: 40, name: '보관됨', archived: true, role: 'OWNER', member: true }))
    expect(await screen.findByTestId('channel-archived-badge')).toBeInTheDocument()
    expect(await screen.findByText('이 채널은 보관되었습니다')).toBeInTheDocument()
    expect(screen.queryByTestId('message-composer-input')).not.toBeInTheDocument()
  })

  // WP-508: 읽기 전용 — 내 메시지라도 반응 추가·수정·삭제가 없고 반응 칩은 눌리지 않는다(답글 보기는 남는다).
  test('메시지 툴바에 반응·수정·삭제가 없고 반응 칩은 비활성', async () => {
    const msg = createMessage({ id: 480, channelId: 48, body: '보관 전 내 글', reactions: [createReaction({ emoji: '👍', count: 1 })] })
    openChannel(createChannel({ id: 48, name: '보관됨', archived: true, role: 'OWNER', member: true }), { messages: { 48: [msg] } })
    expect(await screen.findByTestId('message-body-480')).toHaveTextContent('보관 전 내 글')
    expect(screen.getByTestId('message-reply-480')).toBeInTheDocument()
    expect(screen.queryByTestId('message-480-react')).not.toBeInTheDocument()
    expect(screen.queryByTestId('message-edit-480')).not.toBeInTheDocument()
    expect(screen.queryByTestId('message-delete-480')).not.toBeInTheDocument()
    expect(screen.getByTestId('reaction-pill-480-👍')).toBeDisabled()
  })

  // WP-621: 보관된 공개 채널은 나간 사람도 읽기 전용으로 본다 — 멤버 전용인 채널 파일 버튼은 없다.
  // 읽음 요청이 없는지는 화면에 보이는 순간(IntersectionObserver) 판정이라 E2E(chat-channel-crud.spec.ts @layout)가 지킨다.
  test('보관된 공개 채널 비멤버 — 메시지·보관 안내만, 입력기·파일 버튼 없음', async () => {
    openChannel(createChannel({ id: 49, name: '보관공개', visibility: 'PUBLIC', archived: true, role: null, member: false }), {
      messages: { 49: [createMessage({ id: 490, channelId: 49, body: '보관 전 결정 사항' })] },
    })
    expect(await screen.findByTestId('message-body-490')).toHaveTextContent('보관 전 결정 사항')
    expect(screen.getByText('이 채널은 보관되었습니다')).toBeInTheDocument()
    expect(screen.queryByTestId('message-composer-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('channel-files-button')).not.toBeInTheDocument()
  })

  // WP-843: 보관된 채널은 이름을 바꿀 수 없다 — 설정엔 보관 해제만.
  test('보관된 채널 OWNER 설정엔 이름 변경 없이 보관 해제만', async () => {
    const { user } = openChannel(createChannel({ id: 42, name: '보관됨', archived: true, role: 'OWNER', member: true }))
    await user.click(await screen.findByTestId('channel-settings-btn'))
    expect(await screen.findByTestId('channel-unarchive-action')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-rename-action')).not.toBeInTheDocument()
  })

  // WP-1084: 같은 이름의 채널이 새로 생기면 보관 해제가 409(CHANNEL_NAME_TAKEN)로 거절된다.
  // 뭉뚱그린 오류 토스트 대신 새 이름 대화창을 열고, 받은 이름으로 해제 요청을 다시 보낸다.
  test('보관 해제가 이름 겹침으로 거절되면 새 이름 대화창에서 그 이름으로 해제한다', async () => {
    const ch = createChannel({ id: 61, name: '일반', archived: true, role: 'OWNER', member: true })
    let unarchived = false
    let calls = 0
    const post = capture<{ name: string } | null>('post', '/messaging/channels/61/unarchive', (): Response => {
      // 첫 요청(이름 없음)은 이름 겹침으로 거절, 새 이름으로 다시 보낸 요청은 성공.
      if (calls++ === 0) {
        return HttpResponse.json(
          { message: '같은 이름의 채널이 있어 보관을 해제할 수 없습니다. 새 이름으로 해제해 주세요.', errors: { code: 'CHANNEL_NAME_TAKEN' } },
          { status: 409 },
        )
      }
      unarchived = true
      return new HttpResponse(null, { status: 204 })
    })
    const { user } = openChannel(ch, {
      handlers: [
        post.handler,
        http.get(`${API}/messaging/channels/61`, () => HttpResponse.json(unarchived ? { ...ch, name: '일반-옛날', archived: false } : ch)),
      ],
    })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-unarchive-action'))

    const modal = await screen.findByTestId('rename-channel-modal')
    expect(within(modal).getByRole('heading', { name: '새 이름으로 보관 해제' })).toBeInTheDocument()
    expect(screen.getByTestId('rename-channel-unarchive-hint')).toHaveTextContent('같은 이름의 채널이 있어 「일반」 이름으로는 보관을 해제할 수 없어요')
    // 거절된 이름 그대로는 다시 보낼 수 없다.
    const submit = screen.getByTestId('rename-channel-submit')
    expect(submit).toHaveTextContent('보관 해제')
    expect(submit).toBeDisabled()
    // 이 거절은 대화창으로 안내하므로 오류 토스트를 띄우지 않는다.
    expect(screen.queryByText(/같은 이름의 채널이 있어 보관을/)).not.toBeInTheDocument()

    await user.clear(screen.getByTestId('rename-channel-name'))
    await user.paste('일반-옛날')
    await user.click(submit)
    await waitFor(() => expect(screen.queryByTestId('rename-channel-modal')).not.toBeInTheDocument())
    expect(post.bodies).toEqual([null, { name: '일반-옛날' }])
    await waitFor(() => expect(screen.getByTestId('channel-header-name')).toHaveTextContent('일반-옛날'))
    expect(screen.queryByTestId('channel-archived-badge')).not.toBeInTheDocument()
  })

  // WP-1084: 새 이름도 다른 채널과 겹치면 대화창에 그대로 남아 이유를 보인다(해제되지 않음).
  test('새 이름이 다른 채널과 겹치면 대화창에 인라인 오류를 보인다', async () => {
    const ch = createChannel({ id: 62, name: '일반', archived: true, role: 'OWNER', member: true })
    let calls = 0
    const post = capture<{ name: string } | null>('post', '/messaging/channels/62/unarchive', (): Response =>
      calls++ === 0
        ? HttpResponse.json({ message: '같은 이름의 채널이 있어 보관을 해제할 수 없습니다.', errors: { code: 'CHANNEL_NAME_TAKEN' } }, { status: 409 })
        : HttpResponse.json({ message: '이미 존재하는 채널 이름입니다: 공지' }, { status: 409 }),
    )
    const { user } = openChannel(ch, { handlers: [post.handler] })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-unarchive-action'))
    await user.clear(await screen.findByTestId('rename-channel-name'))
    await user.paste('공지')
    await user.click(screen.getByTestId('rename-channel-submit'))
    expect(await screen.findByTestId('rename-channel-name-error')).toHaveTextContent('이미 존재하는 채널 이름입니다: 공지')
    expect(screen.getByTestId('rename-channel-modal')).toBeInTheDocument()
    expect(post.bodies).toEqual([null, { name: '공지' }])
  })

  // 이름이 겹치지 않으면 지금처럼 본문 없이 바로 해제된다(대화창 없음).
  test('이름이 겹치지 않으면 본문 없이 바로 해제하고 대화창은 열리지 않는다', async () => {
    const ch = createChannel({ id: 63, name: '보관됨', archived: true, role: 'OWNER', member: true })
    const post = capture<null>('post', '/messaging/channels/63/unarchive')
    const { user } = openChannel(ch, { handlers: [post.handler] })
    await user.click(await screen.findByTestId('channel-settings-btn'))
    await user.click(await screen.findByTestId('channel-unarchive-action'))
    await waitFor(() => expect(post.bodies).toEqual([null]))
    expect(screen.queryByTestId('rename-channel-modal')).not.toBeInTheDocument()
  })
})

describe('멤버 패널', () => {
  const CID = 50
  const members = (...extra: Parameters<typeof createChannelMember>[0][]) => ({
    [CID]: [createChannelMember({ userId: 1, name: '나', role: 'OWNER' }), ...extra.map((m) => createChannelMember(m))],
  })

  /** 채널을 열고 멤버 패널을 연다. */
  async function openPanel(over: Partial<ChannelResponse>, opts: Parameters<typeof openChannel>[1] = {}) {
    const view = openChannel(createChannel({ id: CID, member: true, role: 'OWNER', ...over }), opts)
    await view.user.click(await screen.findByTestId('channel-members-btn'))
    await screen.findByTestId('channel-members-panel')
    return view
  }

  // 본인 행은 select 대신 역할 배지, 다른 멤버는 행으로.
  test('OWNER — 멤버 목록과 본인 역할 배지', async () => {
    await openPanel({}, { members: members({ userId: 2, name: '동료', role: 'MEMBER' }) })
    expect(await screen.findByTestId('member-row-2')).toHaveTextContent('동료')
    expect(screen.getByTestId('member-role-1')).toHaveTextContent('소유자')
  })

  // WP-723: 정지된 멤버는 「비활성」 배지(멘션 후보 제외는 lib/mentionCandidates.test.ts 가 지킨다).
  test('정지된 멤버에만 「비활성」 배지', async () => {
    await openPanel({}, {
      members: members({ userId: 2, name: '동료', role: 'MEMBER', active: true }, { userId: 3, name: '퇴사자', role: 'MEMBER', active: false }),
    })
    expect(await screen.findByTestId('member-inactive-3')).toHaveTextContent('비활성')
    expect(screen.queryByTestId('member-inactive-2')).not.toBeInTheDocument()
  })

  // 제거는 확인 대화상자를 거친다 — 확인하면 DELETE 뒤 목록에서 빠지고, 취소하면 남는다.
  test('제거 확인 → DELETE 후 행이 사라지고, 취소하면 남는다', async () => {
    let removed = false
    const del = capture('delete', `/messaging/channels/${CID}/members/2`, () => {
      removed = true
      return new HttpResponse(null, { status: 204 })
    })
    const { user } = await openPanel({}, {
      handlers: [
        del.handler,
        http.get(`${API}/messaging/channels/${CID}/members`, () =>
          HttpResponse.json([
            createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
            ...(removed ? [] : [createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' })]),
          ]),
        ),
      ],
    })
    // 취소 — 확인 단계 없이 즉시 지워지지 않는다.
    await user.click(await screen.findByTestId('member-remove-2'))
    expect(await screen.findByTestId('member-remove-confirm')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('member-remove-confirm')).not.toBeInTheDocument())
    expect(screen.getByTestId('member-row-2')).toBeInTheDocument()
    expect(del.bodies).toHaveLength(0)
    // 확인 — DELETE 후 재조회로 행이 빠진다.
    await user.click(screen.getByTestId('member-remove-2'))
    await user.click(await screen.findByTestId('member-remove-confirm'))
    await waitFor(() => expect(screen.queryByTestId('member-row-2')).not.toBeInTheDocument())
    expect(del.bodies).toHaveLength(1)
  })

  // 비공개 초대 — 사람·조직 선택 창(WP-1058)에서 사람을 찾아 고르면 POST {userId}. 멘션 에이전트 조회(kind=AGENT)는 빈 목록.
  // 조직·내 그룹 추가와 공개 채널의 조직 숨김은 components/chat/ChannelMembersPanel.test.tsx 가 본다.
  test('비공개 채널 OWNER 가 검색해 추가하면 POST {userId} 를 보낸다', async () => {
    const add = capture('post', `/messaging/channels/${CID}/members`)
    const { user } = await openPanel({ visibility: 'PRIVATE' }, {
      handlers: [
        add.handler,
        // 선택 창이 조직도·내 그룹 트리를 받는다 — 이 테스트는 사람만 고른다.
        http.get(`${API}/user-groups`, () => HttpResponse.json({ shared: [], personal: [] })),
        http.get(`${API}/members`, ({ request }) =>
          HttpResponse.json(
            new URL(request.url).searchParams.get('kind') === 'AGENT'
              ? { content: [], totalElements: 0 }
              : { content: [{ userId: 2, name: '동료', username: 'colleague', email: 'c@x.com', kind: 'HUMAN', active: true }], totalElements: 1 },
          ),
        ),
      ],
    })
    await user.click(screen.getByTestId('member-add-trigger'))
    expect(await screen.findByTestId('channel-member-picker-search')).toBeInTheDocument()
    // 검색어 없이 기본 후보에서 고른다 — 검색어를 치면 300ms 디바운스가 끝나기 전 사람 줄은 고를 수 없게 막혀 있다(선택 창 규칙).
    await user.click(await screen.findByTestId('channel-member-picker-person-2'))
    await waitFor(() => expect(add.bodies).toEqual([{ userId: 2 }]))
  })

  // 소유권 이전 — 역할 select 로 OWNER 를 고르면 확인 창(WP-1131)을 거쳐 PATCH {role}, 나는 ADMIN 으로 내려가 배지로 보이고, 나가기 확인 후 /chat.
  test('소유권을 넘기고(PATCH role=OWNER) 나가면 /chat 으로 간다', async () => {
    let transferred = false
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    const patch = capture('patch', `/messaging/channels/${CID}/members/2`, () => {
      transferred = true
      return new HttpResponse(null, { status: 204 })
    })
    const leave = capture('post', `/messaging/channels/${CID}/leave`)
    const { user, location } = await openPanel({}, {
      handlers: [
        patch.handler,
        leave.handler,
        http.get(`${API}/messaging/channels/${CID}`, () => HttpResponse.json({ ...ch, role: transferred ? 'ADMIN' : 'OWNER' })),
        http.get(`${API}/messaging/channels/${CID}/members`, () =>
          HttpResponse.json([
            createChannelMember({ userId: 1, name: '나', role: transferred ? 'ADMIN' : 'OWNER' }),
            createChannelMember({ userId: 2, name: '동료', role: transferred ? 'OWNER' : 'MEMBER' }),
          ]),
        ),
      ],
    })
    await user.selectOptions(await screen.findByTestId('member-role-select-2'), 'OWNER')
    await user.click(await screen.findByTestId('member-transfer-confirm'))
    await waitFor(() => expect(screen.getByTestId('member-role-2')).toHaveTextContent('소유자'))
    expect(screen.getByTestId('member-role-1')).toHaveTextContent('관리자')
    expect(patch.bodies).toEqual([{ role: 'OWNER' }])
    await user.click(screen.getByTestId('channel-leave-btn'))
    await user.click(await screen.findByTestId('channel-leave-confirm'))
    await waitFor(() => expect(location()).toBe('/chat'))
    expect(leave.bodies).toHaveLength(1)
  })

  // WP-1131: OWNER 를 고르기만 해서는 소유권이 넘어가지 않는다 — 확인 창이 누구에게 넘기는지·나는 관리자가 됨을 알리고,
  // 취소하면 요청 없이 원래 역할로 보인다. 관리자·멤버 사이 변경은 되돌릴 수 있어 확인 없이 바로 PATCH 한다. 역할은 한국어 이름이다.
  test('OWNER 를 고르면 확인 창을 거치고, 취소하면 PATCH 없이 그대로 — 관리자 변경은 바로 보낸다', async () => {
    const patch = capture('patch', `/messaging/channels/${CID}/members/2`, () => new HttpResponse(null, { status: 204 }))
    const { user } = await openPanel({ memberCount: 2 }, {
      members: members({ userId: 2, name: '동료', role: 'MEMBER' }),
      handlers: [patch.handler],
    })
    const select = await screen.findByTestId('member-role-select-2')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['소유자', '관리자', '멤버'])

    await user.selectOptions(select, 'OWNER')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('소유권 넘기기')
    expect(dialog).toHaveTextContent('동료에게 채널 소유권을 넘기면 나는 관리자가 됩니다')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('member-role-select-2')).toHaveValue('MEMBER')
    expect(patch.bodies).toEqual([])

    await user.selectOptions(screen.getByTestId('member-role-select-2'), 'ADMIN')
    await waitFor(() => expect(patch.bodies).toEqual([{ role: 'ADMIN' }]))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  // WP-1131 리뷰: 넘긴 뒤 목록·내 역할이 다시 올 때까지 select 를 잠근다 — PATCH 만 끝나고 낡은 내 역할(OWNER)로 다시 풀리면 또 넘기다 403.
  test('소유권을 넘긴 뒤 재조회가 끝날 때까지 역할 select 가 잠겨 있다', async () => {
    let transferred = false
    let releaseMembers: () => void = () => {}
    // 넘긴 뒤의 재조회(목록·내 역할)를 함께 붙잡아 둔다 — 그 사이 select 가 잠겨 있는지 본다.
    const held = new Promise<void>((r) => (releaseMembers = r))
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    const patch = capture('patch', `/messaging/channels/${CID}/members/2`, () => {
      transferred = true
      return new HttpResponse(null, { status: 204 })
    })
    const { user } = await openPanel({}, {
      handlers: [
        patch.handler,
        http.get(`${API}/messaging/channels/${CID}`, async () => {
          if (transferred) await held
          return HttpResponse.json({ ...ch, role: transferred ? 'ADMIN' : 'OWNER' })
        }),
        http.get(`${API}/messaging/channels/${CID}/members`, async () => {
          if (transferred) await held
          return HttpResponse.json([
            createChannelMember({ userId: 1, name: '나', role: transferred ? 'ADMIN' : 'OWNER' }),
            createChannelMember({ userId: 2, name: '동료', role: transferred ? 'OWNER' : 'MEMBER' }),
            createChannelMember({ userId: 3, name: '이웃', role: 'MEMBER' }),
          ])
        }),
      ],
    })
    await user.selectOptions(await screen.findByTestId('member-role-select-2'), 'OWNER')
    await user.click(await screen.findByTestId('member-transfer-confirm'))
    await waitFor(() => expect(patch.bodies).toEqual([{ role: 'OWNER' }]))
    // PATCH 는 끝났지만 목록이 아직 오지 않았다 — 다른 사람의 select 도 잠겨 있다.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('member-role-select-3')).toBeDisabled()
    releaseMembers()
    // 목록이 오면 나는 관리자 — select 대신 배지만 남는다.
    await waitFor(() => expect(screen.getByTestId('member-role-1')).toHaveTextContent('관리자'))
    expect(screen.queryByTestId('member-role-select-3')).not.toBeInTheDocument()
    expect(patch.bodies).toHaveLength(1)
  })

  // WP-1131 리뷰: 확인 창을 연 사이 대상이 나가면 확인 상태를 비운다 — 그 사람이 다시 들어와도 창이 저절로 뜨지 않는다.
  test('확인 창을 연 사이 대상이 나갔다 다시 들어와도 창이 저절로 다시 뜨지 않는다', async () => {
    let roster: 'with' | 'without' = 'with'
    const patch = capture('patch', `/messaging/channels/${CID}/members/2`)
    const view = await openPanel({ memberCount: 2 }, {
      handlers: [
        patch.handler,
        http.get(`${API}/messaging/channels/${CID}/members`, () =>
          HttpResponse.json([
            createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
            ...(roster === 'with' ? [createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' })] : []),
          ]),
        ),
      ],
    })
    await view.user.selectOptions(await screen.findByTestId('member-role-select-2'), 'OWNER')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    roster = 'without'
    await act(() => view.queryClient.invalidateQueries())
    await waitFor(() => expect(screen.queryByTestId('member-row-2')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    roster = 'with'
    await act(() => view.queryClient.invalidateQueries())
    expect(await screen.findByTestId('member-row-2')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(patch.bodies).toEqual([])
  })

  // #598: AGENT 는 채널 소유자가 될 수 없다 — 역할 select 에 OWNER 선택지가 없다(서버도 409 로 막는다).
  test('AGENT 멤버의 역할 select 에는 OWNER 선택지가 없다', async () => {
    await openPanel({ memberCount: 2 }, { members: members({ userId: 2, name: 'My AI', role: 'MEMBER', kind: 'AGENT' }) })
    const select = await screen.findByTestId('member-role-select-2')
    expect(select).toHaveValue('MEMBER')
    expect(within(select).queryByRole('option', { name: '소유자' })).not.toBeInTheDocument()
  })

  // WP-1131: 정지된 사람에게는 소유권을 넘길 수 없다 — 로그인할 수 없는 소유자는 역할을 바꾸거나 되돌려 줄 수 없다.
  test('정지된 멤버의 역할 select 에는 「소유자」 선택지가 없다', async () => {
    await openPanel({ memberCount: 2 }, { members: members({ userId: 2, name: '퇴사자', role: 'MEMBER', active: false }) })
    const select = await screen.findByTestId('member-role-select-2')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['관리자', '멤버'])
  })

  // #780: 역할 select·제거 버튼은 멤버 이름으로 구분되는 접근 가능한 이름을 가진다 — 그 이름으로 고른 버튼이 그 멤버를 지목한다.
  test('역할 select·제거 버튼의 접근 가능한 이름이 멤버별로 구분된다', async () => {
    const { user } = await openPanel({ memberCount: 3 }, {
      members: members({ userId: 2, name: '동료', role: 'MEMBER' }, { userId: 3, name: '이웃', role: 'MEMBER' }),
    })
    const panel = screen.getByTestId('channel-members-panel')
    expect(await within(panel).findByRole('combobox', { name: '동료 역할 변경' })).toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: '이웃 역할 변경' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '이웃 제거' })).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: '동료 제거' }))
    expect(await screen.findByTestId('member-remove-confirm')).toBeInTheDocument()
  })

  // #780: 나가기는 멤버 목록과 구분선(border-t)으로 나뉜다.
  test('채널 나가기 버튼은 구분선 아래에 있다', async () => {
    await openPanel({ role: 'MEMBER' }, { members: { [CID]: [createChannelMember({ userId: 1, name: '나', role: 'MEMBER' })] } })
    const leave = await screen.findByTestId('channel-leave-btn')
    expect(leave.parentElement).toHaveClass('border-t')
  })
})

describe('채널 파일 드로워 (#76)', () => {
  const CHANNEL_ID = 880
  const SPACE_ID = 8800
  const FOLDER_ID = 100
  const channel = createChannel({ id: CHANNEL_ID, name: '파일채널', role: 'OWNER', member: true })
  const space = { id: SPACE_ID, type: 'CHANNEL', name: '파일채널', ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' }
  const driveHandlers = [
    http.post(`${API}/messaging/channels/${CHANNEL_ID}/drive-space`, () => HttpResponse.json({ spaceId: SPACE_ID, archived: false })),
    http.get(`${API}/drive/spaces/${SPACE_ID}`, () => HttpResponse.json(space)),
    http.get(`${API}/drive/spaces/${SPACE_ID}/items`, ({ request }) =>
      HttpResponse.json(
        new URL(request.url).searchParams.get('parentId') === String(FOLDER_ID)
          ? { folders: [], files: [] }
          : { folders: [{ id: FOLDER_ID, parentId: null, name: '테스트폴더', createdAt: '2026-06-01T00:00:00Z' }], files: [] },
      ),
    ),
    http.get(`${API}/drive/folders/${FOLDER_ID}/path`, () => HttpResponse.json([{ id: FOLDER_ID, name: '테스트폴더' }])),
  ]

  async function openDrawer(extra: ReturnType<typeof http.get>[] = []) {
    const view = openChannel(channel, { handlers: [...extra, ...driveHandlers] })
    await view.user.click(await screen.findByTestId('channel-files-button'))
    const drawer = await screen.findByTestId('drive-space-drawer')
    await within(drawer).findByTestId('drive-page')
    return { ...view, drawer }
  }

  // 파일 버튼 → 드로워 안에 드라이브 화면, 주소·채널 헤더는 그대로. 「전체에서 열기」는 풀페이지 드라이브로.
  test('파일 버튼은 채널 주소를 유지한 채 드로워를 열고, 「전체에서 열기」는 드라이브 공간으로 간다', async () => {
    const { user, location } = await openDrawer()
    // 드로워 열림은 ?files 로만 남고 채널 경로는 그대로다.
    expect(location()).toMatch(new RegExp(`^/chat/channels/${CHANNEL_ID}(\\?|$)`))
    expect(screen.getByTestId('channel-header')).toBeInTheDocument()
    await user.click(screen.getByTestId('drive-drawer-open-full'))
    await waitFor(() => expect(location()).toBe(`/drive/spaces/${SPACE_ID}`))
  })

  test('드로워는 Esc 로 닫힌다', async () => {
    const { user } = await openDrawer()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('drive-space-drawer')).not.toBeInTheDocument())
  })

  // WP-207: 드로워 안 폴더 이동은 상위 주소에 folderId 를 남기지 않는다(별도 키).
  test('드로워에서 폴더에 들어가도 주소에 folderId 가 없다', async () => {
    const { user, drawer, location } = await openDrawer()
    await user.click(await within(drawer).findByRole('button', { name: '테스트폴더' }))
    expect(await within(drawer).findByTestId('drive-empty-folder')).toBeInTheDocument()
    expect(location()).toMatch(new RegExp(`^/chat/channels/${CHANNEL_ID}`))
    expect(new URLSearchParams(location().split('?')[1] ?? '').get('folderId')).toBeNull()
  })

  // 드로워(embedded)에서도 콘텐츠 검색이 되지만 AI Overview 버튼은 좁아서 숨긴다.
  test('드로워에서 검색하면 콘텐츠 일치가 보이고 AI Overview 는 없다', async () => {
    const { user, drawer } = await openDrawer([
      http.get(`${API}/drive/spaces/${SPACE_ID}/search`, () => HttpResponse.json({ folders: [], files: [] })),
      http.get(`${API}/drive/search`, () =>
        HttpResponse.json({
          hits: [{ driveFileId: 1, fileId: 10, spaceId: SPACE_ID, spaceName: '파일채널', name: '회의록.txt', mimeType: 'text/plain', snippet: '오늘 <b>회의</b> 내용', score: 0.5 }],
          semantic: true,
        }),
      ),
    ])
    await user.click(within(drawer).getByLabelText('파일명 및 콘텐츠 검색'))
    await user.paste('회의')
    expect(await within(drawer).findByTestId('drive-content-hit')).toBeInTheDocument()
    expect(within(drawer).getByText('회의록.txt')).toBeInTheDocument()
    expect(within(drawer).queryByTestId('drive-overview-btn')).not.toBeInTheDocument()
  })

  // 보관 채널의 드라이브 공간은 읽기 전용 — 배너와 함께 새 폴더·업로드가 실제로 비활성이다.
  test('보관 채널 공간은 읽기 전용 배너와 쓰기 비활성', async () => {
    renderScreen(
      <Routes>
        <Route path="/drive/spaces/:spaceId" element={<DrivePage />} />
      </Routes>,
      {
        path: `/drive/spaces/${SPACE_ID}`,
        handlers: [
          http.get(`${API}/drive/spaces/${SPACE_ID}`, () => HttpResponse.json({ ...space, name: '보관채널', archived: true })),
          http.get(`${API}/drive/spaces/${SPACE_ID}/items`, () => HttpResponse.json({ folders: [], files: [] })),
          http.get(`${API}/drive/spaces`, () => HttpResponse.json([])),
        ],
      },
    )
    expect(await screen.findByTestId('drive-readonly-banner')).toBeInTheDocument()
    expect(screen.getByTestId('drive-new-folder')).toBeDisabled()
    expect(screen.getByTestId('drive-upload')).toBeDisabled()
  })
})

describe('L3 위임 확인 카드', () => {
  const CHANNEL_ID = 9
  const PROPOSAL_ID = 55
  const base: MessageProposal = {
    id: PROPOSAL_ID,
    proposedByUserId: 1,
    actionType: 'CREATE_ISSUE',
    status: 'PENDING',
    title: '로그인 버그',
    priority: 'HIGH',
    projectName: '제품팀 프로젝트',
    projectKey: null,
    candidates: [],
    resultIssueKey: null,
    startsAt: null,
    endsAt: null,
    location: null,
    allDay: null,
    conflicts: null,
    attendees: null,
  }
  const proposalMessage = (proposal: MessageProposal): MessageResponse =>
    createMessage({ id: 200, channelId: CHANNEL_ID, authorId: 99, authorName: 'AI 어시스턴트', authorKind: 'AGENT', body: '이슈 생성을 제안합니다.', proposal })

  function openWith(proposal: MessageProposal, handlers: ReturnType<typeof http.post>[] = []) {
    return openChannel(createChannel({ id: CHANNEL_ID, member: true }), {
      messages: { [CHANNEL_ID]: [proposalMessage(proposal), createMessage({ id: 199, channelId: CHANNEL_ID, body: '일반 메시지' })] },
      handlers,
    })
  }

  // 위임자(제안을 요청한 본인)에겐 제목·프로젝트·우선순위와 승인/거부 버튼, 승인하면 confirm 엔드포인트.
  test('위임자 — 카드 내용과 승인/거부 버튼, 승인하면 confirm 을 부른다', async () => {
    const confirm = capture('post', `/messaging/proposals/${PROPOSAL_ID}/confirm`, () =>
      HttpResponse.json(proposalMessage({ ...base, status: 'CONFIRMED', resultIssueKey: 'SWP-42' })),
    )
    const { user } = openWith(base, [confirm.handler])
    const card = await screen.findByTestId(`proposal-card-${PROPOSAL_ID}`)
    expect(card).toHaveTextContent('로그인 버그')
    expect(card).toHaveTextContent('제품팀 프로젝트')
    expect(card).toHaveTextContent('높음')
    expect(card).toHaveTextContent('담당: AI')
    expect(screen.getByTestId(`proposal-reject-${PROPOSAL_ID}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`proposal-pending-${PROPOSAL_ID}`)).not.toBeInTheDocument()
    await user.click(screen.getByTestId(`proposal-confirm-${PROPOSAL_ID}`))
    await waitFor(() => expect(confirm.bodies).toHaveLength(1))
  })

  // 다른 사람이 요청한 제안 — 버튼 대신 「확인 대기 중」.
  test('비위임자 — 버튼 없이 대기 표시만', async () => {
    openWith({ ...base, proposedByUserId: 99 })
    expect(await screen.findByTestId(`proposal-pending-${PROPOSAL_ID}`)).toBeInTheDocument()
    expect(screen.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toHaveTextContent('로그인 버그')
    expect(screen.queryByTestId(`proposal-confirm-${PROPOSAL_ID}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`proposal-reject-${PROPOSAL_ID}`)).not.toBeInTheDocument()
  })

  test('거부하면 reject 엔드포인트를 부른다', async () => {
    const reject = capture('post', `/messaging/proposals/${PROPOSAL_ID}/reject`, () =>
      HttpResponse.json(proposalMessage({ ...base, status: 'REJECTED' })),
    )
    const { user } = openWith(base, [reject.handler])
    await user.click(await screen.findByTestId(`proposal-reject-${PROPOSAL_ID}`))
    await waitFor(() => expect(reject.bodies).toHaveLength(1))
  })

  // 후보 프로젝트를 바꾸고 승인하면 projectKey 를 함께 보낸다.
  test('프로젝트 드롭다운을 바꾸고 승인하면 {projectKey} 를 보낸다', async () => {
    const withCandidates = {
      ...base,
      projectName: '개인 작업',
      projectKey: 'P1',
      candidates: [
        { key: 'P1', name: '개인 작업' },
        { key: 'DESIGN', name: '디자인팀' },
      ],
    }
    const confirm = capture('post', `/messaging/proposals/${PROPOSAL_ID}/confirm`, () =>
      HttpResponse.json(proposalMessage({ ...withCandidates, status: 'CONFIRMED', resultIssueKey: 'DESIGN-1' })),
    )
    const { user } = openWith(withCandidates, [confirm.handler])
    await user.click(await screen.findByTestId(`proposal-project-${PROPOSAL_ID}`))
    await user.click(await screen.findByRole('option', { name: '디자인팀' }))
    await user.click(screen.getByTestId(`proposal-confirm-${PROPOSAL_ID}`))
    await waitFor(() => expect(confirm.bodies).toEqual([{ projectKey: 'DESIGN' }]))
  })
})

describe('일정 제안 카드', () => {
  // vitest 시간대는 Asia/Seoul — UTC 06:00Z 가 KST 15:00 으로 보여야 한다(나이브 slice 면 06:00).
  const CHANNEL_ID = 9
  const PROPOSAL_ID = 77
  const eventProposal: MessageProposal = {
    id: PROPOSAL_ID,
    proposedByUserId: 1,
    actionType: 'calendar.create_event',
    status: 'PENDING',
    title: '스프린트 리뷰',
    priority: null,
    projectName: null,
    projectKey: null,
    candidates: [],
    resultIssueKey: null,
    startsAt: '2026-07-05T06:00:00Z',
    endsAt: '2026-07-05T07:00:00Z',
    location: null,
    allDay: false,
    conflicts: [{ id: 7, title: '기존 회의', startsAt: '2026-07-05T06:30:00Z', endsAt: '2026-07-05T07:30:00Z' }],
    attendees: null,
  }
  function openWith(handlers: ReturnType<typeof http.post>[] = []) {
    const msg = createMessage({ id: 300, channelId: CHANNEL_ID, authorId: 99, authorName: 'AI 어시스턴트', authorKind: 'AGENT', body: '💡 일정 생성을 제안했어요', proposal: eventProposal })
    return openChannel(createChannel({ id: CHANNEL_ID, member: true }), { messages: { [CHANNEL_ID]: [msg] }, handlers })
  }

  // UTC payload → KST 표시, 충돌 배지, 제목·장소 200자 상한(WP-687), 제목만 고쳐 승인하면 시각 instant 가 그대로 돌아간다.
  test('KST 로 표시하고 충돌 배지·200자 상한, 승인 payload 는 원래 instant 를 보존한다', async () => {
    const confirm = capture<Record<string, unknown>>('post', `/messaging/proposals/${PROPOSAL_ID}/confirm`, () =>
      HttpResponse.json(createMessage({ id: 300, channelId: CHANNEL_ID, authorKind: 'AGENT', proposal: { ...eventProposal, status: 'CONFIRMED', resultIssueKey: 'event:501' } })),
    )
    const { user } = openWith([confirm.handler])
    expect(await screen.findByTestId(`event-proposal-conflicts-${PROPOSAL_ID}`)).toHaveTextContent('충돌 1건')
    expect(screen.getByTestId(`event-proposal-starts-${PROPOSAL_ID}`)).toHaveValue('2026-07-05T15:00')
    expect(screen.getByTestId(`event-proposal-ends-${PROPOSAL_ID}`)).toHaveValue('2026-07-05T16:00')
    const title = screen.getByTestId(`event-proposal-title-${PROPOSAL_ID}`)
    const location = screen.getByTestId(`event-proposal-location-${PROPOSAL_ID}`)
    // 서버 상한 200자 — 입력 칸이 maxLength 로 막는다.
    await user.clear(title)
    await user.paste('가'.repeat(201))
    expect(title).toHaveValue('가'.repeat(200))
    await user.click(location)
    await user.paste('나'.repeat(201))
    expect(location).toHaveValue('나'.repeat(200))
    await user.clear(location)
    await user.clear(title)
    await user.paste('스프린트 리뷰(수정)')
    await user.click(screen.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`))
    await waitFor(() => expect(confirm.bodies).toHaveLength(1))
    expect(confirm.bodies[0]).toMatchObject({
      title: '스프린트 리뷰(수정)',
      startsAt: '2026-07-05T06:00:00.000Z',
      endsAt: '2026-07-05T07:00:00.000Z',
    })
  })

  // WP-727: 종료가 시작보다 앞이거나 같으면 안내 + aria-invalid + 승인 비활성, 고치면 풀린다.
  test('종료를 시작보다 앞으로 고치면 안내가 뜨고 승인이 막힌다', async () => {
    const confirm = capture('post', `/messaging/proposals/${PROPOSAL_ID}/confirm`)
    openWith([confirm.handler])
    const ends = await screen.findByTestId(`event-proposal-ends-${PROPOSAL_ID}`)
    const button = screen.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`)
    const setEnds = (v: string) => act(() => {
      // datetime-local 은 user-event 로 칠 수 없다 — 값 바꾸기 이벤트로 넣는다.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(ends, v)
      ends.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(button).toBeEnabled()
    setEnds('2026-07-05T14:30')
    expect(await screen.findByTestId(`event-proposal-range-error-${PROPOSAL_ID}`)).toHaveTextContent('종료는 시작보다 뒤여야 합니다')
    expect(ends).toHaveAttribute('aria-invalid', 'true')
    expect(button).toBeDisabled()
    setEnds('2026-07-05T15:00')
    expect(button).toBeDisabled()
    setEnds('2026-07-05T16:30')
    await waitFor(() => expect(screen.queryByTestId(`event-proposal-range-error-${PROPOSAL_ID}`)).not.toBeInTheDocument())
    expect(button).toBeEnabled()
    expect(confirm.bodies).toHaveLength(0)
  })
})

describe('빈 상태', () => {
  // 메시지 0건 채널은 채널명을 넣은 시작 안내.
  test('메시지 0건 채널은 「이것은 #채널 채널의 시작입니다.」', async () => {
    openChannel(createChannel({ id: 800, name: '테스트채널', memberCount: 1 }))
    expect(await screen.findByTestId('chat-empty-state')).toHaveTextContent('이것은 #테스트채널 채널의 시작입니다.')
  })
})

describe('입력창 첨부', () => {
  const CHANNEL_ID = 601
  const channel = createChannel({ id: CHANNEL_ID, name: '파일채널', member: true })
  const meta = (fileId: number, name: string, mimeType = 'text/plain') => ({ fileId, originalName: name, mimeType, sizeBytes: 5 })

  // Phase 6: 본문 없이 첨부만으로 보낼 수 있다 — payload {body:'', fileIds}, 비이미지는 파일 카드.
  test('본문 없이 파일만 첨부해도 전송되고 파일 카드가 보인다', async () => {
    const send = capture<{ body: string; fileIds: number[] }>('post', `/messaging/channels/${CHANNEL_ID}/messages`, () =>
      HttpResponse.json(
        createMessage({
          id: 9710, channelId: CHANNEL_ID, authorId: 1, body: '',
          attachments: [{ fileId: 8810, messageId: 9710, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 2048, attachedById: 1, attachedByName: '나', attachedAt: '2026-06-03T00:00:00Z' }],
        }),
      ),
    )
    const { user } = openChannel(channel, {
      handlers: [send.handler, http.post(`${API}/messaging/channels/${CHANNEL_ID}/attachments`, () => HttpResponse.json([meta(8810, 'spec.pdf', 'application/pdf')]))],
    })
    await user.upload(await screen.findByTestId('composer-file-input'), new File(['%PDF-1.4'], 'spec.pdf', { type: 'application/pdf' }))
    expect(await screen.findByTestId('composer-attachments')).toHaveTextContent('spec.pdf')
    await waitFor(() => expect(screen.getByTestId('message-composer-submit')).toBeEnabled())
    await user.click(screen.getByTestId('message-composer-submit'))
    await waitFor(() => expect(send.bodies).toHaveLength(1))
    expect(send.bodies[0]).toMatchObject({ body: '', fileIds: [8810] })
    expect(await screen.findByTestId('attachment-card-8810')).toHaveTextContent('spec.pdf')
  })

  // #152: 업로드가 끝나기 전엔 전송이 막힌다(「업로드 중…」) — 눌러도 전송 요청이 없고, 끝나면 「보내기」로 돌아온다.
  // 먼저 첨부 하나를 올려 둬 「보낼 것이 있는」 상태(전송 가능)에서 시작해야 업로드 중 차단만 따로 판정된다(E2E 는 글자를 쳐서 만든 상태).
  test('보낼 것이 있어도 업로드 중엔 전송 버튼이 「업로드 중…」으로 막히고 전송 요청이 없다', async () => {
    let calls = 0
    let release!: () => void
    const send = capture('post', `/messaging/channels/${CHANNEL_ID}/messages`)
    const { user } = openChannel(channel, {
      handlers: [
        send.handler,
        http.post(`${API}/messaging/channels/${CHANNEL_ID}/attachments`, async () => {
          const nth = ++calls
          if (nth === 2) await new Promise<void>((r) => (release = r))
          return HttpResponse.json([meta(9000 + nth, nth === 1 ? 'first.txt' : 'test.txt')])
        }),
      ],
    })
    const input = await screen.findByTestId('composer-file-input')
    const submit = screen.getByTestId('message-composer-submit')
    await user.upload(input, new File(['a'], 'first.txt', { type: 'text/plain' }))
    await waitFor(() => expect(submit).toBeEnabled())
    expect(submit).toHaveTextContent('보내기')
    await user.upload(input, new File(['hello'], 'test.txt', { type: 'text/plain' }))
    await waitFor(() => expect(submit).toBeDisabled())
    expect(submit).toHaveTextContent('업로드 중…')
    // 비활성 버튼을 눌러도(원시 클릭) 전송은 나가지 않는다.
    act(() => submit.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await new Promise((r) => setTimeout(r, 100))
    expect(send.bodies).toHaveLength(0)
    release()
    await waitFor(() => expect(submit).toBeEnabled())
    expect(submit).toHaveTextContent('보내기')
  })

  // WP-848: 25MB 를 넘는 파일은 올리지 않고 이름과 함께 알린다 — 같이 고른 작은 파일만 올라가고, 큰 파일만이면 요청이 없다.
  test('25MB 를 넘는 파일은 빼고 알리며, 작은 파일만 업로드한다', async () => {
    const uploaded: string[][] = []
    const { user } = openChannel(channel, {
      handlers: [
        http.post(`${API}/messaging/channels/${CHANNEL_ID}/attachments`, async ({ request }) => {
          // multipart 본문의 파일 파트 수와 크기만 본다 — jsdom FormData 는 파일 이름을 「blob」으로 직렬화해 이름으로는 못 가린다.
          const raw = await request.text()
          uploaded.push([...raw.matchAll(/filename="([^"]+)"/g)].map(() => (raw.length > 1024 * 1024 ? 'big' : 'small')))
          return HttpResponse.json([meta(9101, 'small.txt')])
        }),
      ],
    })
    const big = (name: string) => new File([new Uint8Array(25 * 1024 * 1024 + 1)], name, { type: 'application/octet-stream' })
    const input = await screen.findByTestId('composer-file-input')
    await user.upload(input, [big('big.bin'), new File(['hello'], 'small.txt', { type: 'text/plain' })])
    expect(await screen.findByText('big.bin는 25MB 한도를 초과합니다')).toBeInTheDocument()
    // 업로드는 한 번, 파일 파트는 작은 파일 하나뿐이다(25MB 본문이 실리지 않았다).
    await waitFor(() => expect(uploaded).toEqual([['small']]))
    expect(await screen.findByTestId('composer-attachments')).toHaveTextContent('small.txt')
    expect(screen.getByTestId('composer-attachments')).not.toHaveTextContent('big.bin')
    await user.upload(input, big('only-big.bin'))
    expect(await screen.findByText('only-big.bin는 25MB 한도를 초과합니다')).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 200))
    expect(uploaded).toHaveLength(1)
  })
})
