import { describe, expect, it } from 'vitest'

import {
  isCompleteAddress,
  joinRecipients,
  mergeRecipientSuggestions,
  moveRecipient,
  type RecipientField,
  type RecipientFields,
  type RecipientSuggestion,
  removeRecipient,
  splitField,
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

describe('splitField — 칸 문자열과 아직 쓰는 중인 조각(WP-2150 반려)', () => {
  it('조각이 없으면 지금처럼 한 줄 전체를 칩으로 나눈다', () => {
    expect(splitField('hong@x.test, lee@x.test')).toEqual({ chips: toChips('hong@x.test, lee@x.test'), rest: '' })
  })

  it('칩 없이 조각만 남은 칸은 칩 없이 조각으로 남긴다 — 조각이 빨간 칩이 되지 않는다', () => {
    expect(splitField('par', 'par')).toEqual({ chips: [], rest: 'par' })
  })

  it('값이 조각으로 끝나면 앞은 칩, 뒤는 조각으로 나눈다', () => {
    const { chips, rest } = splitField('hong@x.test, par', 'par')
    expect(chips.map((c) => c.label)).toEqual(['hong@x.test'])
    expect(rest).toBe('par')
  })

  it('값이 조각을 담지 않으면 조각을 끼워 맞추지 않고 통째로 나눈다', () => {
    // 바깥이 값을 통째로 바꾼 뒤(답장 채우기 등) — 지난 글자를 새 값에 끼워 맞추면 내용이 달라진다.
    expect(splitField('reply@x.test', 'par')).toEqual({ chips: toChips('reply@x.test'), rest: '' })
    expect(splitField('', 'par')).toEqual({ chips: [], rest: '' })
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

describe('moveRecipient', () => {
  /** 세 칸의 값을 간단히 만든다. */
  const F = (to: string, cc = '', bcc = ''): RecipientFields => ({ to, cc, bcc })

  it('받는사람 칩을 참조로 옮기면 원래 칸에서 빠지고 참조 맨 끝에 붙는다', () => {
    const next = moveRecipient(F('hong@x.test, kim@x.test', 'lee@x.test'), 'to', 0, 'cc')
    expect(next).toEqual({ to: 'kim@x.test', cc: 'lee@x.test, hong@x.test', bcc: '' })
  })

  it('대상 칸에 같은 주소가 있으면 원래 칸에서만 빠진다 — 대상은 가만히다', () => {
    const next = moveRecipient(F('hong@x.test', 'lee@x.test, hong@x.test'), 'to', 0, 'cc')
    expect(next).toEqual({ to: '', cc: 'lee@x.test, hong@x.test', bcc: '' })
  })

  it('대상 칸이 비어 있어도 끝에 붙는다', () => {
    expect(moveRecipient(F('hong@x.test'), 'to', 0, 'bcc')).toEqual({ to: '', cc: '', bcc: 'hong@x.test' })
  })

  it('형식이 틀린 칩(빨간 칩)도 그대로 옮겨진다', () => {
    expect(moveRecipient(F('not-an-address, hong@x.test'), 'to', 0, 'cc'))
      .toEqual({ to: 'hong@x.test', cc: 'not-an-address', bcc: '' })
  })

  it('같은 칸에 놓으면 아무것도 바꾸지 않는다', () => {
    const before = F('hong@x.test, kim@x.test')
    expect(moveRecipient(before, 'to', 1, 'to')).toEqual(before)
  })

  it('인덱스 밖·없는 칸은 원본 그대로다', () => {
    const before = F('hong@x.test', 'lee@x.test')
    expect(moveRecipient(before, 'to', 5, 'cc')).toEqual(before)
    expect(moveRecipient(before, 'to', 0, 'cc')).not.toBe(before) // 실제 이동은 새 객체
    expect(moveRecipient(before, 'nope' as RecipientField, 0, 'cc')).toEqual(before)
  })

  it('빈 문자열 칸은 그대로 비어 있는다', () => {
    expect(moveRecipient(F('', 'lee@x.test'), 'cc', 0, 'to')).toEqual({ to: 'lee@x.test', cc: '', bcc: '' })
  })

  // ── 아직 치는 중인 조각(WP-2150 반려) ──────────────────────────────
  // 입력이 blur 되지 않은 채 옮기면 칸 문자열에 조각이 남아 있다 — 조각까지 칩으로 다시 나누면 빨간 칩이 되어
  // 입력에서 사라지므로, 작성 도크가 지금 쓰는 조각을 함께 넘긴다.

  it('원래 칸에 쓰는 조각이 있으면 옮긴 뒤에도 그 글자가 그대로다', () => {
    const next = moveRecipient(F('hong@x.test, kim@x', ''), 'to', 0, 'cc', { to: 'kim@x' })
    expect(next).toEqual({ to: 'kim@x', cc: 'hong@x.test', bcc: '' })
  })

  it('놓을 칸에 쓰는 조각이 있으면 옮긴 칩 뒤에 그대로 잇는다 — 조각이 앞에 끼어 칩이 되지 않는다', () => {
    // 조각까지 칩으로 다시 나누면 'par, hong@x.test' 처럼 조각이 앞에 끼어 빨간 칩이 되고 입력이 비다.
    const next = moveRecipient(F('hong@x.test', 'par'), 'to', 0, 'cc', { cc: 'par' })
    expect(next).toEqual({ to: '', cc: 'hong@x.test, par', bcc: '' })
  })

  it('조각이 값에 없는 칸은 조각을 끼워 맞추지 않는다 — 지난 글자가 새 값에 섞이지 않는다', () => {
    // 지난 회차의 조각이 ref 에 남아 있어도 값에 그 조각이 없으면 그대로다.
    expect(moveRecipient(F('hong@x.test', ''), 'to', 0, 'cc', { cc: 'par' })).toEqual({
      to: '',
      cc: 'hong@x.test',
      bcc: '',
    })
  })
})

describe('removeRecipient', () => {
  /** 세 칸의 값을 간단히 만든다 — moveRecipient 와 같은 표본. */
  const F = (to: string, cc = '', bcc = ''): RecipientFields => ({ to, cc, bcc })

  it('칸의 칩 하나를 빼면 그 자리만 비고 나머지 칸은 그대로다', () => {
    expect(removeRecipient(F('hong@x.test, kim@x.test', 'lee@x.test'), 'to', 0)).toEqual({
      to: 'kim@x.test',
      cc: 'lee@x.test',
      bcc: '',
    })
  })

  it('실제 삭제는 새 객체다 — 원본은 바꾸지 않는다', () => {
    const before = F('hong@x.test')
    expect(removeRecipient(before, 'to', 0)).not.toBe(before)
  })

  it('인덱스 밖·없는 칸은 원본 그대로다(조용히 무시)', () => {
    const before = F('hong@x.test', 'lee@x.test')
    expect(removeRecipient(before, 'to', 5)).toBe(before)
    expect(removeRecipient(before, 'nope' as RecipientField, 0)).toBe(before)
  })

  it('형식이 틀린 칩(빨간 칩)도 형식 검사 없이 그대로 빠진다', () => {
    expect(removeRecipient(F('not-an-address, hong@x.test'), 'to', 0)).toEqual({
      to: 'hong@x.test',
      cc: '',
      bcc: '',
    })
  })

  it('다른 칸의 칩을 뺀 척해도 자기 칸만 바뀐다', () => {
    expect(removeRecipient(F('hong@x.test', 'lee@x.test, kim@x.test'), 'cc', 1)).toEqual({
      to: 'hong@x.test',
      cc: 'lee@x.test',
      bcc: '',
    })
  })

  // ── 아직 치는 중인 조각(WP-2150 반려) ──────────────────────────────
  // × 단추·메뉴 「빼기」 가 바깥(작성 도크)으로 위임한 뒤에도 안의 removeAt 이 지키던 쓰는 글자를 그대로 남긴다.

  it('뺄 때도 칸에 쓰는 조각은 그대로 남는다 — 조각이 빨간 칩이 되어 비지 않는다', () => {
    expect(removeRecipient(F('hong@x.test, lee@x.test, kim@x'), 'to', 0, { to: 'kim@x' })).toEqual({
      to: 'lee@x.test, kim@x',
      cc: '',
      bcc: '',
    })
  })

  it('조각만 남아 뺀 칩이 없으면 값은 그대로다(조용히 무시)', () => {
    const before = F('', 'par')
    expect(removeRecipient(before, 'cc', 0, { cc: 'par' })).toBe(before)
  })

  it('조각이 값에 없는 칸은 조각을 끼워 맞추지 않는다 — 지난 글자가 새 값에 섞이지 않는다', () => {
    expect(removeRecipient(F('hong@x.test, lee@x.test'), 'to', 0, { to: 'kim@x' })).toEqual({
      to: 'lee@x.test',
      cc: '',
      bcc: '',
    })
  })
})
