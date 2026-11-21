// 노트 멘션 칩 글자 — USER 는 "@"+라벨(이메일형 아이디 라벨은 접두 없음, WP-1897), PAGE 는 접두 없음.
import { describe, expect, it } from 'vitest'

import { mentionChipText } from './wikiMentionLabels'

describe('mentionChipText', () => {
  it('USER 는 이름 앞에 @ 를 붙인다', () => {
    expect(mentionChipText('USER', '김민수')).toBe('@김민수')
  })

  it('USER 라벨에 @ 가 들어 있어도 멘션 @ 접두는 붙는다(채팅 칩과 같다)', () => {
    expect(mentionChipText('USER', 'Kim @Platform')).toBe('@Kim @Platform')
  })

  it('이메일형 아이디 라벨은 @ 를 다시 붙이지 않는다', () => {
    expect(mentionChipText('USER', 'admin@work-loop.local')).toBe('admin@work-loop.local')
  })

  it('공백 없이 @ 가 든 이름이라도 도메인에 점이 없으면 이름으로 보고 접두를 붙인다', () => {
    expect(mentionChipText('USER', 'R&D@Seoul')).toBe('@R&D@Seoul')
    expect(mentionChipText('USER', 'kim@platform')).toBe('@kim@platform')
  })

  it('USER 라벨이 비어 있어도 @ 는 남는다', () => {
    expect(mentionChipText('USER', '')).toBe('@')
  })

  it('PAGE 는 접두 없이 라벨 그대로', () => {
    expect(mentionChipText('PAGE', '문서')).toBe('문서')
  })

  it('ISSUE 도 접두 없이 라벨 그대로(이메일 모양이 섞여 있어도)', () => {
    expect(mentionChipText('ISSUE', 'admin@host.com 오류')).toBe('admin@host.com 오류')
  })
})
