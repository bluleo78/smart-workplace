// 「수정 버전」·「영향 버전」 facet(WP-888) — 보관 안 된 버전이 없으면 facet 자체가 없고, 「… 버전 없음」·「보관됨」 묶음 순서를 지킨다.
import { describe, expect, it } from 'vitest'

import type { VersionResponse } from '../../../types/version'
import { buildVersionFacet, versionFacetValue, versionFilterFromFacet } from './versionFacet'

const ver = (id: number, name: string, status: VersionResponse['status'] = 'UNRELEASED'): VersionResponse => ({
  id, name, description: null, startDate: null, releaseDate: null, status, releasedAt: null,
  progress: { done: 0, inProgress: 0, todo: 0 }, affectsCount: 0,
})

describe('buildVersionFacet', () => {
  it('보관 안 된 버전이 없으면 null — 필터 바에 버전이 보이지 않는다', () => {
    expect(buildVersionFacet('fix', [])).toBeNull()
    expect(buildVersionFacet('affects', [ver(1, 'Old', 'ARCHIVED')])).toBeNull()
  })

  it('그 필터가 걸려 있으면 남긴다(풀 수 있게)', () => {
    const facet = buildVersionFacet('fix', [ver(1, 'Old', 'ARCHIVED')], true)!
    expect(facet.options.map((o) => o.value)).toEqual(['none', 1])
  })

  it('보관 안 된 것(목록 순서) → 「… 버전 없음」 → 「보관됨」 묶음, 종류별 키·문구', () => {
    const list = [ver(1, 'A'), ver(2, 'Old', 'ARCHIVED'), ver(3, 'B', 'RELEASED')]
    const fix = buildVersionFacet('fix', list)!
    expect(fix.key).toBe('fixVersion')
    expect(fix.label).toBe('수정 버전')
    expect(fix.options.map((o) => [o.value, o.label, o.group])).toEqual([
      [1, 'A', undefined],
      [3, 'B', undefined],
      ['none', '수정 버전 없음', undefined],
      [2, 'Old', '보관됨'],
    ])
    const affects = buildVersionFacet('affects', list)!
    expect(affects.key).toBe('affectsVersion')
    expect(affects.options.find((o) => o.value === 'none')?.label).toBe('영향 버전 없음')
  })
})

describe('버전 facet 값 왕복', () => {
  it('id 와 「없음」이 facet 값으로 오가며 유지된다', () => {
    const v = versionFacetValue([3, 5], true)
    expect(v).toEqual([3, 5, 'none'])
    expect(versionFilterFromFacet(v)).toEqual({ ids: [3, 5], none: true })
    expect(versionFilterFromFacet(undefined)).toEqual({ ids: [], none: false })
  })
})
