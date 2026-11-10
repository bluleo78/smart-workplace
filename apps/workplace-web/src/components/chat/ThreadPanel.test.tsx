// WP-1470(그룹 DM 스레드 미읽음 배지 잔존) 회귀 테스트 — 열려 둔 패널에 답글이 "표시"되면 스레드 읽음 처리가 다시 발화해야 한다.
// 수정 전 코드는 읽음 효과 deps 가 [parent.id] 뿐이라 답글 도착이 트리거가 아니었다(수정 본체는 Task 2 소유 — 이 파일은 계약을 고정만 한다).
// 데이터 훅은 vi.mock 으로 끊고, 이중(double)은 실제 훅 계약(미읽음 ≤0 이면 생략)을 미러링해 "유효 발화"만 기록한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MentionCandidate } from '@/components/mentions/types'
import { renderWithProviders } from '@/test/renderWithProviders'
import type { MessageResponse, UserKind } from '@/types/messaging'

import { ThreadPanel } from './ThreadPanel'

const mocks = vi.hoisted(() => ({
  replies: [] as MessageResponse[],
  markThreadRead: vi.fn(),
}))

// 답글 목록은 호출마다 현재 mocks.replies 를 그대로 돌려준다 — 도달 수를 시험을 바꿔 제어.
vi.mock('@/hooks/queries/useThreadReplies', () => ({
  useThreadReplies: () => ({
    data: { pages: [{ items: mocks.replies, nextCursor: null, hasMore: false }] },
  }),
}))

vi.mock('@/hooks/queries/useMarkThreadRead', () => ({
  // 실제 훅 계약 미러: currentUnread <= 0 이면 아무 것도 하지 않는다(useMarkThreadRead.ts:18 "미읽음 없으면 호출 생략").
  // 그 생략 결정은 훅 몫이라 성분에는 기대하지 않는다 — 이중이 계약을 그대로 옮겨 유효 발화만 스파이로 남긴다.
  useMarkThreadRead: () => {
    return (rootId: number, currentUnread: number) => {
      if (currentUnread > 0) mocks.markThreadRead(rootId, currentUnread)
    }
  },
}))

vi.mock('@/hooks/queries/useCreateReply', () => ({
  useCreateReply: () => ({ mutateAsync: vi.fn() }),
}))

// 패널이 그리는 자식은 관심사가 아니다 — 답글 "표시 수"는 성분이 계산해 효과에 넣으므로, 프로바이더 무거운 실제
// 컴포넌트 대신 named export 이중으로 렌더를 가볍게 유지한다.
vi.mock('@/components/chat/MessageList', () => ({ MessageList: () => null }))
vi.mock('@/components/chat/MessageComposer', () => ({ MessageComposer: () => null }))

function makeParent(overrides: { id?: number; unreadReplyCount?: number } = {}) {
  return {
    id: 1,
    channelId: 7,
    authorId: 2,
    authorName: '김하나',
    authorKind: 'HUMAN',
    body: '스레드 부모 메시지',
    mentions: [],
    parentMessageId: null,
    replyCount: 3,
    unreadReplyCount: 3,
    followed: true,
    reactions: [],
    attachments: [],
    driveLinks: [],
    createdAt: '2026-11-09T12:00:00Z',
    editedAt: null,
    deleted: false,
    ...overrides,
  } as unknown as MessageResponse
}

// 답글은 개수만 쓰인다(MessageList 이중) — 최소 필드만 채운 현지 픽스처(저장소 기존 관례).
function makeReply(id: number) {
  return { id, parentMessageId: 1, body: `답글 ${id}` } as unknown as MessageResponse
}

const ME: { id: number; name: string; kind: UserKind } = { id: 1, name: '나', kind: 'HUMAN' }
const MEMBERS: MentionCandidate[] = [{ userId: 2, username: 'hana', name: '김하나', kind: 'HUMAN' }]

function panelElement({ parent, canMarkRead }: { parent?: MessageResponse; canMarkRead?: boolean } = {}) {
  return (
    <ThreadPanel
      channelId={7}
      channelName="일반"
      parent={parent ?? makeParent()}
      members={MEMBERS}
      me={ME}
      // 열람 전용 아님(기본) — 저장소가 요구하는 명시 전달.
      archived={false}
      canMarkRead={canMarkRead}
      onClose={() => {}}
    />
  )
}

function renderPanel(overrides: { parent?: MessageResponse; canMarkRead?: boolean } = {}) {
  return renderWithProviders(panelElement(overrides))
}

describe('ThreadPanel — 열린 채 답글 도착 시 스레드 읽음 처리(WP-1470)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.replies = []
  })

  it('패널을 열면 부모를 1회 읽음 처리한다', () => {
    renderPanel()
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(1)
    expect(mocks.markThreadRead).toHaveBeenCalledWith(1, 3)
  })

  it('열린 채 답글이 표시되면 같은 부모 미읽음 수로 다시 읽음 처리한다', () => {
    const { rerender } = renderPanel()
    mocks.replies = [makeReply(11), makeReply(12)] // 0건 → 2건 도달(표시)
    rerender(panelElement())
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(2)
    expect(mocks.markThreadRead).toHaveBeenLastCalledWith(1, 3)
  })

  it('미읽음 수만 변해도(답글 수 그대로) 다시 읽음 처리한다', () => {
    const { rerender } = renderPanel()
    rerender(panelElement({ parent: makeParent({ unreadReplyCount: 4 }) }))
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(2)
    expect(mocks.markThreadRead).toHaveBeenLastCalledWith(1, 4)
  })

  it('답글이 먼저 와도(미읽음 0) 미읽음이 오르면 다시 읽음 처리한다(0 복귀 시 생략)', () => {
    const { rerender } = renderPanel({ parent: makeParent({ unreadReplyCount: 0 }) })
    mocks.replies = [makeReply(11)] // 답글 렌더 도착, 미읽음은 아직 0 → 생략
    rerender(panelElement({ parent: makeParent({ unreadReplyCount: 0 }) }))
    expect(mocks.markThreadRead).not.toHaveBeenCalled()
    rerender(panelElement({ parent: makeParent({ unreadReplyCount: 1 }) })) // 미읽음 렌더 도착 → 재발화
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(1)
    expect(mocks.markThreadRead).toHaveBeenCalledWith(1, 1)
    rerender(panelElement({ parent: makeParent({ unreadReplyCount: 0 }) })) // bump 반영(0) → 생략, 반복 없음
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(1)
  })

  it('부모 미읽음 수 0이면 처리하지 않는다', () => {
    renderPanel({ parent: makeParent({ unreadReplyCount: 0 }) })
    expect(mocks.markThreadRead).not.toHaveBeenCalled()
  })

  it('canMarkRead=false 이면 처리하지 않는다', () => {
    renderPanel({ canMarkRead: false })
    expect(mocks.markThreadRead).not.toHaveBeenCalled()
  })

  it('부모가 바뀌면 새 부모(id·미읽음 수) 기준으로 처리한다', () => {
    const { rerender } = renderPanel()
    rerender(panelElement({ parent: makeParent({ id: 9, unreadReplyCount: 2 }) }))
    expect(mocks.markThreadRead).toHaveBeenCalledTimes(2)
    expect(mocks.markThreadRead).toHaveBeenLastCalledWith(9, 2)
  })
})
