// 노트 멘션 칩 글자 — USER 는 "@" 접두(이메일 username 이면 이미 "@" 를 품어 중복 금지, WP-1880), PAGE 는 접두 없음.
import { describe, expect, it } from 'vitest'

import { mentionChipText } from './wikiMentionLabels'

describe('mentionChipText', () => {
  it('USER 는 이름 앞에 @ 를 붙인다', () => {
    expect(mentionChipText('USER', '김민수')).toBe('@김민수')
  })

  it('USER 라벨이 이메일 username 이면 @ 를 또 붙이지 않는다', () => {
    expect(mentionChipText('USER', 'admin@work-loop.local')).toBe('admin@work-loop.local')
  })

  it('PAGE 는 접두 없이 라벨 그대로', () => {
    expect(mentionChipText('PAGE', '문서')).toBe('문서')
  })
})
