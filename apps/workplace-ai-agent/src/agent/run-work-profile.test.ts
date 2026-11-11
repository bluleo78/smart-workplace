// run-work-profile 유닛 테스트 — LLM 호출은 runText 목으로 대체.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as messagingAi from './run-messaging-ai.js'
import { runWorkProfile, WORK_PROFILE_TASKS, workProfileInputSchema } from './run-work-profile.js'
import type { RunAgentDeps } from './run-agent.js'

const mockDeps = {} as RunAgentDeps

vi.mock('./run-messaging-ai.js', async (importOriginal) => {
  const original = await importOriginal<typeof messagingAi>()
  return { ...original, runText: vi.fn() }
})

// 입력 빌더 — 이슈 WP-1·WP-2 두 건.
function input() {
  return workProfileInputSchema.parse({
    periodLabel: '이번 달',
    issues: [
      { key: 'WP-1', title: '로그인 오류 수정', project: 'WP', dueResult: '기한 내' },
      { key: 'WP-2', title: '목록 화면 추가', body: '본문', project: 'WP', labels: ['web'], dueResult: '기한 없음' },
    ],
    assistantAgentId: 1,
    model: 'm',
    maxTurns: 2,
    timeoutMs: 30000,
  })
}

function mockText(text: string) {
  vi.mocked(messagingAi.runText).mockResolvedValue(text)
}

beforeEach(() => vi.clearAllMocks())

describe('runWorkProfile', () => {
  it('정상 JSON → 요약·역량·분류', async () => {
    mockText(
      '```json\n' +
        JSON.stringify({
          summary: '로그인 결함을 고치고 화면을 만들었어요.',
          skills: ['React', '인증'],
          items: [
            { key: 'WP-1', task: '결함 수정', area: '로그인' },
            { key: 'WP-2', task: '기능 개발', area: '이슈 트래커' },
          ],
        }) +
        '\n```',
    )
    const r = await runWorkProfile(input(), mockDeps)
    expect(r.summary).toBe('로그인 결함을 고치고 화면을 만들었어요.')
    expect(r.skills).toEqual(['React', '인증'])
    expect(r.items.length).toBe(2)
    expect(r.items[0]).toEqual({ key: 'WP-1', task: '결함 수정', area: '로그인' })
  })

  it('목록 밖 task 는 기타, 모르는 key 는 버림, 같은 key 는 첫 것만', async () => {
    mockText(
      JSON.stringify({
        summary: 's',
        skills: [],
        items: [
          { key: 'WP-1', task: '춤추기', area: 'a' },
          { key: 'ZZ-9', task: '테스트', area: 'b' },
          { key: 'WP-1', task: '테스트', area: 'c' },
        ],
      }),
    )
    const r = await runWorkProfile(input(), mockDeps)
    expect(r.items).toEqual([{ key: 'WP-1', task: '기타', area: 'a' }])
  })

  it('고정 task 목록은 확정된 9개다', () => {
    expect([...WORK_PROFILE_TASKS]).toEqual([
      '결함 수정', '기능 개발', '설계·기획', '릴리스·배포', '매뉴얼·문서', '테스트', '운영·지원', '개선·정리', '기타',
    ])
  })

  it('skills 는 trim·빈 값 제거·중복 제거 후 5개까지', async () => {
    mockText(JSON.stringify({ summary: 's', skills: [' a ', '', 'a', 'b', 'c', 'd', 'e', 'f', 3], items: [] }))
    const r = await runWorkProfile(input(), mockDeps)
    expect(r.skills).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(r.skills.length).toBe(5)
  })

  it('area 가 문자열이 아니면 빈 문자열', async () => {
    mockText(JSON.stringify({ summary: 's', skills: [], items: [{ key: 'WP-1', task: '테스트', area: 5 }] }))
    const r = await runWorkProfile(input(), mockDeps)
    expect(r.items[0].area).toBe('')
  })

  it('깨진 응답이면 예외', async () => {
    mockText('모르겠어요')
    await expect(runWorkProfile(input(), mockDeps)).rejects.toThrow('work_profile_parse_failed')
    mockText('{"summary":1}')
    await expect(runWorkProfile(input(), mockDeps)).rejects.toThrow('work_profile_parse_failed')
  })

  it('프롬프트에 이슈 키·고정 task 목록이 실리고 건수를 만들지 말라는 지시가 있다', async () => {
    mockText(JSON.stringify({ summary: 's', skills: [], items: [] }))
    await runWorkProfile(input(), mockDeps)
    const [systemPrompt, userMessage] = vi.mocked(messagingAi.runText).mock.calls[0]
    expect(userMessage).toContain('WP-1')
    expect(userMessage).toContain('WP-2')
    expect(systemPrompt).toContain('결함 수정')
    expect(systemPrompt).toContain('숫자')
  })
})
