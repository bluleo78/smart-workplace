// 사이클 순수 규칙 단위 테스트(WP-412) — 모바일 행 2줄째 문구·폼 기간 검증·상태 라벨.
// 모바일 행 문구 — 이전 E2E mobile/cycles 의 시작만/끝만/날짜 없음/이슈 0건 문구 단언을 옮겼다.
// 행에 실제로 그려지는지·말줄임·넘침 같은 모바일 레이아웃은 E2E 가 계속 지킨다.
import { describe, expect, it } from 'vitest'

import { CYCLE_STATUS_LABEL, CYCLE_STATUSES } from '@/types/cycle'

import { canPickCycle, cycleMetaText, isCycleDateRangeInvalid } from './cycleMeta'

const progress = { cycleId: 1, total: 20, done: 9, byStatus: { DONE: 9, TODO: 11 } }

describe('cycleMetaText', () => {
  it('기간 + 완료 비율(반올림)', () => {
    expect(cycleMetaText({ startDate: '2026-09-29', endDate: '2026-10-10' }, progress)).toBe('9월 29일 ~ 10월 10일 · 45%')
  })
  it('시작만·끝만은 열린 범위, 날짜 없으면 「—」, 이슈 0건이면 「이슈 없음」', () => {
    expect(cycleMetaText({ startDate: '2026-10-13', endDate: null }, undefined)).toBe('10월 13일 ~ · 이슈 없음')
    expect(cycleMetaText({ startDate: null, endDate: '2026-10-31' }, undefined)).toBe('~ 10월 31일 · 이슈 없음')
    expect(cycleMetaText({ startDate: null, endDate: null }, { ...progress, total: 0, done: 0 })).toBe('— · 이슈 없음')
  })
})

describe('isCycleDateRangeInvalid (#804)', () => {
  it('종료일이 시작일보다 빠르면 오류', () => {
    expect(isCycleDateRangeInvalid('2026-09-10', '2026-09-01')).toBe(true)
  })

  it('같은 날·이후·한쪽이라도 비면 정상', () => {
    expect(isCycleDateRangeInvalid('2026-09-10', '2026-09-10')).toBe(false)
    expect(isCycleDateRangeInvalid('2026-09-10', '2026-09-15')).toBe(false)
    expect(isCycleDateRangeInvalid('', '2026-09-01')).toBe(false)
    expect(isCycleDateRangeInvalid('2026-09-10', '')).toBe(false)
  })
})

describe('CYCLE_STATUS_LABEL', () => {
  it('모든 상태 enum 을 한국어로 표시한다(영문 enum 노출 금지)', () => {
    expect(CYCLE_STATUSES.map((s) => CYCLE_STATUS_LABEL[s])).toEqual(['예정', '진행 중', '완료됨'])
  })
})

describe('canPickCycle (WP-659)', () => {
  it('완료 사이클은 붙어 있지 않으면 고를 수 없다', () => {
    expect(canPickCycle({ id: 2, status: 'COMPLETED' }, new Set([1]))).toBe(false)
  })
  it('이미 붙은 완료 사이클은 뗄 수 있게 고를 수 있다', () => {
    expect(canPickCycle({ id: 2, status: 'COMPLETED' }, new Set([2]))).toBe(true)
  })
  it('완료가 아닌 사이클은 늘 고를 수 있다', () => {
    expect(canPickCycle({ id: 3, status: 'ACTIVE' }, new Set())).toBe(true)
    expect(canPickCycle({ id: 4, status: 'PLANNED' }, new Set())).toBe(true)
  })
})
