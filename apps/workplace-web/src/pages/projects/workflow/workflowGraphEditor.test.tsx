import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Connection, ConnectionMode, type Edge } from '@xyflow/react'
import { useState } from 'react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { renderWithProviders } from '@/test/renderWithProviders'

import { applyConnection } from './applyConnection'
import { computeGraphLayout, drawnEdge, SHAPE_SIZE } from './graphLayout'
import { addAskPath, autoLayout, connectFromFlow, moveManyFromDrag, parseWorkflowGraph, placeNodes, REFUSE_NO_ROLE, REFUSE_SELF, type WorkflowGraph } from './graphYaml'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'
import { ASK_TIP } from './WorkflowGraphShapes'

const FIXTURE = `schema: genia/workflow@1
name: AI 개발 흐름
roles:
  lead: { name: 팀장 }
  planner: { name: 기획자 }
  owner: { name: 확인자 }

nodes:
  start: { type: start }

  # 분류 노드
  triage:
    type: agent_task
    name: 분류
    role: lead
    outcomes:
      ready: { to: dev, assignTo: developer }

  # 개발
  dev:
    type: agent_task
    name: 개발
    role: developer
    instructions: |
      개발한다
    outcomes:
      submitted: { to: plan_ok, assignTo: owner }

  plan_ok:
    type: human_task
    name: 기획 확정
    role: owner
    outcomes:
      approve: { to: dev, assignTo: developer }
      revise: { to: triage, assignTo: planner, requireComment: true }

  done: { type: end }

start:
  - { when: { assigneeRole: lead }, to: triage }
  - { when: { assigneeRole: developer }, to: dev }
`

// 값 지우기 알림(toast.info)을 확인하려고 sonner 를 가로챈다
const toastInfo = vi.hoisted(() => vi.fn())
vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()
  return { ...actual, toast: Object.assign(actual.toast, { info: toastInfo }) }
})

// ReactFlow 속성(connectionMode·onConnect·edges)을 가로채려고 감싼다 — jsdom 에서는 끌어 잇기를 흉내 낼 수 없다(WP-2089).
const captured = vi.hoisted(() => ({
  props: null as null | { connectionMode?: unknown; onConnect?: (c: Connection) => void; edges?: Edge[] },
}))
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: React.ComponentProps<typeof actual.ReactFlow>) => {
      captured.props = props as never
      return <actual.ReactFlow {...props} />
    },
  }
})

// 테스트 사이에 이전 렌더의 props 가 새어 들어가 단언이 우연히 통과하지 않도록 매번 비운다
beforeEach(() => {
  captured.props = null
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doc = (y: string) => parse(y) as Record<string, any>

// jsdom 에는 ReactFlow 가 노드 크기를 재는 데 쓰는 ResizeObserver·DOMMatrixReadOnly 가 없어 최소 스텁을 둔다.
beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixStub {
    m22 = 1
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('DOMMatrixReadOnly', DOMMatrixStub)
})

/** 부모가 yaml 을 들고 있는 것처럼 onChange 결과를 다시 내려 주는 하네스 — 연속 편집이 쌓이는지 본다. */
function Harness({ initial, readOnly = false, onYaml, onOpenYaml = () => {} }: {
  initial: string; readOnly?: boolean; onYaml?: (y: string) => void; onOpenYaml?: () => void
}) {
  const [yaml, setYaml] = useState(initial)
  return (
    <div style={{ width: 1000, height: 600 }}>
      <WorkflowGraphEditor
        yaml={yaml}
        readOnly={readOnly}
        onChange={(next) => { setYaml(next); onYaml?.(next) }}
        onOpenYaml={onOpenYaml}
      />
    </div>
  )
}

it('graphEditor_rendersNodesWithKindLabel', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByText('분류')).toBeInTheDocument()
  expect(screen.getByText('AI · 팀장')).toBeInTheDocument()
  expect(screen.getByText('기획 확정')).toBeInTheDocument()
  expect(screen.getByText('사람 · 확인자')).toBeInTheDocument()
})

it('addNode_fromMenu_callsOnChangeWithNewNode', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  await userEvent.click(screen.getByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '사람 차례' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.human_1.type).toBe('human_task')
  // 새 노드가 선택되어 패널이 열린다.
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('새 사람 차례')
})

