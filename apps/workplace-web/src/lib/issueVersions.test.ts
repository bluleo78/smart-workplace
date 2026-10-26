import { describe, expect, it } from 'vitest'

import type { VersionResponse } from '../types/version'
import { hasActiveVersions, pickerVersionOptions, showVersionField } from './issueVersions'

const v = (id: number, name: string, status: VersionResponse['status'], releaseDate: string | null = null) =>
  ({ id, name, status, releaseDate }) as Pick<VersionResponse, 'id' | 'name' | 'status' | 'releaseDate'>

describe('showVersionField', () => {
  it('보관 안 된 버전이 없고 붙은 것도 없으면 숨긴다', () => {
    expect(showVersionField([], [])).toBe('hidden')
    expect(showVersionField([v(1, 'a', 'ARCHIVED')], [])).toBe('hidden')
  })
  it('보관된 값만 붙은 이슈는 읽기 전용', () => {
    expect(showVersionField([v(1, 'a', 'ARCHIVED')], [{ id: 1 }])).toBe('readonly')
  })
  it('보관 안 된 버전이 있으면 편집', () => {
    expect(hasActiveVersions([v(1, 'a', 'RELEASED')])).toBe(true)
    expect(showVersionField([v(1, 'a', 'RELEASED')], [])).toBe('edit')
  })
})

describe('pickerVersionOptions', () => {
  const list = [v(1, 'r1', 'RELEASED'), v(2, 'u1', 'UNRELEASED'), v(3, 'old', 'ARCHIVED'), v(4, 'u2', 'UNRELEASED')]
  it('미출시 먼저, 보관 제외', () => {
    expect(pickerVersionOptions(list, []).map((x) => x.id)).toEqual([2, 4, 1])
  })
  it('이미 붙은 보관 버전은 맨 뒤에 남긴다', () => {
    expect(pickerVersionOptions(list, [3]).map((x) => x.id)).toEqual([2, 4, 1, 3])
  })
})
