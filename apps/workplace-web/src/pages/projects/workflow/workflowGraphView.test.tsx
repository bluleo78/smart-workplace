import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'

import { formatDurationMs } from '@/lib/formatters'
import type { WorkflowModel, WorkflowModelNode } from '@/lib/workflows'
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

// ---- compact 실행 그래프(WP-2157) ----
const mkNode = (key: string, type: string, extra: Partial<WorkflowModelNode> = {}): WorkflowModelNode => ({
  key, type, use: [], requires: [], outputs: [], outcomes: [], conditions: [], ...extra,
})
const oc = (key: string, to: string) => ({ key, to, requireComment: false })
/** start→dev(done→review, ask→dev_ask), review(merged→end, rework→dev, ask→review_ask) — 질문 단계 둘, 되돌아가는 간선 하나. */
function dfbModel(): WorkflowModel {
  return {
    schema: 'v1', roles: [], shared: [], start: [], layout: [],
    nodes: [
      mkNode('start', 'start', { outcomes: [oc('go', 'dev')] }),
      mkNode('dev', 'human_task', { name: '개발', outcomes: [oc('done', 'review'), oc('ask', 'dev_ask')] }),
      mkNode('dev_ask', 'human_task', { returnTo: 'dev', outcomes: [oc('answered', 'dev')] }),
      mkNode('review', 'human_task', { name: '리뷰', outcomes: [oc('merged', 'end'), oc('rework', 'dev'), oc('ask', 'review_ask')] }),
      mkNode('review_ask', 'human_task', { returnTo: 'review', outcomes: [oc('answered', 'review')] }),
      mkNode('end', 'end'),
    ],
  } as unknown as WorkflowModel
}

it('graphView_compactHidesAskNodesAndForwardLabels', () => {
  render(<WorkflowGraphView model={dfbModel()} readOnly compact currentNode="dev" />)
  expect(screen.queryAllByRole('listitem').find((el) => el.getAttribute('data-node-key') === 'dev_ask')).toBeUndefined()
  expect(screen.getAllByTestId('graph-ask-marker')).toHaveLength(2)
  expect(screen.getByTestId('graph-back-label')).toHaveTextContent('rework → 개발 ↺')
  expect(screen.queryByText('done')).toBeNull()
  // 보조기기용 목록은 본 흐름 노드마다 남고 질문 단계 간선도 그대로다.
  expect(within(node('dev')).getByText('질문 → dev_ask')).toBeInTheDocument()
})

it('graphView_compactCurrentAskSideNode', () => {
  const { container } = render(<WorkflowGraphView model={dfbModel()} readOnly compact currentNode="dev_ask" paint={{ dev_ask: 'current' }} />)
  const side = container.querySelector('[data-node-key="dev_ask"][data-paint="current"]')
  expect(side).not.toBeNull()
  expect(side).toHaveClass('border-warning', 'ring-warning')
  expect(screen.getAllByTestId('graph-ask-marker')).toHaveLength(1)
  // 이름 없는 질문 단계 — 제목은 키, 둘째 줄은 결과 문구(「사람 차례」는 한 번만)
  expect(side).toHaveTextContent('dev_ask')
  expect(side?.textContent?.match(/사람 차례/g)).toHaveLength(1)
})

// WP-2157 리뷰: 멈춘(SUSPENDED) 실행이 질문 단계에 있으면 곁 노드는 「지금」 주황이 아니라 실패로 칠한다.
it('graphView_compactAskSideNode_followsPaintFailed', () => {
  const { container } = render(<WorkflowGraphView model={dfbModel()} readOnly compact currentNode="dev_ask" paint={{ dev_ask: 'failed' }} />)
  expect(container.querySelector('[data-node-key="dev_ask"][data-paint="current"]')).toBeNull()
  const side = container.querySelector('[data-node-key="dev_ask"][data-paint="failed"]')
  expect(side).not.toBeNull()
  expect(side).not.toHaveClass('ring-warning')
  expect(within(side as HTMLElement).getByLabelText('실패한 노드')).toBeInTheDocument()
})

// WP-2157 리뷰: 질문 표식도 칠하기를 따른다 — 지나온 질문은 ✓.
it('graphView_compactAskMarker_followsPaint', () => {
  render(<WorkflowGraphView model={dfbModel()} readOnly compact currentNode="review" paint={{ dev: 'passed', dev_ask: 'passed', review: 'current', review_ask: 'unvisited' }} />)
  const markers = screen.getAllByTestId('graph-ask-marker')
  const passed = markers.find((m) => m.getAttribute('data-paint') === 'passed')!
  expect(within(passed).getByLabelText('지나온 노드')).toBeInTheDocument()
  expect(markers.find((m) => m.getAttribute('data-paint') === 'unvisited')).toHaveClass('opacity-50')
})

it('graphView_compactCurrentAskSideNode_showsDwellTime', () => {
  const { container } = render(
    <WorkflowGraphView model={dfbModel()} readOnly compact currentNode="dev_ask" paint={{ dev_ask: 'current' }} durations={{ dev_ask: 125000 }} />,
  )
  const side = container.querySelector('[data-node-key="dev_ask"][data-paint="current"]')
  expect(side).toHaveTextContent('2분 5초')
  expect(side).not.toHaveTextContent('사람 차례')
})

it('graphView_compactCurrentRingByNodeType', () => {
  const { container } = render(<WorkflowGraphView model={dfbModel()} readOnly compact currentNode="dev" paint={{ start: 'passed', dev: 'current' }} />)
  expect(container.querySelector('[data-node-key="dev"]')).toHaveClass('ring-warning')
  expect(container.querySelector('[data-node-key="dev"]')).not.toHaveClass('ring-primary')
  const agent = { ...mkModel() }
  const r2 = render(<WorkflowGraphView model={agent} readOnly compact currentNode="a" paint={{ a: 'current' }} />)
  expect(r2.container.querySelector('[data-node-key="a"]')).toHaveClass('ring-primary')
})

it('graphView_compactPassedEdgesGreen', () => {
  const { container } = render(<WorkflowGraphView model={mkModel()} readOnly compact currentNode="b" paint={{ start: 'passed', a: 'passed', b: 'current', end: 'unvisited' }} />)
  const paths = [...container.querySelectorAll('svg path[stroke]')]
  // 시작→작성(passed→passed), 작성→검토(passed→current)는 초록, 검토에서 나가는 간선은 아니다.
  expect(paths.filter((p) => p.getAttribute('class')?.includes('text-success')).length).toBe(2)
  expect(paths.some((p) => !p.getAttribute('class')?.includes('text-success'))).toBe(true)
})
