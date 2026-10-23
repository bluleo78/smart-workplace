// 불러오기 실패 상태(WP-865) — 세 배치 모두 안내를 alert 로 알리고, 다시 시도는 다시 부르는 동안 잠긴다.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LoadErrorState } from './LoadErrorState'

describe('LoadErrorState', () => {
  it.each(['block', 'inline', 'banner'] as const)('%s — 제목을 alert 로 보이고 다시 시도가 onRetry 를 부른다', (variant) => {
    const onRetry = vi.fn()
    render(<LoadErrorState variant={variant} title="공간 목록을 불러오지 못했습니다" onRetry={onRetry} testId="x" />)
    expect(screen.getByRole('alert')).toHaveTextContent('공간 목록을 불러오지 못했습니다')
    fireEvent.click(screen.getByTestId('x-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('다시 부르는 중이면 버튼을 잠근다 — 연타로 같은 요청을 거듭 보내지 않게', () => {
    render(<LoadErrorState title="t" onRetry={() => {}} retrying testId="x" />)
    expect(screen.getByTestId('x-retry')).toBeDisabled()
  })

  it('보조 설명은 block 에만 보인다', () => {
    const { rerender } = render(<LoadErrorState title="t" description="잠시 뒤 다시" onRetry={() => {}} testId="x" />)
    expect(screen.getByText('잠시 뒤 다시')).toBeInTheDocument()
    rerender(<LoadErrorState variant="inline" title="t" description="잠시 뒤 다시" onRetry={() => {}} testId="x" />)
    expect(screen.queryByText('잠시 뒤 다시')).toBeNull()
  })
})