it('nodePanel_editsInstructionsRoleOutputs', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  fireEvent.click(screen.getByText('개발'))
  fireEvent.change(await screen.findByLabelText('지시 내용'), { target: { value: '테스트 지시' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.instructions.trim()).toBe('테스트 지시')

  fireEvent.change(screen.getByLabelText('담당 역할 선택'), { target: { value: 'lead' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.role).toBe('lead')

  const outputs = screen.getByRole('region', { name: '내놓을 값' })
  fireEvent.click(within(outputs).getByRole('button', { name: '+ 추가' }))
  fireEvent.change(within(outputs).getByLabelText('값 키'), { target: { value: 'prUrl' } })
  fireEvent.change(within(outputs).getByLabelText('값 종류'), { target: { value: 'url' } })
  fireEvent.click(within(outputs).getByLabelText('필수'))
  const last = doc(onYaml.mock.lastCall![0]).nodes.dev
  expect(last.outputs.prUrl).toEqual({ type: 'url', required: true })
  expect(last.role).toBe('lead')
})

// 리뷰 후속 ④ — 쓸 수 없는 키(빈 값·겹침)를 입력하면 저장하지 않은 까닭을 줄 아래에 알리고, 고치면 알림이 사라진다
it('nodePanel_outputKey_invalidInput_showsAlert', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  fireEvent.click(screen.getByText('개발'))
  const outputs = await screen.findByRole('region', { name: '내놓을 값' })
  fireEvent.click(within(outputs).getByRole('button', { name: '+ 추가' }))
  fireEvent.click(within(outputs).getByRole('button', { name: '+ 추가' }))
  const [first, second] = within(outputs).getAllByLabelText('값 키')
  const before = onYaml.mock.calls.length
  fireEvent.change(second, { target: { value: 'value_1' } })
  expect(within(outputs).getByRole('alert')).toHaveTextContent('같은 키가 있어 저장하지 않았습니다')
  expect(second).toHaveAttribute('aria-invalid', 'true')
  fireEvent.change(first, { target: { value: '' } })
  expect(within(outputs).getByText('키를 비울 수 없어 저장하지 않았습니다')).toBeInTheDocument()
  // 쓸 수 없는 입력은 YAML 에 옮기지 않는다
  expect(onYaml.mock.calls.length).toBe(before)
  fireEvent.change(first, { target: { value: 'prUrl' } })
  // 첫 줄이 비켜 겹침이 풀리면 둘째 줄의 입력(value_1)이 그때 저장되고 알림이 사라진다
  await waitFor(() => expect(Object.keys(doc(onYaml.mock.lastCall![0]).nodes.dev.outputs)).toEqual(['prUrl', 'value_1']))
  expect(within(outputs).queryByRole('alert')).not.toBeInTheDocument()
})

// 읽기 전용이면 문서에 원래 적힌 키에 알림을 띄우지 않는다
it('nodePanel_outputKey_readOnly_noAlert', async () => {
  const y = FIXTURE.replace('      개발한다\n', '      개발한다\n    outputs:\n      "": { type: string }\n')
  renderWithProviders(<Harness initial={y} readOnly />)
  fireEvent.click(screen.getByText('개발'))
  const outputs = await screen.findByRole('region', { name: '내놓을 값' })
  expect(within(outputs).getByLabelText('값 키')).toHaveValue('')
  expect(within(outputs).queryByRole('alert')).not.toBeInTheDocument()
})

// 지운 값을 보던 분기 조건이 함께 지워지면 몇 개인지 알린다
it('nodePanel_removeOutput_withContextRefs_notifies', async () => {
  const y = FIXTURE.replace('      개발한다\n', '      개발한다\n    outputs:\n      ok: { type: boolean }\n')
    .replace('  done: { type: end }\n', '  done: { type: end }\n  pick:\n    type: decision\n    conditions:\n      - { when: { context: dev.ok, equals: true }, to: done }\n    default: done\n')
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={y} onYaml={onYaml} />)
  fireEvent.click(screen.getByText('개발'))
  const outputs = await screen.findByRole('region', { name: '내놓을 값' })
  fireEvent.click(within(outputs).getByRole('button', { name: '값 지우기' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.pick).toEqual({ type: 'decision', default: 'done' })
  expect(toastInfo).toHaveBeenCalledWith('「ok」를 보던 분기 조건 1개도 함께 지웠습니다')
})

it('nodePanel_outcomesAndMaxVisits', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  fireEvent.click(screen.getByText('개발'))
  const outcomes = await screen.findByRole('region', { name: '결과 → 다음 노드' })
  fireEvent.click(within(outcomes).getByRole('button', { name: '+ 추가' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.outcomes.done.to).toBeTruthy()
  fireEvent.change(screen.getByLabelText('되돌림 횟수'), { target: { value: '3' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.maxVisits).toBe(3)
  fireEvent.change(screen.getByLabelText('되돌림 횟수'), { target: { value: '' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.maxVisits).toBeUndefined()
})

it('nodePanel_deleteNode', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  fireEvent.click(screen.getByText('개발'))
  fireEvent.click(await screen.findByRole('button', { name: '노드 지우기' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev).toBeUndefined()
})

it('graphEditor_invalidYaml_showsHint', () => {
  const onOpenYaml = vi.fn()
  renderWithProviders(<Harness initial="nodes: [" onOpenYaml={onOpenYaml} />)
  expect(screen.getByRole('alert')).toHaveTextContent('YAML 에 문법 오류가 있어 그래프로 볼 수 없습니다.')
  fireEvent.click(screen.getByRole('button', { name: 'YAML 에서 고치기' }))
  expect(onOpenYaml).toHaveBeenCalled()
})

// 최종 리뷰 6 — 저장 중(readOnly)에는 도구 줄과 노드 지우기가 사라지지 않고 꺼진 채 보인다
it('graphEditor_readOnly_disablesToolbarAndDelete', async () => {
  renderWithProviders(<Harness initial={FIXTURE} readOnly />)
  expect(screen.getByRole('button', { name: '+ 노드' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '자동 정렬' })).toBeDisabled()
  expect(screen.getByText('분류')).toBeInTheDocument()
  clickNode('dev')
  expect(await screen.findByRole('button', { name: '노드 지우기' })).toBeDisabled()
})

it('autoLayout_button_writesLayout', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  await waitFor(() => expect(screen.getByRole('button', { name: '자동 정렬' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '자동 정렬' }))
  expect(doc(onYaml.mock.lastCall![0]).layout.triage).toBeDefined()
})

/** 캔버스의 노드 카드를 누른다 — 패널의 도착 노드 목록에도 같은 이름이 있어 글자 대신 ReactFlow 의 data-id 로 찾는다. */
function clickNode(key: string) {
  const el = document.querySelector(`.react-flow__node[data-id="${key}"]`)
  if (!el) throw new Error(`노드 없음: ${key}`)
  fireEvent.click(el)
}

/** 노드의 role 줄 바로 아래에 내놓을 값 줄을 넣는다. */
function withOutputs(y: string, node: 'dev' | 'plan_ok', lines: string[]) {
  const anchor = node === 'dev' ? '    role: developer\n' : '    role: owner\n'
  return y.replace(anchor, `${anchor}    outputs:\n${lines.map((l) => `      ${l}\n`).join('')}`)
}

// 최종 리뷰 1 — 노드를 바꿔 골라도 앞 노드의 값 키가 줄에 남지 않는다
it('nodePanel_switchingNodes_showsOwnOutputKeys', async () => {
  const onYaml = vi.fn()
  const y = withOutputs(withOutputs(FIXTURE, 'plan_ok', ['planDoc: { type: url }']), 'dev', ['prUrl: { type: url, required: true }'])
  renderWithProviders(<Harness initial={y} onYaml={onYaml} />)
  clickNode('plan_ok')
  expect(await screen.findByLabelText('값 키')).toHaveValue('planDoc')
  clickNode('dev')
  await waitFor(() => expect(screen.getByLabelText('노드 이름')).toHaveValue('개발'))
  expect(screen.getByLabelText('값 키')).toHaveValue('prUrl')
  fireEvent.change(screen.getByLabelText('값 종류'), { target: { value: 'string' } })
  const dev = doc(onYaml.mock.lastCall![0]).nodes.dev
  expect(dev.outputs).toEqual({ prUrl: { type: 'string', required: true } })
})

// 최종 리뷰 1 — 앞 줄을 지우면 남은 줄이 자기 키를 보이고, 값 종류를 바꿔도 지운 키가 되살아나지 않는다
it('nodePanel_removingFirstOutput_keepsRemainingKey', async () => {
  const onYaml = vi.fn()
  const y = withOutputs(FIXTURE, 'dev', ['a1: { type: string }', 'b2: { type: number }'])
  renderWithProviders(<Harness initial={y} onYaml={onYaml} />)
  clickNode('dev')
  const outputs = await screen.findByRole('region', { name: '내놓을 값' })
  fireEvent.click(within(outputs).getAllByRole('button', { name: '값 지우기' })[0])
  expect(within(outputs).getByLabelText('값 키')).toHaveValue('b2')
  fireEvent.change(within(outputs).getByLabelText('값 종류'), { target: { value: 'url' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.outputs).toEqual({ b2: { type: 'url' } })
})

// 최종 리뷰 2 — 종류마다 서버가 허용하는 칸만 보인다(x-nodeTypes)
const ALL_SECTIONS = ['담당 역할', '필요한 능력', '지시', '공통 지시', '결과 → 다음 노드', '내놓을 값', '되돌림 제한']
it.each([
  ['dev', ALL_SECTIONS, true],
  ['plan_ok', ['담당 역할', '지시', '공통 지시', '결과 → 다음 노드', '내놓을 값', '되돌림 제한'], true],
  ['pick', [], true],
  ['done', [], true],
  ['start', [], false],
])('nodePanel_%s_showsAllowedSectionsOnly', async (key, sections, deletable) => {
  const y = FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision, name: 고르기 }')
  renderWithProviders(<Harness initial={y} />)
  clickNode(key)
  const panel = await screen.findByRole('complementary', { name: '노드 편집' })
  expect(within(panel).getByLabelText('노드 이름')).toBeInTheDocument()
  const shown = within(panel).queryAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(shown).toEqual(sections)
  expect(within(panel).queryByRole('button', { name: '노드 지우기' }) !== null).toBe(deletable)
})

// 최종 리뷰 13 — 되돌림 횟수는 1 이상 정수만 쓴다
it('nodePanel_maxVisits_acceptsPositiveIntegersOnly', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  clickNode('dev')
  const input = await screen.findByLabelText('되돌림 횟수')
  for (const bad of ['0', '-1', '1.5']) fireEvent.change(input, { target: { value: bad } })
  expect(onYaml).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: '2' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.maxVisits).toBe(2)
})

// 최종 리뷰 13 — 「+ 추가」 결과는 자기 자신·시작이 아닌 첫 노드로 간다
it('nodePanel_addOutcome_targetsFirstOtherNonStartNode', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={FIXTURE} onYaml={onYaml} />)
  clickNode('triage')
  const outcomes = await screen.findByRole('region', { name: '결과 → 다음 노드' })
  fireEvent.click(within(outcomes).getByRole('button', { name: '+ 추가' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.triage.outcomes.done.to).toBe('dev')
})

// 최종 리뷰 15 — 시작 노드가 없을 때만 「+ 노드」에 「시작」이 있다
it('addNode_menu_offersStartOnlyWhenMissing', async () => {
  const onYaml = vi.fn()
  const noStart = FIXTURE.replace('  start: { type: start }\n', '')
  const { unmount } = renderWithProviders(<Harness initial={noStart} onYaml={onYaml} />)
  await userEvent.click(screen.getByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '시작' }))
  expect(doc(onYaml.mock.lastCall![0]).nodes.start).toEqual({ type: 'start' })
  unmount()
  renderWithProviders(<Harness initial={FIXTURE} />)
  await userEvent.click(screen.getByRole('button', { name: '+ 노드' }))
  expect(await screen.findByRole('menuitem', { name: 'AI 작업' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '시작' })).not.toBeInTheDocument()
})

/** FIXTURE 를 그래프로 읽어 선 끌기 도우미에 넘긴다. */
function fixtureGraph(yaml: string) {
  const r = parseWorkflowGraph(yaml)
  if (!('graph' in r)) throw new Error('parse')
  return r.graph
}

it('dragStop_writesRoundedLayout', () => {
  const out = moveManyFromDrag(FIXTURE, [{ id: 'dev', position: { x: 100.4, y: 200.6 } }])
  expect(doc(out).layout.dev).toEqual({ x: 100, y: 201 })
})

it('connect_fromAgentTask_addsNextOutcome', () => {
  const out = connectFromFlow(FIXTURE, fixtureGraph(FIXTURE), { source: 'dev', target: 'done' }).yaml
  expect(doc(out).nodes.dev.outcomes.done.to).toBe('done')
  expect(doc(out).nodes.dev.outcomes.submitted.to).toBe('plan_ok')
})

it.each(['done'])('connect_from_%s_isIgnored', (source) => {
  expect(connectFromFlow(FIXTURE, fixtureGraph(FIXTURE), { source, target: 'dev' }).yaml).toBe(FIXTURE)
})


it('applyConnection_refused_toastsAndKeepsYaml', () => {
  toastInfo.mockClear()
  const y = FIXTURE.replace(/roles:[\s\S]*?\nnodes:/, 'roles: {}\n\nnodes:')
  const onChange = vi.fn()
  applyConnection(y, fixtureGraph(y), { source: 'start', target: 'triage' }, onChange)
  expect(toastInfo).toHaveBeenCalledWith(REFUSE_NO_ROLE)
  expect(onChange).not.toHaveBeenCalled()
})

it('applyConnection_success_changesWithoutToast', () => {
  toastInfo.mockClear()
  const onChange = vi.fn()
  applyConnection(FIXTURE, fixtureGraph(FIXTURE), { source: 'dev', target: 'done' }, onChange)
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(doc(onChange.mock.calls[0][0]).nodes.dev.outcomes.done.to).toBe('done')
  expect(toastInfo).not.toHaveBeenCalled()
})

it('applyConnection_unknownNode_doesNothing', () => {
  toastInfo.mockClear()
  const onChange = vi.fn()
  applyConnection(FIXTURE, fixtureGraph(FIXTURE), { source: 'nope', target: 'dev' }, onChange)
  expect(onChange).not.toHaveBeenCalled()
  expect(toastInfo).not.toHaveBeenCalled()
})

// 코드 리뷰 2 — 입력 도중의 잘못된 값(badInput)은 되돌림 제한을 지우지 않는다
it('nodePanel_maxVisits_badInputKeepsValue_emptyDeletes', async () => {
  const onYaml = vi.fn()
  const y = FIXTURE.replace('    role: developer\n', '    role: developer\n    maxVisits: 3\n')
  renderWithProviders(<Harness initial={y} onYaml={onYaml} />)
  clickNode('dev')
  const input = (await screen.findByLabelText('되돌림 횟수')) as HTMLInputElement
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } })
  fireEvent.change(input, { target: { value: '5' } })
  onYaml.mockClear()
  fireEvent.change(input, { target: { value: '' } })
  expect(onYaml).not.toHaveBeenCalled()
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: false } })
  fireEvent.change(input, { target: { value: '' } })
  expect(doc(onYaml.mock.lastCall![0]).nodes.dev.maxVisits).toBeUndefined()
})

