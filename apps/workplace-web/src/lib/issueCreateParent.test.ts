// 이슈 생성 parentNumber 결정 단위 테스트(WP-412) — 이전 E2E mobile/issue-create(에픽 고른 뒤 유형을 에픽으로 → parentNumber 없음)를 대체.
import { describe, expect, it } from 'vitest'

import { resolveParentNumber } from './issueCreateParent'

describe('resolveParentNumber', () => {
  it('일반 이슈는 고른 에픽 번호를 부모로', () => {
    expect(resolveParentNumber({ isSubtask: false, isEpic: false, formParentNumber: undefined, epicNumber: 50 })).toBe(50)
  })
  it('에픽을 고른 뒤 유형을 에픽으로 바꾸면 부모를 보내지 않는다', () => {
    expect(resolveParentNumber({ isSubtask: false, isEpic: true, formParentNumber: undefined, epicNumber: 50 })).toBeUndefined()
  })
  it('SUBTASK 는 에픽 칩이 아니라 폼의 부모 번호를 쓴다', () => {
    expect(resolveParentNumber({ isSubtask: true, isEpic: false, formParentNumber: 7, epicNumber: 50 })).toBe(7)
    expect(resolveParentNumber({ isSubtask: true, isEpic: false, formParentNumber: null, epicNumber: null })).toBeUndefined()
  })
  it('에픽을 고르지 않은 일반 이슈는 부모 없음', () => {
    expect(resolveParentNumber({ isSubtask: false, isEpic: false, formParentNumber: undefined, epicNumber: null })).toBeUndefined()
  })
})
