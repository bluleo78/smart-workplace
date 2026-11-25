// IconHint 판정 — 터치 팝오버가 label 을 이름으로 가진 대화상자로 열리는지(WP-2075).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IconHint } from '@/components/overlay/IconHint'

// 포인터 종류를 테스트마다 바꾼다.
const coarse = vi.hoisted(() => ({ value: true }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => coarse.value }))

describe('IconHint', () => {
  beforeEach(() => {
    coarse.value = true
  })

  it('터치에서 누르면 이름이 label 인 대화상자로 열린다', async () => {
    render(
      <IconHint label="연결됨" detail={<span>3분 전</span>} data-testid="hint">
        <svg aria-label="상태" />
      </IconHint>,
    )
    await userEvent.click(screen.getByTestId('hint'))
    // detail 은 이름에 섞이지 않는다.
    expect(screen.getByRole('dialog', { name: '연결됨' })).toHaveAccessibleName('연결됨')
  })

  it('정밀 포인터에서는 눌러도 팝오버 대화상자가 아니라 포커스 받는 툴팁 트리거다', async () => {
    coarse.value = false
    render(
      <IconHint label="연결됨" data-testid="hint">
        <svg aria-label="상태" />
      </IconHint>,
    )
    const trigger = screen.getByTestId('hint')
    // 팝오버는 눌러야 열리므로 눌러 본다 — 터치 분기로 잘못 가면 여기서 대화상자가 뜬다.
    await userEvent.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
    // 툴팁 분기는 키보드로 닿게 포커스 받는 span 이다.
    expect(trigger.tagName).toBe('SPAN')
    expect(trigger).toHaveAttribute('tabindex', '0')
  })
})
