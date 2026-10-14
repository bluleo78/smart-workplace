import { describe, expect, it } from 'vitest'

import type { ChatMessageResponse } from '@/types/chat'

import { questionStates } from './questionState'

const msg = (id: number, authorKind: 'HUMAN' | 'AGENT', extra: Partial<ChatMessageResponse> = {}) =>
  ({ id, authorKind, question: false, deleted: false, body: 'x', mentions: [], attachments: [], driveLinks: [],
     threadId: 1, authorId: authorKind === 'AGENT' ? 50 : 1, authorName: 'n', createdAt: '2026-10-14T00:00:00Z', editedAt: null, ...extra }) as ChatMessageResponse

describe('questionStates (질문한 AI 의 작업 상태 기준)', () => {
  it('INPUT_REQUIRED 인 AI 의 마지막 질문만 open, 앞선 질문은 answered', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true })], new Set([50]))
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('open')
  })
  it('대기 집합에 없는 AI(WORKING·종료)의 질문은 사람 답이 없어도 answered', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true })], new Set()).get(1)).toBe('answered')
  })
  it('사람 글이 뒤에 있어도 AI 가 여전히 INPUT_REQUIRED 면 open (AI 도구 보고 글)', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'HUMAN')], new Set([50])).get(1)).toBe('open')
  })
  it('AI 별로 각자의 마지막 질문 상태를 가진다', () => {
    const s = questionStates(
      [
        msg(1, 'AGENT', { question: true, authorId: 50 }),
        msg(2, 'AGENT', { question: true, authorId: 60 }),
        msg(3, 'AGENT', { question: true, authorId: 50 }),
      ],
      new Set([50]),
    )
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('answered') // 60 은 대기 아님
    expect(s.get(3)).toBe('open')
    const both = questionStates(
      [msg(1, 'AGENT', { question: true, authorId: 50 }), msg(2, 'AGENT', { question: true, authorId: 60 })],
      new Set([50, 60]),
    )
    expect(both.get(1)).toBe('open')
    expect(both.get(2)).toBe('open')
  })
  it('대기 집합이 undefined(이슈 미로드)면 AI 별 마지막 질문이 open', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true })], undefined)
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('open')
  })
  it('삭제된 질문·question 없는 글은 상태가 없고, 삭제된 최신 질문은 앞선 질문을 가리지 않는다', () => {
    const s = questionStates(
      [msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true, deleted: true }), msg(3, 'AGENT')],
      new Set([50]),
    )
    expect(s.has(2)).toBe(false)
    expect(s.has(3)).toBe(false)
    expect(s.get(1)).toBe('open')
  })
})
