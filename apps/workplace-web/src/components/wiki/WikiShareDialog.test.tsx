// 노트 공유 창(WP-579) 컴포넌트 판정 — 외부 공유 정책에 따른 선택지, 외부일 때 권한 고정, 넓히는 변경의 확인,
// 사람 추가가 보내는 notify payload, 접근 요청 승인. 실제 API 배선·요청 payload 는 E2E(wiki-share-owner)가 맡는다.
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { WikiPageShare, WikiPageShareState } from '../../types/wiki'
import { WikiShareDialog } from './WikiShareDialog'

// 공유 훅은 끊고, 쓰기 mutate 호출만 기록한다.
const state = vi.hoisted(() => ({ data: undefined as unknown, isPending: false }))
const save = vi.hoisted(() => vi.fn())
const regenerate = vi.hoisted(() => vi.fn())
const revoke = vi.hoisted(() => vi.fn())
const decide = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/queries/useWikiShare', () => ({
  useWikiPageShare: () => ({ data: state.data, isPending: state.isPending }),
  useWikiShareEvents: () => ({
    isPending: false,
    isError: false,
    data: [{ id: 1, type: 'CREATED', actor: { userId: 2, name: '김민지' }, detail: '링크 공유를 켰습니다', at: '2026-10-20T01:00:00Z' }],
  }),
  useWikiShareMutations: () => ({
    save: { mutate: save, isPending: false },
    regenerate: { mutate: regenerate, isPending: false },
    revoke: { mutate: revoke, isPending: false },
    decide: { mutate: decide, isPending: false },
  }),
}))
// 사람 고르기는 실제 검색 대신 한 명(id 7)을 바로 고르는 버튼으로 대신한다 — payload 만 본다.
vi.mock('@/pages/projects/components/MemberSearchPopover', () => ({
  MemberSearchPopover: ({ onSelect, trigger }: { onSelect: (u: { id: number }) => void; trigger: React.ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelect({ id: 7 })}>
        7번 고르기
      </button>
    </div>
  ),
}))

beforeEach(() => {
  save.mockReset()
  regenerate.mockReset()
  revoke.mockReset()
  decide.mockReset()
})

const baseShare = (over: Partial<WikiPageShare> = {}): WikiPageShare => ({
  pageId: 5,
  token: 'wsh_abc',
  audience: 'WORKSPACE',
  permission: 'VIEW',
  includeChildren: false,
  people: [],
  createdBy: { userId: 2, name: '김민지' },
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
  expiresAt: null,
  lastAccessedAt: null,
  viewCount: 0,
  ...over,
})
const baseState = (over: Partial<WikiPageShareState> = {}): WikiPageShareState => ({
  share: baseShare(),
  externalShareEnabled: true,
  inheritedFrom: null,
  accessRequests: [],
  ...over,
})

function renderDialog(s: WikiPageShareState) {
  state.data = s
  return renderWithProviders(
    <WikiShareDialog open onOpenChange={() => {}} pageId={5} spaceId={1} pageTitle="로드맵" childCount={3} onOpenPage={() => {}} />,
  )
}

describe('열 수 있는 사람 선택지', () => {
  it('관리자가 외부 공유를 껐으면 외부 항목은 비활성이고 사유가 붙는다', async () => {
    renderDialog(baseState({ externalShareEnabled: false }))
    await userEvent.click(screen.getByTestId('wiki-share-audience'))
    const item = await screen.findByRole('option', { name: /링크가 있는 누구나\(외부\)/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent('관리자가 막아 둠')
  })

  it('외부 공유가 허용돼 있으면 외부 항목을 고를 수 있다', async () => {
    renderDialog(baseState())
    await userEvent.click(screen.getByTestId('wiki-share-audience'))
    const item = await screen.findByRole('option', { name: /링크가 있는 누구나\(외부\)/ })
    expect(item).not.toHaveAttribute('aria-disabled', 'true')
    expect(item).not.toHaveTextContent('관리자가 막아 둠')
  })

  it('외부 링크면 권한 선택이 잠기고, 내부 링크면 열려 있다', () => {
    const { unmount } = renderDialog(baseState({ share: baseShare({ audience: 'PUBLIC' }) }))
    expect(screen.getByTestId('wiki-share-permission')).toBeDisabled()
    unmount()
    renderDialog(baseState())
    expect(screen.getByTestId('wiki-share-permission')).toBeEnabled()
  })
})

describe('확인 절차', () => {
  it('외부로 바꾸면 확인 뒤에야 보기·이 페이지만·만료 있는 값으로 저장한다', async () => {
    renderDialog(baseState({ share: baseShare({ permission: 'EDIT', includeChildren: true }) }))
    await userEvent.click(screen.getByTestId('wiki-share-audience'))
    await userEvent.click(await screen.findByRole('option', { name: /링크가 있는 누구나\(외부\)/ }))
    // 확인 전에는 저장하지 않는다.
    expect(save).not.toHaveBeenCalled()
    const confirm = await screen.findByTestId('wiki-share-confirm')
    expect(within(confirm).getByText('외부에 공개할까요?')).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: '외부 공개' }))
    expect(save).toHaveBeenCalledTimes(1)
    const body = save.mock.calls[0][0]
    expect(body).toMatchObject({ audience: 'PUBLIC', permission: 'VIEW', includeChildren: false })
    expect(typeof body.expiresAt).toBe('string')
  })

  it('넓히지 않는 변경(하위 페이지 포함)은 묻지 않고 바로 저장한다', async () => {
    renderDialog(baseState())
    await userEvent.click(screen.getByTestId('wiki-share-children'))
    expect(screen.queryByTestId('wiki-share-confirm')).not.toBeInTheDocument()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ includeChildren: true }), expect.anything())
  })

  it('해제와 재발급은 확인을 거쳐야 보낸다', async () => {
    renderDialog(baseState())
    await userEvent.click(screen.getByTestId('wiki-share-switch'))
    expect(revoke).not.toHaveBeenCalled()
    await userEvent.click(within(await screen.findByTestId('wiki-share-confirm')).getByRole('button', { name: '해제' }))
    expect(revoke).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByTestId('wiki-share-regenerate'))
    expect(regenerate).not.toHaveBeenCalled()
    await userEvent.click(within(await screen.findByTestId('wiki-share-confirm')).getByRole('button', { name: '다시 만들기' }))
    expect(regenerate).toHaveBeenCalledTimes(1)
  })
})

