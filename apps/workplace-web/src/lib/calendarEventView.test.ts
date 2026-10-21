// 일정 상세 보기 표시 문구 단위 테스트(WP-708). vitest 는 TZ=Asia/Seoul 로 고정돼 로컬 시각 = KST.
import { describe, expect, it } from 'vitest'

import type { Attendee } from '../types/calendar'
import {
  eventTimeLines,
  joinButtonLabel,
  recurrenceLabel,
  reminderLabel,
  rsvpSummary,
  sortAttendeesForView,
  splitMeetingBoilerplate,
  splitTextLinks,
} from './calendarEventView'

// 기준 시각 — 2026-10-21(수) KST
const NOW = new Date('2026-10-21T03:00:00Z')

const att = (role: Attendee['role'], userId: number | null, rsvpStatus: Attendee['rsvpStatus'] = 'ACCEPTED'): Attendee => ({
  userId,
  username: null,
  name: `u${userId}`,
  kind: 'HUMAN',
  role,
  rsvpStatus,
  invitedByUserId: null,
  externalEmail: null,
})

describe('eventTimeLines', () => {
  it('같은 날 같은 오후 — 끝 시각의 오전/오후는 생략한다', () => {
    // 15:00–16:30 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T06:00:00Z', endsAt: '2026-10-21T07:30:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오후 3:00 – 4:30' })
  })

  it('오전에서 오후로 넘어가면 양쪽에 오전/오후를 쓴다, 정오는 오후 12시', () => {
    // 11:00–12:30 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T02:00:00Z', endsAt: '2026-10-21T03:30:00Z', allDay: false }, NOW).time,
    ).toBe('오전 11:00 – 오후 12:30')
  })

  it('자정을 넘기는 시간 일정은 날짜 줄 하나에 양쪽 날짜·시각을 쓴다', () => {
    // 10/21 23:00 – 10/22 01:00 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T14:00:00Z', endsAt: '2026-10-21T16:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수) 오후 11:00 – 10월 22일 (목) 오전 1:00', time: null })
  })

  it('자정에 끝나는 시간 일정은 같은 날로 본다', () => {
    // 22:00–24:00 KST
    expect(
      eventTimeLines({ startsAt: '2026-10-21T13:00:00Z', endsAt: '2026-10-21T15:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오후 10:00 – 오전 12:00' })
  })

  it('길이 0 인 자정 일정은 날짜를 두 번 쓰지 않는다', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-20T15:00:00Z', allDay: false }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '오전 12:00 – 12:00' })
  })

  it('하루 종일 — 배타적 종료(다음 날 0시)는 같은 날로 본다', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-21T00:00:00Z', endsAt: '2026-10-22T00:00:00Z', allDay: true }, NOW),
    ).toEqual({ date: '10월 21일 (수)', time: '종일' })
  })

  it('여러 날 종일 — 마지막 날까지 범위로', () => {
    expect(
      eventTimeLines({ startsAt: '2026-10-21T00:00:00Z', endsAt: '2026-10-24T00:00:00Z', allDay: true }, NOW).date,
    ).toBe('10월 21일 (수) – 10월 23일 (금)')
  })

  it('올해가 아니면 연도를 붙인다', () => {
    expect(
      eventTimeLines({ startsAt: '2027-01-04T01:00:00Z', endsAt: '2027-01-04T02:00:00Z', allDay: false }, NOW).date,
    ).toBe('2027년 1월 4일 (월)')
  })
})

