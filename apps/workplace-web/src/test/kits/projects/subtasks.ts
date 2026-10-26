// 하위 태스크 페이지 테스트 공용(WP-980) — 데스크톱(subtasks.test.tsx)·모바일(subtasksMobile.test.tsx)이 같은 데이터·판정을 쓴다.
import { screen, within } from '@testing-library/react'
import { expect } from 'vitest'

import { agentWorker, createAgentWork } from '../../../../e2e/factories/agentWork.factory'
import { createIssue } from '../../../../e2e/factories/issue.factory'
import { makeSubtaskType } from '../../../../e2e/factories/issueType.factory'

export const TASK_SUMMARY = { id: 1, name: 'TASK', colorToken: 'BLUE' as const, icon: 'Circle' as const }

const subtask = (overrides: Parameters<typeof createIssue>[0]) => ({
  ...createIssue(overrides),
  type: makeSubtaskType(),
  parent: { number: 1, title: '부모 TASK', type: TASK_SUMMARY },
})

/** AI 배지 판정용 하위 태스크 다섯 줄(WP-374·WP-377). */
export const subtaskBadgeChildren = () => [
  // 열린 행 + AI 작업(답변 필요)
  subtask({ id: 10, number: 10, title: '답변 기다리는 하위 태스크', status: 'IN_PROGRESS', agentWork: [createAgentWork({ worker: agentWorker, state: 'INPUT_REQUIRED' })] }),
  // 열린 행 + AI 관여 없음
  subtask({ id: 20, number: 20, title: 'AI 관여 없는 하위 태스크', status: 'TODO' }),
  // 열린 행 + AI 담당(아직 시작 전, TODO)
  subtask({ id: 40, number: 40, title: 'AI 담당인데 아직 시작 안 한 하위 태스크', status: 'TODO', assignees: [agentWorker] }),
  // 작업 기록 없이 AI 담당만 있는 진행 중 행 — 「AI 위임」
  subtask({ id: 50, number: 50, title: 'AI 담당, 작업 기록은 아직 없는 하위 태스크', status: 'IN_PROGRESS', assignees: [agentWorker] }),
  // 끝난 행 — 과거 agentWork 가 있어도 상태배지 우선
  subtask({ id: 30, number: 30, title: '완료된 하위 태스크', status: 'DONE', agentWork: [createAgentWork({ worker: agentWorker, state: 'WORKING' })] }),
]

/** 행별 배지 기대값 — 데스크톱·모바일이 같은 판정을 쓴다. */
export async function expectSubtaskBadges() {
  const waiting = await screen.findByTestId('child-row-10')
  expect(within(waiting).getByTestId('ai-delegation-badge-10')).toHaveTextContent('답변 필요')
  expect(waiting.querySelector('[data-status]')).toBeNull()
  const plain = screen.getByTestId('child-row-20')
  expect(plain.querySelector('[data-testid^="ai-delegation-badge-"]')).toBeNull()
  expect(plain.querySelector('[data-status]')).toHaveAttribute('data-status', 'pending')
  const notStarted = screen.getByTestId('child-row-40')
  expect(within(notStarted).getByTestId('ai-delegation-badge-40')).toHaveTextContent('시작 전')
  expect(notStarted.querySelector('[data-status]')).toBeNull()
  const delegated = screen.getByTestId('child-row-50')
  expect(within(delegated).getByTestId('ai-delegation-badge-50')).toHaveTextContent('AI 위임')
  expect(delegated.querySelector('[data-status]')).toBeNull()
  const done = screen.getByTestId('child-row-30')
  expect(done.querySelector('[data-status]')).toHaveAttribute('data-status', 'success')
  expect(done.querySelector('[data-testid^="ai-delegation-badge-"]')).toBeNull()
}
