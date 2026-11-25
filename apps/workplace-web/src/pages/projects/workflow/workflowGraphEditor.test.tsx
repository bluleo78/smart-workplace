import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import type { WorkflowProblem } from '@/lib/workflows'
import { renderWithProviders } from '@/test/renderWithProviders'

import { applyConnection } from './applyConnection'
import { connectFromFlow, moveManyFromDrag, parseWorkflowGraph, REFUSE_NO_ROLE } from './graphYaml'
import { WorkflowGraphEditor } from './WorkflowGraphEditor'

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
function Harness({ initial, problems = [], readOnly = false, onYaml, onOpenYaml = () => {} }: {
  initial: string; problems?: WorkflowProblem[]; readOnly?: boolean; onYaml?: (y: string) => void; onOpenYaml?: () => void
}) {
  const [yaml, setYaml] = useState(initial)
  return (
    <div style={{ width: 1000, height: 600 }}>
      <WorkflowGraphEditor
        yaml={yaml}
        problems={problems}
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

it('warningBar_quickFixAddsAskPath', async () => {
  const onYaml = vi.fn()
  const problems: WorkflowProblem[] = [{
    severity: 'WARNING', code: 'ASK_PATH_MISSING', nodeKey: 'triage', message: '사람에게 물어볼 길이 없습니다.', line: 1, column: 1,
  }]
  renderWithProviders(<Harness initial={FIXTURE} problems={problems} onYaml={onYaml} />)
  expect(screen.getByText(/경고 1/)).toBeInTheDocument()
  expect(screen.getByText(/사람에게 물어볼 길이 없습니다\./)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '질문 경로 추가' }))
  const out = doc(onYaml.mock.lastCall![0])
  expect(out.nodes.triage_ask).toBeDefined()
  expect(out.nodes.triage.outcomes.ask).toBeDefined()
})

it('warningBar_errors_offerOpenYaml', () => {
  const onOpenYaml = vi.fn()
  const problems: WorkflowProblem[] = [{ severity: 'ERROR', code: 'X', message: '틀렸습니다.', line: 1, column: 1, nodeKey: null }]
  renderWithProviders(<Harness initial={FIXTURE} problems={problems} onOpenYaml={onOpenYaml} />)
  expect(screen.getByText(/오류 1/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'YAML 오류 확인' }))
  expect(onOpenYaml).toHaveBeenCalled()
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

// 코드 리뷰 8 — 오류가 있으면 첫 오류의 메시지를 보인다
it('warningBar_showsFirstErrorMessage', () => {
  const problems: WorkflowProblem[] = [
    { severity: 'WARNING', code: 'W', message: '경고 문구', line: 1, column: 1, nodeKey: null },
    { severity: 'ERROR', code: 'E', message: '오류 문구', line: 1, column: 1, nodeKey: null },
  ]
  renderWithProviders(<Harness initial={FIXTURE} problems={problems} />)
  expect(screen.getByText('오류 문구')).toBeInTheDocument()
  expect(screen.queryByText('경고 문구')).not.toBeInTheDocument()
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
// Esc 는 선택을 풀고 패널도 닫는다
it('graphEditor_escapeOnNode_closesPanel', async () => {
  renderWithProviders(<Harness initial={FIXTURE} />)
  const node = screen.getByLabelText('개발, AI · developer')
  fireEvent.keyDown(node, { key: 'Enter' })
  expect(await screen.findByLabelText('노드 이름')).toHaveValue('개발')
  fireEvent.keyDown(node, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByLabelText('노드 이름')).toBeNull())
})