// jsdom 스텁은 노드 크기를 재지 못해 React Flow 가 노드를 visibility:hidden 으로 두므로 접근 이름이 계산되지 않아(role 조회 불가) 노드는 aria-label 로 찾는다.
// WP-2052 — 접근 이름(한국어)·키보드(Enter·Space)로 편집 패널 열기
it('graphEditor_a11y_namesCanvasAndNodesInKorean', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByRole('application', { name: '워크플로우 그래프 편집' })).toBeInTheDocument()
  expect(screen.getByLabelText('분류, AI · 팀장')).toBeInTheDocument()
  expect(screen.getByLabelText('기획 확정, 사람 · 확인자')).toBeInTheDocument()
})
it('graphEditor_keyboardEnterOrSpace_opensNodePanel', async () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const node = screen.getByLabelText('개발, AI · developer')
  node.focus()
  fireEvent.keyDown(node, { key: 'Enter' })
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('개발')
  // 다른 노드로 Space
  const plan = screen.getByLabelText('기획 확정, 사람 · 확인자')
  fireEvent.keyDown(plan, { key: ' ' })
  await waitFor(() => expect(screen.getByLabelText('노드 이름')).toHaveValue('기획 확정'))
})
it('graphEditor_keyboardOpenedPanel_closesOnPaneClick_andOpensWhenReadOnly', async () => {
  renderWithProviders(<Harness initial={FIXTURE} readOnly />)
  fireEvent.keyDown(screen.getByLabelText('분류, AI · 팀장'), { key: 'Enter' })
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('분류')
  fireEvent.click(document.querySelector('.react-flow__pane')!)
  await waitFor(() => expect(screen.queryByLabelText('노드 이름')).toBeNull())
})

