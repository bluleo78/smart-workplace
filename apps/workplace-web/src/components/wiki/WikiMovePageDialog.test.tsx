// 노트 「이동…」 대화상자의 다른 스페이스 이동(WP-988) — 스페이스 고르기·그 스페이스 트리·영향 경고·보낼 값.
// 사이드바 배선(요청 PATCH·이동 뒤 주소)은 서버 통합 테스트와 라이브 확인이 본다.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { WikiMovePreview, WikiPageSummary, WikiSpace } from '../../types/wiki'
import { WikiMovePageDialog } from './WikiMovePageDialog'

const trees = vi.hoisted(() => ({ value: {} as Record<number, WikiPageSummary[]>, loading: false }))
vi.mock('../../hooks/queries/useWikiTree', () => ({
  useWikiTree: (spaceId: number | null) => ({
    data: spaceId == null || trees.loading ? undefined : trees.value[spaceId],
    isLoading: spaceId != null && trees.loading,
  }),
}))
const preview = vi.hoisted(() => ({ value: undefined as WikiMovePreview | undefined, failed: false, args: [] as unknown[][] }))
vi.mock('../../hooks/queries/useWikiMutations', () => ({
  useWikiMovePreview: (...args: unknown[]) => {
    preview.args.push(args)
    return { data: args[1] == null ? undefined : preview.value, isError: args[1] != null && preview.failed }
  },
}))

const page = (id: number, title: string, parentId: number | null = null, share: WikiPageSummary['share'] = null): WikiPageSummary =>
  ({ id, title, parentId, position: 0, share }) as WikiPageSummary
const space = (id: number, name: string, role: WikiSpace['role']): WikiSpace =>
  ({ id, name, role, type: 'TEAM', ownerId: 1, createdAt: '2026-10-01T00:00:00Z' }) as WikiSpace

const spaces = [space(1, '제품팀', 'OWNER'), space(2, '디자인팀', 'EDITOR'), space(3, '읽기전용', 'VIEWER')]

function renderDialog(onPick = vi.fn(), pages: WikiPageSummary[] = [page(10, '옮길 문서'), page(11, '다른 문서')]) {
  renderWithProviders(
    <WikiMovePageDialog
      spaceId={1}
      spaces={spaces}
      pages={pages}
      pageId={10}
      onClose={() => {}}
      onPick={onPick}
    />,
  )
  return onPick
}

// Radix Select 는 jsdom 에 없는 포인터 캡처·scrollIntoView 를 부른다 — 빈 구현으로 채운다.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  trees.value = { 2: [page(20, '디자인 가이드'), page(21, '컬러', 20)] }
  preview.value = { pageCount: 2, lostMemberCount: 3, gainedMemberCount: 5, keptShares: [{ pageId: 10, title: '옮길 문서' }], revokedShares: [{ pageId: 11, title: '하위 공유' }] }
  preview.args = []
  preview.failed = false
  trees.loading = false
})

describe('WikiMovePageDialog 다른 스페이스 — 자기 공유가 있는 페이지(WP-1043)', () => {
  const own = page(10, '옮길 문서', null, { audience: 'PEOPLE', includeChildren: false } as WikiPageSummary['share'])
  const publicTree = [page(20, '공개 문서', null, { audience: 'PUBLIC', includeChildren: true } as WikiPageSummary['share']), page(21, '공개 하위', 20)]

  async function pickPublicChild() {
    trees.value = { 2: publicTree }
    renderDialog(vi.fn(), [own, page(11, '다른 문서')])
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    await userEvent.click(screen.getByTestId('wiki-move-option-21'))
    return screen.findByTestId('wiki-move-space-warning')
  }

  it('자기 공유가 따라가면 새 위치 공유로 열리지 않는다고 알린다', async () => {
    preview.value = { pageCount: 1, lostMemberCount: 0, gainedMemberCount: 0, keptShares: [{ pageId: 10, title: '옮길 문서' }], revokedShares: [] }
    const warning = await pickPublicChild()
    expect(within(warning).getByTestId('wiki-move-share-blocked')).toHaveTextContent('따로 켠 공유가 우선')
    expect(warning).not.toHaveTextContent('새로 보이게 됩니다')
  })

  it('옮기며 자기 공유가 해제되면 옮긴 뒤에는 열리므로 「새로 보이게 됩니다」로 알린다 — 해제 안내와 모순되지 않는다', async () => {
    preview.value = { pageCount: 1, lostMemberCount: 0, gainedMemberCount: 0, keptShares: [], revokedShares: [{ pageId: 10, title: '옮길 문서' }] }
    const warning = await pickPublicChild()
    expect(warning).toHaveTextContent('공유 링크는 공유한 사람이 새 스페이스 편집자가 아니라 해제됩니다')
    expect(warning).toHaveTextContent('「공개 문서」 외부 공개 링크로 새로 보이게 됩니다')
    expect(within(warning).queryByTestId('wiki-move-share-blocked')).toBeNull()
  })
})

