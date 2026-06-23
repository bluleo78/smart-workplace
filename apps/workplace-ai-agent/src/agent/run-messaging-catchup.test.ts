import { describe, it, expect } from 'vitest'
import { parseCatchupJson } from './run-messaging-catchup.js'

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
