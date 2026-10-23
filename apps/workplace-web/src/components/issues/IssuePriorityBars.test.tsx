// 우선순위 아이콘(WP-886) — 5단계는 각자 라벨로 읽힌다.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { IssuePriorityBars } from './IssuePriorityBars'

describe('IssuePriorityBars', () => {
  it.each([
    ['HIGHEST', '매우 높음'],
    ['HIGH', '높음'],
    ['MID', '보통'],
    ['LOW', '낮음'],
    ['LOWEST', '매우 낮음'],
  ] as const)('%s 는 「우선순위 %s」 로 읽힌다', (priority, label) => {
    render(<IssuePriorityBars priority={priority} />)
    expect(screen.getByRole('img', { name: `우선순위 ${label}` })).toBeInTheDocument()
  })
})
