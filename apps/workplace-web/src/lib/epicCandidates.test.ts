// 상위 에픽 후보 거르기(WP-1018) — 제목 일부·번호로 찾고, 번호 일치·제목 접두를 앞에 둔다.
import { describe, expect, test } from 'vitest'

import { matchEpicCandidates, parseIssueNumberQuery } from './epicCandidates'

const EPICS = [
  { number: 3, title: '로그인 개편' },
  { number: 12, title: 'v1.7.0 제품개선' },
  { number: 120, title: '결제 v1.7 대응' },
  { number: 31, title: 'Release 정리' },
]

const numbers = (q: string, limit?: number) => matchEpicCandidates(EPICS, q, limit).map((e) => e.number)

describe('matchEpicCandidates', () => {
  test('빈 입력이면 모든 에픽을 원래 순서로 보여 준다', () => {
    expect(numbers('  ')).toEqual([3, 12, 120, 31])
  })

  test('제목 일부(「1.7」)로 찾는다 — 번호를 몰라도 된다', () => {
    expect(numbers('1.7')).toEqual([12, 120])
  })

  test('제목은 대소문자를 가리지 않고, 입력으로 시작하는 제목이 앞에 온다', () => {
    expect(numbers('RELEASE')).toEqual([31])
    expect(numbers('v1.7')).toEqual([12, 120])
    expect(numbers('결제')).toEqual([120])
  })

  test('번호(앞의 # 허용)는 꼭 같은 번호가 먼저, 그 번호로 시작하는 에픽이 뒤에 온다', () => {
    expect(numbers('12')).toEqual([12, 120])
    expect(numbers('#3')).toEqual([3, 31])
  })

  test('번호 접두 일치는 제목 일치보다 뒤에 온다 — 짧은 숫자 입력에서 제목 일치가 밀려나지 않게', () => {
    const epics = [
      { number: 10, title: '알림 정리' },
      { number: 11, title: '검색 개선' },
      { number: 40, title: 'v1 출시' },
    ]
    expect(matchEpicCandidates(epics, '1').map((e) => e.number)).toEqual([40, 10, 11])
    expect(matchEpicCandidates(epics, '1', 1).map((e) => e.number)).toEqual([40])
  })

  test('parseIssueNumberQuery — 양의 정수(앞의 # 허용)만 번호로 본다', () => {
    expect(parseIssueNumberQuery(' #12 ')).toBe(12)
    expect(parseIssueNumberQuery('007')).toBe(7)
    expect(parseIssueNumberQuery('#0')).toBeNull()
    expect(parseIssueNumberQuery('1.5')).toBeNull()
    expect(parseIssueNumberQuery('v1.7')).toBeNull()
    expect(parseIssueNumberQuery('')).toBeNull()
  })

  test('맞는 에픽이 없으면 빈 목록, 상한을 넘으면 자른다', () => {
    expect(numbers('없는 제목')).toEqual([])
    expect(numbers('', 2)).toEqual([3, 12])
  })
})
