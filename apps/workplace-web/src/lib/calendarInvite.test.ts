// 메일 일정 초대 카드 표시 문구 단위 테스트(WP-986). vitest 는 TZ=Asia/Seoul 로 고정돼 로컬 시각 = KST.
import { describe, expect, it } from 'vitest'

import { inviteActionMode, inviteOrganizerText, inviteResultText, inviteTimeText } from './calendarInvite'

// 기준 시각 — 2026-10-28(수) KST
const NOW = new Date('2026-10-28T03:00:00Z')

describe('inviteTimeText', () => {
  it('같은 날 시간 일정은 날짜·요일과 시각 범위(같은 오전/오후면 끝 접두어 생략)', () => {
    expect(inviteTimeText({ start: '2026-11-03T14:00:00+09:00', end: '2026-11-03T15:00:00+09:00', allDay: false }, NOW)).toBe(
      '11월 3일 (화) 오후 2:00 – 3:00',
    )
  })

  it('UTC 오프셋으로 온 시각도 로컬(KST)로 보인다', () => {
    expect(inviteTimeText({ start: '2026-11-03T01:30:00Z', end: '2026-11-03T03:00:00Z', allDay: false }, NOW)).toBe(
      '11월 3일 (화) 오전 10:30 – 오후 12:00',
    )
  })

  it('끝이 없는 시간 일정은 시작 시각만', () => {
    expect(inviteTimeText({ start: '2026-11-03T14:00:00+09:00', end: null, allDay: false }, NOW)).toBe('11월 3일 (화) 오후 2:00')
  })

  it('종일은 날짜만 — 하루, 여러 날(끝은 배타적), 끝 없음', () => {
    expect(inviteTimeText({ start: '2026-11-03T00:00:00Z', end: '2026-11-04T00:00:00Z', allDay: true }, NOW)).toBe('11월 3일 (화)')
    expect(inviteTimeText({ start: '2026-11-03T00:00:00+09:00', end: '2026-11-05T00:00:00+09:00', allDay: true }, NOW)).toBe(
      '11월 3일 (화) – 11월 4일 (수)',
    )
    expect(inviteTimeText({ start: '2026-11-03T00:00:00Z', end: null, allDay: true }, NOW)).toBe('11월 3일 (화)')
  })

  it('올해가 아니면 연도를 붙인다', () => {
    expect(inviteTimeText({ start: '2027-01-05T10:00:00+09:00', end: '2027-01-05T11:00:00+09:00', allDay: false }, NOW)).toBe(
      '2027년 1월 5일 (화) 오전 10:00 – 11:00',
    )
  })
})

describe('inviteOrganizerText', () => {
  it('이름이 있으면 「이름 <메일>」, 없으면 메일만, 주최자가 없으면 null', () => {
    expect(inviteOrganizerText({ name: 'Ethan Lee', email: 'ethan@partner.com' })).toBe('Ethan Lee <ethan@partner.com>')
    expect(inviteOrganizerText({ name: null, email: 'ethan@partner.com' })).toBe('ethan@partner.com')
    expect(inviteOrganizerText(null)).toBeNull()
  })
})

describe('inviteResultText', () => {
  it('응답마다 결과 문구, 응답 전이면 null', () => {
    expect(inviteResultText('ACCEPTED')).toBe('수락했습니다 — 주최자에게 응답을 보냈습니다')
    expect(inviteResultText('TENTATIVE')).toBe('미정으로 응답했습니다 — 주최자에게 응답을 보냈습니다')
    expect(inviteResultText('DECLINED')).toBe('거절했습니다 — 주최자에게 응답을 보냈습니다')
    expect(inviteResultText('NEEDS_ACTION')).toBeNull()
  })
})

describe('inviteActionMode', () => {
  it('응답 가능 → respond, 옛 초대 → outdated, 그 밖·취소 → none', () => {
    expect(inviteActionMode({ method: 'REQUEST', canRespond: true, outdated: false })).toBe('respond')
    expect(inviteActionMode({ method: 'REQUEST', canRespond: false, outdated: true })).toBe('outdated')
    expect(inviteActionMode({ method: 'REQUEST', canRespond: false, outdated: false })).toBe('none')
    expect(inviteActionMode({ method: 'CANCEL', canRespond: false, outdated: true })).toBe('none')
  })
})
