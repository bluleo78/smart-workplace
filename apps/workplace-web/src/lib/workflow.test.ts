import { describe, expect, it } from 'vitest'

import { isQuestionPathNode } from './workflow'

// 질문 단계 판정(WP-2157) — 표준 질문 경로 모양(human_task + returnTo + 결과 answered 뿐)만 true.
describe('isQuestionPathNode', () => {
  it('isQuestionPathNode_standardAskOnly', () => {
    expect(isQuestionPathNode('human_task', 'work', ['answered'])).toBe(true)
    expect(isQuestionPathNode('human_task', 'work', ['answered', 'skip'])).toBe(false)
    expect(isQuestionPathNode('agent_task', 'work', ['answered'])).toBe(false)
    expect(isQuestionPathNode('human_task', null, ['answered'])).toBe(false)
    expect(isQuestionPathNode('human_task', 'work', [])).toBe(false)
  })
})
