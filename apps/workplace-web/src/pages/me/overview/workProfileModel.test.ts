// 업무 프로파일 카드 상태줄(WP-1485) — 「이번 달 37건 분석 · 오늘 08:00」. 날짜 경계는 서울 시각 기준이라 순수 함수로 고정한다.
import { describe, expect, it } from 'vitest'

import { createWorkProfile } from '../../../../e2e/factories/workProfile.factory'
import { periodLabel, statusLine, WORK_PROFILE_CAP } from './workProfileModel'

const NOW = new Date('2026-11-11T03:00:00Z') // 서울 11월 11일 12:00

describe('workProfileModel', () => {
  it('오늘 분석이면 「이번 달 37건 분석 · 오늘 08:00」', () => {
    expect(statusLine(createWorkProfile({ analyzedAt: '2026-11-10T23:00:00Z' }), NOW)).toBe('이번 달 37건 분석 · 오늘 08:00')
  })

  it('다른 날이면 「11월 10일 08:00」', () => {
    expect(statusLine(createWorkProfile({ analyzedAt: '2026-11-09T23:00:00Z' }), NOW)).toBe('이번 달 37건 분석 · 11월 10일 08:00')
  })

  it('상한에 걸리면 「이번 주 140건 중 최근 100건 분석 · …」', () => {
    const p = createWorkProfile({ period: 'WEEK', totalCount: 140, analyzedCount: WORK_PROFILE_CAP })
    expect(statusLine(p, NOW)).toBe('이번 주 140건 중 최근 100건 분석 · 오늘 08:00')
  })

  it('상한보다 적게 분석했는데 total 이 더 크면(분석 뒤 지워진 이슈) 상한 문구를 쓰지 않는다', () => {
    const p = createWorkProfile({ totalCount: 5, analyzedCount: 4 })
    expect(statusLine(p, NOW)).toBe('이번 달 5건 분석 · 오늘 08:00')
  })

  it('PENDING·NONE 이면 null', () => {
    expect(statusLine(createWorkProfile({ status: 'PENDING' }), NOW)).toBeNull()
    expect(statusLine(createWorkProfile({ status: 'NONE' }), NOW)).toBeNull()
    // FAILED 는 분석 시각이 있으면 이전 결과의 상태줄을 그대로 보인다. 시각이 없으면 null.
    expect(statusLine(createWorkProfile({ status: 'FAILED' }), NOW)).toBe('이번 달 37건 분석 · 오늘 08:00')
    expect(statusLine(createWorkProfile({ status: 'FAILED', analyzedAt: null }), NOW)).toBeNull()
  })

  it('날짜 경계는 서울 시각 기준 — UTC 15:30 은 다음날 00:30', () => {
    // UTC 로는 11월 10일이지만 서울로는 11월 11일 00:30 → 오늘.
    expect(statusLine(createWorkProfile({ analyzedAt: '2026-11-10T15:30:00Z' }), NOW)).toBe('이번 달 37건 분석 · 오늘 00:30')
    // 서울 11월 10일 23:30 → 어제 날짜로 적는다.
    expect(statusLine(createWorkProfile({ analyzedAt: '2026-11-10T14:30:00Z' }), NOW)).toBe('이번 달 37건 분석 · 11월 10일 23:30')
  })

  it('기간 라벨은 기간 고르기 문구와 같다', () => {
    expect(periodLabel('WEEK')).toBe('이번 주')
    expect(periodLabel('MONTH')).toBe('이번 달')
    expect(periodLabel('QUARTER')).toBe('최근 3개월')
  })
})
