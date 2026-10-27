// 이슈 생성 부모 결정 단위 테스트(WP-412) — 이전 E2E mobile/issue-create(에픽 고른 뒤 유형을 에픽으로 → parentNumber 없음)를 대체.
// WP-1039 다른 프로젝트 에픽을 고르면 parentKey 로 보낸다.
import { describe, expect, it } from 'vitest'

import { resolveCreateParent } from './issueCreateParent'

const base = { isSubtask: false, isEpic: false, formParentNumber: undefined, projectKey: 'WP' }

describe('resolveCreateParent', () => {
  it('일반 이슈는 고른 에픽 번호를 부모로', () => {
    expect(resolveCreateParent({ ...base, epic: { number: 50 } })).toEqual({ parentNumber: 50 })
    expect(resolveCreateParent({ ...base, epic: { projectKey: 'WP', number: 50 } })).toEqual({ parentNumber: 50 })
  })
  it('다른 프로젝트 에픽은 parentKey 로 (WP-1039)', () => {
    expect(resolveCreateParent({ ...base, epic: { projectKey: 'PLAN', number: 3, title: '분기 계획' } })).toEqual({ parentKey: 'PLAN-3' })
  })
  it('에픽을 고른 뒤 유형을 에픽으로 바꾸면 부모를 보내지 않는다', () => {
    expect(resolveCreateParent({ ...base, isEpic: true, epic: { number: 50 } })).toEqual({})
  })
  it('SUBTASK 는 에픽 칩이 아니라 폼의 부모 번호를 쓴다', () => {
    expect(resolveCreateParent({ ...base, isSubtask: true, formParentNumber: 7, epic: { projectKey: 'PLAN', number: 3 } })).toEqual({ parentNumber: 7 })
    expect(resolveCreateParent({ ...base, isSubtask: true, formParentNumber: null, epic: null })).toEqual({})
  })
  it('에픽을 고르지 않은 일반 이슈는 부모 없음', () => {
    expect(resolveCreateParent({ ...base, epic: null })).toEqual({})
  })
})