describe('공유 켜기', () => {
  it('공유가 없을 때 스위치를 켜면 기본값(워크스페이스·보기·이 페이지만·무기한)으로 만든다', async () => {
    renderDialog(baseState({ share: null }))
    expect(screen.queryByTestId('wiki-share-url')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('wiki-share-switch'))
    expect(save).toHaveBeenCalledWith(
      { audience: 'WORKSPACE', permission: 'VIEW', includeChildren: false, userIds: [], expiresAt: null },
      expect.anything(),
    )
  })
})

describe('지정한 사람 추가 — notify payload', () => {
  const people = baseShare({ audience: 'PEOPLE', people: [{ userId: 3, name: '박' }] })

  it('알림을 켜 두고 메시지를 적으면 notify.message 와 함께 기존 사람 + 새 사람을 보낸다', async () => {
    renderDialog(baseState({ share: people }))
    await userEvent.type(screen.getByTestId('wiki-share-message'), '  확인 부탁드립니다  ')
    await userEvent.click(screen.getByRole('button', { name: '7번 고르기' }))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toMatchObject({
      audience: 'PEOPLE',
      userIds: [3, 7],
      notify: { message: '확인 부탁드립니다' },
    })
  })

  it('메시지 입력은 서버 상한(4000자)까지만 받는다', () => {
    renderDialog(baseState({ share: people }))
    expect(screen.getByTestId('wiki-share-message')).toHaveAttribute('maxLength', '4000')
  })

  it('메시지를 비워 두면 message 는 null 이다(알림은 보낸다)', async () => {
    renderDialog(baseState({ share: people }))
    await userEvent.click(screen.getByRole('button', { name: '7번 고르기' }))
    expect(save.mock.calls[0][0].notify).toEqual({ message: null })
  })

  it('알림 보내기를 끄면 notify 를 싣지 않는다', async () => {
    renderDialog(baseState({ share: people }))
    await userEvent.click(screen.getByTestId('wiki-share-notify'))
    expect(screen.queryByTestId('wiki-share-message')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '7번 고르기' }))
    expect(save.mock.calls[0][0].notify).toBeUndefined()
    expect(save.mock.calls[0][0].userIds).toEqual([3, 7])
  })

  it('사람을 빼면 남은 사람만 보낸다(알림 없음)', async () => {
    renderDialog(baseState({ share: people }))
    await userEvent.click(screen.getByRole('button', { name: '박 빼기' }))
    expect(save.mock.calls[0][0]).toMatchObject({ userIds: [] })
    expect(save.mock.calls[0][0].notify).toBeUndefined()
  })
})

describe('접근 요청·상위 공유·기록', () => {
  it('접근 요청이 있으면 승인·거절 버튼이 요청 id 와 함께 호출된다', async () => {
    renderDialog(
      baseState({ accessRequests: [{ id: 41, requester: { userId: 9, name: '최' }, requestedAt: '2026-10-20T02:00:00Z' }] }),
    )
    const box = screen.getByTestId('wiki-share-requests')
    expect(within(box).getByText(/접근 요청 1건/)).toBeInTheDocument()
    fireEvent.click(within(box).getByRole('button', { name: '승인' }))
    expect(decide).toHaveBeenCalledWith({ requestId: 41, approve: true }, expect.anything())
    fireEvent.click(within(box).getByRole('button', { name: '거절' }))
    expect(decide).toHaveBeenLastCalledWith({ requestId: 41, approve: false }, expect.anything())
  })

  it('접근 요청이 없으면 요청 상자를 그리지 않는다', () => {
    renderDialog(baseState())
    expect(screen.queryByTestId('wiki-share-requests')).not.toBeInTheDocument()
  })

  it('상위 공유에 포함된 페이지면 그 공유 제목과 이동 링크를 안내한다', async () => {
    const onOpenPage = vi.fn()
    state.data = baseState({ share: null, inheritedFrom: { pageId: 2, title: '제품 로드맵', audience: 'PUBLIC' } })
    renderWithProviders(
      <WikiShareDialog open onOpenChange={() => {}} pageId={5} spaceId={1} pageTitle="로드맵" childCount={0} onOpenPage={onOpenPage} />,
    )
    const note = screen.getByTestId('wiki-share-inherited')
    expect(note).toHaveTextContent('「제품 로드맵」')
    expect(note).toHaveTextContent('외부 링크로도')
    await userEvent.click(within(note).getByRole('button', { name: '그 페이지로' }))
    expect(onOpenPage).toHaveBeenCalledWith(2)
  })

  it('공유 기록은 서버가 준 한 줄을 「{행위자}님이 {내용}」으로 보인다', async () => {
    renderDialog(baseState())
    await userEvent.click(screen.getByTestId('wiki-share-history-toggle'))
    expect(await screen.findByTestId('wiki-share-history')).toHaveTextContent('김민지님이 링크 공유를 켰습니다')
  })
})
