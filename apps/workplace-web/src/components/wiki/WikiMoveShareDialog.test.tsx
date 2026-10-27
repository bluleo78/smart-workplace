// 같은 스페이스 안 이동의 공유 범위 확인 창(WP-579) — 빠지는·들어가는 공유 문구와, 상위 공유에서 제외된 페이지의 안내(WP-1031).
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import type { WikiPageSummary } from '../../types/wiki'
import { WikiMoveShareDialog } from './WikiMoveShareDialog'
import { shareMoveImpact } from './wikiShare'

const page = (id: number, title: string, parentId: number | null = null, share: WikiPageSummary['share'] = null) =>
  ({ id, title, parentId, position: 0, share }) as WikiPageSummary
const including = (audience: 'WORKSPACE' | 'PUBLIC') => ({ audience, includeChildren: true }) as WikiPageSummary['share']

/** A(하위 포함 공유) 아래의 X 를 B(하위 포함 공유) 아래로 옮기는 트리 — excluded 면 X 에 상위 공유 제외 표시. */
function tree(excluded: boolean): WikiPageSummary[] {
  return [page(1, '로드맵', null, including('WORKSPACE')), { ...page(2, '회의록', 1), shareExcluded: excluded }, page(3, '공개 문서', null, including('PUBLIC'))]
}

function renderFor(excluded: boolean) {
  renderWithProviders(
    <WikiMoveShareDialog state={{ impact: shareMoveImpact(tree(excluded), 2, 3), title: '회의록' }} onCancel={vi.fn()} onConfirm={vi.fn()} />,
  )
  return screen.getByTestId('wiki-move-share-dialog')
}

describe('WikiMoveShareDialog', () => {
  it('제외 표시가 없으면 옛 공유에서 빠지고 새 공유로 새로 보이게 된다고 알린다', () => {
    const dialog = renderFor(false)
    expect(within(dialog).getByRole('heading')).toHaveTextContent('공유 범위가 바뀝니다')
    expect(dialog).toHaveTextContent('「로드맵」 공유 링크로 더 이상 보이지 않습니다.')
    expect(dialog).toHaveTextContent('「공개 문서」 외부 공개 링크로 새로 보이게 됩니다.')
    expect(within(dialog).queryByTestId('wiki-move-share-blocked')).toBeNull()
  })

  it('상위 공유에서 제외된 페이지는 새 위치 공유로 열리지 않는다고 알린다(WP-1031)', () => {
    const dialog = renderFor(true)
    expect(within(dialog).getByRole('heading')).toHaveTextContent('새 위치의 공유 링크로는 열리지 않습니다')
    expect(within(dialog).getByTestId('wiki-move-share-blocked')).toHaveTextContent(
      '상위 공유에서 제외돼 있어 새 위치의 「공개 문서」 외부 공개 링크로는 열리지 않습니다.',
    )
    expect(dialog).not.toHaveTextContent('새로 보이게 됩니다')
    expect(dialog).not.toHaveTextContent('더 이상 보이지 않습니다')
  })
})
