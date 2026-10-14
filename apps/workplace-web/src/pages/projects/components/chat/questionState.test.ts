import { describe, expect, it } from 'vitest'

import type { ChatMessageResponse } from '@/types/chat'

import { questionStates } from './questionState'

const msg = (id: number, authorKind: 'HUMAN' | 'AGENT', extra: Partial<ChatMessageResponse> = {}) =>
  ({ id, authorKind, question: false, deleted: false, body: 'x', mentions: [], attachments: [], driveLinks: [],
     threadId: 1, authorId: id, authorName: 'n', createdAt: '2026-10-14T00:00:00Z', editedAt: null, ...extra }) as ChatMessageResponse

describe('questionStates', () => {
  it('질문 뒤에 사람 글이 없으면 open, 있으면 answered', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'HUMAN'), msg(3, 'AGENT', { question: true })])
    expect(s.get(1)).toBe('answered')
    expect(s.get(3)).toBe('open')
    expect(s.has(2)).toBe(false)
  })
  it('AI 글만 뒤에 있으면 여전히 open', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT')]).get(1)).toBe('open')
  })
  it('삭제된 사람 글은 답으로 치지 않는다', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'HUMAN', { deleted: true })]).get(1)).toBe('open')
  })
  it('보내는 중인 내 글(음수 id)은 답으로 친다', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true }), msg(-5, 'HUMAN')]).get(1)).toBe('answered')
  })
  it('삭제된 질문·question 없는 글은 상태가 없다', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true, deleted: true }), msg(2, 'AGENT')])
    expect(s.size).toBe(0)
  })
})
