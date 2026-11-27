import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import { formatDurationMs } from '@/lib/formatters'
import { mkAskModel, mkModel } from '@/test/kits/projects/workflowRunFixtures'

import { WorkflowGraphView } from './WorkflowGraphView'

function node(key: string) {
  return screen.getAllByRole('listitem').find((el) => el.getAttribute('data-node-key') === key)!
}

it('graphBadges_countActiveRunsPerNode', () => {
  render(<WorkflowGraphView model={mkModel()} readOnly badges={{ a: 3 }} />)
  expect(within(node('a')).getByText('진행 중 3')).toBeVisible()
  expect(within(node('b')).queryByText(/진행 중/)).toBeNull()
})

it('graphEdges_listedAsTextForAssistiveTech', () => {
  render(<WorkflowGraphView model={mkModel()} readOnly />)
  // 픽스처에서 '오류' 간선(onError → a)을 가진 노드는 b 다.
  const list = within(node('b')).getByRole('list', { name: '이어지는 단계' })
  expect(within(list).getByText('오류 → 작성')).toBeInTheDocument()
})

it('graphPaint_marksNodesAndDuration', () => {
  const paint = { start: 'passed', a: 'passed', b: 'current', end: 'unvisited' } as const
  render(<WorkflowGraphView model={mkModel()} readOnly paint={paint} durations={{ a: 600000 }} />)
  for (const [k, v] of Object.entries(paint)) expect(node(k)).toHaveAttribute('data-paint', v)
  expect(within(node('a')).getByText(formatDurationMs(600000))).toBeVisible()
})

it('graphEdges_parallelEdgesShareOneLabel', () => {
  const { container } = render(<WorkflowGraphView model={mkAskModel()} readOnly />)
  const texts = [...container.querySelectorAll('svg text')].map((t) => t.textContent)
  expect(texts.filter((t) => t === '답변 · 돌아가기')).toHaveLength(1)
  expect(texts).not.toContain('답변')
  expect(texts).not.toContain('돌아가기')
  // 보조기기용 목록은 간선마다 한 줄 그대로다.
  const list = within(node('work_ask')).getByRole('list', { name: '이어지는 단계' })
  expect(within(list).getByText('답변 → 작업')).toBeInTheDocument()
  expect(within(list).getByText('돌아가기 → 작업')).toBeInTheDocument()
})
