// 왜: 서버 IssueService.setType 의 releasesParent 와 식을 같이 유지해야 한다(WP-2097)
// 유형 변경 시 상위 해제 판정 순수 함수 단위 테스트 — 서버 규칙과 한 식인지를 고정한다.
import { describe, expect, it } from 'vitest'

import {
  parentLinkChangeChoices,
  releasesParentType,
  shouldShowParentLinkChange,
} from './issueTypeParentLink'

describe('releasesParentType', () => {
  // releasesParentType — 서버 IssueService.setType 의 releasesParent 와 같은 식
  it('하위 태스크 → 비하위 태스크 유형이면 true', () => expect(releasesParentType('SUBTASK', 'TASK')).toBe(true))
  it('어떤 유형 → EPIC 이면 true', () => expect(releasesParentType('BUG', 'EPIC')).toBe(true))
  it('태스크 → 버그처럼 상위가 유지되는 변경은 false', () => expect(releasesParentType('TASK', 'BUG')).toBe(false))
  it('SUBTASK → SUBTASK 는 false', () => expect(releasesParentType('SUBTASK', 'SUBTASK')).toBe(false))
})

describe('shouldShowParentLinkChange', () => {
  // shouldShowParentLinkChange — 상위가 있어야 창이 뜬다 (Review Focus 4)
  it('상위가 없으면 releases 여부와 상관없이 false', () => {
    expect(shouldShowParentLinkChange({ oldTypeName: 'SUBTASK', newTypeName: 'TASK', parentKey: null })).toBe(false)
  })
  it('상위가 있고 releases 면 true', () => {
    expect(shouldShowParentLinkChange({ oldTypeName: 'SUBTASK', newTypeName: 'TASK', parentKey: 'WP-12' })).toBe(true)
  })
  it('상위가 있어도 releases 가 아니면 false', () => {
    expect(shouldShowParentLinkChange({ oldTypeName: 'TASK', newTypeName: 'BUG', parentKey: 'WP-12' })).toBe(false)
  })
})

describe('parentLinkChangeChoices', () => {
  it('지금 상위가 에픽 아래면 이동 선택지에 에픽을 담는다', () => {
    const c = parentLinkChangeChoices({ newTypeName: 'TASK', grandparentTypeName: 'EPIC', grandparentKey: 'WP-9', grandparentTitle: '기능' })
    expect(c).toEqual({ choice: 'move-under-epic', epic: { key: 'WP-9', title: '기능' } })
  })
  it('에픽 아래가 아니면 상위 없이 변경만 있다', () => {
    expect(parentLinkChangeChoices({ newTypeName: 'TASK', grandparentTypeName: null, grandparentKey: null, grandparentTitle: null }))
      .toEqual({ choice: 'detach' })
  })
  // WP-2132 — 완료된 에픽 아래로는 서버가 거절하므로 이동 대신 막힘 표시와 함께 detach 로 낸다.
  const done = { newTypeName: 'TASK', grandparentTypeName: 'EPIC', grandparentKey: 'WP-1', grandparentTitle: '에픽' }
  it.each(['IN_PROGRESS', 'TODO'] as const)('DONE 에픽 + 열린 이슈(%s)면 detach 에 epic 을 싣고 moveBlocked true', (s) => {
    expect(parentLinkChangeChoices({ ...done, grandparentStatus: 'DONE', issueStatus: s })).toEqual({
      choice: 'detach',
      epic: { key: 'WP-1', title: '에픽' },
      moveBlocked: true,
    })
  })
  it.each(['DONE', 'CANCELED'] as const)('DONE 에픽 + %s 이슈는 막지 않는다', (s) => {
    const c = parentLinkChangeChoices({ ...done, grandparentStatus: 'DONE', issueStatus: s })
    expect(c.choice).toBe('move-under-epic')
    expect(c.moveBlocked).toBeUndefined()
  })
  it('CANCELED 에픽은 막지 않는다', () => {
    expect(parentLinkChangeChoices({ ...done, grandparentStatus: 'CANCELED', issueStatus: 'TODO' }).choice).toBe('move-under-epic')
  })
  it('상태가 없으면(구 응답) 막지 않는다', () => {
    expect(parentLinkChangeChoices({ ...done }).choice).toBe('move-under-epic')
  })
  it('신규 유형 EPIC 은 DONE 에픽이어도 detach 만이고 moveBlocked 없음', () => {
    expect(parentLinkChangeChoices({ ...done, newTypeName: 'EPIC', grandparentStatus: 'DONE', issueStatus: 'TODO' })).toEqual({ choice: 'detach' })
  })
  // 완료 기준 7 — 대상이 EPIC 이면 에픽은 상위를 둘 수 없어 할아버지 에픽이 있어도 이동 선택지를 못 만든다.
  // (그래야 parentKey 없는 payload 가 나가 서버 400(EpicCannotHaveParent) 대신 정상 해제된다)
  it('신규 유형이 EPIC 이면 할아버지 에픽이 있어도 상위 없이 변경만 있다', () => {
    expect(parentLinkChangeChoices({ newTypeName: 'EPIC', grandparentTypeName: 'EPIC', grandparentKey: 'WP-9', grandparentTitle: '기능' }))
      .toEqual({ choice: 'detach' })
  })
})