// Space 는 페이지 스크롤이 아니라 노드 선택으로만 쓰인다
it('graphEditor_space_preventsDefaultScroll', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const notPrevented = fireEvent.keyDown(screen.getByLabelText('개발, AI · developer'), { key: ' ' })
  expect(notPrevented).toBe(false)
})
// 질문 경로(가상) 노드는 패널을 열지 않지만, 그 위의 Space 도 페이지를 스크롤하지 않는다
it('graphEditor_spaceOnVirtualNode_preventsScrollWithoutOpeningPanel', async () => {
  renderWithProviders(<Harness initial={'name: 질문\nnodes:\n  work:\n    name: 작업\n    type: agent_task\n    ask: { role: owner }'} />)
  // 질문 경로 노드는 기본으로 접혀 있어(WP-2089) 펼친 뒤에 본다
  fireEvent.click(screen.getByRole('button', { name: '질문 경로' }))
  const virtualNode = await screen.findByLabelText(/질문 경로\(편집 불가\)$/)
  const notPrevented = fireEvent.keyDown(virtualNode, { key: ' ' })
  expect(notPrevented).toBe(false)
  expect(screen.queryByLabelText('노드 이름')).toBeNull()
})
// 떠 있는 도구 패널은 ReactFlow 가 쓰는 키(Space·화살표·Delete/Backspace)만 막고, 나머지 키는 앱 전역 단축키에 닿게 둔다
it('graphEditor_floatingPanelKeys_onlyReactFlowKeysStopped', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const zoom = screen.getByRole('button', { name: '확대' })
  const seen: string[] = []
  const spy = (event: KeyboardEvent) => seen.push(event.key)
  document.addEventListener('keydown', spy)
  for (const key of [' ', 'ArrowLeft', 'ArrowDown', 'Delete', 'Backspace', 'Escape', 'k']) fireEvent.keyDown(zoom, { key })
  document.removeEventListener('keydown', spy)
  expect(seen).toEqual(['Escape', 'k'])
})
// Esc 는 선택을 풀고 패널도 닫는다
it('graphEditor_escapeOnNode_closesPanel', async () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const node = screen.getByLabelText('개발, AI · developer')
  fireEvent.keyDown(node, { key: 'Enter' })
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('개발')
  fireEvent.keyDown(node, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText('노드 이름')).toBeNull())
})
// 「+ 노드」 메뉴가 열려 있을 때 Esc 는 메뉴만 닫는다 — 위로 올라가 열려 있던 노드 편집 패널까지 닫으면 안 된다
it('graphEditor_escapeInAddNodeMenu_closesMenuKeepsPanel', async () => {
  const user = userEvent.setup()
  renderWithProviders(<Harness initial={FIXTURE} />)
  fireEvent.keyDown(screen.getByLabelText('개발, AI · developer'), { key: 'Enter' })
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('개발')
  await user.click(screen.getByRole('button', { name: '+ 노드' }))
  expect(await screen.findByRole('menu')).toBeInTheDocument()
  // Radix 메뉴가 Esc 를 소비하고, 패널 닫기 Esc 는 포커스가 노드 안일 때만 동작한다(메뉴는 포털) — 회귀 방지
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(screen.getByLabelText('노드 이름')).toHaveValue('개발')
})

