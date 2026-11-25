// instructionLock(WP-2092) — 지시 편집 창이 적용할 수 없는 까닭(lockReason)과 잠김 추적 전이(trackTarget).
import { describe, expect, it } from 'vitest'

import type { NodeDetail } from './graphYaml'
import { type InstructionEditorTarget, lockReason, trackTarget } from './instructionLock'

const target: InstructionEditorTarget = { nodeKey: 'dev', nodeName: '개발', nodeType: 'agent_task', text: '', useKey: '' }
const detail = (over: Partial<NodeDetail> = {}) => ({ key: 'dev', type: 'agent_task', name: '개발', instructions: '', use: [], ...over }) as NodeDetail

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

describe('trackTarget', () => {
  const fresh = { last: target, lost: false }
  it('풀린_동안엔_지금_노드를_따라간다', () => {
    const r = trackTarget(fresh, { detail: detail({ name: '개발 단계', instructions: '새 글', use: ['rules'] }), syntaxError: false })
    expect(r.lock).toBeNull()
    expect(r.last).toEqual({ ...target, nodeName: '개발 단계', text: '새 글', useKey: 'rules' })
  })
  it('바뀐_것이_없으면_last_를_그대로_돌려준다', () => {
    expect(trackTarget(fresh, { detail: detail(), syntaxError: false }).last).toBe(target)
  })
  it('노드를_못_찾으면_lost_를_세우고_last_는_둔다', () => {
    const r = trackTarget(fresh, { detail: null, syntaxError: false })
    expect(r).toEqual({ last: target, lost: true, lock: 'gone' })
  })
  it('문법_오류면_syntax_로_잠그고_lost_를_세운다', () => {
    const r = trackTarget(fresh, { detail: null, syntaxError: true })
    expect(r).toEqual({ last: target, lost: true, lock: 'syntax' })
  })
  it('같은_노드로_돌아오면_풀리고_lost_를_내린다', () => {
    const r = trackTarget({ last: target, lost: true }, { detail: detail(), syntaxError: false })
    expect(r).toEqual({ last: target, lost: false, lock: null })
  })
  it('다른_노드로_돌아오면_other_로_잠그고_last_는_둔다', () => {
    const r = trackTarget({ last: target, lost: true }, { detail: detail({ name: '다른 일' }), syntaxError: false })
    expect(r).toEqual({ last: target, lost: true, lock: 'other' })
  })
})
