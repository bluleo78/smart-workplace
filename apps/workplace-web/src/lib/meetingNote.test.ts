// 일정에서 만드는 회의록 노트의 순수 함수(WP-1702) — 제목·틀·위치 기억·위치 해석.
// vitest 는 TZ=Asia/Seoul 로 돈다 — 일정 시각은 로컬(=KST) 기준으로 읽는다.
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { WikiSpace } from '@/types/wiki'

import {
  draftMeetingNoteTitle,
  loadMeetingNoteLocation,
  meetingNoteTemplate,
  meetingNoteTitle,
  resolveMeetingNoteLocation,
  saveMeetingNoteLocation,
  uniqueAttendeeNames,
  writableSpaces,
} from './meetingNote'
import { WIKI_TITLE_MAX } from './wikiLimits'

const NOW = new Date('2026-11-18T00:00:00Z')

describe('meetingNoteTitle', () => {
  test('「M/D 일정 제목 회의록」 — 월·일은 앞자리 0 없이, 시작의 로컬 날짜', () => {
    expect(meetingNoteTitle('주간 기획 회의', new Date('2026-11-18T10:00'))).toBe('11/18 주간 기획 회의 회의록')
    expect(meetingNoteTitle('신년 회의', new Date('2027-01-01T09:00'))).toBe('1/1 신년 회의 회의록')
  })

  test('KST 자정 직후 시작은 로컬 날짜를 쓴다(UTC 로는 전날)', () => {
    // 2026-11-17T15:30Z = KST 11/18 00:30
    expect(meetingNoteTitle('새벽 점검', new Date('2026-11-17T15:30:00Z'))).toBe('11/18 새벽 점검 회의록')
  })

  test('노트 제목 한도(255자)를 넘으면 일정 제목을 줄여 「회의록」 꼬리를 지킨다', () => {
    const t = meetingNoteTitle('가'.repeat(300), new Date('2026-11-18T10:00'))
    expect(t).toHaveLength(WIKI_TITLE_MAX)
    expect(t.startsWith('11/18 가')).toBe(true)
    expect(t.endsWith('가 회의록')).toBe(true)
  })

  test('제목이 비면(공백 포함) 「M/D 회의록」', () => {
    expect(meetingNoteTitle('', new Date('2026-11-18T10:00'))).toBe('11/18 회의록')
    expect(meetingNoteTitle('   ', new Date('2026-11-18T10:00'))).toBe('11/18 회의록')
  })
})

describe('meetingNoteTemplate', () => {
  const base = {
    start: new Date('2026-11-18T10:00'),
    end: new Date('2026-11-18T11:00'),
    allDay: false,
    location: '3층 회의실',
    attendeeNames: ['양동희', '김민수', 'AI 팀장'],
  }

  test('미리보기 줄과 마크다운을 같은 값으로 만든다', () => {
    const t = meetingNoteTemplate(base, NOW)
    expect(t.lines).toEqual([
      { label: '일시', value: '11월 18일 (수) 10:00–11:00' },
      { label: '장소', value: '3층 회의실' },
      { label: '참석', value: '양동희, 김민수, AI 팀장' },
      { label: '안건' },
      { label: '결정' },
      { label: '할 일' },
    ])
    expect(t.markdown).toBe(
      [
        '- 일시: 11월 18일 (수) 10:00–11:00',
        '- 장소: 3층 회의실',
        '- 참석: 양동희, 김민수, AI 팀장',
        '',
        '## 안건',
        '',
        '## 결정',
        '',
        '## 할 일',
        '',
      ].join('\n'),
    )
  })

  test('장소·참석이 비면 그 줄을 뺀다', () => {
    const t = meetingNoteTemplate({ ...base, location: '  ', attendeeNames: [] }, NOW)
    expect(t.lines.map((l) => l.label)).toEqual(['일시', '안건', '결정', '할 일'])
    expect(t.markdown).not.toContain('장소')
    expect(t.markdown).not.toContain('참석')
    expect(meetingNoteTemplate({ ...base, location: null }, NOW).lines.map((l) => l.label)).not.toContain('장소')
  })

  test('종일 하루 — 「11월 18일 (수) 종일」(종료는 다음 날 자정)', () => {
    const t = meetingNoteTemplate(
      { ...base, allDay: true, start: new Date('2026-11-18T00:00'), end: new Date('2026-11-19T00:00') },
      NOW,
    )
    expect(t.lines[0]).toEqual({ label: '일시', value: '11월 18일 (수) 종일' })
  })

  test('종일 여러 날 — 마지막 날까지', () => {
    const t = meetingNoteTemplate(
      { ...base, allDay: true, start: new Date('2026-11-18T00:00'), end: new Date('2026-11-20T00:00') },
      NOW,
    )
    expect(t.lines[0].value).toBe('11월 18일 (수) – 11월 19일 (목) 종일')
  })

  test('여러 날에 걸친 일정 — 양쪽에 날짜를 붙인다', () => {
    const t = meetingNoteTemplate({ ...base, end: new Date('2026-11-19T11:00') }, NOW)
    expect(t.lines[0].value).toBe('11월 18일 (수) 10:00 – 11월 19일 (목) 11:00')
  })

  test('올해가 아니면 연도를 붙인다', () => {
    const t = meetingNoteTemplate(
      { ...base, start: new Date('2027-01-04T09:05'), end: new Date('2027-01-04T10:00') },
      NOW,
    )
    expect(t.lines[0].value).toBe('2027년 1월 4일 (월) 09:05–10:00')
  })
})