describe('recurrenceLabel', () => {
  // 시작: 2026-10-23(금) 10:00 KST
  const ev = (recurrenceRule: string | null, over: { startsAt?: string; allDay?: boolean } = {}) => ({
    recurrenceRule,
    startsAt: over.startsAt ?? '2026-10-23T01:00:00Z',
    allDay: over.allDay ?? false,
  })

  it('반복 없음이면 null', () => {
    expect(recurrenceLabel(ev(null), NOW)).toBeNull()
    expect(recurrenceLabel(ev('  '), NOW)).toBeNull()
  })

  it('매일·매주(요일)·매월(날짜)', () => {
    expect(recurrenceLabel(ev('FREQ=DAILY'), NOW)).toBe('매일')
    expect(recurrenceLabel(ev('FREQ=WEEKLY'), NOW)).toBe('매주 금요일')
    expect(recurrenceLabel(ev('FREQ=MONTHLY'), NOW)).toBe('매월 23일')
  })

  it('간격이 2 이상이면 「N주마다」', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY;INTERVAL=2'), NOW)).toBe('2주마다 금요일')
    expect(recurrenceLabel(ev('FREQ=DAILY;INTERVAL=3'), NOW)).toBe('3일마다')
    expect(recurrenceLabel(ev('FREQ=MONTHLY;INTERVAL=2'), NOW)).toBe('2개월마다 23일')
  })

  it('종료 — 날짜까지(다른 해면 연도) / 횟수', () => {
    // UNTIL 은 KST 그날 끝(11/18 23:59:59 KST)
    expect(recurrenceLabel(ev('FREQ=WEEKLY;UNTIL=20261118T145959Z'), NOW)).toBe('매주 금요일 · 11월 18일까지')
    expect(recurrenceLabel(ev('FREQ=WEEKLY;UNTIL=20270115T145959Z'), NOW)).toBe('매주 금요일 · 2027년 1월 15일까지')
    expect(recurrenceLabel(ev('FREQ=WEEKLY;COUNT=10'), NOW)).toBe('매주 금요일 · 10회')
  })

  it('시작일만으로 풀 수 없는 규칙(BYDAY·YEARLY 등)은 틀린 요일 대신 「반복」', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY;BYDAY=MO,WE,FR'), NOW)).toBe('반복')
    expect(recurrenceLabel(ev('FREQ=MONTHLY;BYDAY=2TU'), NOW)).toBe('반복')
    expect(recurrenceLabel(ev('FREQ=YEARLY'), NOW)).toBe('반복')
  })

  it('종일 반복은 종일 날짜 기준 요일(UTC 자정 저장이어도)', () => {
    expect(recurrenceLabel(ev('FREQ=WEEKLY', { startsAt: '2026-10-23T00:00:00Z', allDay: true }), NOW)).toBe('매주 금요일')
  })
})

describe('reminderLabel', () => {
  it('없음이면 null, 분·시간·일 단위로', () => {
    expect(reminderLabel(null)).toBeNull()
    expect(reminderLabel(0)).toBe('시작할 때')
    expect(reminderLabel(10)).toBe('10분 전')
    expect(reminderLabel(60)).toBe('1시간 전')
    expect(reminderLabel(90)).toBe('90분 전')
    expect(reminderLabel(1440)).toBe('1일 전')
  })
})

describe('rsvpSummary', () => {
  it('수락→미정→거절→대기 순서, 0명은 뺀다', () => {
    expect(
      rsvpSummary([
        att('ATTENDEE', 1, 'NEEDS_ACTION'),
        att('ORGANIZER', 2, 'ACCEPTED'),
        att('ATTENDEE', 3, 'TENTATIVE'),
        att('ATTENDEE', 4, 'ACCEPTED'),
      ]),
    ).toBe('수락 2, 미정 1, 대기 1')
    expect(rsvpSummary([])).toBe('')
  })
})

describe('sortAttendeesForView', () => {
  it('주최자 → 나 → 나머지(원래 순서)', () => {
    const list = [att('ATTENDEE', 1), att('ATTENDEE', 2), att('ORGANIZER', 3), att('ATTENDEE', 4)]
    expect(sortAttendeesForView(list, 4).map((a) => a.userId)).toEqual([3, 4, 1, 2])
  })

  it('내가 누군지 모르면 주최자만 앞으로', () => {
    const list = [att('ATTENDEE', 1), att('ORGANIZER', null)]
    expect(sortAttendeesForView(list, undefined).map((a) => a.userId)).toEqual([null, 1])
  })
})

