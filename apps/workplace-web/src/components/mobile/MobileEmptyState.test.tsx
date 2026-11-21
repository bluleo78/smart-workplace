import { render, screen } from '@testing-library/react'
import { Bell } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import { MobileEmptyState } from './MobileEmptyState'

// 모바일 전체 화면 빈 상태 규격(WP-1939) — 아이콘은 흐린 색(/40) 없이 muted 그대로여야 한다.
describe('MobileEmptyState', () => {
  it('아이콘·제목·설명이 모바일 규격 클래스를 쓴다', () => {
    const { container } = render(<MobileEmptyState icon={Bell} title="알림 없음" description="새 알림이 없습니다" />)
    const icon = container.querySelector('svg')!
    expect(icon).toHaveClass('h-12', 'w-12', 'text-muted-foreground')
    expect(icon.getAttribute('class')).not.toContain('/40')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('알림 없음')).toHaveClass('text-[17px]', 'font-semibold')
    expect(screen.getByText('새 알림이 없습니다')).toHaveClass('text-sm', 'text-muted-foreground')
  })
})