// WP-2089 — 질문 경로(ask 줄임)와 공통 오류 처리(onError 3개가 모두 triage)를 가진 작은 흐름
const RECOVERY = `schema: genia/workflow@1
name: 복구 흐름
roles:
  lead: { name: 팀장 }
  owner: { name: 확인자 }

nodes:
  start: { type: start }
  triage:
    type: agent_task
    name: 분류
    role: lead
    outcomes:
      ready: { to: dev }
  dev:
    type: agent_task
    name: 개발
    role: lead
    ask: { role: owner }
    onError: { to: triage }
    outcomes:
      submitted: { to: review }
  review:
    type: agent_task
    name: 리뷰
    role: lead
    onError: { to: triage }
    outcomes:
      merged: { to: pick }
  pick:
    type: decision
    name: 고르기
    conditions:
      - { when: { context: review.ok, equals: true }, to: qa }
    default: done
  qa:
    type: agent_task
    name: 검증
    role: lead
    onError: { to: triage }
    outcomes:
      ok: { to: done }
  done: { type: end, name: 끝 }

start:
  - { when: { assigneeRole: lead }, to: triage }
`

/** ReactFlow 노드 감싸개(data-id)를 찾는다. */
function flowNode(key: string) {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${key}"]`)
}

it('shapes_decisionDiamond_startEndCircle', () => {
  renderWithProviders(<Harness initial={RECOVERY} />)
  expect(flowNode('start')!.querySelector('[data-shape="circle"]')).not.toBeNull()
  expect(flowNode('done')!.querySelector('[data-shape="circle"]')).not.toBeNull()
  expect(flowNode('pick')!.querySelector('[data-shape="diamond"]')).not.toBeNull()
  expect(flowNode('dev')!.querySelector('[data-shape="card"]')).not.toBeNull()
  // 이름은 모양 오른쪽에 그대로 보인다
  expect(within(flowNode('pick')!).getByText('고르기')).toBeInTheDocument()
})

it('askCollapsed_byDefault_showsIconHidesQuestionNode', () => {
  renderWithProviders(<Harness initial={RECOVERY} />)
  expect(within(flowNode('dev')!).getByLabelText(ASK_TIP)).toHaveAttribute('title', ASK_TIP)
  expect(document.querySelector('.react-flow__node[data-id$="_ask"]')).toBeNull()
  expect(screen.getByRole('button', { name: '질문 경로' })).toHaveAttribute('aria-pressed', 'false')
})

