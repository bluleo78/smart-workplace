// AI 위임 작업 표 담당자 칸(WP-1100) — 작업자 요약의 active(WP-1160 부터 서버가 싣는다)로 정지 여부를 보인다.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import type { AgentWorkView } from '../../../types/issue'
import { AiTaskAssignee } from './AiTasksTable'

const worker = { id: 7, username: 'bot', name: '봇', kind: 'AGENT' as const }

function work(active?: boolean): AgentWorkView {
  return {
    worker: { ...worker, active },
    tool: null,
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

describe('AiTaskAssignee', () => {
  test('대표 작업의 작업자가 정지됐으면 회색 아바타·「(비활성)」 툴팁', () => {
    const issue = createIssue({ assignees: [{ ...worker, active: false }] })
    render(<AiTaskAssignee issue={issue} work={work(false)} testId="cell" />)
    expect(screen.getByTestId('cell')).toHaveAttribute('title', '봇 (에이전트) (비활성)')
    expect(screen.getByTestId('cell').querySelector('[data-inactive="true"]')).not.toBeNull()
  })

  // WP-1160: 담당에서 빠진 작업자는 담당자 요약이 없어 정지 여부를 알 수 없었다 — 작업자 요약의 active 로 본다.
  test('담당자가 아닌 정지된 작업자도 회색 아바타·「(비활성)」 툴팁', () => {
    const issue = createIssue({ assignees: [] })
    render(<AiTaskAssignee issue={issue} work={work(false)} testId="cell" />)
    expect(screen.getByTestId('cell')).toHaveAttribute('title', '봇 (에이전트) (비활성)')
    expect(screen.getByTestId('cell').querySelector('[data-inactive="true"]')).not.toBeNull()
  })

  test('활성 담당자면 보통 표기', () => {
    const issue = createIssue({ assignees: [{ ...worker, active: true }] })
    render(<AiTaskAssignee issue={issue} work={work(true)} testId="cell" />)
    expect(screen.getByTestId('cell')).toHaveAttribute('title', '봇 (에이전트)')
    expect(screen.getByTestId('cell').querySelector('[data-inactive="true"]')).toBeNull()
  })
})
