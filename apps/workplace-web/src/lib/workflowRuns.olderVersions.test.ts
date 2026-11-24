import { describe, expect, it } from 'vitest'

import { olderRunsNotice, olderVersionRuns } from './workflowRuns'

// 옛 버전 실행 안내(WP-2044) — 서버 run-counts 는 게시 버전만 세므로 옛 버전 실행을 따로 골라 알린다.
describe('olderVersionRuns', () => {
  it('olderVersionRuns_ignoresActiveAndZero', () => {
    expect(olderVersionRuns([{ versionNo: 2, activeRuns: 3 }, { versionNo: 1, activeRuns: 0 }], 2)).toEqual([])
  })
  it('olderVersionRuns_picksOlderDescending', () => {
    const versions = [{ versionNo: 1, activeRuns: 1 }, { versionNo: 4, activeRuns: 5 }, { versionNo: 3, activeRuns: 2 }]
    expect(olderVersionRuns(versions, 4)).toEqual([{ versionNo: 3, activeRuns: 2 }, { versionNo: 1, activeRuns: 1 }])
  })
  it('olderVersionRuns_noActiveVersion_empty', () => {
    expect(olderVersionRuns([{ versionNo: 1, activeRuns: 1 }], null)).toEqual([])
    expect(olderVersionRuns(undefined, 2)).toEqual([])
  })
})

describe('olderRunsNotice', () => {
  it('olderRunsNotice_single', () => {
    expect(olderRunsNotice([{ versionNo: 1, activeRuns: 2 }], 2)).toBe(
      '옛 버전 실행 2개는 이 그래프에 표시하지 않습니다 (v1 2개) — 게시 버전 v2의 실행만 단계에 셉니다.',
    )
  })
  it('olderRunsNotice_multipleVersions', () => {
    expect(olderRunsNotice([{ versionNo: 3, activeRuns: 2 }, { versionNo: 1, activeRuns: 1 }], 4)).toBe(
      '옛 버전 실행 3개는 이 그래프에 표시하지 않습니다 (v3 2개, v1 1개) — 게시 버전 v4의 실행만 단계에 셉니다.',
    )
  })
  it('olderRunsNotice_empty_null', () => {
    expect(olderRunsNotice([], 2)).toBeNull()
  })
})