it('askToggle_showsQuestionNodes', async () => {
  // 읽기 전용이어도 보기 토글은 켤 수 있다
  renderWithProviders(<Harness initial={RECOVERY} readOnly />)
  const toggle = screen.getByRole('button', { name: '질문 경로' })
  expect(toggle).toBeEnabled()
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(flowNode('dev_ask')).not.toBeNull())
})

// 질문 경로 토글은 켜지면 디자인 시스템의 「토글 켜짐」 클래스(TOGGLE_ON_CLASS)를 붙여 켜짐을 보인다(WP-2090 리뷰 반려)
it('askToggle_onShowsToggleOnClass_offRemovesIt', () => {
  renderWithProviders(<Harness initial={RECOVERY} />)
  const toggle = screen.getByRole('button', { name: '질문 경로' })
  // TOGGLE_ON_CLASS 의 각 클래스 토큰이 버튼에 모두 있는지 본다
  const onTokens = TOGGLE_ON_CLASS.split(' ')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  for (const token of onTokens) expect(toggle).toHaveClass(token)
  // 다시 누르면 꺼짐 — 켜짐 클래스가 남지 않아야 한다
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  for (const token of onTokens) expect(toggle).not.toHaveClass(token)
})

it('commonError_badgeAndLegend_noEdges', async () => {
  renderWithProviders(<Harness initial={RECOVERY} />)
  expect(within(flowNode('triage')!).getByText('↺ 모든 단계에서')).toBeInTheDocument()
  expect(within(flowNode('dev')!).queryByText('↺ 모든 단계에서')).not.toBeInTheDocument()
  expect(screen.getByText('막힌 단계는 실행 조치에서 「분류」로 되돌릴 수 있음')).toBeInTheDocument()
  // 다른 선은 그려지는데(양성 대조) 공통 목적지로 가는 「오류」 선만 없다
  expect(await screen.findByText('submitted')).toBeInTheDocument()
  expect(screen.queryByText('오류')).not.toBeInTheDocument()
})

it('legend_showsProgressAndBack', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByText('진행')).toBeInTheDocument()
  expect(screen.getByText('되돌림')).toBeInTheDocument()
  // 공통 오류 처리가 없으면 복구 줄은 없다
  expect(screen.queryByText(/막힌 단계는 실행 조치에서/)).not.toBeInTheDocument()
})

it('backEdge_markedWithWarning', async () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  // FIXTURE 의 revise(기획 확정 → 분류)는 위로 되돌아가는 선이다
  const revise = await screen.findByText('revise')
  expect(revise.closest('[data-back]')).toHaveAttribute('data-back', 'true')
  expect(screen.getByText('submitted').closest('[data-back]')).toHaveAttribute('data-back', 'false')
})

it('autoLayout_undo_restoresPreviousYaml', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={RECOVERY} onYaml={onYaml} />)
  expect(screen.queryByRole('button', { name: '실행 취소' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '자동 정렬' }))
  expect(doc(onYaml.mock.lastCall![0]).layout.triage).toBeDefined()
  fireEvent.click(await screen.findByRole('button', { name: '실행 취소' }))
  expect(onYaml.mock.lastCall![0]).toBe(RECOVERY)
  expect(screen.queryByRole('button', { name: '실행 취소' })).not.toBeInTheDocument()
})

it('undoAutoLayout_hiddenAfterOtherEdit', async () => {
  renderWithProviders(<Harness initial={RECOVERY} />)
  fireEvent.click(screen.getByRole('button', { name: '자동 정렬' }))
  expect(await screen.findByRole('button', { name: '실행 취소' })).toBeInTheDocument()
  clickNode('dev')
  fireEvent.change(await screen.findByLabelText('노드 이름'), { target: { value: '개발2' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: '실행 취소' })).not.toBeInTheDocument())
})

it('autoLayout_twice_undoStillRestoresOriginal', async () => {
  const onYaml = vi.fn()
  renderWithProviders(<Harness initial={RECOVERY} onYaml={onYaml} />)
  fireEvent.click(screen.getByRole('button', { name: '자동 정렬' }))
  fireEvent.click(screen.getByRole('button', { name: '자동 정렬' }))
  fireEvent.click(await screen.findByRole('button', { name: '실행 취소' }))
  expect(onYaml.mock.lastCall![0]).toBe(RECOVERY)
})

it('showAsk_nodesAreNotDraggable', async () => {
  const { container } = renderWithProviders(<Harness initial={RECOVERY} />)
  const node = () => container.querySelector('.react-flow__node[data-id="dev"]')!
  await waitFor(() => expect(node()).toHaveClass('draggable'))
  fireEvent.click(screen.getByRole('button', { name: '질문 경로' }))
  await waitFor(() => expect(node()).not.toHaveClass('draggable'))
})

it('showAsk_collapse_closesPanelOfHiddenQuestionNode', async () => {
  // 실제 질문 노드(dev_ask)를 펼친 보기에서 골랐다가 접으면 보이지 않는 노드의 패널이 남지 않는다
  renderWithProviders(<Harness initial={addAskPath(RECOVERY, 'dev')} />)
  fireEvent.click(screen.getByRole('button', { name: '질문 경로' }))
  await waitFor(() => expect(flowNode('dev_ask')).not.toBeNull())
  fireEvent.click(within(flowNode('dev_ask')!).getByText('개발 질문 답변'))
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('개발 질문 답변')
  fireEvent.click(screen.getByRole('button', { name: '질문 경로' }))
  await waitFor(() => expect(screen.queryByLabelText('노드 이름')).toBeNull())
})