describe('splitTextLinks', () => {
  it('URL 만 링크 조각으로, 줄바꿈은 텍스트에 남긴다', () => {
    expect(splitTextLinks('Teams 모임\n참가: https://teams.microsoft.com/meet/123?p=a\n암호: x')).toEqual([
      { type: 'text', text: 'Teams 모임\n참가: ' },
      { type: 'link', text: 'https://teams.microsoft.com/meet/123?p=a', href: 'https://teams.microsoft.com/meet/123?p=a' },
      { type: 'text', text: '\n암호: x' },
    ])
  })

  it('문장 끝 구두점·닫는 괄호는 링크에서 뺀다', () => {
    expect(splitTextLinks('회의록(https://a.b/c).')).toEqual([
      { type: 'text', text: '회의록(' },
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c' },
      { type: 'text', text: ').' },
    ])
  })

  it('URL 에 붙여 쓴 한글 조사는 링크에서 빼고, 짝이 맞는 괄호는 URL 에 남긴다', () => {
    expect(splitTextLinks('https://example.com/doc에서 확인')).toEqual([
      { type: 'link', text: 'https://example.com/doc', href: 'https://example.com/doc' },
      { type: 'text', text: '에서 확인' },
    ])
    expect(splitTextLinks('참고 https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      { type: 'text', text: '참고 ' },
      { type: 'link', text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
      { type: 'text', text: '.' },
    ])
  })

  it('꺾쇠로 감싼 URL(M365 텍스트 본문의 `글자<URL>`)은 꺾쇠를 화면에서 빼고 링크로 만든다', () => {
    expect(splitTextLinks('Teams 모임 참가 <https://teams.microsoft.com/l/meetup-join/abc?x=1>\n다음 줄')).toEqual([
      { type: 'text', text: 'Teams 모임 참가 ' },
      {
        type: 'link',
        text: 'https://teams.microsoft.com/l/meetup-join/abc?x=1',
        href: 'https://teams.microsoft.com/l/meetup-join/abc?x=1',
      },
      { type: 'text', text: '\n다음 줄' },
    ])
    // 맨 앞의 꺾쇠 URL, 끝 구두점은 꺾쇠 안이면 URL 의 일부로 둔다
    expect(splitTextLinks('<https://a.b/c.>')).toEqual([{ type: 'link', text: 'https://a.b/c.', href: 'https://a.b/c.' }])
  })

  it('짝이 맞지 않는 꺾쇠는 그대로 남긴다', () => {
    expect(splitTextLinks('a <https://a.b/c 그리고 d>')).toEqual([
      { type: 'text', text: 'a <' },
      { type: 'link', text: 'https://a.b/c', href: 'https://a.b/c' },
      { type: 'text', text: ' 그리고 d>' },
    ])
  })

  it('URL 이 없으면 텍스트 하나, javascript: 같은 다른 스킴은 링크로 만들지 않는다', () => {
    expect(splitTextLinks('javascript:alert(1) 그냥 글')).toEqual([{ type: 'text', text: 'javascript:alert(1) 그냥 글' }])
  })
})

describe('joinButtonLabel', () => {
  it('공급자별 참가 문구를 돌려준다', () => {
    expect(joinButtonLabel('TEAMS')).toBe('Teams 회의 참가')
    expect(joinButtonLabel('MEET')).toBe('Google Meet 참가')
    expect(joinButtonLabel('ZOOM')).toBe('Zoom 회의 참가')
    expect(joinButtonLabel('OTHER')).toBe('온라인 회의 참가')
  })
})

describe('splitMeetingBoilerplate', () => {
  const SEP = '_'.repeat(80)
  // Graph 가 텍스트로 돌려준 실제 Teams 초대 본문(익명화) — 줄바꿈은 \r\n
  const TEAMS_BLOCK = [
    SEP,
    'Microsoft Teams 모임',
    '참가: https://teams.microsoft.com/meet/123456789012345?p=AbCdEfGh',
    '모임 ID: 123 456 789 012 345',
    '암호: Ab12Cd34',
    SEP,
    '도움이 필요하신가요?<https://aka.ms/JoinTeamsMeeting?omkt=ko-KR> | 시스템 참조<https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0>',
    '이끌이: 모임 옵션<https://teams.microsoft.com/meetingOptions/?organizerId=x>',
    SEP,
  ].join('\r\n')
  const FIXTURE = `@Lucy 아젠다 준비해 주세요.\r\n\r\n${TEAMS_BLOCK}`

  it('실제 초대 본문 — 안내문 덩어리(첫 구분선 ~ 마지막 구분선)를 떼고 본문만 남긴다', () => {
    const r = splitMeetingBoilerplate(FIXTURE)
    expect(r.body).toBe('@Lucy 아젠다 준비해 주세요.')
    expect(r.boilerplate).not.toBeNull()
    expect(r.boilerplate!.startsWith('_'.repeat(80))).toBe(true)
    expect(r.boilerplate!.endsWith('_'.repeat(80))).toBe(true)
    expect(r.boilerplate).toContain('Microsoft Teams 모임')
    expect(r.boilerplate).toContain('암호: Ab12Cd34')
    expect(r.boilerplate).toContain('이끌이: 모임 옵션')
    // \r\n 은 \n 으로 맞춰 돌려준다
    expect(r.boilerplate).not.toContain('\r')
  })

  it('안내문이 없으면 원문 그대로, boilerplate 는 null', () => {
    const text = '분기 회의\n\nMicrosoft Teams 로 진행합니다.\n____\n끝'
    expect(splitMeetingBoilerplate(text)).toEqual({ body: text, boilerplate: null })
    // 구분선이 있어도 다음 줄에 Microsoft Teams 가 없으면 안내문이 아니다
    const other = `메모\n${SEP}\n다른 서명\n${SEP}`
    expect(splitMeetingBoilerplate(other)).toEqual({ body: other, boilerplate: null })
  })

  it('안내문만 있으면 본문은 빈 문자열', () => {
    const r = splitMeetingBoilerplate(TEAMS_BLOCK)
    expect(r.body).toBe('')
    expect(r.boilerplate).toBe(TEAMS_BLOCK.replace(/\r\n/g, '\n'))
  })

  it('안내문 뒤에 사람이 쓴 글이 있으면 본문 뒤에 이어 붙인다', () => {
    const r = splitMeetingBoilerplate(`앞 글\n${TEAMS_BLOCK}\n\n추신: 자료는 공유 폴더에 있습니다.\n`)
    expect(r.body).toBe('앞 글\n\n추신: 자료는 공유 폴더에 있습니다.')
    expect(r.boilerplate!.endsWith('_'.repeat(80))).toBe(true)
    expect(r.boilerplate).not.toContain('추신')
  })

  it('뒤쪽 구분선이 없으면 글 끝까지가 안내문', () => {
    const r = splitMeetingBoilerplate(`안녕\n${SEP}\nMicrosoft Teams 모임\n참가: https://teams.microsoft.com/meet/1`)
    expect(r.body).toBe('안녕')
    expect(r.boilerplate).toBe(`${SEP}\nMicrosoft Teams 모임\n참가: https://teams.microsoft.com/meet/1`)
  })

  it('창(20줄) 밖의 보낸 사람 서명선·후속 글은 접지 않고 본문으로 남긴다', () => {
    const filler = Array.from({ length: 12 }, (_, i) => `후속 ${i + 1}`).join('\n')
    const r = splitMeetingBoilerplate(`앞 글\n${TEAMS_BLOCK}\n${filler}\n${'_'.repeat(30)}\n보낸 사람 서명`)
    expect(r.boilerplate!.endsWith('_'.repeat(80))).toBe(true)
    expect(r.boilerplate).not.toContain('후속')
    expect(r.body).toContain('후속 1')
    expect(r.body).toContain('_'.repeat(30))
    expect(r.body).toContain('보낸 사람 서명')
  })

  it('안내문 안에 구분선이 2~3개 더 있어도(위·중간·아래) 창 안 마지막 구분선까지 접는다', () => {
    const block = [SEP, 'Microsoft Teams 모임', '참가: https://teams.microsoft.com/meet/1', SEP, '암호: x', SEP, '도움말', SEP].join('\n')
    const r = splitMeetingBoilerplate(`앞 글\n\n${block}\n뒷 글`)
    expect(r.boilerplate).toBe(block)
    expect(r.body).toBe('앞 글\n\n뒷 글')
  })

  it('뒤쪽 구분선이 없고 남은 글이 창보다 길면 창 끝까지만 접는다', () => {
    const tail = Array.from({ length: 30 }, (_, i) => `줄 ${i + 1}`).join('\n')
    const r = splitMeetingBoilerplate(`${SEP}\nMicrosoft Teams 모임\n${tail}`)
    expect(r.boilerplate!.split('\n')).toHaveLength(20)
    expect(r.body).toContain('줄 30')
  })
})
