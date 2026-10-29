// 구성요소(WP-933) 화면 판정 — 보이는 조건·자동 지정 안내·피커 선택지.
import { describe, expect, it } from 'vitest'

import type { ComponentResponse, ComponentSummary } from '../types/component'
import { assigneeInvalidText, autoAssignHint, componentPatch, hasActiveComponents, pickerComponentOptions, showComponentField } from './issueComponents'

const user = (id: number, name: string) => ({ id, username: `u${id}`, name, kind: 'HUMAN' as const })

function comp(id: number, name: string, extra: Partial<ComponentResponse> = {}): ComponentResponse {
  return {
    id,
    name,
    description: null,
    defaultAssignee: null,
    defaultAssigneeValid: true,
    archived: false,
    issueCount: 0,
    ...extra,
  }
}

const summary = (c: ComponentResponse): ComponentSummary => ({ id: c.id, name: c.name, archived: c.archived })

describe('hasActiveComponents', () => {
  it('보관 안 된 구성요소가 하나라도 있으면 true', () => {
    expect(hasActiveComponents([comp(1, 'A', { archived: true }), comp(2, 'B')])).toBe(true)
  })
  it('없거나 모두 보관이면 false', () => {
    expect(hasActiveComponents([])).toBe(false)
    expect(hasActiveComponents([comp(1, 'A', { archived: true })])).toBe(false)
  })
})

describe('showComponentField — componentsHidden', () => {
  it('사용 중 구성요소가 0개이고 이슈에 붙은 것도 없으면 hidden', () => {
    expect(showComponentField([], [])).toBe('hidden')
    expect(showComponentField([comp(1, 'A', { archived: true })], [])).toBe('hidden')
  })
  it('사용 중 구성요소가 없어도 보관된 값이 붙은 이슈는 readonly', () => {
    const archived = comp(1, 'A', { archived: true })
    expect(showComponentField([archived], [summary(archived)])).toBe('readonly')
  })
  it('사용 중 구성요소가 있으면 edit', () => {
    expect(showComponentField([comp(1, 'A')], [])).toBe('edit')
  })
})

describe('autoAssignHint', () => {
  const list = [
    comp(1, 'Alpha'),
    comp(2, 'Compute', { defaultAssignee: user(10, '박순'), defaultAssigneeValid: true }),
    comp(3, 'Storage', { defaultAssignee: user(11, '김민'), defaultAssigneeValid: true }),
    comp(4, 'Network', { defaultAssignee: user(12, '이탈'), defaultAssigneeValid: false }),
    comp(5, 'Old', { defaultAssignee: user(13, '보관'), archived: true }),
  ]

  it('고른 구성요소를 목록 순서로 보아 처음으로 유효한 담당자를 고른다(고른 순서 아님)', () => {
    expect(autoAssignHint([3, 2], list, false)).toEqual({ componentName: 'Compute', assigneeName: '박순' })
  })
  it('담당자를 이미 골랐으면 null', () => {
    expect(autoAssignHint([2], list, true)).toBeNull()
  })
  it('유효한 담당자가 없으면 null — 담당자 없음·무효·보관은 건너뛴다', () => {
    expect(autoAssignHint([1, 4, 5], list, false)).toBeNull()
    expect(autoAssignHint([], list, false)).toBeNull()
  })
  it('무효 담당자는 건너뛰고 다음 구성요소 담당자로', () => {
    expect(autoAssignHint([4, 3], list, false)).toEqual({ componentName: 'Storage', assigneeName: '김민' })
  })
})

describe('pickerComponentOptions', () => {
  it('보관된 것은 빼되, 이슈에 이미 붙은 보관 구성요소는 남긴다(교체 요청에서 조용히 빠지지 않게)', () => {
    const list = [comp(1, 'A'), comp(2, 'B', { archived: true }), comp(3, 'C', { archived: true })]
    expect(pickerComponentOptions(list, [2]).map((c) => c.id)).toEqual([1, 2])
  })
})

describe('componentPatch — 바뀐 필드만 보낸다', () => {
  const initial = { name: 'Compute', description: '서버', defaultAssignee: user(10, '박순') }

  it('바뀐 게 없으면 빈 본문 — 무효가 된 담당자를 다시 보내 400 이 나지 않게', () => {
    expect(componentPatch(initial, { name: ' Compute ', description: '서버', assigneeId: 10 })).toEqual({})
  })
  it('이름·설명 변경, 설명 비우기는 빈 문자열', () => {
    expect(componentPatch(initial, { name: 'Compute2', description: '', assigneeId: 10 })).toEqual({ name: 'Compute2', description: '' })
  })
  it('담당자 교체는 id, 지우기는 clearDefaultAssignee', () => {
    expect(componentPatch(initial, { name: 'Compute', description: '서버', assigneeId: 11 })).toEqual({ defaultAssigneeId: 11 })
    expect(componentPatch(initial, { name: 'Compute', description: '서버', assigneeId: null })).toEqual({ clearDefaultAssignee: true })
  })
  it('설명이 null 이던 구성요소에 빈 설명은 변경이 아니다', () => {
    expect(componentPatch({ ...initial, description: null }, { name: 'Compute', description: '  ', assigneeId: 10 })).toEqual({})
  })
})

describe('assigneeInvalidText — 무효 담당자 이유 문구(WP-1123)', () => {
  it('이유마다 다른 경고·꼬리표, 모르면 아우르는 문구', () => {
    expect(assigneeInvalidText('INACTIVE')).toEqual({ warning: '계정이 정지됐어요 — 자동 지정을 건너뛰어요', tag: '계정 정지' })
    expect(assigneeInvalidText('NOT_MEMBER')).toEqual({ warning: '프로젝트 구성원이 아니에요 — 자동 지정을 건너뛰어요', tag: '구성원 아님' })
    expect(assigneeInvalidText('NOT_HUMAN').tag).toBe('AI')
    expect(assigneeInvalidText(undefined).warning).toBe('자동 지정에 쓸 수 없는 담당자예요 — 자동 지정을 건너뛰어요')
    expect(assigneeInvalidText(null).tag).toBe('쓸 수 없음')
  })
})