describe('draftMeetingNoteTitle', () => {
  test('사람이 고치지 않았으면 지금 폼의 제목·시작으로 다시 만든다', () => {
    expect(draftMeetingNoteTitle({ title: '6/10 킥오프 회의록', titleEdited: false }, '킥오프 미팅', '2026-06-12T10:00')).toBe(
      '6/12 킥오프 미팅 회의록',
    )
  })

  test('고쳤으면 그 제목을 지킨다', () => {
    expect(draftMeetingNoteTitle({ title: '킥오프 메모', titleEdited: true }, '킥오프 미팅', '2026-06-12T10:00')).toBe('킥오프 메모')
  })

  test('시작이 날짜가 아니면(칸을 비움) 정해 둔 제목을 쓴다', () => {
    expect(draftMeetingNoteTitle({ title: '6/10 킥오프 회의록', titleEdited: false }, '킥오프', '')).toBe('6/10 킥오프 회의록')
  })
})

describe('uniqueAttendeeNames', () => {
  test('같은 사람(키)은 한 번만, 이름이 같은 다른 사람은 둘 다', () => {
    expect(
      uniqueAttendeeNames([
        { key: 'u-1', name: 'Tester' },
        { key: 'u-2', name: '김민수' },
        { key: 'u-3', name: '김민수' },
        { key: 'u-1', name: 'Tester' },
        { key: 'e-x', name: ' ' },
      ]),
    ).toEqual(['Tester', '김민수', '김민수'])
  })
})

describe('위치 기억(localStorage)', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** 메모리 저장소 — node 환경엔 window·localStorage 가 없어 직접 깐다(safeLocalStorage 는 window.localStorage 를 본다). */
  function stubStorage() {
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
    })
    return data
  }

  test('사람·워크스페이스마다 다른 키에 저장하고 다시 읽는다(WP-701)', () => {
    const data = stubStorage()
    const me = { userId: 7, tenantId: 1 }
    saveMeetingNoteLocation(me, { spaceId: 3, parentId: 30 })
    expect([...data.keys()]).toEqual(['calendar.meetingNoteLocation:7:1'])
    expect(loadMeetingNoteLocation(me)).toEqual({ spaceId: 3, parentId: 30 })
    expect(loadMeetingNoteLocation({ userId: 8, tenantId: 1 })).toBeNull()
    expect(loadMeetingNoteLocation({ userId: 7, tenantId: 2 })).toBeNull()
    saveMeetingNoteLocation(me, { spaceId: 4, parentId: null })
    expect(loadMeetingNoteLocation(me)).toEqual({ spaceId: 4, parentId: null })
  })

  test('깨진 값·모양이 다른 값은 null', () => {
    const data = stubStorage()
    const me = { userId: 7, tenantId: 3 }
    data.set('calendar.meetingNoteLocation:7:3', '{not json')
    expect(loadMeetingNoteLocation(me)).toBeNull()
    data.set('calendar.meetingNoteLocation:7:3', JSON.stringify({ spaceId: 'x', parentId: 1 }))
    expect(loadMeetingNoteLocation(me)).toBeNull()
    data.set('calendar.meetingNoteLocation:7:3', 'null')
    expect(loadMeetingNoteLocation(me)).toBeNull()
  })

  test('저장소가 막혀도 예외 없이 이 탭에서는 기억한다', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      },
    })
    const me = { userId: 9, tenantId: 4 }
    expect(loadMeetingNoteLocation(me)).toBeNull()
    expect(() => saveMeetingNoteLocation(me, { spaceId: 1, parentId: null })).not.toThrow()
    expect(loadMeetingNoteLocation(me)).toEqual({ spaceId: 1, parentId: null })
  })

  test('저장소가 아예 없어도 null', () => {
    vi.stubGlobal('window', undefined)
    expect(loadMeetingNoteLocation({ userId: 10, tenantId: 5 })).toBeNull()
  })
})

