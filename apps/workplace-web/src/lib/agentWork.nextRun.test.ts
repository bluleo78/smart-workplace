import { describe, expect, it } from 'vitest'

import { nextRunLabel } from './agentWork'

// 기준 시각 — 2026-10-18(일) 14:30 KST(= 05:30Z).
describe('nextRunLabel', () => {
  const now = new Date('2026-10-18T05:30:00Z')
  it('없으면 none — 다른 작업 뒤 이어서', () => {
    expect(nextRunLabel(null, now)).toEqual({ kind: 'none', text: '다른 작업 뒤 이어서', absolute: null })
    expect(nextRunLabel(undefined, now)).toEqual({ kind: 'none', text: '다른 작업 뒤 이어서', absolute: null })
  })
  it('이미 지났거나 지금이면 due — 곧 시작', () => {
    expect(nextRunLabel('2026-10-18T04:00:00Z', now)).toMatchObject({ kind: 'due', text: '곧 시작' })
    expect(nextRunLabel('2026-10-18T05:30:00Z', now)).toMatchObject({ kind: 'due', text: '곧 시작' })
  })
  it('같은 KST 날이면 오늘 HH:mm 이후', () => {
    expect(nextRunLabel('2026-10-18T07:30:00Z', now)).toMatchObject({ kind: 'at', text: '오늘 16:30 이후' })
  })
  it('KST 자정 경계 — UTC 로는 같은 날이어도 KST 다음 날이면 내일', () => {
    expect(nextRunLabel('2026-10-18T15:00:00Z', now).text).toBe('내일 00:00 이후')
    expect(nextRunLabel('2026-10-18T14:59:00Z', now).text).toBe('오늘 23:59 이후')
    expect(nextRunLabel('2026-10-19T00:00:00Z', now).text).toBe('내일 09:00 이후')
  })
  it('기준 시각이 KST 자정 직전이어도 내일 판정은 KST 날짜로', () => {
    const lateNow = new Date('2026-10-18T14:50:00Z') // 10/18 23:50 KST
    expect(nextRunLabel('2026-10-18T15:30:00Z', lateNow).text).toBe('내일 00:30 이후')
  })
  it('모레 이후는 월/일(요일) — 요일은 KST 날짜 기준, 한 자리 월·일은 zero-pad 하지 않는다', () => {
    expect(nextRunLabel('2026-10-21T00:00:00Z', now).text).toBe('10/21(수) 09:00 이후')
    expect(nextRunLabel('2026-11-03T00:05:00Z', now).text).toBe('11/3(화) 09:05 이후')
    // 10/20 22:00Z = 10/21 07:00 KST → 수요일.
    expect(nextRunLabel('2026-10-20T22:00:00Z', now).text).toBe('10/21(수) 07:00 이후')
  })
  it('다른 해(KST)면 연도를 붙인다 — 연말 경계 포함', () => {
    expect(nextRunLabel('2027-01-05T00:00:00Z', now).text).toBe('2027/1/5(화) 09:00 이후')
    // 12/31 15:30Z = 2027-01-01 00:30 KST → 다음 해(UTC 로는 아직 올해).
    expect(nextRunLabel('2026-12-31T15:30:00Z', now).text).toBe('2027/1/1(금) 00:30 이후')
    // 12/31 14:30Z = 12/31 23:30 KST → 올해.
    expect(nextRunLabel('2026-12-31T14:30:00Z', now).text).toBe('12/31(목) 23:30 이후')
    // 기준이 연말이면 다음 날(1/1)은 내일.
    expect(nextRunLabel('2026-12-31T15:30:00Z', new Date('2026-12-31T05:00:00Z')).text).toBe('내일 00:30 이후')
  })
  it('해석할 수 없는 값은 없는 것과 같다', () => {
    expect(nextRunLabel('not-a-date', now).kind).toBe('none')
  })
  it('절대시각은 KST YYYY-MM-DD HH:mm', () => {
    expect(nextRunLabel('2026-10-19T00:00:00Z', now).absolute).toBe('2026-10-19 09:00')
    expect(nextRunLabel('2026-12-31T15:05:00Z', now).absolute).toBe('2027-01-01 00:05')
    expect(nextRunLabel('2026-10-18T04:00:00Z', now).absolute).toBe('2026-10-18 13:00')
    expect(nextRunLabel('x', now).absolute).toBeNull()
  })
})
