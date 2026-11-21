import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { emptyStateDescriptionClass, emptyStateIconClass, emptyStateTitleClass } from '@/components/layout/empty-state'

import { ListEmptyState } from './ListEmptyState'

// 빈 상태 규격 상수(WP-1924, DS 06 §B)를 ListEmptyState 가 그대로 쓰는지 확인한다.
describe('ListEmptyState', () => {
  it('규격 상수로 그린다', () => {
    const { container } = render(
      <ListEmptyState
        icon={Inbox}
        title="비어 있음"
        description="아직 항목이 없습니다."
        action={{ label: '만들기', onClick: vi.fn(), testId: 'empty-action' }}
        testId="empty"
      />,
    )
    expect(container.querySelector('svg')).toHaveClass(...emptyStateIconClass.split(' '))
    expect(screen.getByText('비어 있음')).toHaveClass(...emptyStateTitleClass.split(' '))
    expect(screen.getByText('아직 항목이 없습니다.')).toHaveClass(...emptyStateDescriptionClass.split(' '))
    expect(screen.getByTestId('empty-action')).toBeTruthy()
  })
})
