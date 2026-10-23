import { describe, expect, it } from 'vitest'

import {
  BUILTIN_ORDER,
  COLS_PARAM,
  DEFAULT_COLUMNS,
  isCustomColumnKey,
  orderColumns,
  parseColumns,
  resolveColumns,
  serializeColumns,
} from './issueListColumns'

describe('상수', () => {
  it('기본 열은 우선순위·담당자·마감이고 URL 파라미터 이름은 cols 다', () => {
    expect(DEFAULT_COLUMNS).toEqual(['priority', 'assignee', 'due'])
    expect(COLS_PARAM).toBe('cols')
    expect(BUILTIN_ORDER).toEqual([
      'priority', 'assignee', 'due', 'closed', 'start', 'created', 'updated', 'reporter', 'milestone', 'cycle',
    ])
  })
})

describe('parseColumns', () => {
  it('파라미터가 없으면(null) null — 개인값/기본으로 넘긴다', () => {
    expect(parseColumns(null, [])).toBeNull()
  })

  it('빈 값(cols=)은 "선택 열 모두 끔" 이라 빈 배열이다 — 부재(null)와 구분', () => {
    expect(parseColumns('', [])).toEqual([])
    expect(parseColumns('', null)).toEqual([])
  })

  it('모르는 키·삭제된 커스텀 필드·중복은 버리고 입력 순서는 유지한다', () => {
    expect(parseColumns('due,priority,bogus,due,cf7,cf99', [7])).toEqual(['due', 'priority', 'cf7'])
  })

  it('커스텀 필드 정의가 아직 로딩 중(null)이면 cf<n> 은 형식만 검사해 유지한다', () => {
    expect(parseColumns('cf7,cf99,cfx,cf,cf-1,cf1.5,cf07', null)).toEqual(['cf7', 'cf99'])
  })

  it('전부 모르는 키면 빈 배열(부재가 아님)', () => {
    expect(parseColumns('bogus,cf99', [])).toEqual([])
  })

  it('공백·빈 토큰은 무시한다', () => {
    expect(parseColumns(' due , ,priority,', [])).toEqual(['due', 'priority'])
  })

  it('저장값(문자열 배열)도 같은 규칙으로 검증한다 — 빈 배열은 「모두 끔」', () => {
    expect(parseColumns(['due', 'bogus', 'due', ' cf7 ', 'cf99'], [7])).toEqual(['due', 'cf7'])
    expect(parseColumns([], [])).toEqual([])
  })
})

describe('isCustomColumnKey', () => {
  it('cf<양의 정수> 만 커스텀 필드 키다', () => {
    expect(isCustomColumnKey('cf7')).toBe(true)
    for (const k of ['due', 'cf', 'cfx', 'cf07', 'cf-1']) expect(isCustomColumnKey(k)).toBe(false)
  })
})

describe('serializeColumns', () => {
  it('쉼표로 잇고, 빈 배열은 빈 문자열(cols=)이다', () => {
    expect(serializeColumns(['due', 'cf7'])).toBe('due,cf7')
    expect(serializeColumns([])).toBe('')
  })

  it('parse 와 왕복해도 같다', () => {
    expect(parseColumns(serializeColumns(['closed', 'cf3']), [3])).toEqual(['closed', 'cf3'])
    expect(parseColumns(serializeColumns([]), [])).toEqual([])
  })
})

describe('orderColumns', () => {
  it('내장 열은 BUILTIN_ORDER 순, 그 뒤에 커스텀 필드를 정의 순서대로 놓는다', () => {
    expect(orderColumns(['cf9', 'cycle', 'cf2', 'due', 'priority'], [2, 5, 9])).toEqual([
      'priority', 'due', 'cycle', 'cf2', 'cf9',
    ])
  })

  it('중복은 한 번만 남긴다', () => {
    expect(orderColumns(['due', 'due', 'cf2', 'cf2'], [2])).toEqual(['due', 'cf2'])
  })

  it('정의 순서에 없는 커스텀 필드(로딩 중)도 잃지 않고 뒤에 입력 순서로 붙인다', () => {
    expect(orderColumns(['cf9', 'due', 'cf2'], [])).toEqual(['due', 'cf9', 'cf2'])
  })

  it('빈 입력은 빈 배열', () => {
    expect(orderColumns([], [1, 2])).toEqual([])
  })
})

describe('resolveColumns', () => {
  const base = { closedFilterActive: false, customFieldOrder: [] as number[] }

  it('URL > 저장값 > 기본 순서로 고른다', () => {
    expect(resolveColumns({ ...base, url: ['due'], stored: ['priority'] }).keys).toEqual(['due'])
    expect(resolveColumns({ ...base, url: null, stored: ['updated'] }).keys).toEqual(['updated'])
    expect(resolveColumns({ ...base, url: null, stored: null }).keys).toEqual(['priority', 'assignee', 'due'])
  })

  it('URL 의 빈 배열은 "모두 끔" 으로 존중하고 저장값·기본으로 폴백하지 않는다', () => {
    expect(resolveColumns({ ...base, url: [], stored: ['due'] })).toEqual({ keys: [], chosen: [], autoClosed: false })
    expect(resolveColumns({ ...base, url: null, stored: [] })).toEqual({ keys: [], chosen: [], autoClosed: false })
  })

  it('결과는 표시 순서(내장 → 커스텀)로 정렬된다', () => {
    const r = resolveColumns({ url: ['cf2', 'due', 'priority'], stored: null, closedFilterActive: false, customFieldOrder: [2] })
    expect(r.keys).toEqual(['priority', 'due', 'cf2'])
  })

  it('완료일 필터가 켜졌는데 closed 가 없으면 자동으로 더하고 autoClosed=true', () => {
    const r = resolveColumns({ ...base, url: null, stored: null, closedFilterActive: true })
    expect(r).toEqual({ keys: ['priority', 'assignee', 'due', 'closed'], chosen: ['priority', 'assignee', 'due'], autoClosed: true })
  })

  it('모두 끈 상태에서도 필터가 켜지면 closed 만 자동으로 켠다', () => {
    expect(resolveColumns({ ...base, url: [], stored: null, closedFilterActive: true })).toEqual({
      keys: ['closed'],
      chosen: [],
      autoClosed: true,
    })
  })

  it('사용자가 이미 closed 를 골랐으면 autoClosed 는 false', () => {
    const r = resolveColumns({ ...base, url: ['closed'], stored: null, closedFilterActive: true })
    expect(r).toEqual({ keys: ['closed'], chosen: ['closed'], autoClosed: false })
  })

  it('chosen 은 고른 열을 표시 순서로 — 자동 완료일 열은 빠진다', () => {
    const r = resolveColumns({ url: ['cf2', 'reporter', 'priority'], stored: null, closedFilterActive: true, customFieldOrder: [2] })
    expect(r.chosen).toEqual(['priority', 'reporter', 'cf2'])
    expect(r.keys).toEqual(['priority', 'closed', 'reporter', 'cf2'])
  })

  it('필터가 꺼져 있으면 closed 를 더하지 않는다', () => {
    expect(resolveColumns({ ...base, url: ['due'], stored: null }).autoClosed).toBe(false)
  })
})
