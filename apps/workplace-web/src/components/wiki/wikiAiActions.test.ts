import { describe, expect, it } from 'vitest'

import {
  LANGUAGE_PRESETS,
  TONE_PRESETS,
  TRANSFORM_ACTIONS,
} from './wikiAiActions'

describe('wikiAiActions', () => {
  it('변형 액션 5종을 정의한다', () => {
    expect(TRANSFORM_ACTIONS.map((a) => a.key)).toEqual([
      'rewrite_tone',
      'translate',
      'expand',
      'condense',
      'polish',
    ])
  })

  it('톤·번역만 param 을 가진다', () => {
    const withParam = TRANSFORM_ACTIONS.filter((a) => a.param).map((a) => a.key)
    expect(withParam).toEqual(['rewrite_tone', 'translate'])
  })

  it('프리셋은 톤 4·언어 4', () => {
    expect(TONE_PRESETS).toHaveLength(4)
    expect(LANGUAGE_PRESETS).toHaveLength(4)
    expect(TONE_PRESETS.map((t) => t.value)).toContain('격식체')
    expect(LANGUAGE_PRESETS.map((l) => l.value)).toContain('영어')
  })

})
