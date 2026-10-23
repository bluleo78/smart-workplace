// run-issue-classify-ai 유닛 테스트 — LLM 호출은 runText 목으로 대체.
import { describe, it, expect, vi } from 'vitest'
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

  // WP-886: 5단계 — HIGHEST·LOWEST 를 그대로 받고, 모르는 우선순위는 그 필드만 MID(유형·라벨 제안은 지킨다).
  const input = {
    title: '제목',
    body: '',
    projectLabels: ['backend'],
    isPersonalProject: false,
    assistantAgentId: 1,
    model: 'claude-sonnet-4-6',
    maxTurns: 2,
    timeoutMs: 30000,
  }

  it('HIGHEST·LOWEST 를 받는다', async () => {
    for (const priority of ['HIGHEST', 'LOWEST']) {
      vi.mocked(messagingAi.runText).mockResolvedValue(`{"type":"BUG","priority":"${priority}","labels":[],"reason":"r"}`)
      const result = await runIssueClassify(input, mockDeps)
      expect(result.priority).toBe(priority)
    }
  })

  it('모르는 우선순위만 MID 로 — 유형·라벨은 그대로', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue('{"type":"BUG","priority":"URGENT","labels":["backend"],"reason":"r"}')
    const result = await runIssueClassify(input, mockDeps)
    expect(result.priority).toBe('MID')
    expect(result.type).toBe('BUG')
    expect(result.labels).toEqual(['backend'])
  })

  it('프롬프트가 5단계와 매우 높음의 좁은 기준을 안내한다', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue('{"priority":"MID","labels":[],"reason":"r"}')
    await runIssueClassify(input, mockDeps)
    const prompt = JSON.stringify(vi.mocked(messagingAi.runText).mock.calls.at(-1))
    expect(prompt).toContain('HIGHEST|HIGH|MID|LOW|LOWEST')
    expect(prompt).toContain('드물게')
  })

  // 정규화 규칙 자체는 issue-priority.test 가 지킨다 — 여기선 classify 가 그 정규화를 거치는지만 본다.
  it('소문자·공백 우선순위는 normalizePriority 를 거쳐 살린다', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue('{"type":"BUG","priority":" highest ","labels":[],"reason":"r"}')
    const result = await runIssueClassify(input, mockDeps)
    expect(result.priority).toBe('HIGHEST')
  })
})
