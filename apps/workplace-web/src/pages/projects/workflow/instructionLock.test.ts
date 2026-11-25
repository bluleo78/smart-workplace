// instructionLock.lockReason(WP-2092) — 지시 편집 창이 적용할 수 없는 까닭을 순서대로 가린다.
import { describe, expect, it } from 'vitest'

import type { NodeDetail } from './graphYaml'
import { type InstructionEditorTarget, lockReason } from './instructionLock'

const target: InstructionEditorTarget = { nodeKey: 'dev', nodeName: '개발', nodeType: 'agent_task', text: '' }
const detail = (over: Partial<NodeDetail> = {}) => ({ key: 'dev', type: 'agent_task', name: '개발', ...over }) as NodeDetail

describe('lockReason', () => {
  it('문법_오류가_가장_먼저다', () => {
    expect(lockReason({ syntaxError: true, detail: null, lost: true, target })).toBe('syntax')
  })
  it('노드가_없으면_gone', () => {
    expect(lockReason({ syntaxError: false, detail: null, lost: true, target })).toBe('gone')
  })
  it('지시를_받지_않는_유형이면_type', () => {
    expect(lockReason({ syntaxError: false, detail: detail({ type: 'decision' }), lost: false, target })).toBe('type')
  })
  it('사라졌다_돌아온_노드의_이름이나_유형이_다르면_other', () => {
    expect(lockReason({ syntaxError: false, detail: detail({ name: '다른 일' }), lost: true, target })).toBe('other')
    expect(lockReason({ syntaxError: false, detail: detail({ type: 'human_task' }), lost: true, target })).toBe('other')
  })
  it('계속_있던_노드는_이름이_바뀌어도_잠기지_않는다', () => {
    expect(lockReason({ syntaxError: false, detail: detail({ name: '다른 일' }), lost: false, target })).toBeNull()
  })
  it('사라졌다_같은_노드로_돌아오면_null', () => {
    expect(lockReason({ syntaxError: false, detail: detail(), lost: true, target })).toBeNull()
  })
})
