// WP-873 closedInfo — 끝난 이슈(DONE·CANCELED)의 완료 표기·늦음 판정.
// 날짜 판정은 브라우저 로컬 날짜 기준이고 vitest 는 TZ=Asia/Seoul 로 고정(vitest.config.ts)이라 결정적이다.
import { describe, expect, it } from 'vitest'

import { closedInfo } from './issueClosedInfo'

describe('closedInfo', () => {
  it('종료 상태가 아니면 null', () => {
    expect(closedInfo({ status: 'TODO', closedAt: '2026-10-23T05:05:00Z', dueDate: null })).toBeNull()
    expect(closedInfo({ status: 'IN_PROGRESS', closedAt: null, dueDate: null })).toBeNull()
  })
  it('종료 상태인데 closedAt 이 없으면(구버전 응답·데이터 이상) null', () => {
    expect(closedInfo({ status: 'DONE', closedAt: null, dueDate: '2026-10-21' })).toBeNull()
    expect(closedInfo({ status: 'DONE', dueDate: null })).toBeNull()
    expect(closedInfo({ status: 'CANCELED', closedAt: null, dueDate: null })).toBeNull()
  })
  it('마감보다 늦게 끝난 DONE → lateDays', () => {
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-21' })).toEqual({
      kind: 'done',
      closedAt: '2026-10-23T05:05:00Z',
      lateDays: 2,
    })
  })
  it('마감 당일 완료·마감 전 완료·마감 없음 → lateDays null', () => {
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-23' })?.lateDays).toBeNull()
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-25' })?.lateDays).toBeNull()
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-23T05:05:00Z', dueDate: null })?.lateDays).toBeNull()
  })
  it('취소는 늦어도 lateDays null', () => {
    expect(closedInfo({ status: 'CANCELED', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-01' })).toEqual({
      kind: 'canceled',
      closedAt: '2026-10-23T05:05:00Z',
      lateDays: null,
    })
  })
  it('자정 경계 — 15:30 UTC(KST 10/23 00:30)는 로컬 10/23 이라 마감 10/22 면 +1일', () => {
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-22T15:30:00Z', dueDate: '2026-10-22' })?.lateDays).toBe(1)
    // 14:30 UTC(KST 10/22 23:30)는 아직 10/22 — 마감 당일이라 늦지 않다.
    expect(closedInfo({ status: 'DONE', closedAt: '2026-10-22T14:30:00Z', dueDate: '2026-10-22' })?.lateDays).toBeNull()
  })
  it('월·연 경계를 넘어도 일수가 정확하다', () => {
    expect(closedInfo({ status: 'DONE', closedAt: '2026-11-02T03:00:00Z', dueDate: '2026-10-30' })?.lateDays).toBe(3)
    expect(closedInfo({ status: 'DONE', closedAt: '2027-01-02T03:00:00Z', dueDate: '2026-12-30' })?.lateDays).toBe(3)
  })
  it('closedAt 이 해석 불가면 null', () => {
    expect(closedInfo({ status: 'DONE', closedAt: 'garbage', dueDate: '2026-10-22' })).toBeNull()
  })
})