it('addNode_whileShowAsk_usesCollapsedPositions', async () => {
  // 펼친 보기의 좌표는 보기 전용이다 — 새 노드의 저장 좌표는 접은 배치의 가장 아래 노드 밑으로 정한다
  const onYaml = vi.fn()
  const laid = autoLayout(RECOVERY)
  renderWithProviders(<Harness initial={laid} onYaml={onYaml} />)
  fireEvent.click(screen.getByRole('button', { name: '질문 경로' }))
  await userEvent.click(screen.getByRole('button', { name: '+ 노드' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '사람 차례' }))
  const collapsed = [...placeNodes((parseWorkflowGraph(laid) as { graph: WorkflowGraph }).graph).positions.values()]
  const at = doc(onYaml.mock.lastCall![0]).layout.human_1
  expect(at.y).toBe(Math.max(...collapsed.map((p) => p.y)) + 64 + 64)
  expect(at.x).toBe(Math.min(...collapsed.map((p) => p.x)))
})

it('backEdge_strokeAndArrowUseWarningText', async () => {
  const { container } = renderWithProviders(<Harness initial={FIXTURE} />)
  await screen.findByText('revise')
  const path = container.querySelector('[data-back="true"] path.react-flow__edge-path')
  expect(path?.getAttribute('style')).toContain('var(--warning-text)')
  // 화살촉 마커 id·정의에 되돌림 색이 실려 있다
  expect(container.innerHTML).toContain('color=var(--warning-text)')
})

it('editor_legacyLeftRightLayout_edgesUseSideHandles', () => {
  // 옛 좌→우 좌표가 저장된 YAML — 그려지는 자리는 저장 좌표라 두 노드의 상대 위치(가로)로 변을 골라야 한다
  const legacy = FIXTURE + `layout:
  start: { x: 0, y: 0 }
  triage: { x: 240, y: 0 }
  dev: { x: 480, y: 0 }
  plan_ok: { x: 720, y: 0 }
  done: { x: 960, y: 0 }
`
  const parsed = parseWorkflowGraph(legacy)
  if ('error' in parsed) throw new Error(parsed.error)
  const { positions, view } = placeNodes(parsed.graph, { showAsk: false })
  const layout = computeGraphLayout(view)
  const laid = layout.edges.find((e) => e.from === 'start' && e.to === 'triage')!
  expect(drawnEdge(laid, positions, layout)).toMatchObject({ sourceHandle: 's-right', targetHandle: 's-left' })
  // 편집기가 실제로 그린 선 — 저장 좌표가 옛 좌→우 배치라 대체 경로(smoothstep)를 쓰므로 선이 start 의 오른쪽 변에서 시작한다
  renderWithProviders(<Harness initial={legacy} />)
  const edge = [...document.querySelectorAll('.react-flow__edge')].find((e) => e.getAttribute('data-id')?.startsWith('start->triage'))
  const d = edge?.querySelector('path')?.getAttribute('d') ?? ''
  // 시작 원의 오른쪽 변(x = SHAPE_SIZE 근처, y = 원 가운데)에서 나가 triage 의 왼쪽 변(x = 240 근처, y = 카드 가운데)으로 들어온다
  expect(d).toMatch(new RegExp(`^M${SHAPE_SIZE + 0.5} ${SHAPE_SIZE / 2}L`))
  expect(d).toMatch(/L239\.5 32$/)
})

it('legend_showsGrayDashed', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByText('질문·오류')).toBeInTheDocument()
})

it('card_handlesHolderNotOverflowHidden_textWrapperIs', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const card = flowNode('dev')!.querySelector('[data-shape="card"]')!
  const handle = card.querySelector('.react-flow__handle')!
  // 손잡이를 가진 바깥 상자는 자르지 않고, 글자 줄을 감싼 안쪽 상자만 자른다
  expect(handle.parentElement).toBe(card)
  expect(card.className).not.toContain('overflow-hidden')
  const wrapper = screen.getByText('개발', { selector: 'span.truncate' }).closest('.overflow-hidden')
  expect(wrapper).not.toBeNull()
  expect(wrapper).not.toBe(card)
  expect(card.contains(wrapper)).toBe(true)
})

it('legend_doesNotBlockPointer', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByText('진행').closest('div.absolute')!.className).toContain('pointer-events-none')
})

it('backEdge_savedLeftRightLayout_forwardEdgeIsNotBack', async () => {
  const legacy = FIXTURE + `layout:
  start: { x: 0, y: 0 }
  triage: { x: 240, y: 0 }
  dev: { x: 480, y: 0 }
  plan_ok: { x: 720, y: 0 }
  done: { x: 960, y: 0 }
`
  renderWithProviders(<Harness initial={legacy} />)
  // 옛 좌→우 배치에서는 어느 선도 위로 가지 않는다 — dagre 층으로 되돌림이라 하지 않는다
  expect((await screen.findByText('submitted')).closest('[data-back]')).toHaveAttribute('data-back', 'false')
  expect(screen.getByText('revise').closest('[data-back]')).toHaveAttribute('data-back', 'false')
})

it('backEdge_savedTargetAboveSource_isBack', async () => {
  // dev 가 triage 위에 그려져 있으면 triage → dev 선은 위로 되돌아간다
  const saved = FIXTURE + `layout:
  start: { x: 0, y: 0 }
  triage: { x: 0, y: 300 }
  dev: { x: 0, y: 100 }
  plan_ok: { x: 0, y: 500 }
  done: { x: 0, y: 700 }
`
  const { container } = renderWithProviders(<Harness initial={saved} />)
  expect((await screen.findByText('ready')).closest('[data-back]')).toHaveAttribute('data-back', 'true')
  expect(container.querySelector('[data-back="true"] path.react-flow__edge-path')?.getAttribute('style')).toContain('var(--warning-text)')
})

