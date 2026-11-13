// 드라이브 행 작업 비활성 판정 — 보관 공간·보기 전용 역할·원본 유실(WP-413: 비활성만 보던 E2E 를 대체).
import { describe, expect, it } from 'vitest'

import type { DriveSpace } from '../types/drive'
import { driveFileActionDisabled, driveFolderActionDisabled, isDriveViewer, visibleDriveRowActions } from './driveRowActions'

// 판정에 쓰는 공간 필드만 — 보관 여부와 내 역할.
const space = (archived: boolean, role: DriveSpace['role'] = 'EDITOR') => ({ archived, role })

describe('driveFileActionDisabled', () => {
  it('일반 파일은 모두 활성', () => {
    expect(Object.values(driveFileActionDisabled({ space: space(false), missing: false })).some(Boolean)).toBe(false)
  })

  it('보관된 공간(편집자): 쓰기 작업만 비활성, 다운로드·공유·버전 이력은 그대로', () => {
    expect(driveFileActionDisabled({ space: space(true), missing: false })).toEqual({
      download: false, share: false, rename: true, move: true, copy: true, versions: false, delete: true,
    })
  })

  it('원본 유실(#739): 다운로드·공유·복사는 비활성, 이동(메타데이터만)·이름 변경·삭제는 허용', () => {
    expect(driveFileActionDisabled({ space: space(false), missing: true })).toEqual({
      download: true, share: true, rename: false, move: false, copy: true, versions: false, delete: false,
    })
  })

  it('보기 전용 역할(WP-582): 쓰기 작업에 더해 공유도 비활성, 다운로드·버전 이력은 그대로', () => {
    expect(driveFileActionDisabled({ space: space(false, 'VIEWER'), missing: false })).toEqual({
      download: false, share: true, rename: true, move: true, copy: true, versions: false, delete: true,
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

// WP-1538 — 폴더 행 작업 비활성: 공유 링크는 파일과 같은 규칙(보관 공간은 열림), 나머지는 읽기 전용이면 막힌다.
describe('driveFolderActionDisabled', () => {
  it('folder share enabled for editor', () => {
    expect(driveFolderActionDisabled({ space: space(false) }).share).toBe(false)
  })
  it('folder share enabled on archived space (modal explains)', () => {
    const off = driveFolderActionDisabled({ space: space(true) })
    expect(off.share).toBe(false)
    expect(off.rename).toBe(true)
    expect(off).toEqual({ share: false, rename: true, move: true, copy: true, delete: true })
  })
  it('viewer: everything disabled and share hidden by visibleDriveRowActions', () => {
    expect(driveFolderActionDisabled({ space: space(false, 'VIEWER') }).share).toBe(true)
    expect(visibleDriveRowActions([{ key: 'share' }], true)).toEqual([])
  })
})
