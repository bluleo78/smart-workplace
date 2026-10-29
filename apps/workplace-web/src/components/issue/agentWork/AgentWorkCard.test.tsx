// 이슈 상세 AI 작업 카드의 작업자 아바타(WP-1160) — 서버가 작업자 요약에 싣는 active 로 정지된 작업자를 회색으로 보인다
// (AI 위임 작업 표·담당자 칸과 같은 표기). 카드 하나만 띄우는 컴포넌트 테스트.
import { screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { AgentWorkView } from '@/types/issue'

import { AgentWorkCard } from './AgentWorkCard'

function work(active?: boolean): AgentWorkView {
  return {
    worker: { id: 7, username: 'bot', name: '봇', kind: 'AGENT', active },
    tool: 'claude-code',
    state: 'WORKING',
    note: null,
    progress: null,
    stepsDone: null,
    stepsTotal: null,
    startedAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
    stale: false,
  } as AgentWorkView
}

describe('AgentWorkCard 작업자', () => {
  test('정지된 작업자는 회색 아바타 + 접근 이름 「(비활성)」', () => {
    renderWithProviders(<AgentWorkCard list={[work(false)]} onOpenChat={vi.fn()} />)
    const avatar = screen.getByTestId('user-avatar-7')
    expect(avatar).toHaveAttribute('data-inactive', 'true')
    expect(avatar).toHaveAccessibleName('봇 (에이전트) (비활성)')
  })

  test('활성 작업자는 보통 아바타', () => {
    renderWithProviders(<AgentWorkCard list={[work(true)]} onOpenChat={vi.fn()} />)
    expect(screen.getByTestId('user-avatar-7')).not.toHaveAttribute('data-inactive')
  })
})