describe('resolveMeetingNoteLocation', () => {
  const ME = 7
  const mine: WikiSpace = { id: 1, type: 'PERSONAL', name: '내 노트', ownerId: ME, role: 'OWNER', createdAt: '' }
  const team: WikiSpace = { id: 3, type: 'TEAM', name: '기획팀 공간', ownerId: 2, role: 'EDITOR', createdAt: '' }
  const viewer: WikiSpace = { id: 5, type: 'TEAM', name: '보기 공간', ownerId: 2, role: 'VIEWER', createdAt: '' }
  const others: WikiSpace = { id: 9, type: 'PERSONAL', name: '남의 노트', ownerId: 2, role: 'EDITOR', createdAt: '' }
  const spaces = [team, viewer, mine]

  test('저장된 위치가 없으면 내 공간 최상위', () => {
    expect(resolveMeetingNoteLocation(null, spaces, ME)).toEqual({ spaceId: 1, parentId: null, source: 'mine' })
  })

  test('저장된 공간 최상위·상위 노트가 살아 있으면 그대로(지난번 위치)', () => {
    expect(resolveMeetingNoteLocation({ spaceId: 3, parentId: null }, spaces, ME)).toEqual({
      spaceId: 3,
      parentId: null,
      source: 'saved',
    })
    expect(resolveMeetingNoteLocation({ spaceId: 3, parentId: 30 }, spaces, ME, [{ id: 30 }, { id: 31 }])).toEqual({
      spaceId: 3,
      parentId: 30,
      source: 'saved',
    })
  })

  test('지워진(목록에 없는) 공간·VIEWER 공간이면 내 공간 최상위', () => {
    expect(resolveMeetingNoteLocation({ spaceId: 42, parentId: null }, spaces, ME)).toEqual({
      spaceId: 1,
      parentId: null,
      source: 'mine',
    })
    expect(resolveMeetingNoteLocation({ spaceId: 5, parentId: null }, spaces, ME)).toEqual({
      spaceId: 1,
      parentId: null,
      source: 'mine',
    })
  })

  test('저장된 상위 노트가 그 공간 트리에 없으면(지워짐·트리 못 읽음) 그 공간이 아니라 내 공간 최상위', () => {
    expect(resolveMeetingNoteLocation({ spaceId: 3, parentId: 30 }, spaces, ME, [{ id: 31 }])).toEqual({
      spaceId: 1,
      parentId: null,
      source: 'mine',
    })
    expect(resolveMeetingNoteLocation({ spaceId: 3, parentId: 30 }, spaces, ME, undefined)).toEqual({
      spaceId: 1,
      parentId: null,
      source: 'mine',
    })
  })

  test('내 공간이 없으면 쓸 수 있는 첫 공간 최상위 — 남의 개인 공간도 쓸 수 있으면 후보', () => {
    expect(resolveMeetingNoteLocation(null, [viewer, team], ME)).toEqual({ spaceId: 3, parentId: null, source: 'fallback' })
    expect(resolveMeetingNoteLocation(null, [viewer, others], ME)).toEqual({
      spaceId: 9,
      parentId: null,
      source: 'fallback',
    })
  })

  test('쓸 수 있는 공간이 하나도 없으면 null', () => {
    expect(resolveMeetingNoteLocation(null, [viewer], ME)).toBeNull()
    expect(resolveMeetingNoteLocation({ spaceId: 5, parentId: null }, [], ME)).toBeNull()
  })

  test('writableSpaces — OWNER·EDITOR 만, 순서 유지', () => {
    expect(writableSpaces(spaces).map((s) => s.id)).toEqual([3, 1])
  })
})
