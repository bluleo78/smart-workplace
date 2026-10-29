// AI별 보기(WP-1201) 순수 로직 — 대표 상태·그 상태로 있은 시각·경과 표기·정렬·건수.
import { describe, expect, it } from 'vitest'

import { createAiAgentStatus as ag, createAiAgentWork as w } from '../../e2e/factories/aiAgent.factory'
import { elapsedLabel, parseRosterState, rosterCounts, rosterRows, sinceLine, toRosterRow } from './aiRoster'

const NOW = Date.parse('2026-10-29T05:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60000).toISOString()
const state = (a: Parameters<typeof toRosterRow>[0]) => toRosterRow(a).state

describe('toRosterRow — 대표 상태', () => {
  it('작업이 없으면 쉬는 중', () => expect(state(ag(1, 'A'))).toBe('idle'))

  it('검토 필요만 있으면 쉬는 중(AI 는 끝냈다) — 검토 대기 수는 따로', () => {
    const row = toRosterRow(ag(1, 'A', { works: [w({ state: 'REVIEW' })] }))
    expect(row.state).toBe('idle')
    expect(row.reviews).toBe(1)
    expect(row.active).toEqual([])
  })

  it('급한 순 — 답변 필요 > 막힘(인증 필요 포함) > 작업 중 > 기다림', () => {
    expect(state(ag(1, 'A', { works: [w({ state: 'BLOCKED' }), w({ state: 'INPUT_REQUIRED' })] }))).toBe('needs')
    expect(state(ag(1, 'A', { works: [w({ state: 'WORKING' }), w({ state: 'AUTH_REQUIRED' })] }))).toBe('blocked')
    expect(state(ag(1, 'A', { works: [w({ state: 'SCHEDULED' }), w({ state: 'WORKING' })] }))).toBe('working')
    expect(state(ag(1, 'A', { works: [w({ state: 'PAUSED' }), w({ state: 'WAITING' })] }))).toBe('waiting')
    expect(state(ag(1, 'A', { works: [w({ state: 'SUBMITTED' })] }))).toBe('working')
  })

  it('외부 AI 연결이 끊기면 연결 끊김 — 답변 필요는 가리지 않는다, 서버 안 AI(null)는 판단하지 않는다', () => {
    expect(state(ag(1, 'A', { connected: false, works: [w({ state: 'BLOCKED' })] }))).toBe('offline')
    expect(state(ag(1, 'A', { connected: false, works: [w({ state: 'INPUT_REQUIRED' })] }))).toBe('needs')
    expect(state(ag(1, 'A', { connected: null }))).toBe('idle')
  })
})

describe('toRosterRow — 대표 작업·그 상태로 있은 시각·마지막 보고', () => {
  it('같은 묶음이면 그 상태로 오래 있은 작업이 대표', () => {
    const row = toRosterRow(
      ag(1, 'A', { works: [w({ number: 1, stateChangedAt: ago(10) }), w({ number: 2, stateChangedAt: ago(90) })] }),
    )
    expect(row.lead?.number).toBe(2)
    expect(row.since).toBe(ago(90))
  })

  it('쉬는 중은 마지막 작업 종료 시각, 끊김은 끊긴 시각', () => {
    expect(toRosterRow(ag(1, 'A', { lastEndedAt: ago(70) })).since).toBe(ago(70))
    expect(toRosterRow(ag(1, 'A', { connected: false, disconnectedAt: ago(47), works: [w()] })).since).toBe(ago(47))
  })

  it('마지막 보고는 보고가 가장 최근인 행(검토 필요 포함)', () => {
    const row = toRosterRow(ag(1, 'A', { works: [w({ number: 1, state: 'REVIEW', updatedAt: ago(3) }), w({ number: 2, updatedAt: ago(20) })] }))
    expect(row.latest?.number).toBe(1)
    expect(toRosterRow(ag(2, 'B')).latest).toBeNull()
  })

  it('시각은 문자열이 아니라 시간으로 비교한다 — 소수 초 자릿수가 달라도', () => {
    const row = toRosterRow(
      ag(1, 'A', {
        works: [
          w({ number: 1, updatedAt: '2026-10-29T01:02:03.120Z', stateChangedAt: '2026-10-29T01:02:03.120Z' }),
          w({ number: 2, updatedAt: '2026-10-29T01:02:03Z', stateChangedAt: '2026-10-29T01:02:03Z' }),
        ],
      }),
    )
    expect(row.latest?.number).toBe(1)
    expect(row.lead?.number).toBe(2)
  })
})

describe('elapsedLabel·sinceLine — 경과 표기', () => {
  it('방금·분·시간 분·시간·일', () => {
    expect(elapsedLabel(ago(0), NOW)).toBe('방금')
    expect(elapsedLabel(ago(38), NOW)).toBe('38분')
    expect(elapsedLabel(ago(124), NOW)).toBe('2시간 4분')
    expect(elapsedLabel(ago(180), NOW)).toBe('3시간')
    expect(elapsedLabel(ago(60 * 50), NOW)).toBe('2일')
  })

  it('「n째」, 끊김은 「n째 신호 없음」·「방금 끊김」, 시각 모르면 null', () => {
    const line = (a: Parameters<typeof toRosterRow>[0]) => sinceLine(toRosterRow(a), NOW)
    expect(line(ag(1, 'A', { works: [w({ state: 'INPUT_REQUIRED', stateChangedAt: ago(38) })] }))).toBe('38분째')
    expect(line(ag(1, 'A', { connected: false, disconnectedAt: ago(47) }))).toBe('47분째 신호 없음')
    expect(line(ag(1, 'A', { connected: false, disconnectedAt: ago(0) }))).toBe('방금 끊김')
    expect(line(ag(1, 'A', { connected: false }))).toBeNull()
    expect(line(ag(1, 'A'))).toBeNull()
  })
})

describe('rosterRows·rosterCounts', () => {
  const needs = ag(1, '다', { works: [w({ state: 'INPUT_REQUIRED', stateChangedAt: ago(5) })] })
  const off = ag(2, '나', { connected: false, disconnectedAt: ago(30) })
  const blocked = ag(3, '가', { works: [w({ state: 'BLOCKED', stateChangedAt: ago(10) })] })
  const workNew = ag(4, '라', { works: [w({ stateChangedAt: ago(5) })] })
  const workOld = ag(5, '마', { works: [w({ stateChangedAt: ago(50) })] })
  const idle = ag(6, '바')
  const rows = rosterRows([idle, workNew, blocked, off, workOld, needs])

  it('급한 상태 먼저, 같은 급함이면 그 상태로 오래 있은 AI 먼저, 시각 모름은 뒤', () => {
    expect(rows.map((r) => r.agent.agent.id)).toEqual([1, 2, 3, 5, 4, 6])
  })

  it('상태별 AI 수', () => {
    expect(rosterCounts(rows)).toEqual({ all: 6, needs: 1, blocked: 1, offline: 1, working: 2, waiting: 0, idle: 1 })
  })
})

describe('parseRosterState', () => {
  it('URL 값 — 아는 상태만', () => {
    expect(parseRosterState('needs')).toBe('needs')
    expect(parseRosterState('nope')).toBeNull()
    expect(parseRosterState(null)).toBeNull()
  })
})
