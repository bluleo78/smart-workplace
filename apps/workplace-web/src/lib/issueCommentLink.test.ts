import { describe, expect, test } from 'vitest'

import { commentIdFromHash, issueCommentPath } from './issueCommentLink'

describe('이슈 코멘트 링크(WP-1175)', () => {
  test('코멘트로 가는 경로는 이슈 경로에 #comment-<id> 를 붙인다', () => {
    expect(issueCommentPath('WP', 12, 345)).toBe('/projects/WP/issues/12#comment-345')
  })

  test('코멘트 조각에서 id 를 읽는다 — 다른 조각·잘못된 값은 null', () => {
    expect(commentIdFromHash('#comment-345')).toBe(345)
    expect(commentIdFromHash('')).toBeNull()
    expect(commentIdFromHash('#comment-')).toBeNull()
    expect(commentIdFromHash('#comment-0')).toBeNull()
    expect(commentIdFromHash('#comment-12x')).toBeNull()
    expect(commentIdFromHash('#history-3')).toBeNull()
    expect(commentIdFromHash('#comment-99999999999999999999')).toBeNull()
  })
})
