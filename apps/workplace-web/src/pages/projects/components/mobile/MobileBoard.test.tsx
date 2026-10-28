// 모바일 보드 — 조건을 바꿔 새 결과를 받는 동안(WP-1049)의 탭 수·스크롤.
// 받는 동안은 이전 카드가 남아 있으므로, 결과가 다 들어온 때에만 목록을 맨 위로 올린다(데스크톱 보드·목록과 같은 규칙).
// 탭·헤더의 수는 이전 조건의 것이라 받는 동안 비워 둔다.
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { MobileBoard, type MobileBoardTab } from './MobileBoard'

const tab = (over: Partial<MobileBoardTab> = {}): MobileBoardTab => ({
  statusId: 1,
  category: 'TODO',
  label: '할 일',
  count: 3,
  hasMore: true,
  pending: false,
  ...over,
})

const board = (tabs: MobileBoardTab[], scrollReset: { key: string; refreshing: boolean }) => (
  <MobileBoard tabs={tabs} scrollReset={scrollReset}>
    {() => <div>카드</div>}
  </MobileBoard>
)

afterEach(() => vi.restoreAllMocks())

describe('모바일 보드 — 조건을 바꿔 받는 동안(WP-1049)', () => {
  test('받는 동안은 스크롤을 두고, 새 결과가 다 들어오면 맨 위로 올린다', () => {
    const scrollTo = vi.spyOn(Element.prototype, 'scrollTo')
    const { rerender } = renderWithProviders(board([tab()], { key: 'a', refreshing: false }))
    scrollTo.mockClear()

    rerender(board([tab({ refreshing: true })], { key: 'b', refreshing: true }))
    expect(scrollTo).not.toHaveBeenCalled()

    rerender(board([tab()], { key: 'b', refreshing: false }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
  })

  test('받는 동안 탭·헤더의 수는 비우고, 받은 뒤에는 「N+」로 보인다', () => {
    const { rerender } = renderWithProviders(board([tab({ refreshing: true })], { key: 'b', refreshing: true }))
    expect(screen.getByTestId('board-tab-count-1')).toHaveTextContent(/^$/)
    expect(screen.getByTestId('board-tab-header')).not.toHaveTextContent('3')

    rerender(board([tab()], { key: 'b', refreshing: false }))
    expect(screen.getByTestId('board-tab-count-1')).toHaveTextContent('3+')
    expect(screen.getByTestId('board-tab-header')).toHaveTextContent('3+')
  })
})
