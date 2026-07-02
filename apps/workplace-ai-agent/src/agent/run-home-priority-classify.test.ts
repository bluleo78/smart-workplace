// run-home-priority-classify 유닛 테스트 — LLM 호출은 runText 목으로 대체.
import { describe, it, expect, vi } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import { runHomePriorityClassify, parsePriorityClassifyJson } from './run-home-priority-classify.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

// runText 목 — 실제 LLM 호출 없이 텍스트 반환 제어.
vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runText: vi.fn() }
})

const baseInput = {
  assistantAgentId: 1,
  model: 'claude-sonnet-4-6',
  maxTurns: 4,
  timeoutMs: 30000,
}

describe('runHomePriorityClassify', () => {
  it('항목이 없으면 LLM 호출 없이 빈 결과 반환', async () => {
    const result = await runHomePriorityClassify({ ...baseInput, items: [] }, mockDeps)
    expect(result.results).toEqual([])
    expect(messagingAi.runText).not.toHaveBeenCalled()
  })

  it('정상 JSON 파싱 → 결과 반환', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"results":[{"sourceType":"ISSUE_DUE","sourceId":"1","importanceScore":80,"urgencyScore":90,"reason":"고객 마감"}]}',
    )
    const result = await runHomePriorityClassify(
      { ...baseInput, items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', context: '마감 오늘' }] },
      mockDeps,
    )
    expect(result.results).toEqual([
      { sourceType: 'ISSUE_DUE', sourceId: '1', importanceScore: 80, urgencyScore: 90, reason: '고객 마감' },
    ])
  })

  it('JSON 파싱 실패 시 빈 결과 폴백', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue('죄송합니다, 판단할 수 없습니다.')
    const result = await runHomePriorityClassify(
      { ...baseInput, items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', context: '' }] },
      mockDeps,
    )
    expect(result.results).toEqual([])
  })

  it('Zod 검증 실패(점수 범위 밖) 시 빈 결과 폴백', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"results":[{"sourceType":"ISSUE_DUE","sourceId":"1","importanceScore":200,"urgencyScore":90,"reason":"x"}]}',
    )
    const result = await runHomePriorityClassify(
      { ...baseInput, items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', context: '' }] },
      mockDeps,
    )
    expect(result.results).toEqual([])
  })

  it('sourceType 누락 시 Zod 검증 실패 → 빈 결과 폴백(C1: sourceId 단독으로는 소스 구분 불가)', async () => {
    vi.mocked(messagingAi.runText).mockResolvedValue(
      '{"results":[{"sourceId":"1","importanceScore":80,"urgencyScore":90,"reason":"고객 마감"}]}',
    )
    const result = await runHomePriorityClassify(
      { ...baseInput, items: [{ sourceType: 'ISSUE_DUE', sourceId: '1', title: '이슈 A', context: '' }] },
      mockDeps,
    )
    expect(result.results).toEqual([])
  })
})

describe('parsePriorityClassifyJson', () => {
  it('코드펜스가 섞여도 JSON 추출', () => {
    const text =
      '```json\n{"results":[{"sourceType":"MENTION","sourceId":"2","importanceScore":10,"urgencyScore":20,"reason":"낮음"}]}\n```'
    expect(parsePriorityClassifyJson(text)).toEqual({
      results: [{ sourceType: 'MENTION', sourceId: '2', importanceScore: 10, urgencyScore: 20, reason: '낮음' }],
    })
  })
})