describe('WikiMovePageDialog 다른 스페이스', () => {
  it('편집할 수 없는 스페이스는 고를 수 없다', async () => {
    renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    const options = await screen.findAllByRole('option', { hidden: true })
    const names = options.map((o) => o.textContent)
    expect(names).toContain('디자인팀')
    expect(names).not.toContain('읽기전용')
  })

  it('다른 스페이스를 고르면 그 트리를 보이고 영향 경고를 띄우며, 옮기면 대상 스페이스 id 와 함께 넘긴다', async () => {
    const onPick = renderDialog()
    // 같은 스페이스 안에서는 경고가 없고 미리보기도 부르지 않는다.
    expect(screen.queryByTestId('wiki-move-space-warning')).toBeNull()
    expect(preview.args.every((a) => a[1] == null)).toBe(true)

    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))

    const list = screen.getByTestId('wiki-move-list')
    expect(within(list).getByText('디자인 가이드')).toBeInTheDocument()
    expect(within(list).queryByText('다른 문서')).toBeNull()
    const warning = await screen.findByTestId('wiki-move-space-warning')
    expect(warning).toHaveTextContent('2개 페이지가 함께 옮겨집니다')
    expect(warning).toHaveTextContent('멤버 3명')
    expect(warning).toHaveTextContent('새 스페이스 멤버 5명이 이 페이지를 볼 수 있게 됩니다')
    expect(warning).toHaveTextContent('「하위 공유」 공유 링크는 공유한 사람이 새 스페이스 편집자가 아니라 해제됩니다')
    expect(preview.args.at(-1)).toEqual([10, 2])

    // 다른 스페이스에서는 「지금 위치」가 없어 최상위도 고를 수 있다.
    await userEvent.click(screen.getByTestId('wiki-move-option-20'))
    await userEvent.click(screen.getByTestId('wiki-move-confirm'))
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(20, 2))
  })

  it('경고(미리보기)가 오기 전에는 옮기기를 막는다', async () => {
    preview.value = undefined
    renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    await userEvent.click(screen.getByTestId('wiki-move-option-root'))
    expect(screen.getByTestId('wiki-move-confirm')).toBeDisabled()
  })

  it('미리보기가 실패하면 이유를 알리고 옮기기는 막아 둔다', async () => {
    preview.value = undefined
    preview.failed = true
    renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    expect(await screen.findByTestId('wiki-move-preview-error')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-move-confirm')).toBeDisabled()
  })

  it('대상 스페이스 트리를 받는 동안은 「맞는 페이지가 없습니다」 대신 불러오는 중을 보이고 옮기기를 막는다', async () => {
    trees.loading = true
    renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    expect(screen.getByTestId('wiki-move-tree-loading')).toBeInTheDocument()
    expect(screen.queryByText('맞는 페이지가 없습니다')).toBeNull()
    await userEvent.click(screen.getByTestId('wiki-move-option-root'))
    expect(screen.getByTestId('wiki-move-confirm')).toBeDisabled()
  })

  it('고른 자리를 덮는 대상 스페이스의 하위 포함 공유를 경고에 보인다 — 외부 공개면 그렇다고 적는다', async () => {
    trees.value = {
      2: [
        page(20, '공개 문서', null, { audience: 'PUBLIC', includeChildren: true } as WikiPageSummary['share']),
        page(21, '공개 하위', 20),
        page(22, '공유 없음'),
      ],
    }
    renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    await userEvent.click(screen.getByTestId('wiki-move-option-21'))
    expect(await screen.findByTestId('wiki-move-space-warning')).toHaveTextContent('「공개 문서」 외부 공개 링크로 새로 보이게 됩니다')
    await userEvent.click(screen.getByTestId('wiki-move-option-22'))
    expect(screen.getByTestId('wiki-move-space-warning')).not.toHaveTextContent('새로 보이게 됩니다')
  })

  it('상위 공유에서 제외된 페이지는 새 위치 공유로 「새로 보이게 됩니다」 대신 열리지 않는다고 알린다(WP-1031)', async () => {
    trees.value = {
      2: [page(20, '공개 문서', null, { audience: 'PUBLIC', includeChildren: true } as WikiPageSummary['share']), page(21, '공개 하위', 20)],
    }
    renderDialog(vi.fn(), [
      page(9, '로드맵', null, { audience: 'WORKSPACE', includeChildren: true } as WikiPageSummary['share']),
      { ...page(10, '옮길 문서', 9), shareExcluded: true },
      page(11, '다른 문서'),
    ])
    await userEvent.click(screen.getByTestId('wiki-move-space'))
    await userEvent.click(await screen.findByRole('option', { name: '디자인팀' }))
    await userEvent.click(screen.getByTestId('wiki-move-option-21'))
    const warning = await screen.findByTestId('wiki-move-space-warning')
    expect(within(warning).getByTestId('wiki-move-share-blocked')).toHaveTextContent(
      '상위 공유에서 제외돼 있어 새 위치의 「공개 문서」 외부 공개 링크로는 열리지 않습니다.',
    )
    expect(warning).not.toHaveTextContent('새로 보이게 됩니다')
    // 원래 덮이지 않았으므로 옛 위치 공유에서 「더 이상 보이지 않습니다」도 없다.
    expect(warning).not.toHaveTextContent('더 이상 보이지 않습니다')
  })

  it('같은 스페이스 안 이동은 지금 스페이스 id 로 넘긴다', async () => {
    const onPick = renderDialog()
    await userEvent.click(screen.getByTestId('wiki-move-option-11'))
    await userEvent.click(screen.getByTestId('wiki-move-confirm'))
    expect(onPick).toHaveBeenCalledWith(11, 1)
  })
})
