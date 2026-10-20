// 드라이브 행 작업 비활성 판정 — 보관 공간·원본 유실(WP-413: 비활성만 보던 E2E 를 대체).
import { describe, expect, it } from 'vitest'

import { driveFileActionDisabled, isDriveViewer, visibleDriveRowActions } from './driveRowActions'

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

// WP-602 — 팀 공간 VIEWER 에게는 읽기 동작(다운로드·버전 이력)만 보인다.
describe('visibleDriveRowActions', () => {
  const file = ['download', 'share', 'rename', 'move', 'copy', 'versions', 'delete'].map((key) => ({ key }))
  const folder = ['rename', 'move', 'copy', 'delete'].map((key) => ({ key }))
  it('VIEWER 는 파일에서 다운로드·버전 이력만, 폴더는 아무것도 없다', () => {
    expect(visibleDriveRowActions(file, true).map((a) => a.key)).toEqual(['download', 'versions'])
    expect(visibleDriveRowActions(folder, true)).toEqual([])
  })
  it('편집 역할이면 그대로', () => {
    expect(visibleDriveRowActions(file, false)).toHaveLength(7)
    expect(visibleDriveRowActions(folder, false)).toHaveLength(4)
  })
})

describe('isDriveViewer', () => {
  it('VIEWER 만 참, 공간 정보가 없으면 거짓', () => {
    expect(isDriveViewer({ role: 'VIEWER' })).toBe(true)
    expect(isDriveViewer({ role: 'EDITOR' })).toBe(false)
    expect(isDriveViewer({ role: 'OWNER' })).toBe(false)
    expect(isDriveViewer(null)).toBe(false)
  })
})
