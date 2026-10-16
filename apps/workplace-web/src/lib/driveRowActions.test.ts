// 드라이브 행 작업 비활성 판정 — 보관 공간·원본 유실(WP-413: 비활성만 보던 E2E 를 대체).
import { describe, expect, it } from 'vitest'

import { driveFileActionDisabled } from './driveRowActions'

describe('driveFileActionDisabled', () => {
  it('일반 파일은 모두 활성', () => {
    expect(Object.values(driveFileActionDisabled({ archived: false, missing: false })).some(Boolean)).toBe(false)
  })

  it('보관된 공간: 쓰기 작업만 비활성, 다운로드·공유·버전 이력은 그대로', () => {
    expect(driveFileActionDisabled({ archived: true, missing: false })).toEqual({
      download: false, share: false, rename: true, move: true, copy: true, versions: false, delete: true,
    })
  })

  it('원본 유실(#739): 다운로드·공유·복사는 비활성, 이동(메타데이터만)·이름 변경·삭제는 허용', () => {
    expect(driveFileActionDisabled({ archived: false, missing: true })).toEqual({
      download: true, share: true, rename: false, move: false, copy: true, versions: false, delete: false,
    })
  })
})
