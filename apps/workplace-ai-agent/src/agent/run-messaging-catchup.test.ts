import { describe, it, expect, vi } from 'vitest'

vi.mock('./run-messaging-ai.js', () => ({ runText: vi.fn() }))

import { runText } from './run-messaging-ai.js'
import { parseCatchupJson, runMessagingCatchup } from './run-messaging-catchup.js'

describe('parseCatchupJson', () => {
  it('코드펜스+중첩 배열 JSON 을 파싱한다', () => {
    const text =
      '```json\n{"decisions":[{"text":"출시일 6/30 확정","sourceMessageIds":[10,11]}],' +
      '"discussion":[{"text":"QA 이슈 논의","sourceMessageIds":[12]}]}\n```'
    const r = parseCatchupJson(text)
    expect(r.decisions).toHaveLength(1)
    expect(r.decisions[0].sourceMessageIds).toEqual([10, 11])
    expect(r.discussion[0].text).toContain('QA')
  })

  it('JSON 이 없으면 빈 결과', () => {
    expect(parseCatchupJson('요약 실패')).toEqual({ decisions: [], discussion: [] })
  })

  it('스키마 불일치(sourceMessageIds 누락)면 빈 결과', () => {
    expect(parseCatchupJson('{"decisions":[{"text":"x"}],"discussion":[]}')).toEqual({
      decisions: [],
      discussion: [],
    })
  })
})

describe('runMessagingCatchup — 읽기 전용 메모리 (WP-381)', () => {
  it('요청문 맨 앞에 메모리 블록을 붙인다', async () => {
    vi.mocked(runText).mockResolvedValue('{"decisions":[],"discussion":[]}')
    await runMessagingCatchup(
      {
        messages: [{ id: 1, authorName: '양동희', body: '배포 일정' }],
        assistantAgentId: 7,
        model: 'm',
        maxTurns: 1,
        timeoutMs: 1000,
        memories: [{ id: 5, kind: 'PREFERENCE', content: '요약은 세 줄로', scope: 'MESSAGING' }],
      },
      { client: {} as never },
    )
    expect(vi.mocked(runText).mock.calls[0][1]).toContain('- [#5 선호·메신저] 요약은 세 줄로\n\n안 읽은 메시지:\n- [1] 양동희: 배포 일정')
  })
})
