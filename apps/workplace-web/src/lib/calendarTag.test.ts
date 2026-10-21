import { describe, expect, it } from 'vitest'

import { PALETTE_KEYS } from '@/lib/calendarPalette'

import {
  eventTagHint,
  filterTagsByName,
  pickTagColor,
  sameTagIds,
  TAG_HINT_OUTLOOK_EVENT,
  TAG_HINT_OUTLOOK_READ_ONLY,
  TAG_HINT_OUTLOOK_SERIES,
  tagNameToCreate,
  toggleTagId,
} from './calendarTag'

describe('pickTagColor', () => {
  it('같은 이름은 항상 같은 팔레트 키이고, 대소문자·앞뒤 공백은 무시한다', () => {
    expect(pickTagColor('Ops')).toBe(pickTagColor('ops'))
    expect(pickTagColor(' 고객사 ')).toBe(pickTagColor('고객사'))
    expect(PALETTE_KEYS).toContain(pickTagColor('고객사'))
  })

  it('서버 CalendarPalette.forName 과 같은 답을 낸다(같은 이름을 CalendarTagServiceTest 에도 고정)', () => {
    // Outlook 범주에서 서버가 만든 태그와 앱에서 만든 태그가 같은 이름이면 같은 색이어야 한다(WP-714)
    expect(pickTagColor('사내 공유')).toBe('amber')
    expect(pickTagColor('운영')).toBe('pink')
    expect(pickTagColor('Ops')).toBe('red')
    expect(pickTagColor('고객사')).toBe('gray')
    expect(pickTagColor('Customer Meeting')).toBe('green')
  })

  it('이름이 달라지면 팔레트 전체에 고르게 퍼진다(한 색으로 몰리지 않는다)', () => {
    const colors = new Set(['사내 공유', '운영', '개인', '고객사', '채용', '교육', '출장', '휴가', '1on1', '스프린트'].map(pickTagColor))
    expect(colors.size).toBeGreaterThanOrEqual(4)
  })
})

describe('filterTagsByName', () => {
  const tags = [{ name: '사내 공유' }, { name: 'Ops' }, { name: '운영' }]
  it('부분 일치·대소문자 무시로 거른다', () => {
    expect(filterTagsByName(tags, 'op')).toEqual([{ name: 'Ops' }])
    expect(filterTagsByName(tags, '공유')).toEqual([{ name: '사내 공유' }])
  })
  it('빈 검색어(공백만 포함)는 전부 돌려준다', () => {
    expect(filterTagsByName(tags, '  ')).toHaveLength(3)
  })
})

describe('tagNameToCreate', () => {
  const existing = [{ name: 'Ops' }, { name: '운영' }]
  it('이름이 없으면 만들 수 없다', () => {
    expect(tagNameToCreate('', existing)).toBeNull()
    expect(tagNameToCreate('   ', existing)).toBeNull()
  })
  it('대소문자만 다른 이름은 이미 있는 것으로 본다(서버 유일 제약과 같다)', () => {
    expect(tagNameToCreate('ops', existing)).toBeNull()
    expect(tagNameToCreate(' OPS ', existing)).toBeNull()
  })
  it('일부만 겹치는 이름은 새 태그로 만들 수 있고 앞뒤 공백은 지운다', () => {
    expect(tagNameToCreate(' 운 ', existing)).toBe('운')
    expect(tagNameToCreate('고객사 미팅', existing)).toBe('고객사 미팅')
  })
})

describe('toggleTagId', () => {
  it('없으면 끝에 더하고 있으면 뺀다', () => {
    expect(toggleTagId([1, 2], 3)).toEqual([1, 2, 3])
    expect(toggleTagId([1, 2, 3], 2)).toEqual([1, 3])
  })
  it('원본 배열을 바꾸지 않는다', () => {
    const src = [1]
    toggleTagId(src, 2)
    expect(src).toEqual([1])
  })
})

describe('sameTagIds', () => {
  it('순서와 상관없이 같은 집합이면 같다', () => {
    expect(sameTagIds([1, 2, 3], [3, 1, 2])).toBe(true)
    expect(sameTagIds([], [])).toBe(true)
  })
  it('원소나 개수가 다르면 다르다', () => {
    expect(sameTagIds([1, 2], [1, 2, 3])).toBe(false)
    expect(sameTagIds([1, 2], [1, 3])).toBe(false)
  })
})

describe('eventTagHint', () => {
  const tag = { id: 1, name: '운영', color: 'amber' }

  it('붙일 수 있는 M365 일정은 Outlook 범주에도 반영된다고 알리고, 반복 회의면 시리즈 전체라고 알린다 (WP-716)', () => {
    expect(eventTagHint({ tags: [], tagsEditable: true, outlookTagScope: 'EVENT' })).toBe(TAG_HINT_OUTLOOK_EVENT)
    expect(eventTagHint({ tags: [tag], tagsEditable: true, outlookTagScope: 'SERIES' })).toBe(TAG_HINT_OUTLOOK_SERIES)
    // 처음 쓰는 범주 이름은 Outlook 에서 색 없이 붙는다는 것도 짧게 단다(범주 목록에 만들지 않으므로)
    expect(TAG_HINT_OUTLOOK_EVENT).toContain('색 없이')
    expect(TAG_HINT_OUTLOOK_SERIES).toContain('반복 일정 전체')
  })

  it('앱 일정은 안내가 없다', () => {
    expect(eventTagHint({ tags: [tag], tagsEditable: true, outlookTagScope: null })).toBeNull()
    expect(eventTagHint({ tags: [tag], tagsEditable: true })).toBeNull()
  })

  it('붙일 수 없는 일정(공유받은 읽기 전용 달력 등)은 태그가 있을 때만 「Outlook에서 바꾸기」 안내 — 범주 단위 필드가 없어도 같다', () => {
    expect(eventTagHint({ tags: [tag], tagsEditable: false, outlookTagScope: 'EVENT' })).toBe(TAG_HINT_OUTLOOK_READ_ONLY)
    expect(eventTagHint({ tags: [tag], tagsEditable: false })).toBe(TAG_HINT_OUTLOOK_READ_ONLY)
    expect(eventTagHint({ tags: [], tagsEditable: false, outlookTagScope: 'EVENT' })).toBeNull()
    expect(eventTagHint({})).toBeNull()
  })
})