// 손잡이는 자리마다 s-* 하나뿐이다 — 같은 자리에 t-* 를 겹치면 느슨한 모드가 연결 불가 쪽을 잡는다(WP-2089)
it('handles_onlyOneSourceHandlePerSide_onEveryShape', () => {
  // 카드·마름모(decision)·원(start/end)이 모두 들어 있는 그래프 — RECOVERY 는 decision(pick)을 가진다
  const { container } = render(<Harness initial={RECOVERY} />)
  for (const shape of ['card', 'diamond', 'circle']) {
    const node = container.querySelector(`[data-shape="${shape}"]`)
    // 모양이 없어 검사가 건너뛰어지지 않게 한다
    expect(node, `${shape} 모양 노드`).not.toBeNull()
    const ids = [...node!.closest('.react-flow__node')!.querySelectorAll('.react-flow__handle')].map((h) => h.getAttribute('data-handleid'))
    expect(ids.sort()).toEqual(['s-bottom', 's-left', 's-right', 's-top'])
  }
  // 마름모·원의 위·아래 손잡이는 상자 가운데가 아니라 도형 가운데 x(SHAPE_SIZE / 2), 오른쪽은 도형 오른쪽 변(SHAPE_SIZE)에 놓인다
  for (const shape of ['diamond', 'circle']) {
    const wrap = container.querySelector(`[data-shape="${shape}"]`)!.closest('.react-flow__node')!
    const left = (id: string) => wrap.querySelector<HTMLElement>(`[data-handleid="${id}"]`)!.style.left
    expect(left('s-top'), `${shape} 위`).toBe(`${SHAPE_SIZE / 2}px`)
    expect(left('s-bottom'), `${shape} 아래`).toBe(`${SHAPE_SIZE / 2}px`)
    expect(left('s-right'), `${shape} 오른쪽`).toBe(`${SHAPE_SIZE}px`)
  }
})

// 느슨한 연결 모드의 대체 동작 고정 — 모든 선의 출발·도착 손잡이 id 가 그려진 노드에 실제로 있어야 한다(선 끝이 사라지지 않는다). 손잡이가 s-* 하나뿐이라는 것은 위 테스트가 확인한다
it('edges_endpointHandleIdsExistOnRenderedNodes', () => {
  const { container } = render(<Harness initial={FIXTURE} />)
  const edges = captured.props!.edges!
  expect(edges.length).toBeGreaterThan(0)
  const handlesOf = (id: string) =>
    [...container.querySelector(`.react-flow__node[data-id="${id}"]`)!.querySelectorAll('[data-handleid]')].map((h) => h.getAttribute('data-handleid'))
  for (const e of edges) {
    expect(handlesOf(e.source), `${e.id} 출발`).toContain(e.sourceHandle)
    expect(handlesOf(e.target), `${e.id} 도착`).toContain(e.targetHandle)
  }
})

it('reactFlow_usesLooseConnectionMode', () => {
  render(<Harness initial={FIXTURE} />)
  expect(captured.props?.connectionMode).toBe(ConnectionMode.Loose)
})

it.each(['s-top', 's-left'])('onConnect_dropOnHandle_%s_keepsDirectionFromStartNode', (targetHandle) => {
  const onYaml = vi.fn()
  render(<Harness initial={FIXTURE} onYaml={onYaml} />)
  captured.props!.onConnect!({ source: 'triage', target: 'done', sourceHandle: 's-right', targetHandle })
  const out = doc(onYaml.mock.lastCall![0])
  expect(Object.values(out.nodes.triage.outcomes).map((o) => (o as { to: string }).to)).toContain('done')
  expect(out.nodes.done.outcomes).toBeUndefined()
})

it('onConnect_selfConnection_refusedWithToast', () => {
  toastInfo.mockClear()
  const onYaml = vi.fn()
  render(<Harness initial={FIXTURE} onYaml={onYaml} />)
  captured.props!.onConnect!({ source: 'dev', target: 'dev', sourceHandle: 's-right', targetHandle: 's-top' })
  expect(onYaml).not.toHaveBeenCalled()
  expect(toastInfo).toHaveBeenCalledWith(REFUSE_SELF)
})

// WP-2090 — 도구는 캔버스 위에 뜨고, 미니맵이 함께 있다
it('floatingTools_render_inCanvas', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const canvas = screen.getByTestId('workflow-graph-canvas')
  for (const name of ['+ 노드', '자동 정렬', '질문 경로', '축소', '확대', '맞춤']) {
    expect(within(canvas).getByRole('button', { name })).toBeInTheDocument()
  }
})

it('minimap_rendered', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  expect(screen.getByTestId('workflow-graph-canvas').querySelector('.react-flow__minimap')).not.toBeNull()
})

it('readOnly_disablesFloatingTools', () => {
  renderWithProviders(<Harness initial={FIXTURE} readOnly />)
  expect(screen.getByRole('button', { name: '+ 노드' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '자동 정렬' })).toBeDisabled()
  for (const name of ['질문 경로', '축소', '확대', '맞춤']) expect(screen.getByRole('button', { name })).toBeEnabled()
})

it('fitButton_click_doesNotThrow', () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  fireEvent.click(screen.getByRole('button', { name: '맞춤' }))
  expect(screen.getByRole('button', { name: '맞춤' })).toBeInTheDocument()
})
