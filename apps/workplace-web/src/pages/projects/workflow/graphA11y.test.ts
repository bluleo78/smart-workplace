import { describe, expect, it } from 'vitest'

import {
  edgeAriaLabel,
  GRAPH_ARIA_LABEL_CONFIG,
  GRAPH_ARIA_LABEL_CONFIG_READONLY,
  GRAPH_EDITOR_ARIA_LABEL,
  nodeAriaLabel,
  panelActionFromKeyDown,
} from './graphA11y'

describe('graphA11y', () => {
  it('nodeAriaLabel_problemSuffix', () => {
    const node = { key: 'dev', type: 'agent_task', name: '개발' }
    expect(nodeAriaLabel(node, undefined, 'ERROR')).toBe('개발, AI, 오류 있음')
    expect(nodeAriaLabel(node, '팀장', 'WARNING')).toBe('개발, AI · 팀장, 경고 있음')
    expect(nodeAriaLabel(node, undefined, undefined)).toBe('개발, AI')
  })

  it('nodeAriaLabel_actorWithRole', () => {
    expect(nodeAriaLabel({ key: 'work', type: 'human_task', name: '작업' }, '확인자')).toBe('작업, 사람 · 확인자')
    expect(nodeAriaLabel({ key: 'triage', type: 'agent_task', name: '분류' }, '팀장')).toBe('분류, AI · 팀장')
    expect(nodeAriaLabel({ key: 'dev', type: 'agent_task', name: '개발' })).toBe('개발, AI')
  })
  it('nodeAriaLabel_kindWhenNoActor_keyWhenNoName', () => {
    expect(nodeAriaLabel({ key: 'start', type: 'start' })).toBe('start, 시작')
    expect(nodeAriaLabel({ key: 'end', type: 'end' })).toBe('end, 종료')
    expect(nodeAriaLabel({ key: 'gate', type: 'decision', name: '갈림' })).toBe('갈림, 분기')
    expect(nodeAriaLabel({ key: 'x', type: 'custom' })).toBe('x, custom')
  })
  it('edgeAriaLabel_usesDisplayNames_labelInParens', () => {
    const names = new Map([['work', '작업'], ['check', '확인 단계']])
    expect(edgeAriaLabel({ id: 'e1', from: 'work', to: 'check', kind: 'outcome', label: 'done' }, names)).toBe('작업 → 확인 단계 (done)')
    expect(edgeAriaLabel({ id: 'e2', from: 'work', to: 'check', kind: 'outcome', label: '' }, names)).toBe('작업 → 확인 단계')
    expect(edgeAriaLabel({ id: 'e3', from: 'a', to: 'check', kind: 'outcome', label: '' }, names)).toBe('a → 확인 단계')
  })
  it('nodeAriaLabel_virtualNodeSaysNotEditable', () => {
    expect(nodeAriaLabel({ key: 'a_ask', type: 'human_task', name: '질문', virtual: true })).toBe('질문, 사람, 질문 경로(편집 불가)')
  })
  it('edgeAriaLabel_askEdgeReadsAsQuestion', () => {
    const names = new Map([['a', '가'], ['b', '나']])
    expect(edgeAriaLabel({ id: 'e', from: 'a', to: 'b', kind: 'ask', label: 'x' }, names)).toBe('가 → 나 (질문)')
    expect(edgeAriaLabel({ id: 'e', from: 'a', to: 'b', kind: 'ask', label: '' }, names)).toBe('가 → 나 (질문)')
  })
  it('panelActionFromKeyDown_openOnEnterSpace_closeOnEscapeOnNode', () => {
    const real = new Set(['a', 'b'])
    expect(panelActionFromKeyDown('Enter', 'a', real)).toEqual({ open: 'a' })
    expect(panelActionFromKeyDown(' ', 'b', real)).toEqual({ open: 'b' })
    expect(panelActionFromKeyDown('Escape', 'a', real)).toEqual({ close: true })
    expect(panelActionFromKeyDown('Escape', null, real)).toBeNull()
    expect(panelActionFromKeyDown('a', 'a', real)).toBeNull()
    expect(panelActionFromKeyDown('Enter', null, real)).toBeNull()
    expect(panelActionFromKeyDown('Enter', 'a_ask', real)).toBeNull()
    // 가상 노드 위 Space 는 패널을 열지 않고 스크롤만 막는다
    expect(panelActionFromKeyDown(' ', 'a_ask', real)).toEqual({ swallow: true })
  })
  it('ariaLabelConfig_isKorean', () => {
    const c = GRAPH_ARIA_LABEL_CONFIG
    for (const k of ['node.a11yDescription.default', 'node.a11yDescription.keyboardDisabled', 'edge.a11yDescription.default'] as const) {
      expect(c[k]).toMatch(/[가-힣]/)
    }
    expect(c['node.a11yDescription.keyboardDisabled']).toContain('편집 패널')
    expect(c['node.a11yDescription.ariaLiveMessage']!({ direction: 'left', x: 10, y: 20 })).toBe('고른 노드를 왼쪽으로 옮겼습니다. 새 위치 x 10, y 20')
    expect(c['node.a11yDescription.keyboardDisabled']).toBe('Enter·Space 로 노드를 골라 편집 패널을 엽니다. 고른 뒤 화살표로 노드를 옮기고, Esc 로 선택을 풀고 편집 패널을 닫습니다.')
    expect(GRAPH_ARIA_LABEL_CONFIG_READONLY['node.a11yDescription.keyboardDisabled']).toBe('Enter·Space 로 노드를 골라 편집 패널을 열고, Esc 로 닫습니다.')
    expect(GRAPH_ARIA_LABEL_CONFIG_READONLY['node.a11yDescription.keyboardDisabled']).not.toContain('화살표')
    expect(GRAPH_EDITOR_ARIA_LABEL).toBe('워크플로우 그래프 편집')
  })
})
