// AI 위임 작업 표 담당자 칸(WP-1100) — 작업자 요약에는 active 가 없어, 같은 사람의 담당자 요약으로 정지 여부를 보는지 확인한다.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { createIssue } from '../../../../e2e/factories/issue.factory'
import type { AgentWorkView } from '../../../types/issue'
import { AiTaskAssignee } from './AiTasksTable'

const worker = { id: 7, username: 'bot', name: '봇', kind: 'AGENT' as const }

function work(): AgentWorkView {
  return {
    worker,
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
  test('대표 작업의 작업자가 정지된 담당자면 회색 아바타·「(비활성)」 툴팁', () => {
    const issue = createIssue({ assignees: [{ ...worker, active: false }] })
    render(<AiTaskAssignee issue={issue} work={work()} testId="cell" />)
    expect(screen.getByTestId('cell')).toHaveAttribute('title', '봇 (에이전트) (비활성)')
    expect(screen.getByTestId('cell').querySelector('[data-inactive="true"]')).not.toBeNull()
  })

  test('활성 담당자면 보통 표기', () => {
    const issue = createIssue({ assignees: [{ ...worker, active: true }] })
    render(<AiTaskAssignee issue={issue} work={work()} testId="cell" />)
    expect(screen.getByTestId('cell')).toHaveAttribute('title', '봇 (에이전트)')
    expect(screen.getByTestId('cell').querySelector('[data-inactive="true"]')).toBeNull()
  })
})
