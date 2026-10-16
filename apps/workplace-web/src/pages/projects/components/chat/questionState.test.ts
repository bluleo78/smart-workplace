import { describe, expect, it } from 'vitest'

import type { AgentQuestionWork } from '@/lib/agentWork'
import type { ChatMessageResponse } from '@/types/chat'

import { questionStates } from './questionState'

// 질문 글 시각(msg 기본 createdAt) 이후에 갱신된 작업 — 이슈 데이터가 질문을 이미 반영한 상태.
const AFTER = Date.parse('2026-10-14T00:00:05Z')
/** AI id → 작업 재료. waiting 에 든 id 는 답변 대기, 나머지는 작업 중. 갱신 시각은 기본 질문 뒤. */
const works = (ids: number[], waiting: number[] = [], updatedAt = AFTER): Map<number, AgentQuestionWork> =>
  new Map(ids.map((id) => [id, { waiting: waiting.includes(id), updatedAt }]))

const msg = (id: number, authorKind: 'HUMAN' | 'AGENT', extra: Partial<ChatMessageResponse> = {}) =>
  ({ id, authorKind, question: false, deleted: false, body: 'x', mentions: [], attachments: [], driveLinks: [],
     threadId: 1, authorId: authorKind === 'AGENT' ? 50 : 1, authorName: 'n', createdAt: '2026-10-14T00:00:00Z', editedAt: null, ...extra }) as ChatMessageResponse

describe('questionStates (질문한 AI 의 작업 상태 기준)', () => {
  it('INPUT_REQUIRED 인 AI 의 마지막 질문만 open, 앞선 질문은 answered', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true })], works([50], [50]))
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('open')
  })
  it('질문 뒤에 WORKING 으로 갱신됐거나 작업이 끝난 AI 의 질문은 사람 답이 없어도 answered', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true })], works([50])).get(1)).toBe('answered')
    expect(questionStates([msg(1, 'AGENT', { question: true })], works([])).get(1)).toBe('answered')
  })
  it('사람 글이 뒤에 있어도 AI 가 여전히 INPUT_REQUIRED 면 open (AI 도구 보고 글)', () => {
    expect(questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'HUMAN')], works([50], [50])).get(1)).toBe('open')
  })
  it('AI 별로 각자의 마지막 질문 상태를 가진다', () => {
    const s = questionStates(
      [
        msg(1, 'AGENT', { question: true, authorId: 50 }),
        msg(2, 'AGENT', { question: true, authorId: 60 }),
        msg(3, 'AGENT', { question: true, authorId: 50 }),
      ],
      works([50, 60], [50]),
    )
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('answered') // 60 은 대기 아님
    expect(s.get(3)).toBe('open')
    const both = questionStates(
      [msg(1, 'AGENT', { question: true, authorId: 50 }), msg(2, 'AGENT', { question: true, authorId: 60 })],
      works([50, 60], [50, 60]),
    )
    expect(both.get(1)).toBe('open')
    expect(both.get(2)).toBe('open')
  })
  it('이슈를 받는 중이면 AI 별 마지막 질문이 open — 첫 화면에서 답변됨으로 깜빡이지 않게', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true })], 'loading')
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('open')
  })
  it('마지막 이슈 조회가 실패했으면 마지막 질문은 unknown — 단정하지 않는다 (WP-391)', () => {
    const s = questionStates([msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true })], 'failed')
    expect(s.get(1)).toBe('answered')
    expect(s.get(2)).toBe('unknown')
  })
  it('작업 갱신이 질문 글보다 이르면(이슈를 아직 다시 받지 않음) WORKING 이어도 open (WP-391)', () => {
    const before = Date.parse('2026-10-13T23:59:00Z')
    expect(questionStates([msg(1, 'AGENT', { question: true })], works([50], [], before)).get(1)).toBe('open')
    // 같은 트랜잭션에서 남긴 질문은 시각이 같다 — 그때는 작업 상태를 따른다.
    const same = Date.parse('2026-10-14T00:00:00Z')
    expect(questionStates([msg(1, 'AGENT', { question: true })], works([50], [], same)).get(1)).toBe('answered')
    expect(questionStates([msg(1, 'AGENT', { question: true })], works([50], [50], same)).get(1)).toBe('open')
  })
  it('삭제된 질문·question 없는 글은 상태가 없고, 삭제된 최신 질문은 앞선 질문을 가리지 않는다', () => {
    const s = questionStates(
      [msg(1, 'AGENT', { question: true }), msg(2, 'AGENT', { question: true, deleted: true }), msg(3, 'AGENT')],
      works([50], [50]),
    )
    expect(s.has(2)).toBe(false)
    expect(s.has(3)).toBe(false)
    expect(s.get(1)).toBe('open')
  })
})
