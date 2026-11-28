import { describe, expect, it } from 'vitest'

import {
  isCompleteAddress,
  joinRecipients,
  mergeRecipientSuggestions,
  type RecipientSuggestion,
  splitTypedRecipients,
  toChips,
} from './mailRecipientSuggest'

const s = (address: string, name: string | null, source: RecipientSuggestion['source']): RecipientSuggestion => ({
  address,
  name,
  source,
})

/** 칩은 표기(label)만 비교한다. */
const split = (raw: string) => {
  const { committed, rest } = splitTypedRecipients(raw)
  return { committed: committed.map((c) => c.label), rest }
}

describe('splitTypedRecipients — 쉼표·세미콜론 앞은 칩, 뒤는 쓰는 중', () => {
  it('구분자가 없으면 모두 쓰는 중', () => {
    expect(split('dh')).toEqual({ committed: [], rest: 'dh' })
  })
  it('쉼표를 치면 앞이 칩이 된다', () => {
    expect(split('a@x.com,')).toEqual({ committed: ['a@x.com'], rest: '' })
  })
  it('여러 주소를 붙여 넣으면 마지막 조각만 남긴다', () => {
    expect(split('a@x.com; 앨리스 <b@x.com>, c@')).toEqual({
      committed: ['a@x.com', '앨리스 <b@x.com>'],
      rest: 'c@',
    })
  })
  it('닫히지 않은 꺾쇠·따옴표 뒤의 구분자도 나눈다 — 여러 주소가 한 수신인으로 묶이지 않게', () => {
    expect(split('Kim <kim@x.com, lee@y.com')).toEqual({ committed: ['Kim <kim@x.com'], rest: 'lee@y.com' })
    expect(split('"Kim kim@x.com; lee@y.com')).toEqual({ committed: ['"Kim kim@x.com'], rest: 'lee@y.com' })
  })
  it('따옴표 안의 쉼표는 나누지 않는다', () => {
    expect(split('"김, 철수" <kim@x.com>')).toEqual({ committed: [], rest: '"김, 철수" <kim@x.com>' })
  })
})

describe('joinRecipients', () => {
  it('칩 뒤에 쓰는 중인 조각을 잇고 빈 조각은 뺀다', () => {
    expect(joinRecipients(toChips('a@x.com, b@x.com'), ' c ')).toBe('a@x.com, b@x.com, c')
    expect(joinRecipients(toChips('a@x.com'), '  ')).toBe('a@x.com')
  })
})

describe('칩', () => {
  it('보이는 글자는 이름, 없으면 주소 — 비교 키는 소문자 주소', () => {
    expect(toChips('앨리스 <Alice@X.com>, bob@x.com').map(({ text, key }) => ({ text, key }))).toEqual([
      { text: '앨리스', key: 'alice@x.com' },
      { text: 'bob@x.com', key: 'bob@x.com' },
    ])
  })
  it('메일 주소 모양이 아니면 오류 칩', () => {
    expect(toChips('앨리스 <alice@x.com>, alice, alice@x').map((c) => c.ok)).toEqual([true, false, false])
  })
  it('완성된 주소인지 — Enter 가 후보 대신 쓴 주소를 넣을지', () => {
    expect(isCompleteAddress('han@partner.co')).toBe(true)
    expect(isCompleteAddress('han@partner')).toBe(false)
    expect(isCompleteAddress('dh')).toBe(false)
  })
})

describe('mergeRecipientSuggestions', () => {
  it('최근 → 구성원 → 주소록 순, 같은 주소는 앞선 것만 두고 비어 있던 이름은 뒤의 것으로 채운다', () => {
    const out = mergeRecipientSuggestions(
      'r',
      {
        recent: [s('Kim@corp.com', null, 'recent')],
        member: [s('kim@corp.com', '김철수', 'member'), s('lee@corp.com', '이영희', 'member')],
        external: [s('park@partner.com', '박민수', 'external')],
      },
      new Set(),
      10,
    )
    expect(out).toEqual([
      s('Kim@corp.com', '김철수', 'recent'),
      s('lee@corp.com', '이영희', 'member'),
      s('park@partner.com', '박민수', 'external'),
    ])
  })
  it('주소·이름이 검색어로 시작하는 후보를 앞으로 올리고, 검색어가 없는 후보·이미 넣은 주소는 빼고, 개수를 자른다', () => {
    const out = mergeRecipientSuggestions(
      'dh',
      {
        recent: [s('adh@corp.com', null, 'recent'), s('done@corp.com', null, 'recent'), s('other@corp.com', null, 'recent')],
        member: [s('dh.yang@corp.com', '양동희', 'member'), s('dhkim@corp.com', '김도훈', 'member')],
        external: [],
      },
      new Set(['done@corp.com']),
      2,
    )
    expect(out.map((x) => x.address)).toEqual(['dh.yang@corp.com', 'dhkim@corp.com'])
    expect(
      mergeRecipientSuggestions('dh', { recent: [s('other@corp.com', null, 'recent')], member: [], external: [] }, new Set(), 8),
    ).toEqual([])
  })
  it('빈 검색어는 후보가 없다', () => {
    expect(mergeRecipientSuggestions(' ', { recent: [s('a@x.com', null, 'recent')], member: [], external: [] }, new Set(), 8)).toEqual([])
  })
})
