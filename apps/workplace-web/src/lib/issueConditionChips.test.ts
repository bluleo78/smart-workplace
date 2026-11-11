// 이슈 탭 조건 칩(WP-1478) — 걸린 조건 → 칩 글, 칩 하나 지우기.
import { describe, expect, it } from 'vitest'

import { issueConditionChips, withoutCondition } from './issueConditionChips'
import { parseFilters } from './issueFilters'

const NOW = new Date('2026-11-11T12:00:00+09:00')
const f = (q: string) => parseFilters(new URLSearchParams(q))

describe('issueConditionChips', () => {
  it('조건이 없으면 칩도 없다', () => {
    expect(issueConditionChips(f(''), NOW)).toEqual([])
  })

  it('오래 멈춤 → 기다리는 중 → 마감 순서, 마감은 끝만·시작만·둘 다를 나눠 쓴다', () => {
    expect(issueConditionChips(f('waiting=true&stale=true&dueTo=2026-11-10'), NOW)).toEqual([
      { key: 'stale', label: '오래 멈춤' },
      { key: 'waiting', label: '기다리는 중' },
      { key: 'due', label: '마감 ~ 11월 10일' },
    ])
    expect(issueConditionChips(f('dueFrom=2026-11-11'), NOW)).toEqual([{ key: 'due', label: '마감 11월 11일 ~' }])
    expect(issueConditionChips(f('dueFrom=2026-11-11&dueTo=2026-11-17'), NOW)).toEqual([{ key: 'due', label: '마감 11월 11일 ~ 11월 17일' }])
    // 올해가 아니면 연도까지.
    expect(issueConditionChips(f('dueTo=2027-01-05'), NOW)[0].label).toBe('마감 ~ 2027년 1월 5일')
  })
})

describe('withoutCondition', () => {
  it('칩 하나만 지우고 나머지는 그대로 — 마감은 시작·끝을 함께 지운다', () => {
    const all = f('stale=true&waiting=true&dueFrom=2026-11-01&dueTo=2026-11-10&status=TODO')
    const noStale = withoutCondition(all, 'stale')
    expect('stale' in noStale).toBe(false)
    expect(noStale.waiting).toBe(true)
    expect(noStale.statuses).toEqual(['TODO'])
    const noDue = withoutCondition(all, 'due')
    expect(noDue.dueFrom).toBeNull()
    expect(noDue.dueTo).toBeNull()
    expect(noDue.stale).toBe(true)
    expect(withoutCondition(f('waiting=true'), 'waiting')).toEqual(f(''))
  })
})
