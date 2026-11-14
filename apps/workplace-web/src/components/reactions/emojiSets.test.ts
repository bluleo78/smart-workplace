// 이모지 한국어 이름·반응 버튼 접근 이름 헬퍼 — 순수 테스트(WP-1551).
import { describe, expect, test } from 'vitest'

import { EMOJI_NAMES, emojiReactionLabel, PICKER_EMOJIS, QUICK_EMOJIS } from './emojiSets'

describe('EMOJI_NAMES', () => {
  test('피커 40종 모두 비지 않은 이름이 있고 이름이 서로 겹치지 않는다', () => {
    const names = PICKER_EMOJIS.map((e) => EMOJI_NAMES[e])
    for (const n of names) expect(n?.trim()).toBeTruthy()
    expect(new Set(names).size).toBe(PICKER_EMOJIS.length)
  })

  test('퀵셋 6종은 피커 목록의 부분집합이라 모두 이름이 있다', () => {
    for (const e of QUICK_EMOJIS) expect(PICKER_EMOJIS).toContain(e)
  })
})

describe('emojiReactionLabel', () => {
  test('목록 이모지는 「<한국어 이름> 반응」', () => {
    expect(emojiReactionLabel('👍')).toBe('좋아요 반응')
    // 변형 선택자(U+FE0F)가 붙은 키도 찾힌다.
    expect(emojiReactionLabel('❤️')).toBe('하트 반응')
    expect(emojiReactionLabel('🛠️')).toBe('도구 반응')
  })

  test('목록 밖 이모지는 글리프로 대신한다', () => {
    expect(emojiReactionLabel('🦄')).toBe('🦄 반응')
  })
})
