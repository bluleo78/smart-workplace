import { describe, it, expect } from 'vitest'
import { parseIssueSummaryJson, buildIssueSummaryPrompt, type IssueSummaryInput } from './run-issue-summary.js'

// 기본 입력 픽스처 — body·chat 비어 있는 최소 케이스.
const baseInput: IssueSummaryInput = {
  title: '테스트 이슈',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  dueDate: '2026-07-01',
  comments: [],
  history: [],
  assistantAgentId: 1,
  model: 'claude-sonnet-4-5',
  maxTurns: 3,
  timeoutMs: 30000,
}

describe('parseIssueSummaryJson', () => {
  it('코드펜스 감싼 JSON 을 파싱한다', () => {
    const out = parseIssueSummaryJson('```json\n{"summary":"리뷰 대기","nextAction":"리뷰어 지정"}\n```')
    expect(out).toEqual({ summary: '리뷰 대기', nextAction: '리뷰어 지정' })
  })
  it('JSON 없으면 빈 문자열로 폴백한다', () => {
    expect(parseIssueSummaryJson('헛소리')).toEqual({ summary: '', nextAction: '' })
  })
  it('nextAction 누락 시 빈 문자열', () => {
    expect(parseIssueSummaryJson('{"summary":"x"}')).toEqual({ summary: 'x', nextAction: '' })
  })
})

describe('buildIssueSummaryPrompt', () => {
  it('기본 메타(제목·상태·우선순위·마감)를 포함한다', () => {
    const prompt = buildIssueSummaryPrompt(baseInput)
    expect(prompt).toContain('테스트 이슈')
    expect(prompt).toContain('IN_PROGRESS')
    expect(prompt).toContain('HIGH')
    expect(prompt).toContain('2026-07-01')
  })

  it('body 가 있으면 이슈 본문 섹션을 포함한다', () => {
    const input: IssueSummaryInput = {
      ...baseInput,
      body: '이슈 설명입니다.',
    }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).toContain('## 이슈 본문')
    expect(prompt).toContain('이슈 설명입니다.')
  })

  it('body 가 빈 문자열이면 이슈 본문 섹션을 생략한다', () => {
    const input: IssueSummaryInput = { ...baseInput, body: '   ' }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).not.toContain('## 이슈 본문')
  })

  it('body 가 undefined 이면 이슈 본문 섹션을 생략한다', () => {
    const prompt = buildIssueSummaryPrompt(baseInput)
    expect(prompt).not.toContain('## 이슈 본문')
  })

  it('chat 이 있으면 채팅 섹션과 각 메시지를 포함한다', () => {
    const input: IssueSummaryInput = {
      ...baseInput,
      chat: [
        { author: '홍길동', kind: 'USER', body: '진행 상황이 어떻게 되나요?', createdAt: '2026-06-28T10:00:00Z' },
        { author: 'AI', kind: 'AGENT', body: '현재 리뷰 중입니다.', createdAt: '2026-06-28T10:01:00Z' },
      ],
    }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).toContain('## 이슈 채팅(사람↔AI 대화, 시간순)')
    expect(prompt).toContain('[USER] 홍길동: 진행 상황이 어떻게 되나요?')
    expect(prompt).toContain('[AGENT] AI: 현재 리뷰 중입니다.')
  })

  it('chat 이 빈 배열이면 채팅 섹션을 생략한다', () => {
    const input: IssueSummaryInput = { ...baseInput, chat: [] }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).not.toContain('## 이슈 채팅')
  })

  it('chat 이 undefined 이면 채팅 섹션을 생략한다', () => {
    const prompt = buildIssueSummaryPrompt(baseInput)
    expect(prompt).not.toContain('## 이슈 채팅')
  })

  it('코멘트와 변경이력을 포함한다', () => {
    const input: IssueSummaryInput = {
      ...baseInput,
      comments: [{ authorName: '김철수', body: '확인 부탁드립니다.', createdAt: '2026-06-28T09:00:00Z' }],
      history: [
        {
          actorName: '이영희',
          eventType: 'STATUS_CHANGED',
          fromValue: 'TODO',
          toValue: 'IN_PROGRESS',
          createdAt: '2026-06-28T08:00:00Z',
        },
      ],
    }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).toContain('김철수: 확인 부탁드립니다.')
    expect(prompt).toContain('이영희: STATUS_CHANGED TODO→IN_PROGRESS')
  })

  it('body·chat 모두 포함한 완전한 입력을 올바르게 조립한다', () => {
    const input: IssueSummaryInput = {
      ...baseInput,
      body: '로그인 버튼이 모바일에서 동작하지 않음.',
      chat: [{ author: '박민수', kind: 'USER', body: '재현 확인됨', createdAt: null }],
    }
    const prompt = buildIssueSummaryPrompt(input)
    expect(prompt).toContain('## 이슈 본문')
    expect(prompt).toContain('로그인 버튼이 모바일에서 동작하지 않음.')
    expect(prompt).toContain('## 이슈 채팅(사람↔AI 대화, 시간순)')
    expect(prompt).toContain('[USER] 박민수: 재현 확인됨')
  })
})
