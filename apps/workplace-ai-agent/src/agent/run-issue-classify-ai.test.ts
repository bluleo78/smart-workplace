// run-issue-classify-ai 유닛 테스트 — LLM 호출은 runText 목으로 대체.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import { runIssueClassify } from './run-issue-classify-ai.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

// runText 목 — 실제 LLM 호출 없이 텍스트 반환 제어.
vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runText: vi.fn() }
})

describe('parseClassifyJson', () => {
  it('정상 JSON 파싱', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"type":"BUG","priority":"HIGH","labels":["backend"],"reason":"500 오류"}'
    )
    const result = await runIssueClassify(
      {
        title: '로그인 오류',
        body: '500 에러 발생',
        projectLabels: ['backend', 'frontend'],
        isPersonalProject: false,
        assistantAgentId: 1,
        model: 'claude-sonnet-4-6',
        maxTurns: 2,
        timeoutMs: 30000,
      },
      mockDeps
    )
    expect(result.type).toBe('BUG')
    expect(result.priority).toBe('HIGH')
    expect(result.labels).toEqual(['backend'])
    expect(result.reason).toBe('500 오류')
  })

  it('allowlist 밖 라벨 필터링', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"type":"TASK","priority":"MID","labels":["backend","ghost-label"],"reason":"테스트"}'
    )
    const result = await runIssueClassify(
      {
        title: '테스트',
        body: '',
        projectLabels: ['backend'],
        isPersonalProject: false,
        assistantAgentId: 1,
        model: 'claude-sonnet-4-6',
        maxTurns: 2,
        timeoutMs: 30000,
      },
      mockDeps
    )
    expect(result.labels).toEqual(['backend'])  // ghost-label 필터됨
  })

  it('isPersonalProject=true 일 때 fallback type 없음', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"priority":"HIGH","labels":[],"reason":"개인 태스크"}'
    )
    const result = await runIssueClassify(
      {
        title: '개인 할 일',
        body: '',
        projectLabels: [],
        isPersonalProject: true,
        assistantAgentId: 1,
        model: 'claude-sonnet-4-6',
        maxTurns: 2,
        timeoutMs: 30000,
      },
      mockDeps
    )
    expect(result.type).toBeUndefined()
    expect(result.priority).toBe('HIGH')
  })

  it('JSON 파싱 실패 시 fallback 반환', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue('죄송합니다, 분류할 수 없습니다.')
    const result = await runIssueClassify(
      {
        title: '제목',
        body: '',
        projectLabels: ['bug'],
        isPersonalProject: false,
        assistantAgentId: 1,
        model: 'claude-sonnet-4-6',
        maxTurns: 2,
        timeoutMs: 30000,
      },
      mockDeps
    )
    expect(result.priority).toBe('MID')
    expect(result.labels).toEqual([])
    expect(result.reason).toBe('')
  })

  it('Zod 검증 실패 시 fallback 반환', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"type":"INVALID_TYPE","priority":"CRITICAL","labels":[],"reason":"잘못된 값"}'
    )
    const result = await runIssueClassify(
      {
        title: '제목',
        body: '',
        projectLabels: [],
        isPersonalProject: false,
        assistantAgentId: 1,
        model: 'claude-sonnet-4-6',
        maxTurns: 2,
        timeoutMs: 30000,
      },
      mockDeps
    )
    expect(result.priority).toBe('MID')  // fallback
    expect(result.type).toBeUndefined()   // fallback
  })
})
