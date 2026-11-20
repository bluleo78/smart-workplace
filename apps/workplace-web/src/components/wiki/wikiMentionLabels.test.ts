// 노트 멘션 칩 글자 — USER 는 채팅 칩과 같이 늘 "@"+라벨(라벨은 표시 이름, WP-1880 리뷰 후속), PAGE 는 접두 없음.
import { describe, expect, it } from 'vitest'

import { mentionChipText } from './wikiMentionLabels'

describe('mentionChipText', () => {
  it('USER 는 이름 앞에 @ 를 붙인다', () => {
    expect(mentionChipText('USER', '김민수')).toBe('@김민수')
  })

  it('USER 라벨에 @ 가 들어 있어도 멘션 @ 접두는 붙는다(채팅 칩과 같다)', () => {
    expect(mentionChipText('USER', 'Kim @Platform')).toBe('@Kim @Platform')
    expect(mentionChipText('USER', 'admin@work-loop.local')).toBe('@admin@work-loop.local')
  })

  it('USER 라벨이 비어 있어도 @ 는 남는다', () => {
    expect(mentionChipText('USER', '')).toBe('@')
  })

  it('PAGE 는 접두 없이 라벨 그대로', () => {
    expect(mentionChipText('PAGE', '문서')).toBe('문서')
  })
})
