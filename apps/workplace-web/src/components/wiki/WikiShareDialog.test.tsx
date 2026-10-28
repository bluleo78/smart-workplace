// 노트 공유 창(WP-579) 컴포넌트 판정 — 외부 공유 정책에 따른 선택지, 외부일 때 권한 고정, 넓히는 변경의 확인,
// 사람 추가가 보내는 notify payload, 접근 요청 승인, 상위 공유 상속 상자·제외(WP-987).
// 실제 API 배선·요청 payload 는 E2E(wiki-share-owner)가 맡는다.
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { WikiPageShare, WikiPageShareState } from '../../types/wiki'
import { WikiShareDialog } from './WikiShareDialog'

// 공유 훅은 끊고, 쓰기 mutate 호출만 기록한다. 공유 저장은 차례대로 mutateAsync 로 보낸다(WP-1023).
const state = vi.hoisted(() => ({ data: undefined as unknown, isPending: false }))
const save = vi.hoisted(() => vi.fn())
const regenerate = vi.hoisted(() => vi.fn())
const revoke = vi.hoisted(() => vi.fn())
const decide = vi.hoisted(() => vi.fn())
const exclusion = vi.hoisted(() => vi.fn())
const copyText = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@/lib/copyText', () => ({ copyText }))
vi.mock('../../hooks/queries/useWikiShare', async () => {
  const { useQueryClient } = await import('@tanstack/react-query')
  const { wikiKeys } = await import('../../hooks/queries/wikiKeys')
  return {
    // 창은 차례가 오면 최신 공유를 쿼리 캐시에서 읽는다(WP-1023) — 끊은 훅이 돌려주는 값을 캐시에도 둔다.
    useWikiPageShare: (pageId: number) => {
      const qc = useQueryClient()
      if (state.data) qc.setQueryData(wikiKeys.share(pageId), state.data)
      return { data: state.data, isPending: state.isPending }
    },
    useWikiShareEvents: () => ({
      isPending: false,
      isError: false,
      data: [{ id: 1, type: 'CREATED', actor: { userId: 2, name: '김민지' }, detail: '링크 공유를 켰습니다', at: '2026-10-20T01:00:00Z' }],
    }),
    useWikiShareMutations: () => ({
      save: { mutateAsync: save, isPending: false },
      regenerate: { mutate: regenerate, isPending: false },
      revoke: { mutate: revoke, isPending: false },
      decide: { mutate: decide, isPending: false },
      exclusion: { mutate: exclusion, isPending: false },
    }),
  }
})
// 사람 고르기는 실제 검색 대신 한 명(id 7)을 바로 고르는 버튼으로 대신한다 — payload 만 본다.
// 사람·팀 검색(WP-1023)의 실제 검색·부서·내 그룹은 pages/wiki/wikiShare.test.tsx 가 MSW 로 본다.
vi.mock('./ShareTargetSearchPopover', () => ({
  ShareTargetSearchPopover: ({ onSelectPerson, trigger }: { onSelectPerson: (userId: number) => void; trigger: React.ReactNode }) => (
    <div>
      {trigger}
      <button type="button" onClick={() => onSelectPerson(7)}>
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
  exclusion.mockReset()
  copyText.mockClear()
})

const baseShare = (over: Partial<WikiPageShare> = {}): WikiPageShare => ({
  pageId: 5,
  token: 'wsh_abc',
  audience: 'WORKSPACE',
  permission: 'VIEW',
  includeChildren: false,
  people: [],
  groups: [],
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
  excludedFromParent: false,
  excludedPages: [],
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
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ includeChildren: true }))
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
  it('공유가 없을 때 스위치를 켜면 기본값(워크스페이스·보기·하위 포함·무기한)으로 만든다(WP-987)', async () => {
    renderDialog(baseState({ share: null }))
    expect(screen.queryByTestId('wiki-share-url')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('wiki-share-switch'))
    expect(save).toHaveBeenCalledWith({ audience: 'WORKSPACE', permission: 'VIEW', includeChildren: true, userIds: [], expiresAt: null })
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

  it('공유 기록은 서버가 준 한 줄을 「{행위자}님이 {내용}」으로 보인다', async () => {
    renderDialog(baseState())
    await userEvent.click(screen.getByTestId('wiki-share-history-toggle'))
    expect(await screen.findByTestId('wiki-share-history')).toHaveTextContent('김민지님이 링크 공유를 켰습니다')
  })
})

describe('상위 공유 상속(WP-987)', () => {
  const inherited = { pageId: 2, title: '프로젝트 문서', audience: 'WORKSPACE' as const, permission: 'VIEW' as const, token: 'wsh_parent' }

  function renderChild(over: Partial<WikiPageShareState> = {}, onOpenPage = vi.fn()) {
    state.data = baseState({ share: null, inheritedFrom: inherited, ...over })
    renderWithProviders(
      <WikiShareDialog open onOpenChange={() => {}} pageId={5} spaceId={1} pageTitle="회의록 3" childCount={0} onOpenPage={onOpenPage} />,
    )
    return screen.getByTestId('wiki-share-inherited')
  }

  it('받은 권한(범위·권한)을 보이고, 「이 페이지 링크 복사」는 상위 토큰 + 이 페이지 주소를 복사한다', async () => {
    const onOpenPage = vi.fn()
    const box = renderChild({}, onOpenPage)
    expect(within(box).getByTestId('wiki-share-inherited-summary')).toHaveTextContent(
      '「프로젝트 문서」 공유 · 워크스페이스 멤버 누구나 · 보기만',
    )
    await userEvent.click(within(box).getByTestId('wiki-share-inherited-copy'))
    expect(copyText).toHaveBeenCalledWith(`${window.location.origin}/wiki/share/wsh_parent/pages/5`)
    await userEvent.click(within(box).getByRole('button', { name: '그 페이지로' }))
    expect(onOpenPage).toHaveBeenCalledWith(2)
    // 따로 켜는 공유는 상위보다 우선한다는 안내.
    expect(screen.getByTestId('wiki-share-switch-hint')).toHaveTextContent('켜면 이 페이지의 범위·권한이 상위 공유보다 우선합니다.')
  })

  it('편집 권한 상위 공유는 「편집 가능」으로 보인다', () => {
    const box = renderChild({ inheritedFrom: { ...inherited, permission: 'EDIT', audience: 'PEOPLE' } })
    expect(within(box).getByTestId('wiki-share-inherited-summary')).toHaveTextContent('지정한 사람만 · 편집 가능')
  })

  it('「상위 공유에서 제외」 체크는 이 페이지의 제외를 켜고, 켜져 있으면 끈다', async () => {
    const box = renderChild()
    await userEvent.click(within(box).getByTestId('wiki-share-exclude'))
    expect(exclusion).toHaveBeenCalledWith({ targetPageId: 5, excluded: true }, expect.anything())
  })

  it('제외돼 있으면 체크가 켜져 있고, 링크 복사 대신 열리지 않는다는 안내를 보인다 — 체크를 풀면 제외를 푼다', async () => {
    const box = renderChild({ excludedFromParent: true })
    expect(within(box).getByTestId('wiki-share-exclude')).toBeChecked()
    expect(within(box).queryByTestId('wiki-share-inherited-copy')).not.toBeInTheDocument()
    expect(within(box).getByTestId('wiki-share-inherited-overridden')).toHaveTextContent('상위 공유에서 제외되어')
    await userEvent.click(within(box).getByTestId('wiki-share-exclude'))
    expect(exclusion).toHaveBeenCalledWith({ targetPageId: 5, excluded: false }, expect.anything())
  })

  it('따로 켠 공유가 있으면 상위 링크로는 열리지 않는다고 안내하고 링크 복사를 숨긴다', () => {
    const box = renderChild({ share: baseShare() })
    expect(within(box).queryByTestId('wiki-share-inherited-copy')).not.toBeInTheDocument()
    expect(within(box).getByTestId('wiki-share-inherited-overridden')).toHaveTextContent('따로 켠 공유를 따릅니다')
  })

  it('상위 창은 제외된 하위 수와 목록을 보이고, 「제외 풀기」는 그 하위의 제외를 푼다', async () => {
    renderDialog(
      baseState({ share: baseShare({ includeChildren: true }), excludedPages: [{ pageId: 9, title: '회의록 3' }] }),
    )
    expect(screen.getByText('하위 페이지도 함께 공유 (지금 3개, 제외 1개)')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-share-excluded')).toHaveTextContent('제외: 회의록 3')
    await userEvent.click(screen.getByTestId('wiki-share-excluded-lift-9'))
    expect(exclusion).toHaveBeenCalledWith({ targetPageId: 9, excluded: false }, expect.anything())
  })

  it('외부 공개 상위 공유에서 제외를 풀면 확인을 받은 뒤에만 푼다', async () => {
    const box = renderChild({ excludedFromParent: true, inheritedFrom: { ...inherited, audience: 'PUBLIC' } })
    await userEvent.click(within(box).getByTestId('wiki-share-exclude'))
    expect(exclusion).not.toHaveBeenCalled()
    const confirm = await screen.findByTestId('wiki-share-confirm')
    expect(confirm).toHaveTextContent('외부 공개에 다시 포함할까요?')
    await userEvent.click(within(confirm).getByRole('button', { name: '포함' }))
    expect(exclusion).toHaveBeenCalledWith({ targetPageId: 5, excluded: false }, expect.anything())
  })

  it('상위 공유를 받는 페이지가 자기 공유를 해제하면 상위 공유대로 다시 열린다고 알린다', async () => {
    renderChild({ share: baseShare() })
    await userEvent.click(screen.getByTestId('wiki-share-switch'))
    const confirm = await screen.findByTestId('wiki-share-confirm')
    expect(confirm).toHaveTextContent('다시 상위 공유의 설정대로 열립니다')
    expect(confirm).not.toHaveTextContent('스페이스 멤버는 그대로 볼 수 있습니다')
  })
})
