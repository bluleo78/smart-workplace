import { describe, expect, it } from 'vitest'

import { emptyStateDescriptionClass, mobileEmptyStateDescriptionClass } from './empty-state'

// WP-2051 — 빈 상태 설명은 데스크톱·모바일 모두 한국어를 단어 단위로 줄바꿈한다(06 §B).
// break-keep: 기본 word-break 는 한국어를 글자마다 끊어 마지막 줄에 「요.」 한 글자만 남길 수 있다.
// break-words: keep-all 로 끊을 곳이 없어진 띄어쓰기 없는 긴 낱말(사용자가 지은 이름 등)을 칸을 넘칠 때만 끊는다.
describe('빈 상태 설명 클래스', () => {
  it.each([
    ['데스크톱', emptyStateDescriptionClass],
    ['모바일', mobileEmptyStateDescriptionClass],
  ])('%s 설명은 break-keep 과 break-words 를 함께 가진다', (_, cls) => {
    expect(cls.split(' ')).toEqual(expect.arrayContaining(['break-keep', 'break-words']))
  })
})
