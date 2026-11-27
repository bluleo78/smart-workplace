// 워크플로우 결과·출력 표시 이름 해석(WP-2158) — 서버(WorkflowDisplayNames)와 같은 규칙.
import { describe, expect, test } from 'vitest'

import { outcomeDisplayName, outputDisplayName } from './workflowNames'

describe('outcomeDisplayName', () => {
  test.each([
    ['approve', '승인', '승인'],
    ['approve', '  ', 'approve'],
    ['approve', '', 'approve'],
    ['approve', null, 'approve'],
    ['approve', undefined, 'approve'],
    ['ask', undefined, '질문'],
    ['answered', null, '답변'],
    ['ask', '문의', '문의'],
    ['ask', ' ', '질문'],
    ['_recover', undefined, '조치'],
  ])('key=%s name=%s -> %s', (key, name, want) => {
    expect(outcomeDisplayName(key, name)).toBe(want)
  })
})

describe('outputDisplayName', () => {
  test.each([
    ['tag', '태그', '태그'],
    ['tag', '', 'tag'],
    ['tag', null, 'tag'],
    ['tag', undefined, 'tag'],
    ['ask', undefined, 'ask'],
  ])('key=%s name=%s -> %s', (key, name, want) => {
    expect(outputDisplayName(key, name)).toBe(want)
  })
})
